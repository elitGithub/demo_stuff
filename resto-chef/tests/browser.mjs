// Local Chromium UI smoke checks; no npm packages required (Node 22+).
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const base=process.env.DEMO_URL||'http://127.0.0.1:8087';
const profile=mkdtempSync(join(tmpdir(),'restrogirls-browser-'));
const out=join(root,'storage','screenshots');mkdirSync(out,{recursive:true});
const accounts=JSON.parse(readFileSync(join(root,'storage','demo-credentials.json'),'utf8'));
const chrome=spawn(process.env.CHROME_BIN||'/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
let socket;
try {
  const debug=await new Promise((resolve,reject)=>{
    let text='';const timer=setTimeout(()=>reject(new Error('Chrome startup timeout')),15000);
    chrome.stderr.on('data',data=>{text+=data;const match=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    chrome.once('error',reject);chrome.once('exit',code=>{clearTimeout(timer);reject(new Error('Chrome exited '+code+' '+text.slice(-500)));});
  });
  const target=await fetch('http://'+new URL(debug).host+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let serial=0;const pending=new Map();const errors=[];
  socket.addEventListener('message',event=>{
    const m=JSON.parse(event.data);
    if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
  });
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const waitFor=async expression=>{for(let i=0;i<60;i++){try{if(await evaluate(expression))return;}catch{}await pause(100);}throw new Error('Timeout: '+expression);};
  const goto=async path=>{await cdp('Page.navigate',{url:base+path});await pause(150);await waitFor(`document.readyState==='complete' && location.pathname===${JSON.stringify(path.split('?')[0])}`);};
  const viewport=async(width,height)=>{await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});await pause(100);};
  const shot=async name=>{
    await evaluate('window.scrollTo(0,0)');
    const layout=await evaluate('({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,heading:document.querySelector("h1")?.textContent,broken:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length})');
    if(layout.scroll>layout.width+1)throw new Error(name+' horizontal overflow '+JSON.stringify(layout));
    if(layout.broken)throw new Error(name+' broken images');
    const result=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    writeFileSync(join(out,name+'.png'),Buffer.from(result.data,'base64'));
    console.log('PASS',name,layout.width+'px',layout.heading);
  };
  const login=async role=>{
    await goto('/login');
    await evaluate(`document.querySelector('input[name="email"]').value=${JSON.stringify(accounts[role].email)};document.querySelector('input[name="password"]').value=${JSON.stringify(accounts[role].password)};document.querySelector('form[action="/login"]').requestSubmit()`);
    await waitFor(`document.readyState==='complete' && location.pathname===${JSON.stringify(role==='admin'?'/admin':'/menu')}`);
  };
  await cdp('Page.enable');await cdp('Runtime.enable');
  await viewport(1440,1050);await goto('/');await shot('menu-desktop');
  await viewport(390,844);await shot('menu-mobile');
  await login('customer');
  await evaluate(`document.querySelector('form[action="/cart/add"]').requestSubmit()`);
  await waitFor(`document.querySelector('.notice')?.textContent.includes('Added to your bag')`);
  await goto('/cart');await shot('cart-mobile');
  await goto('/checkout?fulfillment=delivery');await shot('checkout-mobile');
  await viewport(1440,1050);await shot('checkout-desktop');
  await evaluate(`document.querySelector('form[action="/logout"]').requestSubmit()`);
  await waitFor(`location.pathname==='/' && !!document.querySelector('a[href="/login"]')`);
  await login('admin');await shot('dashboard-desktop');
  await viewport(390,844);await shot('dashboard-mobile');
  await goto('/admin/orders');await shot('orders-mobile');
  await viewport(1440,1050);await goto('/admin/menu');await shot('admin-menu-desktop');
  await viewport(390,844);await goto('/admin/menu/edit?id=1');await shot('menu-edit-mobile');
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('10 browser screens passed; no horizontal overflow, broken images or JS exceptions.');
} finally {
  socket?.close();chrome.kill();
  await new Promise(resolve=>chrome.once('exit',resolve));
  rmSync(profile,{recursive:true,force:true});
}
