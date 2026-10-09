import {supabaseRequest} from '../_shared/http.ts';
// This worker has one fixed destination: the project's in-app notification outbox.
// It cannot accept delivery URLs, recipients, provider keys or arbitrary payloads.
Deno.serve(async (req:Request)=>{
  const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
  const response=(data:unknown,status:number)=>new Response(JSON.stringify(data),{status,headers});
  if(req.method!=='POST') return response({error:'Use POST'},405);
  const expected=Deno.env.get('ANCHOR_DISPATCH_SECRET');
  const supplied=req.headers.get('x-anchor-dispatch-secret')||'';
  if(!expected || supplied.length!==expected.length) return response({error:'Unauthorized'},401);
  // Constant-work compare after a public length check.
  let mismatch=0; for(let i=0;i<expected.length;i++) mismatch|=expected.charCodeAt(i)^supplied.charCodeAt(i);
  if(mismatch) return response({error:'Unauthorized'},401);
  if(Number(req.headers.get('content-length')||0)>0) return response({error:'No payload accepted'},400);
  const base=Deno.env.get('SUPABASE_URL'), key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!base||!key) return response({error:'Dispatcher is not configured'},503);
  try {
    const result=await supabaseRequest(base,key,key,'/rest/v1/rpc/anchor_dispatch_reminders',{method:'POST',body:'{}'});
    return response(result,200);
  } catch { return response({error:'Dispatch failed; the database transaction was rolled back'},503); }
});
