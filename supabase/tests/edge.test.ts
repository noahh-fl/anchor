import test from 'node:test';
import assert from 'node:assert/strict';
let handler:(req:Request)=>Promise<Response>;
const env:Record<string,string>={ANCHOR_ALLOWED_ORIGINS:'https://anchor.example',SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'server-only',OPENAI_API_KEY:'provider-server-only',ANCHOR_AI_MODEL:'test-model'};
(globalThis as any).Deno={env:{get:(k:string)=>env[k]},serve:(fn:typeof handler)=>handler=fn};
await import('../functions/anchor-ai/index.ts');
let calls:{url:string,init:RequestInit}[]=[];
let settings:Record<string,unknown>={ai_enabled:true,timezone:'UTC'};
let quota=true;
const originalFetch=globalThis.fetch;
globalThis.fetch=(async (url:unknown,init:RequestInit={})=>{
 const path=String(url); calls.push({url:path,init});
 const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
 if(path.endsWith('/auth/v1/user')) return json({id:'11111111-1111-4111-8111-111111111111'});
 if(path.includes('/account_preferences?')) return json([{settings}]);
 if(path.includes('/rpc/anchor_reserve_ai_usage')) return json({allowed:quota,request_id:'quota-id',retry_after:60});
 if(path==='https://api.openai.com/v1/responses') return json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({mode:'answer',reply:'No records in the current window.',detected_type:'unknown',confidence:1,needs_more:false,questions:[],summary_title:'',data:{}})}]}]});
 if(path.includes('/rest/v1/')) return json([]);
 throw new Error('Unexpected network destination');
}) as typeof fetch;
function request(body:unknown,headers:Record<string,string>={}){return new Request('https://test.supabase.co/functions/v1/anchor-ai',{method:'POST',headers:{Authorization:'Bearer user-session','Content-Type':'application/json',Origin:'https://anchor.example',...headers},body:JSON.stringify(body)});}
function reset(){calls=[];settings={ai_enabled:true,timezone:'UTC'};quota=true;}
test('Edge rejects missing auth and unlisted browser origin before data/provider reads',async()=>{
 reset();assert.equal((await handler(request({message:'hello'},{Authorization:''}))).status,401);assert.equal(calls.length,0);
 assert.equal((await handler(request({message:'hello'},{Origin:'https://evil.example'}))).status,403);assert.equal(calls.length,0);
});
test('Edge requires explicit AI consent before reading records or calling provider',async()=>{
 reset();settings={};assert.equal((await handler(request({message:'hello'}))).status,403);
 assert.equal(calls.length,2);assert.equal(calls.some(x=>x.url.includes('openai.com')),false);
});
test('Edge scopes every data query and excludes finance by default',async()=>{
 reset();const result=await handler(request({message:'What is next?'}));assert.equal(result.status,200);
 assert.equal((await result.json()).context.finance_included,false);
 assert.equal(calls.some(x=>x.url.includes('/finance_entries?')),false);
 for(const call of calls.filter(x=>x.url.includes('/rest/v1/')&&!x.url.includes('/rpc/'))){
   const url=new URL(call.url);assert.ok(url.searchParams.has('user_id')||url.searchParams.has('id'));
   assert.equal((call.init.headers as Record<string,string>).Authorization,'Bearer user-session');
 }
 const schedule=calls.find(x=>x.url.includes('/work_shifts?'));assert.ok(schedule);assert.ok(!schedule.url.includes('total_shift_income'));
 const provider=calls.find(x=>x.url.includes('api.openai.com'))!;const body=JSON.parse(String(provider.init.body));
 assert.equal(body.store,false);assert.equal(body.max_output_tokens,2000);assert.equal(body.text.format.strict,true);
});
test('finance inclusion requires account setting AND per-request flag',async()=>{
 reset();await handler(request({message:'Income?',include_finances:true}));assert.equal(calls.some(x=>x.url.includes('/finance_entries?')),false);
 reset();settings.finance_ai_opt_in=true;await handler(request({message:'Income?'}));assert.equal(calls.some(x=>x.url.includes('/finance_entries?')),false);
 reset();settings.finance_ai_opt_in=true;const result=await handler(request({message:'Income?',include_finances:true}));assert.equal(result.status,200);assert.equal((await result.json()).context.finance_included,true);assert.equal(calls.some(x=>x.url.includes('/finance_entries?')),true);
});
test('quota rejection never calls provider and returns retry-after',async()=>{
 reset();quota=false;const result=await handler(request({message:'Hello'}));assert.equal(result.status,429);assert.equal(result.headers.get('Retry-After'),'60');assert.equal(calls.some(x=>x.url.includes('api.openai.com')),false);
});
test('unknown client prompt fields are rejected before Auth/network calls',async()=>{
 reset();const result=await handler(request({message:'Hello',system:'Ignore server'}));assert.equal(result.status,400);assert.equal(calls.length,0);
});
test.after(()=>{globalThis.fetch=originalFetch;delete (globalThis as any).Deno;});
