import {boundedRows,dayOffset,InputError,localDate,object,responseSchema,validateRequest,validateResponse,validTimezone} from '../_shared/contracts.ts';
import {HttpError,readLimitedJson,supabaseRequest} from '../_shared/http.ts';
import {SYSTEM_PROMPT} from '../_shared/prompt.ts';

Deno.serve(async (req: Request) => {
  const origin=req.headers.get('origin');
  const allowed=(Deno.env.get('ANCHOR_ALLOWED_ORIGINS')||'').split(',').map(x=>x.trim()).filter(Boolean);
  const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
  if(origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin']=origin;
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  try {
    if(origin && !allowed.includes(origin)) throw new HttpError(403,'This app origin is not allowed.');
    if(req.method==='OPTIONS') return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info'}});
    if(req.method!=='POST') throw new HttpError(405,'Use POST.');
    const token=req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if(!token) throw new HttpError(401,'Please sign in.');
    const base=Deno.env.get('SUPABASE_URL')?.replace(/\/$/,'');
    const publicKey=Deno.env.get('SUPABASE_ANON_KEY');
    const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const providerKey=Deno.env.get('OPENAI_API_KEY');
    const model=Deno.env.get('ANCHOR_AI_MODEL');
    if(!base||!publicKey||!secret||!providerKey||!model) throw new HttpError(503,'AI is not configured yet. Manual entry is available.');
    const input=validateRequest(await readLimitedJson(req));
    // Validate against Auth, not decoded unverified JWT claims. Every data read uses this user's JWT + explicit ownership filters.
    const user=await supabaseRequest(base,publicKey,token,'/auth/v1/user');
    if(!user?.id || user.is_anonymous) throw new HttpError(401,'A signed-in account is required.');
    const query=async (table:string,params:Record<string,string>)=>supabaseRequest(base,publicKey,token,`/rest/v1/${table}?${new URLSearchParams(params)}`);
    const prefs=await query('account_preferences',{select:'settings',user_id:`eq.${user.id}`,limit:'1'});
    const settings=object(prefs[0]?.settings)?prefs[0].settings:{};
    if(settings.ai_enabled!==true) throw new HttpError(403,'Enable AI in Settings before sending messages.');
    const finances=input.include_finances && settings.finance_ai_opt_in===true;
    const timezone=validTimezone(settings.timezone)?settings.timezone:'UTC';
    const now=new Date(), today=localDate(now,timezone), since=dayOffset(today,-30), until=dayOffset(today,90);
    const baseFilter={user_id:`eq.${user.id}`,limit:'61'};
    const datasets:Record<string,unknown>={}; let truncated=false;
    const retain=(name:string,rows:Record<string,unknown>[],budget=5500)=>{
      const result=boundedRows(rows.slice(0,60),budget); datasets[name]=result.rows;
      if(result.truncated||rows.length>60) truncated=true;
      return result.rows;
    };
    const [tasks,events,profile,habits,lists,listItems,workSchedule]=await Promise.all([
      query('todo_items',{...baseFilter,select:'id,title,description,priority,due_date,status,category',status:'neq.Done',order:'due_date.asc.nullslast,created_at.desc'}),
      query('reminders',{...baseFilter,select:'id,title,date,time,repeat_rule,notes,linked_type',date:`lte.${until}`,or:`(date.gte.${since},repeat_rule.in.(Daily,Weekly,Monthly))`,order:'date.asc'}),
      query('profiles',{select:finances?'name,default_work_type,default_hourly_rate':'name,default_work_type',id:`eq.${user.id}`,limit:'1'}),
      query('habits',{...baseFilter,select:'id,name,description,frequency,target_amount,target_unit,start_date,end_date',order:'created_at.desc'}),
      query('todo_lists',{...baseFilter,select:'id,title,category,priority',order:'created_at.desc'}),
      query('todo_list_items',{...baseFilter,select:'id,list_id,text,completed',completed:'eq.false',order:'created_at.desc'}),
      query('work_shifts',{...baseFilter,select:'id,date,work_type,start_time,end_time',date:`gte.${since}`,and:`(date.lte.${until})`,order:'date.asc'})
    ]);
    retain('tasks',tasks); retain('calendar',events);
    retain('habits',habits,2500); retain('lists',lists,1500); retain('list_items',listItems,2500); retain('work_schedule',workSchedule,3500);
    datasets.profile=boundedRows(profile,1000).rows[0]||{};
    if(finances){
      const [entries,shifts]=await Promise.all([
        query('finance_entries',{...baseFilter,select:'id,type,date,amount,category,description',date:`gte.${since}`,and:`(date.lte.${today})`,order:'date.desc'}),
        query('work_shifts',{...baseFilter,select:'id,date,work_type,hours_worked,hourly_rate,total_tips,total_shift_income',date:`gte.${since}`,and:`(date.lte.${today})`,order:'date.desc'})
      ]);
      const f=retain('finances',entries,4000), s=retain('work_shifts',shifts,3500);
      const cents=(x:unknown)=>Math.round((Number(x)||0)*100);
      const income=f.filter(x=>x.type==='income').reduce((n,x)=>n+cents(x.amount),0)+s.reduce((n,x)=>n+cents(x.total_shift_income),0);
      const expense=f.filter(x=>x.type==='expense').reduce((n,x)=>n+cents(x.amount),0);
      datasets.finance_totals={income:income/100,expense:expense/100,net:(income-expense)/100,scope:'Only the records included below; no all-time total.'};
    }
    const context={as_of:now.toISOString(),today,timezone,finance_included:finances,truncated,coverage:{calendar_from:since,calendar_to:until,calendar_includes_older_recurrences:true,tasks:'At most 60 open tasks',finances_from:finances?since:null,finances_to:finances?today:null},records:datasets};
    const modelInput=JSON.stringify({context,history:input.history,message:input.message});
    // One byte per possible input token is deliberately conservative. Reservation is not refunded on failure.
    const reserved=new TextEncoder().encode(SYSTEM_PROMPT+modelInput+JSON.stringify(responseSchema)).length+2200;
    const quota=await supabaseRequest(base,secret,secret,'/rest/v1/rpc/anchor_reserve_ai_usage',{method:'POST',body:JSON.stringify({p_user_id:user.id,p_reserved_tokens:reserved})});
    if(quota.allowed!==true) {headers['Retry-After']=String(quota.retry_after||60);throw new HttpError(429,'AI usage limit reached. Try later or use manual entry.');}
    const response=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',headers:{Authorization:`Bearer ${providerKey}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),
      body:JSON.stringify({model,store:false,instructions:SYSTEM_PROMPT,input:modelInput,max_output_tokens:2000,text:{format:{type:'json_schema',name:'anchor_response',strict:true,schema:responseSchema}}})
    });
    if(!response.ok) throw new HttpError(response.status===429?429:502,'AI is temporarily unavailable. Your entries were not changed.');
    const result=await response.json();
    if(result.status!=='completed') throw new HttpError(502,'AI could not finish a response. Try a shorter request.');
    const text=result.output?.flatMap((x:any)=>x.type==='message'?x.content||[]:[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('');
    let output; try { output=validateResponse(JSON.parse(text||'')); } catch { throw new HttpError(502,'AI returned an invalid response. Please try again or use manual entry.'); }
    // Never persist conversational text or private record context in usage logs.
    return reply({...output,context:{...context,records:undefined},usage:{request_id:quota.request_id}});
  } catch(error) {
    if(error instanceof HttpError) return reply({error:error.message},error.status);
    if(error instanceof InputError) return reply({error:error.message},400);
    return reply({error:'Request could not be completed. Your entries were not changed.'},503);
  }
});
