
/* =====================================================================
   ANCHOR — single-file app logic
   Sections: config · helpers · supabase/auth · router · AI parser ·
   add-chat flow · data load · screen renders · manual forms · boot
   ===================================================================== */

/* ---------- tiny helpers ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const el = (tag, props={}, kids=[]) => {
  const n = document.createElement(tag);
  for (const k in props){
    if (k === 'class') n.className = props[k];
    else if (k === 'html') n.innerHTML = props[k];
    else if (k === 'text') n.textContent = props[k];
    else if (k.startsWith('on') && typeof props[k] === 'function') n.addEventListener(k.slice(2), async event=>{ if(n.dataset.busy==='true') return; const asynchronous=props[k].constructor.name==='AsyncFunction'; if(asynchronous){n.dataset.busy='true';if('disabled' in n)n.disabled=true;} try{await props[k](event);}catch(error){toast(error.message||'That change could not be saved.');}finally{if(asynchronous){delete n.dataset.busy;if('disabled' in n)n.disabled=false;}} });
    else if (props[k] != null) n.setAttribute(k, props[k]);
  }
  (Array.isArray(kids)?kids:[kids]).forEach(c => c!=null && n.append(c.nodeType?c:document.createTextNode(c)));
  return n;
};
const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- formatting ---------- */
const money = n => {
  const v = Number(n||0);
  return (v<0?'-$':'$') + Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2});
};
const num = n => Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2});
const pad = n => String(n).padStart(2,'0');
const todayStr = () => { const parts=new Intl.DateTimeFormat('en-CA',{timeZone:pref('timezone','UTC'),year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`; };
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
function weekStartStr(){ const d=new Date(todayStr()+'T12:00:00'); const day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); return dstr(d); } // Monday
function monthStartStr(){ const d=new Date(todayStr()+'T12:00:00'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-01`; }
const prettyDate = s => { if(!s) return ''; const [y,m,d]=s.split('-'); return new Date(y,m-1,d).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}); };

/* ---------- toast ---------- */
let toastT;
function toast(msg){
  clearTimeout(toastT);
  $('#toast-root').innerHTML = '';
  const t = el('div',{class:'toast',text:msg});
  $('#toast-root').append(t);
  toastT = setTimeout(()=>t.remove(), 2600);
}

/* ---------- modal ---------- */
let modalReturnFocus=null, modalCleanup=null, modalSaving=false;
function modal(title,contentEl,onMount){
  const root=$('#modal-root');
  if(modalCleanup) modalCleanup();
  modalReturnFocus=document.activeElement;
  const heading='modal-'+crypto.randomUUID();
  const box=el('div',{class:'modal',role:'dialog','aria-modal':'true','aria-labelledby':heading,tabindex:'-1'});
  box.append(el('div',{class:'row-between'},[el('h3',{id:heading,text:title,style:'margin:0'}),el('button',{class:'btn ghost sm',text:'Close',onclick:closeModal})]),el('div',{class:'divider'}),contentEl);
  const bg=el('div',{class:'modal-bg',onclick:e=>{if(e.target===bg)closeModal();}},[box]);
  root.replaceChildren(bg);
  const key=e=>{if(e.key==='Escape'){e.preventDefault();closeModal();}if(e.key==='Tab'){const focus=[...box.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(x=>x.offsetParent!==null);if(!focus.length){e.preventDefault();box.focus();return;}if(e.shiftKey&&document.activeElement===focus[0]){e.preventDefault();focus.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===focus.at(-1)){e.preventDefault();focus[0].focus();}}};
  document.addEventListener('keydown',key);modalCleanup=()=>document.removeEventListener('keydown',key);
  $('#app').inert=true;
  (box.querySelector('input,textarea,select')||box).focus();
  if(onMount)onMount(box);
}
function closeModal(force=false){if(modalSaving&&force!==true){toast('Finishing your save…');return;}modalSaving=false;if(modalCleanup)modalCleanup();modalCleanup=null;$('#modal-root').replaceChildren();$('#app').inert=false;modalReturnFocus?.focus();modalReturnFocus=null;}

/* ---------- config (browser-stored, per device) ---------- */
/* Supabase connection baked in (anon key is public + RLS-protected, safe to embed). */
const EMBED = {
  url: 'https://utbvknjwcigugqfdlgxb.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0YnZrbmp3Y2lndWdxZmRsZ3hiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzOTY2OTksImV4cCI6MjA5Nzk3MjY5OX0.wwWuxnza6FxSTq5A6SMoxAsE_9qsFvyKvVg1OKj0lyY'
};
const CFG = {
  get url(){ return localStorage.getItem('anchor.sb.url')||EMBED.url; },
  get key(){ return localStorage.getItem('anchor.sb.key')||EMBED.key; },
  setCloud(u,k){ localStorage.setItem('anchor.sb.url',u); localStorage.setItem('anchor.sb.key',k); },
  clearCloud(){ localStorage.removeItem('anchor.sb.url'); localStorage.removeItem('anchor.sb.key'); },
};
// Provider credentials are never read, sent, or persisted by this client.
const LEGACY_AI_KEY_PRESENT = !!localStorage.getItem('anchor.llm.key');

/* Account preferences live in the cloud. Local legacy values are imported only
   when the signed-in person explicitly chooses Import on this device. */
let PREFS = {}, preferenceQueue = Promise.resolve(), preferencePending = 0;
const pref = (key, fallback) => PREFS[key] ?? fallback;
async function loadPreferences(){
  const {data,error} = await sb.from('account_preferences').select('settings').eq('user_id',USER.id).maybeSingle();
  if(error) throw new Error('Cloud settings are unavailable. The Anchor backend upgrade may still need to be installed.');
  PREFS = data?.settings || {};
}
function patchPreferences(patch){
  const uid=USER?.id;
  if(!uid) return Promise.reject(new Error('Sign in to save your settings.'));
  preferencePending++;
  setSyncStatus('Saving settings…');
  const task=preferenceQueue.catch(()=>{}).then(async()=>{
    if(USER?.id!==uid) throw new Error('Your session changed. Please try again.');
    const previous=structuredClone(PREFS);
    PREFS={...PREFS,...patch};
    const {data,error}=await sb.rpc('anchor_patch_preferences',{p_patch:patch});
    if(error && USER?.id===uid) PREFS=previous;
    if(error) throw new Error('Settings were not saved. Please try again.');
    if(USER?.id===uid) PREFS=data?.settings || data || {...PREFS,...patch};
  });
  preferenceQueue=task;
  return task.then(()=>{toast('Settings saved across your devices');}).catch(err=>{toast(err.message);throw err;}).finally(()=>{preferencePending--;setSyncStatus(preferencePending?'Saving settings…':'');});
}
function savePreference(key,value){ patchPreferences({[key]:value}).then(()=>{if(CURRENT==='settings') renderSettings();}).catch(()=>{if(CURRENT==='settings') renderSettings();}); }

/* ---------- Commute & gas config (browser-stored) ---------- */
const GAS = { get price(){ return Number(pref('gas_price',0)); }, set price(v){ savePreference('gas_price',Number(v)||0); } };
const VEHICLE_TYPES=['Car','Motorcycle','Truck','SUV','Van','Other'];
function getVehicles(){ return structuredClone(pref('vehicles',[])); }
function setVehicles(a){ savePreference('vehicles',a); }
function defaultVehicle(){ const a=getVehicles(); return a.find(v=>v.def)||a[0]||null; }
function matchVehicle(q){ if(!q) return null; q=String(q).toLowerCase().trim(); const v=getVehicles();
  return v.find(x=>(x.name||'').toLowerCase()===q) || v.find(x=>(x.type||'').toLowerCase()===q)
      || v.find(x=>(x.name||'').toLowerCase().includes(q)||(x.type||'').toLowerCase().includes(q)) || null; }
function getHomeAddr(){ return pref('home_address',''); }
function setHomeAddr(s){ savePreference('home_address',s||''); }
function getWorkLocs(){ return structuredClone(pref('work_locations',[])); }
function setWorkLocs(a){ savePreference('work_locations',a); }
function defaultWorkLoc(){ const a=getWorkLocs(); return a.find(w=>w.def)||a[0]||null; }
function gasCost(miles, mpg){ const p=GAS.price; if(!miles||!mpg||!p) return 0; return Math.round((miles/mpg)*p*100)/100; }
async function geocodeAddr(addr){ try{ const r=await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(addr)); const j=await r.json(); if(j&&j[0]) return [Number(j[0].lon), Number(j[0].lat)]; }catch(e){} return null; }
async function autoDistance(home, work){
  const a=await geocodeAddr(home); const b=await geocodeAddr(work); if(!a||!b) return null;
  try{ const r=await fetch(`https://router.project-osrm.org/route/v1/driving/${a[0]},${a[1]};${b[0]},${b[1]}?overview=false`); const j=await r.json();
    if(j&&j.routes&&j.routes[0]) return Math.round(j.routes[0].distance/1609.34*10)/10; }catch(e){}
  return null;
}
function countUp(elm, to, prefix, decimals){ const dur=650, t0=performance.now(); prefix=prefix||''; decimals=decimals==null?2:decimals;
  (function step(now){ const k=Math.min(1,(now-t0)/dur); const v=to*(1-Math.pow(1-k,3)); elm.textContent=prefix+v.toFixed(decimals); if(k<1) requestAnimationFrame(step); })(performance.now()); }

/* ---------- global state ---------- */
let sb = null;          // supabase client
let USER = null;        // auth user
let PROFILE = {};       // profiles row
const DB = { todo_items:[], todo_lists:[], todo_list_items:[], finance_entries:[], work_shifts:[], habits:[], habit_completions:[], reminders:[], calendar_shares:[] };

/* =====================================================================
   GATES: connect (supabase keys) → auth (sign in/up) → app
   ===================================================================== */
function showGate(which){
  $('#gate-connect').classList.toggle('hidden', which!=='connect');
  $('#gate-auth').classList.toggle('hidden', which!=='auth');
  $('#app').classList.toggle('hidden', which!=='app');
}

function initSupabase(){
  if(!CFG.url || !CFG.key) return false;
  try { sb = window.supabase.createClient(CFG.url, CFG.key); sb.auth.onAuthStateChange?.((event)=>{if(event==='SIGNED_OUT'){resetAccountState();showGate('auth');setAuthMode('signin');}}); return true; }
  catch(e){ console.error(e); return false; }
}

/* connect gate */
$('#connect-btn').addEventListener('click', async ()=>{
  const u = $('#cfg-url').value.trim().replace(/\/+$/,'');
  const k = $('#cfg-key').value.trim();
  const m = $('#connect-msg');
  if(!u || !k){ m.innerHTML='<div class="msg err">Both fields are required.</div>'; return; }
  if(!/^https:\/\/.+\.supabase\.co$/.test(u)){ m.innerHTML='<div class="msg err">URL should look like https://xxxx.supabase.co</div>'; return; }
  CFG.setCloud(u,k);
  if(!initSupabase()){ m.innerHTML='<div class="msg err">Could not connect with those keys.</div>'; CFG.clearCloud(); return; }
  m.innerHTML='<div class="msg ok">Connected. Sign in next.</div>';
  setTimeout(boot, 400);
});

/* auth gate tabs */
let authMode='signin';
function setAuthMode(mode){
  authMode=mode;
  $('#tab-signin').classList.toggle('active', mode==='signin');
  $('#tab-signup').classList.toggle('active', mode==='signup');
  $('#tab-signin').setAttribute('aria-pressed',String(mode==='signin'));
  $('#tab-signup').setAttribute('aria-pressed',String(mode==='signup'));
  $('#name-field').style.display = mode==='signup'?'block':'none';
  $('#auth-btn').textContent = mode==='signin'?'Sign in':'Create account';
  $('#au-pass').setAttribute('autocomplete', mode==='signin'?'current-password':'new-password');
}
$('#tab-signin').addEventListener('click', ()=>setAuthMode('signin'));
$('#tab-signup').addEventListener('click', ()=>setAuthMode('signup'));
$('#change-cloud').addEventListener('click', e=>{ e.preventDefault(); CFG.clearCloud(); sb=null; showGate('connect'); });

$('#auth-btn').addEventListener('click', async ()=>{
  const email=$('#au-email').value.trim(), pass=$('#au-pass').value, name=$('#au-name').value.trim();
  const m=$('#auth-msg');
  if(!email||!pass){ m.innerHTML='<div class="msg err">Email and password required.</div>'; return; }
  $('#auth-btn').disabled=true; $('#auth-btn').textContent='…';
  try{
    if(authMode==='signup'){
      const {error}=await sb.auth.signUp({email,password:pass,options:{data:{name:name||email.split('@')[0]}}});
      if(error) throw error;
      m.innerHTML='<div class="msg ok">Account created. If email confirmation is on, check your inbox, then sign in.</div>';
      setAuthMode('signin');
    }else{
      const {error}=await sb.auth.signInWithPassword({email,password:pass});
      if(error) throw error;
      await boot();
    }
  }catch(err){ m.innerHTML=`<div class="msg err">${esc(err.message||'Something went wrong.')}</div>`; }
  finally{ $('#auth-btn').disabled=false; $('#auth-btn').textContent=authMode==='signin'?'Sign in':'Create account'; }
});

/* =====================================================================
   ROUTER
   ===================================================================== */
