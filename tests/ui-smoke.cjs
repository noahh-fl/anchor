const {chromium}=require('playwright');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const mock=require('./mock-supabase.cjs');
(async()=>{
const root=path.join(__dirname,'..');const server=http.createServer((req,res)=>{const target=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);try{res.setHeader('Content-Type',target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(target))}catch{res.statusCode=404;res.end()}}).listen(0,'127.0.0.1');
await new Promise(r=>server.on('listening',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>{const url=route.request().url();if(url.includes('cdn.jsdelivr.net'))return route.fulfill({contentType:'text/javascript',body:mock});if(url.startsWith(base))return route.continue();return route.abort();});
try{
await page.goto(base);await page.locator('#app:not(.hidden)').waitFor();
assert.equal(await page.evaluate(()=>typeof AnchorCore),'object');
await page.evaluate(()=>go('calendar'));
assert.equal(await page.evaluate(()=>dayEvents('2026-10-08').filter(x=>x.id==='r1').length),1);
await page.evaluate(()=>openManualForm('task'));
await page.getByLabel('Task',{exact:true}).fill('Get groceries');
await page.evaluate(()=>window.failSave=true);
await page.locator('.modal button').filter({hasText:/^Save$/}).click();
await page.waitForTimeout(100);
assert.equal(await page.locator('.modal').count(),1);
assert.equal(await page.getByLabel('Task',{exact:true}).inputValue(),'Get groceries');
await page.evaluate(()=>window.failSave=false);
await page.locator('.modal button').filter({hasText:/^Save$/}).click();
await page.waitForTimeout(100);
assert.equal(await page.locator('.modal').count(),0);
const saves=await page.evaluate(()=>calls.filter(x=>x.name==='anchor_save_entry'));
assert.equal(saves.length,2);assert.equal(saves[0].args.p_request_id,saves[1].args.p_request_id);
await page.evaluate(()=>{go('add');document.querySelector('#chat-text').value='What is on my calendar?';submitChat();submitChat();});
await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>aiCalls),1);
assert.match(await page.locator('#chat-scroll').innerText(),/daily reminder/);
assert.equal(await page.locator('.confirm-card').count(),0);
await page.evaluate(()=>{go('settings');gotoSettings('ai');});
assert.equal(await page.locator('input[type=password]').count(),1); // Only signed-out auth password remains; no provider key UI.
await page.screenshot({path:path.join(root,'artifacts/mobile-ai-privacy.png'),fullPage:true});
for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:844});for(const screen of ['add','dashboard','finance','habits','todo','calendar','settings']){await page.evaluate(s=>go(s),screen);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,screen+' overflows at '+width);}}
await page.setViewportSize({width:390,height:844});await page.evaluate(()=>go('calendar'));await page.screenshot({path:path.join(root,'artifacts/mobile-calendar.png'),fullPage:true});
await page.evaluate(()=>openManualForm('task'));await page.keyboard.press('Escape');assert.equal(await page.locator('.modal').count(),0);assert.equal(await page.locator('#app').getAttribute('inert'),null);
const preserved=await page.evaluate(async()=>{const before=DB.reminders.length;window.failRead=true;try{await loadAll()}catch{}return before===DB.reminders.length;});assert.equal(preserved,true);
assert.deepEqual(errors,[]);console.log('PASS: mock-auth boot, recurrence, failed-save retention, idempotent retry, duplicate-send guard, read-only AI answer, mobile/desktop overflow, Escape cleanup, failed-read preservation.');
}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e.message);process.exit(1)});
