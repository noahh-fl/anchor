export class HttpError extends Error { status:number; constructor(status:number, message:string) { super(message); this.status=status; } }
export async function readLimitedJson(req: Request, limit=18000): Promise<unknown> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415,'Send application/json.');
  if (Number(req.headers.get('content-length')||0)>limit) throw new HttpError(413,'Request is too large.');
  const reader = req.body?.getReader(); if (!reader) throw new HttpError(400,'Missing request.');
  const chunks: Uint8Array[]=[]; let length=0;
  for (;;) { const {done,value}=await reader.read(); if(done) break; length+=value.length; if(length>limit){await reader.cancel();throw new HttpError(413,'Request is too large.');} chunks.push(value); }
  const bytes=new Uint8Array(length); let i=0; for(const c of chunks){bytes.set(c,i);i+=c.length;}
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400,'Invalid JSON.'); }
}
export async function supabaseRequest(base:string,key:string,token:string,path:string,init:RequestInit={}) {
  const response=await fetch(base+path,{...init,headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw new HttpError(response.status===401?401:503,response.status===401?'Please sign in again.':'Account data is unavailable. Try again shortly.');
  return response.status===204?null:await response.json();
}