let CURRENT='add';
function go(screen){
  if(!['add','dashboard','finance','habits','todo','calendar','settings'].includes(screen))screen='add';
  CURRENT=screen;
  if(location.hash!=='#screen-'+screen)history.replaceState(null,'','#screen-'+screen);
  $$('.screen').forEach(s=>s.classList.toggle('active', s.id==='screen-'+screen));
  $$('#side-nav a, #bottom-nav a').forEach(a=>{a.classList.toggle('active',a.dataset.screen===screen);if(a.dataset.screen===screen)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  const ct=$('.content'); if(ct) ct.classList.toggle('wide', screen==='calendar');
  window.scrollTo(0,0);
  if(screen==='dashboard') renderDashboard();
  if(screen==='finance')   renderFinance();
  if(screen==='habits')    renderHabits();
  if(screen==='todo')      renderTodo();
  if(screen==='calendar')  renderCalendar();
  if(screen==='settings'){ SET_PAGE=null; renderSettings(); }
}
$$('#side-nav a, #bottom-nav a').forEach(a=> a.addEventListener('click', e=>{e.preventDefault();go(a.dataset.screen);}) );

/* =====================================================================
   BOOT + DATA LAYER
   ===================================================================== */
let bootGeneration=0, dataCapped=false;
async function boot(){
  const generation=++bootGeneration;
  const shareToken = new URLSearchParams(location.search).get('share');
  if(shareToken){ if(!sb && !initSupabase()){ showSharedError('Calendar service is not configured.'); return; } await renderSharedViewer(shareToken); return; }
  if(!CFG.url || !CFG.key || (!sb && !initSupabase())){ showGate('connect'); return; }
  try{
    const { data, error } = await sb.auth.getSession();
    if(error) throw error;
    if(!data.session){ resetAccountState(); showGate('auth'); setAuthMode('signin'); return; }
    USER=data.session.user;
    await loadProfile();
    await Promise.all([loadAll(),loadPreferences()]);
    if(generation!==bootGeneration) return;
    $('#side-who').textContent='Signed in as '+(PROFILE.name||USER.email);
    showGate('app');
    go(location.hash.replace('#screen-','') || 'add');
    startChatGreeting();
    setSyncStatus('');
  }catch(error){
    showGate('auth');
    $('#auth-msg').replaceChildren(el('div',{class:'msg err',role:'alert',text:error.message||'We couldn’t load your account. Your records have not been changed.'}),el('button',{class:'btn',text:'Try again',onclick:boot}));
  }
}
function resetAccountState(){
  USER=null; PROFILE={}; PREFS={}; dataCapped=false; bootGeneration++;
  Object.keys(DB).forEach(t=>DB[t]=[]);
  chatTranscript=[];
  $('#chat-scroll').replaceChildren(); closeModal(true);
}
function setSyncStatus(message){
  if(!message&&dataCapped)message='Showing up to 5,000 recent records per section. Totals may exclude older saved records.';
  let node=$('#sync-status');
  if(!node){node=el('div',{id:'sync-status',role:'status','aria-live':'polite',class:'sync-status'});$('.main').prepend(node);}
  node.textContent=message;node.classList.toggle('hidden',!message);
}
window.addEventListener('offline',()=>setSyncStatus('You’re offline. Reconnect before saving changes.'));
window.addEventListener('online',()=>{setSyncStatus('Back online. Refresh to check your latest records.');});

/* =====================================================================
   SHARED CALENDAR VIEWER (public, read-only, no account)
   ===================================================================== */
let SHARE_DATA=null, SHARE_WEEK=null;
function anchorMark(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="#63b7da" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5.5" r="1.6"/><path d="M12 7v11"/><path d="M8 11h8"/><path d="M5 13a7 7 0 0 0 14 0"/></svg><b>Anchor</b>'; }
function showSharedError(msg){
  $('#gate-connect').classList.add('hidden'); $('#gate-auth').classList.add('hidden'); $('#app').classList.add('hidden');
  const root=$('#shared-view'); root.classList.remove('hidden');
  root.innerHTML = `<div class="sv-wrap"><div class="sv-card sv-msg"><div class="sv-brand">${anchorMark()}</div><p>${esc(msg)}</p></div></div>`;
}
async function renderSharedViewer(token){
  $('#gate-connect').classList.add('hidden'); $('#gate-auth').classList.add('hidden'); $('#app').classList.add('hidden');
  const root=$('#shared-view'); root.classList.remove('hidden');
  root.innerHTML = `<div class="sv-wrap"><div class="sv-card sv-msg"><div class="sv-brand">${anchorMark()}</div><p class="muted">Loading calendar…</p></div></div>`;
  let res;
  try{ const { data, error } = await sb.rpc('get_shared_calendar', { p_token: token }); if(error) throw error; res=data; }
  catch(e){ showSharedError('Could not load this calendar right now.'); return; }
  if(!res || res.status!=='ok'){
    showSharedError(res && res.status==='expired' ? 'This calendar link has expired.' : 'This calendar link is no longer active.');
    return;
  }
  SHARE_DATA=res; SHARE_WEEK=startOfWeek(new Date());
  drawSharedWeek();
}
function formatShareTime(t){ const v=parseTime(t); if(v==null) return t||''; return fmtHourTime(Math.floor(v), Math.round((v%1)*60)); }
function drawSharedWeek(){
  const res=SHARE_DATA, ws=SHARE_WEEK, root=$('#shared-view');
  const days=[]; for(let i=0;i<7;i++) days.push(addDays(ws,i));
  const byDate={}; (res.events||[]).forEach(ev=>{ (byDate[ev.date]=byDate[ev.date]||[]).push(ev); });
  const wrap=el('div',{class:'sv-wrap'});
  wrap.append(el('div',{class:'sv-head'},[ el('div',{class:'sv-brand',html:anchorMark()}), el('div',{class:'sv-title',text:res.name||'Shared calendar'}) ]));
  wrap.append(el('div',{class:'sv-nav'},[
    el('button',{class:'sv-btn',html:'‹ Prev',onclick:()=>{ SHARE_WEEK=addDays(SHARE_WEEK,-7); drawSharedWeek(); }}),
    el('div',{class:'sv-range',text:'Week of '+ws.toLocaleDateString('en-US',{month:'long',day:'numeric'})}),
    el('button',{class:'sv-btn',html:'Next ›',onclick:()=>{ SHARE_WEEK=addDays(SHARE_WEEK,7); drawSharedWeek(); }})
  ]));
  const list=el('div',{class:'sv-days'});
  days.forEach(dt=>{ const ds=dstr(dt), evs=byDate[ds]||[];
    const d=el('div',{class:'sv-day'+(ds===todayStr()?' today':'')});
    d.append(el('div',{class:'sv-dname'},[ el('span',{class:'sv-dow',text:dt.toLocaleDateString('en-US',{weekday:'long'})}), el('span',{class:'sv-dnum',text:dt.toLocaleDateString('en-US',{month:'short',day:'numeric'})}) ]));
    if(!evs.length) d.append(el('div',{class:'sv-empty',text:'—'}));
    else evs.forEach(ev=> d.append(el('div',{class:'sv-ev'},[
      el('div',{class:'sv-ev-t',text:ev.title}),
      el('div',{class:'sv-ev-time',text:(ev.start? formatShareTime(ev.start)+(ev.end?' – '+formatShareTime(ev.end):'') : 'All day')}),
      ev.notes?el('div',{class:'sv-ev-n',text:ev.notes}):null
    ])));
    list.append(d);
  });
  wrap.append(list);
  wrap.append(el('div',{class:'sv-foot',text:'Read-only · Updated '+new Date(res.updated_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' · Powered by Anchor'}));
  root.innerHTML=''; root.append(wrap);
}

async function loadProfile(){
  let {data,error}=await sb.from('profiles').select('*').eq('id',USER.id).maybeSingle();
  if(error) throw new Error('Your profile could not be loaded. Please try again.');
  if(!data){
    const result=await sb.from('profiles').insert({id:USER.id,name:USER.user_metadata?.name||USER.email.split('@')[0]}).select().single();
    if(result.error) throw new Error('Your profile could not be created. Please try again.');
    data=result.data;
  }
  PROFILE=data;
}
let loadGeneration=0;
async function loadAll(){
  const generation=++loadGeneration, uid=USER.id, tables=Object.keys(DB);
  const results=await Promise.all(tables.map(async t=>{const rows=[];for(let offset=0;offset<5000;offset+=1000){const result=await sb.from(t).select('*').eq('user_id',uid).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+999);if(result.error)return result;rows.push(...(result.data||[]));if((result.data||[]).length<1000)break;}return {data:rows,error:null};}));
  const failed=tables.filter((t,i)=>results[i].error);
  if(failed.length) throw new Error('Could not refresh '+failed.join(', ').replaceAll('_',' ')+'. Your existing view is unchanged.');
  if(USER?.id!==uid || generation!==loadGeneration) return;
  tables.forEach((t,i)=>DB[t]=results[i].data||[]);
  dataCapped=results.some(r=>r.data?.length===5000);
  if(dataCapped)setSyncStatus('');
}
async function refresh(){ try{await loadAll();go(CURRENT);}catch(error){setSyncStatus(error.message);toast('Refresh failed. Your existing records are still shown.');} }
async function insertRow(table,row){
  const {data,error}=await sb.from(table).insert({...row,user_id:USER.id}).select().single();
  if(error) throw new Error('That change could not be saved. Please try again.');
  return data;
}
async function checkedWrite(query){const {error}=await query;if(error) throw new Error('That change was not saved. Please try again.');}
async function saveAtomic(type,data,requestId,commute=null,original_text=''){
  data=AnchorCore.validateEntry(type,data);
  if(['expense','income'].includes(type)&&data.amount<=0)throw new Error('Enter an amount greater than zero.');
  if(type==='work_shift'&&calcShift(data).hours_worked<=0)throw new Error('Enter positive hours or a start and end time.');
  const {data:result,error}=await sb.rpc('anchor_save_entry',{p_request_id:requestId,p_entry:{detected_type:type,data,...(original_text?{original_text}:{}),commute}});
  if(error) throw new Error('Your entry could not be confirmed as saved. Retry this same entry safely; don’t create a second copy.');
  // A refresh failure is not a save failure. Do not offer a fresh write after success.
  try{await loadAll();}catch(e){setSyncStatus('Saved, but the latest view could not load. Refresh when you’re back online.');}
  return result;
}

/* =====================================================================
   FINANCE CALCULATIONS  (done locally — never trust LLM math)
   ===================================================================== */
function parseTime(t){ return AnchorCore.parseTime(t); }
function hoursBetween(start,end){
  const a=parseTime(start), b=parseTime(end);
  if(a==null||b==null) return null;
  let diff = b-a; if(diff<0) diff+=24;
  return Math.round(diff*100)/100;
}
function calcShift(d){
  const o = { ...d };
  o.hours_worked = Number(o.hours_worked)||0;
  if(!o.hours_worked && o.start_time && o.end_time){
    const h = hoursBetween(o.start_time,o.end_time); if(h!=null) o.hours_worked=h;
  }
  o.hourly_rate  = Number(o.hourly_rate)||0;
  o.cash_tips    = Number(o.cash_tips)||0;
  o.digital_tips = Number(o.digital_tips)||0;
  o.total_tips   = Math.round((o.cash_tips+o.digital_tips)*100)/100;
  o.wage_pay     = Math.round((o.hours_worked*o.hourly_rate)*100)/100;
  o.total_shift_income = Math.round((o.wage_pay+o.total_tips)*100)/100;
  o.tips_per_hour= o.hours_worked? Math.round((o.total_tips/o.hours_worked)*100)/100 : 0;
  return o;
}

/* date-range filters for finance */
const inRange = (date,start) => date >= start && date <= todayStr(); // string compare on YYYY-MM-DD
function financeTotals(start){
  let income=0, expense=0, shiftIncome=0, hours=0, tips=0, wage=0, side=0;
  DB.finance_entries.filter(e=>inRange(e.date,start)).forEach(e=>{
    if(e.type==='income'){ income+=Number(e.amount)||0; side+=Number(e.amount)||0; }
    else if(e.type==='expense'){ expense+=Number(e.amount)||0; }
  });
  DB.work_shifts.filter(s=>inRange(s.date,start)).forEach(s=>{
    shiftIncome += Number(s.total_shift_income)||0;
    hours += Number(s.hours_worked)||0;
    tips  += Number(s.total_tips)||0;
    wage  += Number(s.wage_pay)||0;
  });
  const totalIncome = income + shiftIncome;
  return { income, expense, shiftIncome, hours, tips, wage, side, totalIncome, net: totalIncome-expense };
}

/* =====================================================================
   AI PARSER  (provider-agnostic; Gemini / OpenAI / Anthropic)
   ===================================================================== */
const EXPENSE_CATS = ['Food','Gas','Bills','Rent','Car / motorcycle','Clothes','Hygiene','Entertainment','Subscriptions','Other'];

async function callLLM(message,history){
  if(!pref('ai_enabled',false)) throw new Error('Enable secure AI in Settings → AI & privacy first. You can still add everything manually.');
  const uid=USER?.id;
  const {data,error}=await sb.functions.invoke('anchor-ai',{body:{message,history:history.slice(-8).map(m=>({role:m.role,text:m.text.slice(0,950)})),include_finances:!!pref('finance_ai_opt_in',false)}});
  if(USER?.id!==uid)throw new Error('Your session changed. Please send the message again.');
  if(error) throw new Error('AI is unavailable right now. Your message is still here; try again or add the item manually.');
  return AnchorCore.validateAIResponse(data);
}

/* =====================================================================
   ADD / CHAT FLOW
   ===================================================================== */
let chatTranscript = [];   // {role:'user'|'assistant', text}
const scroller = () => $('#chat-scroll');
function scrollDown(){ const s=scroller(); s.scrollTop=s.scrollHeight; }
function addBubble(role, text){
  const b=el('div',{class:'bubble '+(role==='user'?'user':'bot')}, text);
  scroller().append(b); scrollDown(); return b;
}
function addThinking(){
  const b=el('div',{class:'bubble bot'});
  b.append(el('div',{class:'typing',html:'<span></span><span></span><span></span>'}));
  scroller().append(b); scrollDown(); return b;
}

function startChatGreeting(){
  const wrap=$('#chat-wrap'); if(wrap) wrap.classList.add('empty');
  scroller().innerHTML='';
  chatTranscript=[]; convoMentions=[]; activeMentions=[]; pendingCommute=null; renderMentionBar();
  const hero=el('div',{class:'hero'});
  hero.append(el('div',{class:'mark',html:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5.5" r="1.6"/><path d="M12 7v11"/><path d="M8 11h8"/><path d="M5 13a7 7 0 0 0 14 0"/></svg>'}));
  hero.append(el('h2',{text:`What's on your mind, ${PROFILE.name||'there'}?`}));
  hero.append(el('p',{text:'Log a shift, an expense, a task or a habit — just say it naturally.'}));
  scroller().append(hero);
  const QUICK=[
    {label:'Add to schedule', color:'#a98fd6', text:'Add to my schedule: ', icon:'<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>'},
    {label:'Work', color:'#63b7da', text:'Worked ', icon:'<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/></svg>'},
    {label:'Create a list', color:'#d0a85f', text:'New list: ', icon:'<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>'},
    {label:'New habit', color:'#5fb585', text:'Start a new habit: ', icon:'<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>'},
    {label:'Expense', color:'#d2706f', text:'Spent ', icon:'<svg viewBox="0 0 24 24"><path d="M6 3v18l2-1.2 2 1.2 2-1.2 2 1.2 2-1.2 2 1.2V3l-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2z"/><path d="M9.5 9h5M9.5 13h5"/></svg>'},
  ];
  const row=$('#chip-row');
  if(row){ row.innerHTML='';
    QUICK.forEach(q=>{
      const card=el('button',{class:'quick-card',type:'button'},[
        el('span',{class:'qi',style:`color:${q.color};background:${q.color}1a;border-color:${q.color}55`,html:q.icon}),
        el('span',{class:'ql',text:q.label})
      ]);
      card.addEventListener('click', ()=>{ const ct=$('#chat-text'); ct.value=q.text; ct.focus(); ct.dispatchEvent(new Event('input')); ct.selectionStart=ct.selectionEnd=ct.value.length; });
      row.append(card);
    });
  }
  hero.append(el('p',{class:'tiny muted',text:pref('ai_enabled',false)?'Ask about your schedule or tasks, or describe something to add. You review every new entry.':'Enable secure AI in Settings, or add items manually from any section.'}));
}

/* ===== ! command menu ===== */
const WT_KEY='anchor.worktypes';
const WT_COLORS=['#63b7da','#7f9fd6','#5fb585','#d0a85f','#c98fd0','#d2706f','#6fccc0','#b9a06a'];
function getWorkTypes(){ return structuredClone(pref('work_types',[])); }
function setWorkTypes(a){ savePreference('work_types',a); }
function commandGroups(){
  return [
    { label:'Work type', color:'#63b7da', items: getWorkTypes().map(w=>({label:w.name, kind:'work', color:w.color||'#63b7da', rate:w.rate, meta:(w.rate?'$'+w.rate+'/hr':'')})) },
    { label:'Send to',   color:'#a98fd6', items:[['Finance','finance'],['To-do','todo'],['Habits','habits'],['Calendar','calendar']].map(([l,v])=>({label:l, value:v, kind:'dest', color:'#a98fd6'})) },
    { label:'Category',  color:'#d0a85f', items:EXPENSE_CATS.map(c=>({label:c, kind:'cat', color:'#d0a85f'})) },
    { label:'Priority',  color:'#d2706f', items:['High','Medium','Low'].map(p=>({label:p, kind:'prio', color:'#d2706f'})) },
  ];
}
let activeMentions=[], convoMentions=[], menuOpen=false, menuItems=[], menuIdx=0, curToken=null;
let pendingCommute=null;

function renderMentionBar(){
  const bar=$('#mention-bar'); if(!bar) return; bar.innerHTML='';
  activeMentions.forEach((m,i)=> bar.append(
    el('span',{class:'mchip', style:`color:${m.color};border-color:${m.color}66;background:${m.color}1a`},[
      '!'+m.label,
      el('span',{class:'x',text:'×',onclick:()=>{ activeMentions.splice(i,1); renderMentionBar(); chatText.focus(); }})
    ])
  ));
}
function tokenAtCaret(){
  const v=chatText.value, pos=chatText.selectionStart||0;
  const m=v.slice(0,pos).match(/!([^\s!]*)$/);
  return m ? {query:m[1].toLowerCase(), start:pos-m[0].length, end:pos} : null;
}
function openMenu(){
  const tok=tokenAtCaret(); if(!tok){ closeMenu(); return; }
  curToken=tok; const q=tok.query;
  const menu=$('#cmd-menu'); menu.innerHTML=''; menuItems=[]; menuIdx=0; let any=false;
  commandGroups().forEach(g=>{
    const items=g.items.filter(it=> it.label.toLowerCase().includes(q));
    if(!items.length) return; any=true;
    menu.append(el('div',{class:'grp'},[ el('span',{class:'swatch',style:`background:${g.color}`}), g.label ]));
    items.forEach(it=>{
      const idx=menuItems.length;
      const row=el('div',{class:'cmd-item',
        onmousedown:(e)=>{ e.preventDefault(); selectCommand(it); },
        onmouseenter:()=>{ menuIdx=idx; highlightMenu(); }},
        [ el('span',{class:'dot',style:`background:${it.color}`}), el('span',{text:it.label}), it.meta?el('span',{class:'meta',text:it.meta}):null ]);
      menu.append(row); menuItems.push({it,row});
    });
  });
  if(!any){ menu.append(el('div',{class:'cmd-empty',text: q?('No commands match “'+q+'”'):'Add work types in Settings to use them here.'})); }
  else if(!getWorkTypes().length){ menu.append(el('div',{class:'cmd-hint',text:'Tip: add your work types in Settings → Work types.'})); }
  menu.classList.remove('hidden'); menuOpen=true; highlightMenu();
}
function highlightMenu(){ menuItems.forEach((m,i)=> m.row.classList.toggle('active', i===menuIdx)); }
function closeMenu(){ const m=$('#cmd-menu'); if(m){ m.classList.add('hidden'); m.innerHTML=''; } menuOpen=false; curToken=null; }
function selectCommand(it){
  if(curToken){ const v=chatText.value; chatText.value=v.slice(0,curToken.start)+v.slice(curToken.end); chatText.selectionStart=chatText.selectionEnd=curToken.start; }
  if(!activeMentions.some(m=>m.kind===it.kind && m.label===it.label)) activeMentions.push({kind:it.kind,label:it.label,color:it.color,rate:it.rate,value:it.value});
  renderMentionBar(); closeMenu(); chatText.focus();
  chatText.style.height='auto'; chatText.style.height=Math.min(chatText.scrollHeight,120)+'px';
}
function mentionHint(ms){
  if(!ms.length) return '';
  const parts=[];
  const w=ms.find(m=>m.kind==='work'); if(w) parts.push(`the work_type is "${w.label}"`+(w.rate?` with hourly_rate ${w.rate}`:''));
  const d=ms.find(m=>m.kind==='dest'); if(d) parts.push(`file this only under the ${d.label} section`);
  const c=ms.find(m=>m.kind==='cat'); if(c) parts.push(`the category is "${c.label}"`);
  const p=ms.find(m=>m.kind==='prio'); if(p) parts.push(`the priority is "${p.label}"`);
  return parts.length ? ('\n\n[User commands — '+parts.join('; ')+'. Honor these exactly.]') : '';
}

const chatForm = $('#chat-form'), chatText = $('#chat-text');
chatText.maxLength=4000;
chatText.addEventListener('input', ()=>{
  chatText.style.height='auto'; chatText.style.height=Math.min(chatText.scrollHeight,120)+'px';
  if(tokenAtCaret()) openMenu(); else closeMenu();
});
chatText.addEventListener('keydown', e=>{
  if(menuOpen){
    if(e.key==='ArrowDown'){ e.preventDefault(); menuIdx=Math.min(menuIdx+1,menuItems.length-1); highlightMenu(); menuItems[menuIdx]&&menuItems[menuIdx].row.scrollIntoView({block:'nearest'}); return; }
    if(e.key==='ArrowUp'){ e.preventDefault(); menuIdx=Math.max(menuIdx-1,0); highlightMenu(); menuItems[menuIdx]&&menuItems[menuIdx].row.scrollIntoView({block:'nearest'}); return; }
    if((e.key==='Enter'||e.key==='Tab') && menuItems[menuIdx]){ e.preventDefault(); selectCommand(menuItems[menuIdx].it); return; }
    if(e.key==='Escape'){ e.preventDefault(); closeMenu(); return; }
  }
  if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); submitChat(); }
});
chatText.addEventListener('blur', ()=> setTimeout(closeMenu,150));
chatForm.addEventListener('submit', e=>{ e.preventDefault(); submitChat(); });

let chatBusy=false;
async function submitChat(){
  if(chatBusy) return;
  const text = chatText.value.trim();
  const mentions = activeMentions.slice();
  if(!text && !mentions.length) return;
  chatText.value=''; chatText.style.height='auto';
  activeMentions=[]; renderMentionBar(); closeMenu();
  convoMentions = convoMentions.concat(mentions);
  const wrap=$('#chat-wrap'), sendBtn=$('#chat-send');
  if(wrap && wrap.classList.contains('empty')){ wrap.classList.remove('empty'); scroller().innerHTML=''; }
  const display = (text + (mentions.length ? '  '+mentions.map(m=>'!'+m.label).join(' ') : '')).trim();
  addBubble('user', display);
  chatTranscript.push({role:'user', text:(text||'(see commands)') + mentionHint(mentions)});
  if(!pref('ai_enabled',false)){ addBubble('bot','Enable secure AI in Settings → AI & privacy, or add an item manually.'); return; }
  chatBusy=true;
  const thinking = addThinking();
  if(sendBtn){ sendBtn.classList.add('loading'); sendBtn.disabled=true; }
  try{
    const parsed = await callLLM(chatTranscript.at(-1).text,chatTranscript.slice(0,-1));
    thinking.remove();
    if(parsed.mode==='answer'){addBubble('bot',parsed.reply);if(parsed.context?.truncated)addBubble('bot','This answer uses a limited set of recent records. Open the relevant section for the full view.');chatTranscript.push({role:'assistant',text:parsed.reply});return;}
    if(!parsed){ addBubble('bot','I couldn’t read that clearly — could you rephrase?'); return; }
    if(parsed.detected_type==='unknown' || parsed.needs_more){
      const q = (parsed.questions||[]);
      const msg = (parsed.reply? parsed.reply+'\n\n':'') + q.map(x=>'• '+x).join('\n');
      addBubble('bot', msg || (parsed.reply||'Tell me a little more?'));
      chatTranscript.push({role:'assistant', text:msg});
      return;
    }
    showConfirm(parsed);
  }catch(err){
    thinking.remove();
    addBubble('bot','⚠ '+(err.message||'Something went wrong calling the AI.'));
  }finally{
    chatBusy=false;
    if(sendBtn){ sendBtn.classList.remove('loading'); sendBtn.disabled=false; }
  }
}

const TYPE_LABEL = { work_shift:'work shift', expense:'expense', income:'income', todo_task:'task', todo_list:'list', shopping_list:'shopping list', habit:'habit', workout_routine:'workout routine', calendar_event:'event', reminder:'reminder', note:'note' };
const SECTION_OF = { work_shift:'finance', expense:'finance', income:'finance', todo_task:'todo', todo_list:'todo', shopping_list:'todo', note:'todo', habit:'habits', workout_routine:'habits', calendar_event:'calendar', reminder:'calendar' };
const resolveDate = d => (AnchorCore.validDate(d)?d:todayStr());

function kvRows(type, d){
  const primary=[], more=[];
  const ap=(k,v)=>{ if(v!==''&&v!=null) primary.push([k,v]); };
  const am=(k,v)=>{ if(v!==''&&v!=null) more.push([k,v]); };
  if(type==='work_shift'){
    const s=calcShift(d);
    // compact view — the essentials only
    ap('Date', prettyDate(resolveDate(s.date)));
    ap('Hours', num(s.hours_worked));
    ap('Hourly rate', s.hourly_rate?money(s.hourly_rate):'—');
    ap('Cash tips', money(s.cash_tips));
    // full breakdown — behind the expander
    am('Work type', s.work_type||PROFILE.default_work_type||'—');
    if(s.start_time||s.end_time) am('Time', `${s.start_time||'?'} – ${s.end_time||'?'}`);
    if(s.digital_tips) am('Digital tips', money(s.digital_tips));
    am('Wage pay', money(s.wage_pay));
    am('Total tips', money(s.total_tips));
    am('Total income', money(s.total_shift_income));
    am('Tips / hour', money(s.tips_per_hour));
    if(d.notes) am('Notes', d.notes);
    return {primary, more};
  }
  const add=ap;
  if(type==='expense'||type==='income'){
    add('Type', type==='expense'?'Expense':'Income'); add('Date', prettyDate(resolveDate(d.date)));
    add('Amount', money(d.amount)); add('Category', d.category||'—');
    if(d.description) add('Description', d.description); if(d.payment_type) add('Payment', d.payment_type);
  } else if(type==='todo_task'){
    add('Task', d.title); add('Priority', d.priority||'Medium'); if(d.due_date) add('Due', prettyDate(resolveDate(d.due_date))); if(d.category) add('Category', d.category);
  } else if(type==='todo_list'||type==='shopping_list'){
    add('List', d.title||(type==='shopping_list'?'Shopping list':'New list')); add('Priority', d.priority||'Medium');
    add('Items', (d.items||[]).join(', '));
  } else if(type==='habit'||type==='workout_routine'){
    add('Habit', d.name); if(d.description) add('Details', d.description);
    add('Frequency', d.frequency||'Daily'); if(d.target_amount) add('Target', `${d.target_amount} ${d.target_unit||''}`.trim());
    if(d.reminder_time) add('Reminder', d.reminder_time); add('Type', d.is_temporary?'Temporary':'Ongoing');
  } else if(type==='reminder'||type==='calendar_event'){
    add('Title', d.title); add('Date', prettyDate(resolveDate(d.date))); if(d.time) add('Time', d.time); add('Repeat', d.repeat_rule||'None');
  } else if(type==='note'){
    add('Note', d.title||d.notes);
  }
  if(d.notes && type!=='note') add('Notes', d.notes);
  return {primary, more};
}

function computeCommute(type, d){
  if(type!=='work_shift') return null;
  const text0=(chatTranscript[0]||{}).text||'';
  let trip=d.commute_trip;
  if(!trip || trip==='none'){
    if(/\b(drove|drive|driving|rode|riding|ride|commut|there and back|to and from|both ways|round\s*trip)\b/i.test(text0))
      trip = /there and back|to and from|both ways|round\s*trip/i.test(text0) ? 'round_trip' : 'one_way';
    else trip='none';
  }
  if(!trip || trip==='none') return null;
  const veh = matchVehicle(d.commute_vehicle) || matchVehicle((text0.match(/motorcycle|scooter|moped|truck|suv|van|car|bike/i)||[])[0]) || defaultVehicle();
  const loc = defaultWorkLoc();
  const oneWay = loc && loc.oneWay ? Number(loc.oneWay) : 0;
  const trips = trip==='round_trip' ? 2 : 1;
  const miles = Math.round(oneWay*trips*10)/10;
  const mpg = veh ? Number(veh.mpg)||0 : 0;
  return { trip, trips, veh, miles, mpg, oneWay, cost: gasCost(miles, mpg), ok: !!(veh && oneWay>0 && mpg>0 && GAS.price>0) };
}
function showConfirm(parsed){
  const type=parsed.detected_type, d=parsed.data||{}, requestId=crypto.randomUUID();
  if(type==='work_shift'){
    const w=convoMentions.find(m=>m.kind==='work');
    if(w){ if(!d.work_type) d.work_type=w.label; if((!d.hourly_rate||Number(d.hourly_rate)===0)&&w.rate) d.hourly_rate=Number(w.rate); }
  }
  const commute = computeCommute(type, d); pendingCommute = commute;
  if(parsed.reply) addBubble('bot', parsed.reply);
  const { primary, more } = kvRows(type,d);
  const card = el('div',{class:'confirm-card'});
  card.append(el('h4',{text: parsed.summary_title || `Ready to add this ${TYPE_LABEL[type]||'entry'}?`}));
  const kvEl = ([k,v]) => el('div',{class:'kv',html:`<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>`});
  primary.forEach(r=> card.append(kvEl(r)));
  if(more.length){
    const moreEl = el('div',{class:'kv-more hidden'}, more.map(kvEl));
    const cap = el('span',{text:'Show full breakdown'});
    const car = el('span',{class:'car',text:'▾'});
    const tog = el('button',{class:'kv-toggle'},[car, cap]);
    tog.addEventListener('click', ()=>{ const hid=moreEl.classList.toggle('hidden'); cap.textContent=hid?'Show full breakdown':'Hide breakdown'; car.style.transform=hid?'':'rotate(180deg)'; });
    card.append(tog, moreEl);
  }
  if(commute){
    if(commute.ok){
      const box=el('div',{class:'commute'});
      box.append(el('div',{class:'commute-h'},[ el('span',{class:'ci',html:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="9" height="18" rx="2"/><path d="M4 9h9"/><path d="M13 8l3 3v5a2 2 0 0 0 4 0V8l-2.5-2.5"/></svg>'}), 'Estimated commute gas' ]));
      box.append(el('div',{class:'commute-row',html:`<span>${esc(commute.veh.name)} · ${commute.trip==='round_trip'?'round trip':'one way'}</span><b>${commute.miles} mi</b>`}));
      box.append(el('div',{class:'commute-row',html:`<span>Efficiency</span><b>${commute.mpg} mpg</b>`}));
      box.append(el('div',{class:'commute-row',html:`<span>Gas price</span><b>$${Number(GAS.price).toFixed(2)}/gal</b>`}));
      const costEl=el('span',{class:'commute-cost',text:'$0.00'});
      box.append(el('div',{class:'commute-total'},[ el('span',{class:'lab',text:'Gas cost'}), costEl ]));
      box.append(el('div',{class:'tiny muted',style:'margin-top:6px',text:'Saved as a Gas expense alongside this shift.'}));
      card.append(box);
      requestAnimationFrame(()=> countUp(costEl, commute.cost, '$', 2));
    } else {
      card.append(el('div',{class:'commute-hint',text:'Driving detected — add your vehicle’s MPG, a work distance, and gas price in Settings → Commute & gas to auto-track this.'}));
    }
  }
  const actions = el('div',{class:'confirm-actions'});
  const confirmBtn = el('button',{class:'btn primary',text:'Confirm & Add'});
  const editBtn = el('button',{class:'btn ghost',text:'Edit'});
  const cancelBtn = el('button',{class:'btn ghost',text:'Cancel'});
  actions.append(confirmBtn,editBtn,cancelBtn);
  card.append(actions);
  scroller().append(card); scrollDown();

  confirmBtn.addEventListener('click', async ()=>{
    if(confirmBtn.disabled) return;
    confirmBtn.disabled=true; editBtn.disabled=true; cancelBtn.disabled=true; confirmBtn.textContent='Saving…';
    try{
      await saveAtomic(type,d,requestId,commute,(chatTranscript[0]||{}).text||'');
      card.style.borderColor='var(--success)';
      actions.remove();
      const sec=SECTION_OF[type]||'dashboard';
      const done = el('div',{class:'confirm-actions'},[
        el('span',{class:'pill accent',text:'✓ Added'}),
        el('button',{class:'btn sm',text:'View in '+sec, onclick:()=>go(sec)})
      ]);
      card.append(done);
      chatTranscript=[]; convoMentions=[]; pendingCommute=null;
      toast('Added to '+sec);
    }catch(err){ toast(err.message); confirmBtn.disabled=false; editBtn.disabled=false; cancelBtn.disabled=false; confirmBtn.textContent='Retry save'; }
  });
  editBtn.addEventListener('click', ()=>{
    const sec = SECTION_OF[type]||'todo';
    const manualType = (type==='work_shift')?'workshift':(type==='income')?'income':(type==='expense')?'expense':(type==='habit'||type==='workout_routine')?'habit':(type==='shopping_list'||type==='todo_list')?'list':(type==='reminder'||type==='calendar_event')?'reminder':'task';
    openManualForm(manualType, prefillFromData(type,d));
    card.remove(); // The editable form replaces this proposal; it cannot be saved twice.
  });
  cancelBtn.addEventListener('click', ()=>{ card.remove(); addBubble('bot','Okay, cancelled.'); chatTranscript=[]; convoMentions=[]; pendingCommute=null; });
}

function prefillFromData(type,d){
  const o={...d}; o.date=resolveDate(d.date);
  if(type==='work_shift'){ const s=calcShift(o); return s; }
  return o;
}

/* =====================================================================
   SHARED RENDER HELPERS
   ===================================================================== */
function statCard(label, value, sub, cls){
  return el('div',{class:'card stat'},[
    el('div',{class:'label',text:label}),
    el('div',{class:'big num '+(cls||''),html:value}),
    sub?el('div',{class:'small',html:sub}):null
  ]);
}
function sectionTitle(t){ return el('div',{class:'label',text:t,style:'margin:22px 0 10px'}); }
function emptyMsg(t){ return el('div',{class:'empty',text:t}); }

/* habit scheduling + completion */
function habitDue(h, dateStr){
  if(h.start_date && dateStr < h.start_date) return false;
  if(h.end_date && dateStr > h.end_date) return false;
  if(h.frequency==='Weekly'){
    const sd = h.start_date ? new Date(h.start_date+'T00:00:00') : new Date(dateStr+'T00:00:00');
    return new Date(dateStr+'T00:00:00').getDay() === sd.getDay();
  }
  return true;
}
const habitsDueToday = () => DB.habits.filter(h=>habitDue(h,todayStr()));
const completion = (hid,ds)=> DB.habit_completions.find(c=>c.habit_id===hid && c.date===ds);
function streakOf(hid){
  let s=0; const d=new Date();
  for(let i=0;i<366;i++){
    const ds=dstr(d), c=DB.habit_completions.find(x=>x.habit_id===hid && x.date===ds);
    if(c && (c.status==='done'||c.status==='partial')) s++;
    else if(i>0) break;
    d.setDate(d.getDate()-1);
  }
  return s;
}
async function setCompletion(hid, status, amount){
  const { error } = await sb.from('habit_completions').upsert(
    { habit_id:hid, user_id:USER.id, date:todayStr(), status, amount_completed:amount??null },
    { onConflict:'habit_id,date' });
  if(error){ toast('Failed: '+error.message); return; }
  await refresh();
}
async function clearCompletion(hid){
  await checkedWrite(sb.from('habit_completions').delete().eq('habit_id',hid).eq('date',todayStr()).eq('user_id',USER.id));
  await refresh();
}
async function delRow(table,id){ await checkedWrite(sb.from(table).delete().eq('id',id).eq('user_id',USER.id)); await refresh(); }

/* =====================================================================
   DASHBOARD
   ===================================================================== */
function renderDashboard(){
  $('#dash-date').textContent = new Date().toLocaleDateString('en-US',{weekday:'long', month:'long', day:'numeric'});
  const body=$('#dash-body'); body.innerHTML='';
  const t=todayStr(), wk=weekStartStr();
  const dayT=financeTotals(t), weekT=financeTotals(wk);

  // MONEY SNAPSHOT
  body.append(sectionTitle('Money'));
  const money3=el('div',{class:'grid grid-3'});
  money3.append(statCard('Earned today', money(dayT.totalIncome)));
  money3.append(statCard('Spent today', money(dayT.expense)));
  money3.append(statCard('Net today', money(dayT.net), null, dayT.net>=0?'pos':'neg'));
  body.append(money3);
  const money3b=el('div',{class:'grid grid-3',style:'margin-top:14px'});
  money3b.append(statCard('Week income', money(weekT.totalIncome)));
  money3b.append(statCard('Week expenses', money(weekT.expense)));
  money3b.append(statCard('Week profit', money(weekT.net), null, weekT.net>=0?'pos':'neg'));
  body.append(money3b);

  // HABITS SNAPSHOT
  body.append(sectionTitle('Habits today'));
  const due=habitsDueToday();
  const habCard=el('div',{class:'card'});
  if(!due.length){ habCard.append(emptyMsg('No habits due today. Add one from the Add page.')); }
  else{
    const doneCount=due.filter(h=>{const c=completion(h.id,t);return c&&(c.status==='done'||c.status==='partial');}).length;
    habCard.append(el('div',{class:'row-between',style:'margin-bottom:6px'},[
      el('span',{class:'tiny muted',text:`${doneCount} of ${due.length} done`}),
      el('span',{class:'pill accent',text:'Quick check-off'})
    ]));
    due.forEach(h=> habCard.append(habitRow(h,true)) );
  }
  body.append(habCard);

  // TO-DO SNAPSHOT
  body.append(sectionTitle('To-do'));
  const todoCard=el('div',{class:'card'});
  const open=DB.todo_items.filter(x=>x.status!=='Done');
  const overdue=open.filter(x=>x.due_date && x.due_date<t);
  const high=open.filter(x=>x.priority==='High' && !(x.due_date&&x.due_date<t));
  const show=[...overdue,...high].slice(0,6);
  if(!show.length){ todoCard.append(emptyMsg(open.length?'No high-priority or overdue tasks. Nice.':'No tasks yet.')); }
  else show.forEach(x=> todoCard.append(taskRow(x, x.due_date&&x.due_date<t?'Overdue':'High priority')) );
  body.append(todoCard);

  // WORK SNAPSHOT
  body.append(sectionTitle('Work'));
  const last=DB.work_shifts[0];
  const work2=el('div',{class:'grid grid-2'});
  work2.append(statCard('Hours this week', num(weekT.hours)+' h'));
  work2.append(statCard('Tips this week', money(weekT.tips)));
  work2.append(statCard('Avg tips / hour', money(weekT.hours? weekT.tips/weekT.hours:0)));
  work2.append(statCard('Last shift', last? money(last.total_shift_income):'—', last?prettyDate(last.date)+' · '+num(last.hours_worked)+'h':'No shifts logged yet'));
  body.append(work2);
}

function habitRow(h, quick){
  const c=completion(h.id,todayStr());
  const on = c && (c.status==='done'||c.status==='partial');
  const check=el('button',{class:'check'+(on?' on':''),'aria-label':'Mark '+h.name+' complete','aria-pressed':String(!!on),html:'<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4 10-10"/></svg>',
    onclick:()=> on?clearCompletion(h.id):setCompletion(h.id,'done')});
  const target = h.target_amount? ` · ${h.target_amount} ${h.target_unit||''}`.trim():'';
  const st = c? (c.status==='partial'?` · partial ${c.amount_completed??''}`:` · ${c.status}`):'';
  const right = el('div',{style:'display:flex;align-items:center;gap:10px'},[
    h_streakBadge(h.id),
    el('button',{class:'btn ghost sm',text:'Partial',onclick:async()=>{ const a=prompt('How much of the target did you complete?'); if(a!=null) setCompletion(h.id,'partial',Number(a)||0); }})
  ]);
  return el('div',{class:'item-row'},[
    check,
    el('div',{class:'grow'},[ el('div',{class:'t'+(on?' strike':''),text:h.name}), el('div',{class:'s',text:(h.frequency||'Daily')+target+st}) ]),
    quick?h_streakBadge(h.id):right
  ]);
}
function h_streakBadge(hid){ const s=streakOf(hid); return el('span',{class:'pill',text:(s>0?'🔥 '+s+'d':'—')}); }

function taskRow(x, badge){
  const done=x.status==='Done';
  const check=el('button',{class:'check'+(done?' on':''),'aria-label':'Complete '+x.title,'aria-pressed':String(!!done),html:'<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4 10-10"/></svg>',
    onclick:async()=>{ await checkedWrite(sb.from('todo_items').update({status:done?'Not started':'Done'}).eq('id',x.id).eq('user_id',USER.id)); await refresh(); }});
  const sub=[]; if(x.due_date) sub.push('Due '+prettyDate(x.due_date)); if(x.category) sub.push(x.category);
  return el('div',{class:'item-row'},[
    check,
    el('div',{class:'grow'},[ el('div',{class:'t'+(done?' strike':''),text:x.title}), sub.length?el('div',{class:'s',text:sub.join(' · ')}):null ]),
    badge?el('span',{class:'prio '+(badge==='Overdue'?'High':x.priority||'Medium'),text:badge}):el('span',{class:'prio '+(x.priority||'Medium'),text:x.priority||'Medium'}),
    el('button',{class:'btn ghost sm',html:'✕',onclick:()=>delRow('todo_items',x.id)})
  ]);
}

/* =====================================================================
   FINANCE
   ===================================================================== */
let FIN_RANGE='day';
function renderFinance(){
  $$('#fin-seg button').forEach(b=>{ b.classList.toggle('active', b.dataset.range===FIN_RANGE);
    b.onclick=()=>{ FIN_RANGE=b.dataset.range; renderFinance(); }; });
  const body=$('#fin-body'); body.innerHTML='';
  const start = FIN_RANGE==='day'?todayStr():FIN_RANGE==='week'?weekStartStr():monthStartStr();
  const T=financeTotals(start);

  const g=el('div',{class:'grid grid-3'});
  g.append(statCard('Income', money(T.totalIncome)));
  g.append(statCard('Expenses', money(T.expense)));
  g.append(statCard('Net', money(T.net), null, T.net>=0?'pos':'neg'));
  body.append(g);

  if(FIN_RANGE!=='day'){
    const g2=el('div',{class:'grid grid-4',style:'margin-top:14px'});
    g2.append(statCard('Hours worked', num(T.hours)+' h'));
    g2.append(statCard('Wage income', money(T.wage)));
    g2.append(statCard('Total tips', money(T.tips)));
    g2.append(statCard('Avg tips / hr', money(T.hours? T.tips/T.hours:0)));
    body.append(g2);
    // spending by category
    const cats={};
    DB.finance_entries.filter(e=>e.type==='expense'&&inRange(e.date,start)).forEach(e=>{ cats[e.category||'Other']=(cats[e.category||'Other']||0)+(Number(e.amount)||0); });
    const top=Object.entries(cats).sort((a,b)=>b[1]-a[1]);
    if(top.length){
      const c=el('div',{class:'card',style:'margin-top:14px'});
      c.append(el('div',{class:'label',text:'Top spending'}));
      top.slice(0,6).forEach(([k,v])=> c.append(el('div',{class:'item-row'},[ el('span',{class:'grow',text:k}), el('span',{class:'num',text:money(v)}) ])) );
      body.append(c);
    }
  }

  // transactions
  body.append(sectionTitle('Transactions'));
  const tx=el('div',{class:'card'});
  const items=[
    ...DB.work_shifts.filter(s=>inRange(s.date,start)).map(s=>({date:s.date, title:(s.work_type||'Shift')+' · '+num(s.hours_worked)+'h', sub:'Tips '+money(s.total_tips), amt:Number(s.total_shift_income)||0, kind:'income', table:'work_shifts', id:s.id})),
    ...DB.finance_entries.filter(e=>inRange(e.date,start)).map(e=>({date:e.date, title:e.description||e.category||(e.type==='income'?'Income':'Expense'), sub:e.category||'', amt:(e.type==='expense'?-1:1)*(Number(e.amount)||0), kind:e.type, table:'finance_entries', id:e.id})),
  ].sort((a,b)=> b.date.localeCompare(a.date));
  if(!items.length){ tx.append(emptyMsg('No transactions in this range. Log one from the Add page.')); }
  else items.forEach(it=> tx.append(el('div',{class:'item-row'},[
    el('div',{class:'grow'},[ el('div',{class:'t',text:it.title}), el('div',{class:'s',text:prettyDate(it.date)+(it.sub?' · '+it.sub:'')}) ]),
    el('span',{class:'num '+(it.amt>=0?'pos':'neg'),text:(it.amt>=0?'+':'')+money(it.amt)}),
    el('button',{class:'btn ghost sm',html:'✕',onclick:()=>delRow(it.table,it.id)})
  ])) );
  body.append(tx);
}

/* =====================================================================
   HABITS
   ===================================================================== */
function renderHabits(){
  const body=$('#hab-body'); body.innerHTML='';
  if(!DB.habits.length){ body.append(el('div',{class:'card'},[emptyMsg('No habits yet. Try “Start a habit: 50 crunches a day” on the Add page, or add one manually.')])); return; }
  const t=todayStr();
  DB.habits.forEach(h=>{
    const due=habitDue(h,t), c=completion(h.id,t), on=c&&(c.status==='done'||c.status==='partial');
    const card=el('div',{class:'card'});
    card.append(el('div',{class:'row-between'},[
      el('div',{},[ el('div',{style:'font-weight:600;font-size:16px',text:h.name}),
        el('div',{class:'tiny muted',style:'margin-top:2px',text:[h.frequency||'Daily', h.target_amount?`${h.target_amount} ${h.target_unit||''}`.trim():null, h.is_temporary?'temporary':'ongoing'].filter(Boolean).join(' · ')}) ]),
      h_streakBadge(h.id)
    ]));
    if(h.description) card.append(el('div',{class:'tiny muted',style:'margin-top:6px',text:h.description}));
    const actions=el('div',{class:'confirm-actions',style:'margin-top:12px'});
    actions.append(el('button',{class:'btn '+(on?'':'primary'),text:on?'✓ Done today':(due?'Mark done':'Mark done (not due)'),onclick:()=> on?clearCompletion(h.id):setCompletion(h.id,'done')}));
    actions.append(el('button',{class:'btn ghost sm',text:'Partial',onclick:()=>{ const a=prompt('How much did you complete?'); if(a!=null) setCompletion(h.id,'partial',Number(a)||0); }}));
    actions.append(el('button',{class:'btn ghost sm',text:'Skip',onclick:()=>setCompletion(h.id,'skipped')}));
    actions.append(el('button',{class:'btn danger sm',text:'Delete',onclick:async()=>{ if(confirm('Delete this habit?')) await delRow('habits',h.id); }}));
    card.append(actions);
    body.append(card);
  });
}

/* =====================================================================
   TO-DO
   ===================================================================== */
function renderTodo(){
  const body=$('#todo-body'); body.innerHTML='';
  // single tasks
  body.append(sectionTitle('Tasks'));
  const tcard=el('div',{class:'card'});
  const tasks=DB.todo_items.slice().sort((a,b)=>(a.status==='Done')-(b.status==='Done'));
  if(!tasks.length) tcard.append(emptyMsg('No tasks yet.'));
  else tasks.forEach(x=> tcard.append(taskRow(x)) );
  body.append(tcard);
  // lists
  body.append(sectionTitle('Lists'));
  if(!DB.todo_lists.length){ body.append(el('div',{class:'card'},[emptyMsg('No lists yet. Try “Quick list: milk, eggs, bread”.')])); }
  DB.todo_lists.forEach(list=>{
    const items=DB.todo_list_items.filter(i=>i.list_id===list.id);
    const doneN=items.filter(i=>i.completed).length;
    const card=el('div',{class:'card'});
    const head=el('div',{class:'row-between',style:'cursor:pointer'},[
      el('div',{},[ el('span',{style:'font-weight:600',text:list.title}), el('span',{class:'tiny muted',style:'margin-left:8px',text:`${doneN}/${items.length}`}) ]),
      el('div',{style:'display:flex;gap:8px;align-items:center'},[
        list.priority?el('span',{class:'prio '+list.priority,text:list.priority}):null,
        el('button',{class:'btn ghost sm',html:'✕',onclick:async(e)=>{ e.stopPropagation(); if(confirm('Delete list?')) await delRow('todo_lists',list.id); }})
      ])
    ]);
    const wrap=el('div',{style:'margin-top:6px'});
    items.forEach(i=>{
      const check=el('button',{class:'check'+(i.completed?' on':''),'aria-label':'Complete '+i.text,'aria-pressed':String(!!i.completed),html:'<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4 10-10"/></svg>',
        onclick:async()=>{ await checkedWrite(sb.from('todo_list_items').update({completed:!i.completed}).eq('id',i.id).eq('user_id',USER.id)); await refresh(); }});
      wrap.append(el('div',{class:'item-row'},[ check, el('div',{class:'grow t'+(i.completed?' strike':''),text:i.text}) ]));
    });
    // quick add item
    const addItem=el('form',{class:'input-row',style:'margin-top:10px'},[
      el('input',{class:'input',placeholder:'Add item…'}),
      el('button',{class:'btn sm',type:'submit',text:'Add'})
    ]);
    addItem.addEventListener('submit',async e=>{e.preventDefault();const button=addItem.querySelector('button'),input=addItem.querySelector('input'),v=input.value.trim();if(!v||button.disabled)return;if(v.length>500){toast('Use 500 characters or fewer.');return;}button.disabled=true;try{await insertRow('todo_list_items',{list_id:list.id,text:v,completed:false});input.value='';await refresh();}catch(error){toast(error.message);}finally{button.disabled=false;}});
    head.addEventListener('click', ()=> wrap.classList.toggle('hidden'));
    card.append(head, wrap, addItem);
    body.append(card);
  });
}

/* =====================================================================
   CALENDAR
   ===================================================================== */
let CAL_VIEW='month', CAL_ANCHOR=null, CAL_SELECTED=null;
const ROWH=46;
const CAL_VIEWS=[['month','Month'],['week','Week'],['3day','3 day'],['day','Day'],['schedule','Schedule']];
function calAnchor(){ if(!CAL_ANCHOR){ const n=new Date(todayStr()+'T12:00:00'); CAL_ANCHOR=new Date(n.getFullYear(),n.getMonth(),n.getDate()); } return CAL_ANCHOR; }
function addDays(dt,n){ const d=new Date(dt); d.setDate(d.getDate()+n); return d; }
function startOfWeek(dt){ const d=new Date(dt); d.setDate(d.getDate()-((d.getDay()+6)%7)); return d; }
function fmtHour(h){ const ap=h<12?'am':'pm'; let hh=h%12; if(hh===0)hh=12; return hh+ap; }
function fmtHourTime(h,m){ const ap=h<12?'am':'pm'; let hh=h%12; if(hh===0)hh=12; return hh+':'+pad(m||0)+' '+ap; }
function prettyDateFull(s){ if(!s) return ''; const [y,m,d]=s.split('-'); return new Date(y,m-1,d).toLocaleDateString('en-US',{weekday:'long', month:'long', day:'numeric'}); }
function dayEvents(ds){
  const out=[];
  DB.reminders.filter(r=>AnchorCore.occursOn(r,ds)).forEach(r=> out.push({label:r.title||'Reminder', sub:r.time||'', color:'#a98fd6', kind:'Reminder', table:'reminders', id:r.id, edit:{type:'reminder', pf:{title:r.title,date:r.date,time:r.time,repeat_rule:r.repeat_rule,notes:r.notes}}}));
  DB.work_shifts.filter(s=>s.date===ds).forEach(s=> out.push({label:(s.work_type||'Shift'), sub:money(s.total_shift_income)+' · '+num(s.hours_worked)+'h', color:'#63b7da', kind:'Shift', table:'work_shifts', id:s.id, edit:{type:'workshift', pf:{date:s.date,work_type:s.work_type,start_time:s.start_time,end_time:s.end_time,hours_worked:s.hours_worked,hourly_rate:s.hourly_rate,cash_tips:s.cash_tips,digital_tips:s.digital_tips,notes:s.notes}}}));
  DB.finance_entries.filter(e=>e.date===ds).forEach(e=> out.push({label:(e.description||e.category||(e.type==='income'?'Income':'Expense')), sub:(e.type==='expense'?'-':'+')+money(e.amount), color:e.type==='expense'?'#d2706f':'#5fb585', kind:e.type==='expense'?'Expense':'Income', table:'finance_entries', id:e.id, edit:{type:e.type, pf:{date:e.date,amount:e.amount,category:e.category,description:e.description,payment_type:e.payment_type,notes:e.notes}}}));
  DB.todo_items.filter(x=>x.due_date===ds).forEach(x=> out.push({label:x.title||'Task', sub:'Due'+(x.status&&x.status!=='Not started'?' · '+x.status:''), color:'#d0a85f', kind:'Task', table:'todo_items', id:x.id, edit:{type:'task', pf:{title:x.title,category:x.category,priority:x.priority,due_date:x.due_date,status:x.status,notes:x.description}}}));
  return out;
}
function eventRow(ev){
  return el('div',{class:'item-row'},[
    el('span',{class:'pill',style:`color:${ev.color};border-color:${ev.color}55`,text:ev.kind}),
    el('div',{class:'grow'},[ el('div',{class:'t',text:ev.label}), ev.sub?el('div',{class:'s',text:ev.sub}):null ]),
    el('button',{class:'btn ghost sm',text:'Edit',onclick:()=>openManualForm(ev.edit.type, ev.edit.pf, {table:ev.table, id:ev.id})}),
    el('button',{class:'btn ghost sm',html:'✕','aria-label':'Delete '+ev.label,onclick:async()=>{ if(confirm(ev.edit.pf.repeat_rule&&ev.edit.pf.repeat_rule!=='None'?'Delete this repeating reminder and every future occurrence?':'Delete this item?')) await delRow(ev.table, ev.id); }})
  ]);
}
function calRangeLabel(){
  const a=calAnchor();
  if(CAL_VIEW==='month') return new Date(a.getFullYear(),a.getMonth(),1).toLocaleDateString('en-US',{month:'long',year:'numeric'});
  if(CAL_VIEW==='day') return a.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  if(CAL_VIEW==='schedule') return 'Upcoming';
  const start=CAL_VIEW==='week'?startOfWeek(a):a, n=CAL_VIEW==='week'?7:3, end=addDays(start,n-1);
  const same=start.getMonth()===end.getMonth();
  return start.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' – '+end.toLocaleDateString('en-US', same?{day:'numeric'}:{month:'short',day:'numeric'})+', '+end.getFullYear();
}
function calNav(dir){
  const a=calAnchor();
  if(CAL_VIEW==='month') CAL_ANCHOR=new Date(a.getFullYear(),a.getMonth()+dir,1);
  else if(CAL_VIEW==='week') CAL_ANCHOR=addDays(a,7*dir);
  else if(CAL_VIEW==='3day') CAL_ANCHOR=addDays(a,3*dir);
  else if(CAL_VIEW==='day') CAL_ANCHOR=addDays(a,dir);
  else CAL_ANCHOR=addDays(a,7*dir);
  renderCalendar();
}
function renderCalendar(){
  const body=$('#cal-body'); body.innerHTML='';
  if(!CAL_SELECTED) CAL_SELECTED=todayStr();
  calAnchor();
  const bar=el('div',{class:'cal-toolbar'});
  bar.append(el('div',{class:'cal-nav'},[
    el('button',{class:'btn ghost sm',text:'Today',onclick:()=>{ const n=new Date(todayStr()+'T12:00:00'); CAL_ANCHOR=new Date(n.getFullYear(),n.getMonth(),n.getDate()); CAL_SELECTED=todayStr(); renderCalendar(); }}),
    el('button',{class:'btn ghost sm cal-arrow','aria-label':'Previous calendar period',html:'‹',onclick:()=>calNav(-1)}),
    el('button',{class:'btn ghost sm cal-arrow','aria-label':'Next calendar period',html:'›',onclick:()=>calNav(1)}),
    el('div',{class:'cal-title',text:calRangeLabel()})
  ]));
  const seg=el('div',{class:'cal-seg'});
  CAL_VIEWS.forEach(([v,lbl])=> seg.append(el('button',{class:'cal-seg-btn'+(CAL_VIEW===v?' active':''),'aria-pressed':String(CAL_VIEW===v),text:lbl,onclick:()=>{ CAL_VIEW=v; renderCalendar(); }})));
  bar.append(seg);
  body.append(bar);
  const view=el('div',{class:'cal-view'}); body.append(view);
  if(CAL_VIEW==='month') renderMonthInto(view);
  else if(CAL_VIEW==='schedule') renderScheduleInto(view);
  else renderTimeGridInto(view, CAL_VIEW==='week'?startOfWeek(calAnchor()):calAnchor(), CAL_VIEW==='week'?7:(CAL_VIEW==='3day'?3:1));
}
function renderMonthInto(view){
  const a=calAnchor(), y=a.getFullYear(), m=a.getMonth();
  const first=new Date(y,m,1), startDow=(first.getDay()+6)%7, days=new Date(y,m+1,0).getDate();
  const cal=el('div',{class:'card cal-month-card'});
  const grid=el('div',{class:'cal cal-month'});
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d=> grid.append(el('div',{class:'dow',text:d})) );
  for(let i=0;i<startDow;i++) grid.append(el('div',{class:'day muted'}));
  for(let d=1; d<=days; d++){
    const ds=`${y}-${pad(m+1)}-${pad(d)}`, evs=dayEvents(ds);
    const cell=el('button',{type:'button','aria-label':prettyDateFull(ds)+', '+evs.length+' events','aria-pressed':String(ds===CAL_SELECTED),class:'day'+(ds===todayStr()?' today':'')+(ds===CAL_SELECTED?' sel':''), onclick:()=>{ CAL_SELECTED=ds; renderCalendar(); }});
    cell.append(el('div',{class:'dnum',text:String(d)}));
    if(evs.length){ const tags=el('div',{class:'dtags'});
      evs.slice(0,3).forEach(ev=> tags.append(el('div',{class:'dtag',style:`background:${ev.color}22;color:${ev.color}`,text:ev.label})));
      if(evs.length>3) tags.append(el('div',{class:'dmore',text:'+'+(evs.length-3)+' more'}));
      cell.append(tags); }
    grid.append(cell);
  }
  cal.append(grid); view.append(cal);
  const sel=CAL_SELECTED, evs=dayEvents(sel);
  view.append(el('div',{class:'row-between',style:'margin:20px 0 10px'},[
    el('div',{class:'label',style:'margin:0',text:prettyDateFull(sel)}),
    el('button',{class:'btn sm',text:'+ Add event',onclick:()=>openManualForm('reminder',{date:sel})})
  ]));
  const dc=el('div',{class:'card'});
  if(!evs.length) dc.append(emptyMsg('Nothing on this day. Tap “Add event”, or log a shift/expense from the Add page.'));
  else evs.forEach(ev=> dc.append(eventRow(ev)));
  view.append(dc);
}
function timedEventsForDate(ds){
  const evs=dayEvents(ds), timed=[], allday=[];
  evs.forEach(ev=>{
    let start=null, end=null;
    if(ev.kind==='Shift'){ const s=DB.work_shifts.find(w=>w.id===ev.id);
      if(s){ const A=parseTime(s.start_time); let B=parseTime(s.end_time);
        if(A!=null){ start=A; if(B==null) B=A+(Number(s.hours_worked)||1); if(B<=A) B+=24; end=B; } } }
    else if(ev.kind==='Reminder'){ const r=DB.reminders.find(x=>x.id===ev.id); const A=r?parseTime(r.time):null; if(A!=null){ start=A; end=A+0.75; } }
    if(start!=null){ ev.start=start; ev.end=Math.min(24, Math.max(start+0.4, end)); timed.push(ev); } else allday.push(ev);
  });
  return {timed, allday};
}
function layoutDay(evs){
  evs.sort((a,b)=> a.start-b.start || a.end-b.end);
  let i=0;
  while(i<evs.length){
    let maxEnd=evs[i].end; const cluster=[evs[i]]; let j=i+1;
    while(j<evs.length && evs[j].start < maxEnd){ cluster.push(evs[j]); if(evs[j].end>maxEnd) maxEnd=evs[j].end; j++; }
    const lanes=[];
    cluster.forEach(ev=>{ let placed=false; for(let l=0;l<lanes.length;l++){ if(ev.start>=lanes[l]-0.001){ ev.lane=l; lanes[l]=ev.end; placed=true; break; } } if(!placed){ ev.lane=lanes.length; lanes.push(ev.end); } });
    cluster.forEach(ev=> ev.laneCount=lanes.length);
    i=j;
  }
}
function renderTimeGridInto(view, startDate, n){
  const dd=[]; for(let i=0;i<n;i++){ const dt=addDays(startDate,i), ds=dstr(dt); dd.push(Object.assign({dt,ds}, timedEventsForDate(ds))); }
  const card=el('div',{class:'card cal-tg-card'});
  const tg=el('div',{class:'tg', style:`--cols:${n}`});
  const header=el('div',{class:'tg-header'});
  header.append(el('div',{class:'tg-corner'}));
  dd.forEach(o=>{ const today=o.ds===todayStr();
    header.append(el('button',{type:'button','aria-label':'Open '+prettyDateFull(o.ds),class:'tg-dh', onclick:()=>{ CAL_ANCHOR=new Date(o.dt); CAL_VIEW='day'; CAL_SELECTED=o.ds; renderCalendar(); }},[
      el('div',{class:'tg-dow',text:o.dt.toLocaleDateString('en-US',{weekday:'short'})}),
      el('div',{class:'tg-dnum'+(today?' today':''),text:String(o.dt.getDate())})
    ]));
  });
  const allRow=el('div',{class:'tg-allday'});
  allRow.append(el('div',{class:'tg-corner small',text:'all-day'}));
  dd.forEach(o=>{ const cell=el('div',{class:'tg-allcell'});
    o.allday.forEach(ev=> cell.append(el('button',{type:'button',class:'tg-chip',style:`background:${ev.color}22;color:${ev.color};border-color:${ev.color}55`,text:ev.label,onclick:(e)=>{ e.stopPropagation(); openManualForm(ev.edit.type, ev.edit.pf, {table:ev.table, id:ev.id}); }})));
    allRow.append(cell);
  });
  const scroll=el('div',{class:'tg-scroll'});
  const top=el('div',{class:'tg-top'}); top.append(header, allRow);
  const grid=el('div',{class:'tg-grid'});
  const axis=el('div',{class:'tg-axis'});
  for(let h=0;h<24;h++) axis.append(el('div',{class:'tg-hour', style:`height:${ROWH}px`}, h===0?[]:[el('span',{text:fmtHour(h)})]));
  grid.append(axis);
  const cols=el('div',{class:'tg-cols', style:`height:${ROWH*24}px; background-image:repeating-linear-gradient(to bottom, var(--border), var(--border) 1px, transparent 1px, transparent ${ROWH}px)`});
  dd.forEach(o=>{
    const col=el('div',{class:'tg-col'+(o.ds===todayStr()?' today':''),
      onclick:(e)=>{ const r=col.getBoundingClientRect(); const h=Math.max(0,Math.min(23,Math.floor((e.clientY-r.top)/ROWH))); openManualForm('reminder',{date:o.ds, time:fmtHourTime(h,0)}); }});
    layoutDay(o.timed);
    o.timed.forEach(ev=>{ const eTop=ev.start*ROWH, height=Math.max(20,(ev.end-ev.start)*ROWH-2), w=100/ev.laneCount, left=ev.lane*w;
      col.append(el('button',{type:'button','aria-label':ev.label+' at '+fmtHourTime(Math.floor(ev.start),Math.round((ev.start%1)*60)),class:'tg-ev', style:`top:${eTop}px; height:${height}px; left:calc(${left}% + 2px); width:calc(${w}% - 4px); background:${ev.color}26; border-left:3px solid ${ev.color}; color:${ev.color}`,
        onclick:(e)=>{ e.stopPropagation(); openManualForm(ev.edit.type, ev.edit.pf, {table:ev.table, id:ev.id}); }},[
        el('div',{class:'tg-ev-t',text:ev.label}),
        el('div',{class:'tg-ev-s',text:fmtHourTime(Math.floor(ev.start), Math.round((ev.start%1)*60))})
      ]));
    });
    cols.append(col);
  });
  grid.append(cols); scroll.append(top, grid); tg.append(scroll); card.append(tg); view.append(card);
  requestAnimationFrame(()=>{ scroll.scrollTop = 7*ROWH; });
}
function renderScheduleInto(view){
  const start=calAnchor(); const card=el('div',{class:'card'}); let any=false;
  for(let i=0;i<45;i++){ const dt=addDays(start,i), ds=dstr(dt), evs=dayEvents(ds); if(!evs.length) continue; any=true;
    card.append(el('div',{class:'sch-date'},[
      el('div',{class:'sch-d'+(ds===todayStr()?' today':''),text:String(dt.getDate())}),
      el('div',{},[ el('div',{class:'sch-dow',text:dt.toLocaleDateString('en-US',{weekday:'long'})}), el('div',{class:'tiny muted',text:dt.toLocaleDateString('en-US',{month:'short',day:'numeric'})}) ])
    ]));
    evs.forEach(ev=> card.append(eventRow(ev)));
  }
  if(!any) card.append(emptyMsg('Nothing scheduled in the next 45 days. Add an event, or log things from the Add page.'));
  view.append(card);
}

/* =====================================================================
   SETTINGS
   ===================================================================== */
/* =====================================================================
   CALENDAR SHARE LINKS (management)
   ===================================================================== */
function selKV(value, pairs){ const s=el('select',{class:'input'}); pairs.forEach(([v,l])=>{ const o=el('option',{value:v}); o.textContent=l; if(String(v)===String(value)) o.selected=true; s.append(o); }); return s; }
function genShareToken(){ const r=(self.crypto&&crypto.randomUUID?crypto.randomUUID():(Date.now()+'-'+Math.random())).replace(/-/g,''); return 'cl_'+r+Math.random().toString(36).slice(2,8); }
function shareUrl(token){ return location.origin + location.pathname + '?share=' + token; }
async function copyText(t){ try{ await navigator.clipboard.writeText(t); toast('Link copied'); }catch(e){ prompt('Copy this link:', t); } }
const VIS_LABEL={ all_events:'All events', work_shifts_only:'Work shifts only', busy_free_only:'Busy / free only', selected_categories:'Selected categories' };
const DETAIL_LABEL={ full:'Full details', limited:'Limited details', busy_free:'Busy / free' };

function openShareForm(existing){
  const nameI=inp(existing?existing.name:'',{placeholder:'e.g. Girlfriend work schedule'});
  const visI=selKV(existing?existing.visibility_mode:'work_shifts_only', [['work_shifts_only','Work shifts only'],['all_events','All events'],['busy_free_only','Busy / free only (no titles)']]);
  const detailI=selKV(existing?existing.detail_level:'limited', [['limited','Limited — title, time, date'],['full','Full — also notes'],['busy_free','Busy / free only — no titles']]);
  const rangeI=selKV(existing?existing.date_range_mode:'all_future', [['all_future','All upcoming'],['current_week_only','Current week only']]);
  const expI=inp(existing&&existing.expires_at?String(existing.expires_at).slice(0,10):'',{type:'date'});
  const form=el('div',{});
  form.append(f('Link name',nameI), f('What it shows',visI), f('Detail level',detailI), f('Date range',rangeI), f('Expires on (optional)',expI));
  const save=el('button',{class:'btn primary block',text:existing?'Save changes':'Create link',style:'margin-top:6px'});
  save.onclick=async()=>{ save.disabled=true;
    const payload={ name:nameI.value.trim()||'Shared calendar', visibility_mode:visI.value, detail_level:detailI.value, date_range_mode:rangeI.value,
      expires_at: expI.value? new Date(expI.value+'T23:59:59').toISOString() : null, updated_at:new Date().toISOString() };
    try{
      if(existing){ const {error}=await sb.from('calendar_shares').update(payload).eq('id',existing.id).eq('user_id',USER.id); if(error) throw error; toast('Link updated'); }
      else { payload.token=genShareToken(); payload.is_active=true; await insertRow('calendar_shares', payload); toast('Share link created'); }
      closeModal(); await refresh();
    }catch(e){ save.disabled=false; toast('Save failed — did you run the share-links migration?'); }
  };
  form.append(save);
  modal(existing?'Edit share link':'Create calendar share link', form);
}
function renderShareLinksCard(){
  const card=el('div',{class:'card'});
  card.append(el('div',{class:'row-between',style:'margin-bottom:4px'},[
    el('div',{class:'label',style:'margin:0',text:'Calendar share links'}),
    el('button',{class:'btn sm',text:'+ Create link',onclick:()=>openShareForm(null)})
  ]));
  card.append(el('div',{class:'tiny muted',style:'margin:0 0 12px',text:'Share a read-only view of your schedule — recipients need no account, just the link.'}));
  const shares=DB.calendar_shares||[];
  if(!shares.length){ card.append(emptyMsg('No share links yet. Create one to share your work schedule.')); return card; }
  shares.forEach(s=> card.append(el('div',{class:'share-row'},[
    el('div',{class:'share-main'},[
      el('div',{class:'share-name'},[ el('span',{class:'share-dot'+(s.is_active?' on':'')}), el('span',{text:s.name||'Shared calendar'}) ]),
      el('div',{class:'tiny muted',style:'margin-top:3px',text:[VIS_LABEL[s.visibility_mode]||s.visibility_mode, DETAIL_LABEL[s.detail_level]||s.detail_level, s.is_active?'Active':'Disabled', s.last_viewed_at?('viewed '+new Date(s.last_viewed_at).toLocaleDateString()):'never viewed'].join(' · ')})
    ]),
    el('div',{class:'share-acts'},[
      el('button',{class:'btn ghost sm',text:'Copy link',onclick:()=>copyText(shareUrl(s.token))}),
      el('button',{class:'btn ghost sm',text:'Edit',onclick:()=>openShareForm(s)}),
      el('button',{class:'btn ghost sm',text:s.is_active?'Disable':'Enable',onclick:async()=>{ await checkedWrite(sb.from('calendar_shares').update({is_active:!s.is_active}).eq('id',s.id).eq('user_id',USER.id)); await refresh(); }}),
      el('button',{class:'btn danger sm',html:'✕',onclick:async()=>{ if(confirm('Delete this link? Anyone using it will lose access.')) await delRow('calendar_shares', s.id); }})
    ])
  ])));
  return card;
}

let SET_PAGE=null;
function settingsProfile(){
  const c=el('div',{class:'card'});
  c.append(el('div',{class:'label',text:'Your defaults'}));
  const nameI=inp(PROFILE.name,{placeholder:'Noah'});
  const rateI=inp(PROFILE.default_hourly_rate,{type:'number',step:'0.01',placeholder:'e.g. 14.50'});
  const wtI=sel(PROFILE.default_work_type||'Hotel shift',['Hotel shift','Side work','Other']);
  c.append(f('Name',nameI), f('Default hourly rate ($/hr)',rateI), f('Default work type',wtI));
  const saveP=el('button',{class:'btn primary',text:'Save defaults'});
  saveP.addEventListener('click',async()=>{
    if(saveP.disabled)return;saveP.disabled=true;
    try{
      const rate=rateI.value===''?null:Number(rateI.value);
      if(rate!==null&&(!Number.isFinite(rate)||rate<0))throw new Error('Enter a valid nonnegative hourly rate.');
      if(!nameI.value.trim())throw new Error('Enter your name.');
      await checkedWrite(sb.from('profiles').update({name:nameI.value.trim(),default_hourly_rate:rate,default_work_type:wtI.value}).eq('id',USER.id));
      try{await loadProfile();$('#side-who').textContent='Signed in as '+(PROFILE.name||USER.email);}catch{setSyncStatus('Defaults saved. Refresh to load the latest profile.');}
      toast('Defaults saved');
    }catch(error){toast(error.message);}finally{saveP.disabled=false;}
  });
  c.append(saveP); return c;
}
function settingsWorkTypes(){
  const c=el('div',{class:'card'});
  c.append(el('div',{class:'label',text:'Work types'}));
  c.append(el('div',{class:'tiny muted',style:'margin-bottom:12px',text:'Add each kind of work you do with its hourly rate. In the Add chat, type ! to drop one in — Anchor uses its rate automatically.'}));
  const wtList=el('div',{});
  function renderWT(){ wtList.innerHTML=''; const arr=getWorkTypes();
    if(!arr.length){ wtList.append(el('div',{class:'empty',text:'No work types yet. Add one below.'})); return; }
    arr.forEach((w,i)=> wtList.append(el('div',{class:'wt-row'},[
      el('span',{class:'wt-dot',style:`background:${w.color||'#63b7da'}`}),
      el('span',{class:'nm',text:w.name}),
      el('span',{class:'rt',text:w.rate?('$'+w.rate+'/hr'):'no rate'}),
      el('button',{class:'btn ghost sm',html:'✕',onclick:()=>{ const a=getWorkTypes(); a.splice(i,1); setWorkTypes(a); renderWT(); }})
    ]))); }
  renderWT(); c.append(wtList);
  const wtName=inp('',{placeholder:'e.g. Valet shift'}), wtRate=inp('',{type:'number',step:'0.01',placeholder:'$/hr'});
  const wtAdd=el('button',{class:'btn primary sm',text:'Add',style:'white-space:nowrap'});
  wtAdd.onclick=()=>{ const nm=wtName.value.trim(); if(!nm) return; const a=getWorkTypes(); a.push({name:nm, rate:wtRate.value?Number(wtRate.value):null, color:WT_COLORS[a.length%WT_COLORS.length]}); setWorkTypes(a); wtName.value=''; wtRate.value=''; renderWT(); };
  c.append(el('div',{style:'display:flex; gap:10px; align-items:flex-end; margin-top:14px'},[
    el('div',{style:'flex:2'},[ f('Name',wtName) ]), el('div',{style:'flex:1'},[ f('Hourly rate',wtRate) ]), el('div',{},[ el('div',{style:'height:18px'}), wtAdd ])
  ]));
  return c;
}
function settingsAI(){
  const c=el('div',{class:'card'});
  c.append(el('div',{class:'label',text:'AI & privacy'}),el('p',{class:'muted',text:'AI runs through your authenticated Anchor backend. Provider keys stay on the server. When enabled, your message and a limited set of your saved tasks, lists, habits, calendar and work schedule are sent to OpenAI. Provider data-retention terms apply.'}));
  const enabled=inp('',{type:'checkbox'});enabled.checked=!!pref('ai_enabled',false);
  const finance=inp('',{type:'checkbox'});finance.checked=!!pref('finance_ai_opt_in',false);
  c.append(f('Enable OpenAI for my messages, tasks, lists, habits and schedule',enabled),f('Also allow AI to use my financial entries and work earnings',finance));
  c.append(el('p',{class:'tiny muted',text:'Financial context is off by default. AI answers never change records. Every proposed entry needs your confirmation.'}));
  c.append(el('button',{class:'btn primary',text:'Save AI preferences',onclick:async e=>{const button=e.currentTarget;button.disabled=true;try{await patchPreferences({ai_enabled:enabled.checked,finance_ai_opt_in:finance.checked});}catch{}finally{button.disabled=false;}}}));
  if(LEGACY_AI_KEY_PRESENT)c.append(el('p',{class:'msg err',text:'An old provider key is still stored on this device. Anchor no longer uses it. Remove it here and rotate it with your provider if it was exposed.'}),el('button',{class:'btn danger',text:'Remove old key from this device',onclick:()=>{localStorage.removeItem('anchor.llm.key');toast('Old browser key removed');}}));
  return c;
}
function settingsReminders(){
  const c=el('div',{class:'card'}), timezone=inp(pref('timezone',Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'));
  const enabled=inp('',{type:'checkbox'});enabled.checked=!!pref('reminders_enabled',false);
  c.append(el('div',{class:'label',text:'Reminder preferences'}),f('Timezone (for example America/New_York)',timezone),f('Queue reminders in my Anchor inbox',enabled),el('p',{class:'tiny muted',text:'Daily, weekly and monthly repeats appear on your calendar. The server reminder queue requires the backend scheduler to be installed. Phone push and email delivery are not connected yet.'}));
  c.append(el('button',{class:'btn primary',text:'Save reminder preferences',onclick:async e=>{const button=e.currentTarget;try{new Intl.DateTimeFormat('en',{timeZone:timezone.value});button.disabled=true;await patchPreferences({timezone:timezone.value,reminders_enabled:enabled.checked});}catch(err){toast(err.message||'Enter a valid timezone');}finally{button.disabled=false;}}}));
  const inbox=el('div',{class:'reminder-inbox',role:'status',text:'Loading reminder inbox…'});c.append(el('div',{class:'divider'}),el('h3',{text:'Reminder inbox'}),inbox);
  const uid=USER.id;
  sb.from('anchor_notifications').select('id,title,body,scheduled_for,read_at').eq('user_id',uid).order('scheduled_for',{ascending:false}).limit(50).then(({data,error})=>{
    if(USER?.id!==uid)return;
    inbox.replaceChildren();
    if(error){inbox.textContent='Reminder inbox is unavailable until the backend is installed.';return;}
    if(!data.length){inbox.textContent='No reminders delivered yet.';return;}
    for(const item of data)inbox.append(el('div',{class:'card'},[el('strong',{text:item.title}),el('p',{class:'muted',text:item.body||''}),el('span',{class:'tiny muted',text:new Date(item.scheduled_for).toLocaleString()})]));
  }).catch(()=>{inbox.textContent='Could not load reminders. Try again later.';});
  return c;
}
function settingsAccount(){
  const c=el('div',{class:'card'});
  c.append(el('div',{class:'label',text:'Account'}));
  c.append(el('div',{class:'kv',html:`<span class="k">Email</span><span class="v">${esc(USER.email)}</span>`}));
  c.append(el('div',{class:'kv',html:`<span class="k">Role</span><span class="v">${PROFILE.is_admin?'Admin':'User'}</span>`}));
  c.append(el('div',{class:'kv',html:`<span class="k">Cloud</span><span class="v">${esc(CFG.url.replace('https://',''))}</span>`}));
  const acts=el('div',{class:'confirm-actions',style:'margin-top:14px'});
  acts.append(el('button',{class:'btn ghost',text:'Sign out',onclick:async()=>{ const {error}=await sb.auth.signOut(); if(error){toast('Could not sign out. Please try again.');return;} resetAccountState(); showGate('auth'); setAuthMode('signin'); }}));
  acts.append(el('button',{class:'btn ghost sm',text:'Change cloud project',onclick:()=>{ CFG.clearCloud(); sb=null; showGate('connect'); }}));
  c.append(acts);
  c.append(el('div',{class:'divider'}),el('p',{class:'tiny muted',text:'Settings saved by older Anchor versions live only on this device. Import them only if they belong to this account; this replaces matching cloud preferences.'}),el('button',{class:'btn ghost',text:'Import this device’s old settings',onclick:async()=>{
    if(!confirm('Replace this account’s work types, vehicles, gas and commute settings with the old settings saved on this device?'))return;
    const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback));}catch{return fallback;}};
    await patchPreferences({work_types:read('anchor.worktypes',[]),vehicles:read('anchor.vehicles',[]),work_locations:read('anchor.worklocs',[]),home_address:localStorage.getItem('anchor.home.addr')||'',gas_price:Number(localStorage.getItem('anchor.gas.price'))||0});
  }}));
  return c;
}
function settingsGas(){
  const c=el('div',{class:'card'});
  // gas price
  c.append(el('div',{class:'label',text:'Gas price'}));
  c.append(el('div',{class:'tiny muted',style:'margin-bottom:10px',text:'Your typical local price per gallon — Anchor uses it to estimate trip costs.'}));
  const priceI=inp(GAS.price||'',{type:'number',step:'0.01',placeholder:'e.g. 3.45'});
  const savePrice=el('button',{class:'btn primary sm',text:'Save'});
  savePrice.onclick=()=>{ GAS.price=priceI.value?Number(priceI.value):'';  };
  c.append(el('div',{style:'display:flex;gap:10px;align-items:flex-end'},[ el('div',{style:'flex:1'},[ f('Price per gallon ($)',priceI) ]), el('div',{},[ el('div',{style:'height:18px'}), savePrice ]) ]));
  c.append(el('div',{class:'divider'}));
  // vehicles
  c.append(el('div',{class:'label',text:'Vehicles'}));
  c.append(el('div',{class:'tiny muted',style:'margin-bottom:10px',text:'Each vehicle’s MPG lets Anchor estimate gas. Say “…on my motorcycle” in chat and it uses that one.'}));
  const vList=el('div',{});
  function renderVeh(){ vList.innerHTML=''; const arr=getVehicles();
    if(!arr.length){ vList.append(el('div',{class:'empty',text:'No vehicles yet.'})); return; }
    arr.forEach((v,i)=> vList.append(el('div',{class:'wt-row'},[
      el('span',{class:'wt-dot',style:`background:${v.color||'#63b7da'}`}),
      el('span',{class:'nm',text:v.name+(v.type?' · '+v.type:'')}),
      el('span',{class:'rt',text:(v.mpg?v.mpg+' mpg':'no mpg')+(v.def?' · default':'')}),
      el('button',{class:'btn ghost sm',text:v.def?'Default':'Set default',onclick:()=>{ const a=getVehicles(); a.forEach((x,j)=>x.def=(j===i)); setVehicles(a); renderVeh(); }}),
      el('button',{class:'btn ghost sm',html:'✕',onclick:()=>{ const a=getVehicles(); a.splice(i,1); setVehicles(a); renderVeh(); }})
    ]))); }
  renderVeh(); c.append(vList);
  const vName=inp('',{placeholder:'e.g. Motorcycle'}), vType=sel('Motorcycle',VEHICLE_TYPES), vMpg=inp('',{type:'number',step:'1',placeholder:'mpg'});
  const vAdd=el('button',{class:'btn primary sm',text:'Add'});
  vAdd.onclick=()=>{ const nm=vName.value.trim(); if(!nm) return; const a=getVehicles(); a.push({name:nm,type:vType.value,mpg:vMpg.value?Number(vMpg.value):null,color:WT_COLORS[a.length%WT_COLORS.length],def:a.length===0}); setVehicles(a); vName.value='';vMpg.value=''; renderVeh(); };
  c.append(el('div',{style:'display:flex;gap:10px;align-items:flex-end;margin-top:14px;flex-wrap:wrap'},[ el('div',{style:'flex:2;min-width:110px'},[f('Name',vName)]), el('div',{style:'flex:1;min-width:90px'},[f('Type',vType)]), el('div',{style:'flex:1;min-width:70px'},[f('MPG',vMpg)]), el('div',{},[el('div',{style:'height:18px'}),vAdd]) ]));
  c.append(el('div',{class:'divider'}));
  // commute
  c.append(el('div',{class:'label',text:'Commute'}));
  c.append(el('div',{class:'tiny muted',style:'margin-bottom:10px',text:'Your home and workplaces. “Auto” sends these addresses to OpenStreetMap and coordinates to OSRM to estimate driving distance. Or enter one-way miles yourself.'}));
  const homeI=inp(getHomeAddr(),{placeholder:'Home address'});
  const saveHome=el('button',{class:'btn ghost sm',text:'Save'});
  saveHome.onclick=()=>{ setHomeAddr(homeI.value.trim());  };
  c.append(el('div',{style:'display:flex;gap:10px;align-items:flex-end'},[ el('div',{style:'flex:1'},[f('Home address',homeI)]), el('div',{},[el('div',{style:'height:18px'}),saveHome]) ]));
  const wList=el('div',{style:'margin-top:10px'});
  function renderWL(){ wList.innerHTML=''; const arr=getWorkLocs();
    if(!arr.length){ wList.append(el('div',{class:'empty',text:'No workplaces yet.'})); return; }
    arr.forEach((w,i)=> wList.append(el('div',{class:'wt-row'},[
      el('span',{class:'wt-dot',style:'background:#63b7da'}),
      el('span',{class:'nm',text:w.name}),
      el('span',{class:'rt',text:(w.oneWay?w.oneWay+' mi each way':'no distance')+(w.def?' · default':'')}),
      el('button',{class:'btn ghost sm',text:w.def?'Default':'Set default',onclick:()=>{ const a=getWorkLocs(); a.forEach((x,j)=>x.def=(j===i)); setWorkLocs(a); renderWL(); }}),
      el('button',{class:'btn ghost sm',html:'✕',onclick:()=>{ const a=getWorkLocs(); a.splice(i,1); setWorkLocs(a); renderWL(); }})
    ]))); }
  renderWL(); c.append(wList);
  const wName=inp('',{placeholder:'e.g. White Barn Inn'}), wAddr=inp('',{placeholder:'Work address (for Auto)'}), wMiles=inp('',{type:'number',step:'0.1',placeholder:'mi one-way'});
  const wAuto=el('button',{class:'btn ghost sm',text:'Auto'});
  wAuto.onclick=async()=>{ const home=homeI.value.trim()||getHomeAddr(), wa=wAddr.value.trim(); if(!home||!wa){ toast('Enter home + work address first'); return; }
    wAuto.disabled=true; wAuto.textContent='…'; const mi=await autoDistance(home,wa); wAuto.disabled=false; wAuto.textContent='Auto';
    if(mi){ wMiles.value=mi; toast('≈ '+mi+' mi one-way'); } else toast('Couldn’t estimate — type the miles'); };
  const wAdd=el('button',{class:'btn primary sm',text:'Add'});
  wAdd.onclick=()=>{ const nm=wName.value.trim(); if(!nm) return; const a=getWorkLocs(); a.push({name:nm,addr:wAddr.value.trim(),oneWay:wMiles.value?Number(wMiles.value):null,def:a.length===0}); setWorkLocs(a); wName.value='';wAddr.value='';wMiles.value=''; renderWL(); };
  c.append(el('div',{style:'display:flex;gap:10px;align-items:flex-end;margin-top:14px;flex-wrap:wrap'},[ el('div',{style:'flex:2;min-width:120px'},[f('Workplace',wName)]), el('div',{style:'flex:2;min-width:150px'},[f('Address',wAddr)]), el('div',{style:'flex:1;min-width:80px'},[f('Miles',wMiles)]), el('div',{},[el('div',{style:'height:18px'}),wAuto]), el('div',{},[el('div',{style:'height:18px'}),wAdd]) ]));
  c.append(el('div',{class:'tiny muted',style:'margin-top:14px',text:'Then in Add: “worked 7 hrs, drove there and back on my motorcycle” → Anchor logs the shift and the gas.'}));
  return c;
}
const SET_PAGES=[
  {key:'reminders',label:'Reminders',desc:'Timezone and reminder preferences',icon:'◷',build:settingsReminders},
  {key:'profile',   label:'Profile',          desc:'Name, hourly rate, default work type', icon:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>', build:settingsProfile},
  {key:'worktypes', label:'Work types',       desc:'Your jobs & rates for ! commands',     icon:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/></svg>', build:settingsWorkTypes},
  {key:'gas',       label:'Commute & gas',    desc:'Vehicles, distances & gas price',      icon:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="9" height="18" rx="2"/><path d="M4 9h9"/><path d="M13 8l3 3v5a2 2 0 0 0 4 0V8l-2.5-2.5"/></svg>', build:settingsGas},
  {key:'ai',        label:'AI & privacy',      desc:'Secure assistant and data choices',    icon:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.7 4.6L18.3 9l-4.6 1.7L12 15l-1.7-4.3L5.7 9l4.6-1.4z"/><path d="M18 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>', build:settingsAI},
  {key:'sharing',   label:'Calendar sharing', desc:'Share links & privacy',                icon:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="6" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M8.3 10.8l7.4-3.6M8.3 13.2l7.4 3.6"/></svg>', build:renderShareLinksCard},
  {key:'account',   label:'Account',          desc:'Email, cloud & sign out',              icon:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14 2h-4l-.6 2.5a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2L10 22h4l.6-2.5a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/></svg>', build:settingsAccount},
];
function gotoSettings(key){ SET_PAGE=key; renderSettings(); window.scrollTo(0,0); }
function renderSettings(){
  const body=$('#set-body'); body.innerHTML='';
  const sub=$('#screen-settings .page-sub');
  if(!SET_PAGE){
    if(sub) sub.textContent='Choose a section to manage.';
    const list=el('div',{class:'set-list'});
    SET_PAGES.forEach(p=> list.append(el('button',{class:'set-row', onclick:()=>gotoSettings(p.key)},[
      el('span',{class:'set-ico',html:p.icon}),
      el('span',{class:'set-rl'},[ el('span',{class:'set-rt',text:p.label}), el('span',{class:'set-rd',text:p.desc}) ]),
      el('span',{class:'set-chev',html:'›'})
    ])));
    body.append(list);
    return;
  }
  const page=SET_PAGES.find(p=>p.key===SET_PAGE)||SET_PAGES[0];
  if(sub) sub.textContent=page.desc;
  body.append(el('div',{class:'set-crumb'},[
    el('a',{href:'#', class:'set-crumb-link', onclick:(e)=>{ e.preventDefault(); gotoSettings(null); }},[ el('span',{html:'‹'}), 'All settings' ]),
    el('span',{class:'set-crumb-sep',text:'›'}),
    el('span',{class:'set-crumb-cur',text:page.label})
  ]));
  body.append(page.build());
  body.append(el('a',{href:'#', class:'set-bottomback', onclick:(e)=>{ e.preventDefault(); gotoSettings(null); }, text:'‹ Back to all settings'}));
}

/* =====================================================================
   MANUAL ENTRY FORMS
   ===================================================================== */
function f(label,input){ if(!input.id) input.id='field-'+crypto.randomUUID(); return el('div',{class:'field'},[el('label',{text:label,for:input.id}),input]); }
function inp(value, attrs={}){ return el('input',{class:'input', value:(value??''), ...attrs}); }
function ta(value, attrs={}){ const t=el('textarea',{class:'input', ...attrs}); t.value=value??''; return t; }
function sel(value, options){ const s=el('select',{class:'input'}); options.forEach(o=>{ const op=el('option',{value:o}); op.textContent=o; if(String(o)===String(value)) op.selected=true; s.append(op); }); return s; }

function openManual(section){
  if(section==='finance'){
    const box=el('div',{},[ el('div',{class:'tiny muted',style:'margin-bottom:12px',text:'What do you want to log?'}),
      el('div',{class:'confirm-actions'},[
        el('button',{class:'btn primary',text:'Expense',onclick:()=>openManualForm('expense')}),
        el('button',{class:'btn',text:'Income',onclick:()=>openManualForm('income')}),
        el('button',{class:'btn',text:'Work shift',onclick:()=>openManualForm('workshift')}),
      ])]);
    modal('Add to Finance', box);
  } else if(section==='todo'){
    const box=el('div',{},[ el('div',{class:'tiny muted',style:'margin-bottom:12px',text:'Add a single task or a list?'}),
      el('div',{class:'confirm-actions'},[
        el('button',{class:'btn primary',text:'Task',onclick:()=>openManualForm('task')}),
        el('button',{class:'btn',text:'List',onclick:()=>openManualForm('list')}),
      ])]);
    modal('Add to To-do', box);
  } else if(section==='habit'){ openManualForm('habit'); }
  else if(section==='reminder'){ openManualForm('reminder'); }
}

function openManualForm(type, pf={}, edit=null){
  const t=todayStr();
  let fields={}, title='';
  const requestId=crypto.randomUUID();
  const form=el('div',{});
  const save=el('button',{class:'btn primary block',text:edit?'Save changes':'Save',style:'margin-top:6px'});
  const commit = async (table, payload) => {
    const entryType={work_shifts:'work_shift',finance_entries:payload.type,todo_items:'todo_task',reminders:'reminder'}[table];
    payload=AnchorCore.validateEntry(entryType,payload);
    if(edit){await checkedWrite(sb.from(table).update(payload).eq('id',edit.id).eq('user_id',USER.id));}
    else {const entry={...payload};delete entry.linked_type;if(table==='todo_items'){entry.notes=entry.description;delete entry.description;}await saveAtomic(entryType,entry,requestId);}
  };

  if(type==='workshift'){
    title='Add work shift';
    fields.date=inp(pf.date||t,{type:'date'});
    fields.work_type=sel(pf.work_type||PROFILE.default_work_type||'Hotel shift',['Hotel shift','Side work','Other']);
    fields.start=inp(pf.start_time||'',{placeholder:'e.g. 9:00 am'});
    fields.end=inp(pf.end_time||'',{placeholder:'e.g. 4:30 pm'});
    fields.hours=inp(pf.hours_worked||'',{type:'number',step:'0.1',placeholder:'or enter hours directly'});
    fields.rate=inp(pf.hourly_rate??PROFILE.default_hourly_rate??'',{type:'number',step:'0.01'});
    fields.cash=inp(pf.cash_tips||'',{type:'number',step:'0.01'});
    fields.digital=inp(pf.digital_tips||'',{type:'number',step:'0.01'});
    fields.notes=ta(pf.notes||'');
    form.append(f('Date',fields.date), f('Work type',fields.work_type),
      el('div',{class:'input-row'},[f('Start',fields.start),f('End',fields.end)]),
      f('Hours (optional if start/end given)',fields.hours), f('Hourly rate',fields.rate),
      el('div',{class:'input-row'},[f('Cash tips',fields.cash),f('Digital tips',fields.digital)]), f('Notes',fields.notes));
    save.onclick=async()=>{ save.disabled=true;
      const raw=AnchorCore.validateEntry('work_shift',{date:fields.date.value,work_type:fields.work_type.value,start_time:fields.start.value||null,end_time:fields.end.value||null,hours_worked:fields.hours.value||0,hourly_rate:fields.rate.value,cash_tips:fields.cash.value||0,digital_tips:fields.digital.value||0,notes:fields.notes.value});
      const s=calcShift(raw);
      await commit('work_shifts',{date:resolveDate(s.date),work_type:s.work_type,start_time:s.start_time||null,end_time:s.end_time||null,hours_worked:s.hours_worked,hourly_rate:s.hourly_rate,cash_tips:s.cash_tips,digital_tips:s.digital_tips,total_tips:s.total_tips,wage_pay:s.wage_pay,total_shift_income:s.total_shift_income,tips_per_hour:s.tips_per_hour,notes:s.notes||null});
      closeModal(true); await refresh(); if(!edit) go('finance'); toast(edit?'Shift updated':'Shift added'); };
  }
  else if(type==='expense'||type==='income'){
    title=type==='expense'?'Add expense':'Add income';
    fields.date=inp(pf.date||t,{type:'date'});
    fields.amount=inp(pf.amount||'',{type:'number',step:'0.01',placeholder:'0.00'});
    fields.category = type==='expense'? sel(pf.category||'Other',EXPENSE_CATS) : inp(pf.category||'',{placeholder:'e.g. Side work'});
    fields.desc=inp(pf.description||'',{placeholder:'description'});
    fields.pay=sel(pf.payment_type||'cash',['cash','digital']);
    fields.notes=ta(pf.notes||'');
    form.append(f('Date',fields.date), f('Amount ($)',fields.amount), f('Category',fields.category), f('Description',fields.desc), f('Payment',fields.pay), f('Notes',fields.notes));
    save.onclick=async()=>{ save.disabled=true;
      await commit('finance_entries',{type, date:fields.date.value, amount:fields.amount.value, category:(fields.category.value||'Other'), description:fields.desc.value||null, payment_type:fields.pay.value, notes:fields.notes.value||null});
      closeModal(true); await refresh(); if(!edit) go('finance'); toast((type==='expense'?'Expense':'Income')+(edit?' updated':' added')); };
  }
  else if(type==='habit'){
    title='Add habit';
    fields.name=inp(pf.name||'',{placeholder:'e.g. Workout Routine'});
    fields.desc=ta(pf.description||'',{placeholder:'e.g. 60-100 superman planks, 50 crunches'});
    fields.freq=sel(pf.frequency||'Daily',['Daily','Weekly']);
    fields.amt=inp(pf.target_amount||'',{type:'number',step:'1',placeholder:'e.g. 50'});
    fields.unit=sel(pf.target_unit||'reps',['reps','minutes','times','yes/no','custom']);
    fields.remind=inp(pf.reminder_time||'',{placeholder:'e.g. 8:00 am (optional)'});
    fields.temp=el('select',{class:'input'}); ['Ongoing','Temporary'].forEach(o=>{const op=el('option',{value:o});op.textContent=o; if(pf.is_temporary&&o==='Temporary')op.selected=true; fields.temp.append(op);});
    form.append(f('Name',fields.name), f('Details',fields.desc), f('Frequency',fields.freq),
      el('div',{class:'input-row'},[f('Target amount',fields.amt),f('Unit',fields.unit)]), f('Reminder time',fields.remind), f('Type',fields.temp));
    save.onclick=async()=>{ save.disabled=true;
      await saveAtomic('habit',{name:fields.name.value,description:fields.desc.value||null,frequency:fields.freq.value,target_amount:fields.amt.value?Number(fields.amt.value):null,target_unit:fields.unit.value,reminder_time:fields.remind.value||null,is_temporary:fields.temp.value==='Temporary',start_date:t},requestId);
      closeModal(true); await refresh(); go('habits'); toast('Habit added'); };
  }
  else if(type==='task'){
    title='Add task';
    fields.title=inp(pf.title||'',{placeholder:'e.g. Call landlord'});
    fields.cat=inp(pf.category||'',{placeholder:'category (optional)'});
    fields.prio=sel(pf.priority||'Medium',['High','Medium','Low']);
    fields.due=inp(/^\d{4}-\d{2}-\d{2}$/.test(pf.due_date||'')?pf.due_date:'',{type:'date'});
    fields.notes=ta(pf.notes||'');
    form.append(f('Task',fields.title), f('Category',fields.cat), f('Priority',fields.prio), f('Due date',fields.due), f('Notes',fields.notes));
    save.onclick=async()=>{ save.disabled=true;
      await commit('todo_items',{title:fields.title.value,description:fields.notes.value||null,category:fields.cat.value||null,priority:fields.prio.value,due_date:fields.due.value||null,status:pf.status||'Not started'});
      closeModal(true); await refresh(); if(!edit) go('todo'); toast(edit?'Task updated':'Task added'); };
  }
  else if(type==='list'){
    title='Add list';
    fields.title=inp(pf.title||'',{placeholder:'e.g. Groceries'});
    fields.prio=sel(pf.priority||'Medium',['High','Medium','Low']);
    fields.items=ta((pf.items||[]).join('\n'),{placeholder:'One item per line'});
    form.append(f('List title',fields.title), f('Priority',fields.prio), f('Items',fields.items));
    save.onclick=async()=>{ save.disabled=true;
      await saveAtomic('todo_list',{title:fields.title.value,priority:fields.prio.value,items:fields.items.value.split('\n').map(x=>x.trim()).filter(Boolean)},requestId);
      closeModal(true); await refresh(); go('todo'); toast('List added'); };
  }
  else if(type==='reminder'){
    title='Add reminder';
    fields.title=inp(pf.title||'',{placeholder:'e.g. Dentist appointment'});
    fields.date=inp(resolveDate(pf.date),{type:'date'});
    fields.time=inp(pf.time||'',{placeholder:'e.g. 2:00 pm'});
    fields.repeat=sel(pf.repeat_rule||'None',['None','Daily','Weekly','Monthly']);
    fields.notes=ta(pf.notes||'');
    form.append(f('Title',fields.title), f('Date',fields.date), f('Time',fields.time), f('Repeat',fields.repeat), f('Notes',fields.notes));
    save.onclick=async()=>{ save.disabled=true;
      await commit('reminders',{title:fields.title.value,date:fields.date.value,time:fields.time.value||null,repeat_rule:fields.repeat.value,linked_type:'general',notes:fields.notes.value||null});
      closeModal(true); await refresh(); if(!edit) go('calendar'); toast(edit?'Reminder updated':'Reminder added'); };
  }
  const onSave=save.onclick;
  save.onclick=async()=>{if(save.disabled)return;const original=save.textContent;modalSaving=true;try{await onSave();}catch(err){toast(err.message||'Save failed. Your form is still here.');}finally{modalSaving=false;save.disabled=false;save.textContent=original;}};
  if(edit&&type==='reminder'&&pf.repeat_rule&&pf.repeat_rule!=='None')form.prepend(el('p',{class:'msg',text:'You’re editing the whole repeating reminder, including future occurrences.'}));
  form.append(save);
  modal(edit ? title.replace(/^Add/,'Edit') : title, form);
}

/* =====================================================================
   BOOT
   ===================================================================== */
setAuthMode('signin');
boot();
