import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {EXERCISE_ORDER} from '../movement-math.js';
import {landmarksFor,sequenceFor} from '../tests/fixtures.js';

const base='http://127.0.0.1:18765/';
const server=spawn('python',['-m','http.server','18765','--bind','127.0.0.1','--directory','dist'],{stdio:'ignore'});
let browser,subServer;
const ids=['cygnus','docking','solar','water','drill','ultrasound','experiment'];
async function ready(url){for(let i=0;i<40;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Server unavailable');}
async function localContext(options={}){
  const context=await browser.newContext(options),external=[],errors=[];
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(!['localhost','127.0.0.1'].includes(u.hostname)){external.push(u.href);r.abort();}else r.continue();});
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  return {context,external,errors};
}
async function login(page,mode='crew',url=base){
  await page.goto(url+'#/tasks');
  await page.locator('#posGrid [data-pos="CDR"]').click();
  await page.locator('#callsign').fill('TEST');
  await page.locator(`#access [data-mode="${mode}"]`).click();
  await page.locator('#accessForm [type="submit"]').click();
  await page.locator('#access').waitFor({state:'hidden'});
}
async function assessment(page,id,url=base){
  await page.goto(url+'#/');
  await page.locator(`#opsTable [data-start="${id}"]`).click();
  await page.locator('[data-pane="brief"].active').waitFor();
}
async function recorded(page,id,url=base){
  await assessment(page,id,url);await page.locator('#btnLoadRecorded').click();await page.locator('[data-pane="movement"].active').waitFor();
}
async function observations(page,id){await page.waitForURL(`**/#/run/${id}/results`);await page.locator('#verdict h3').waitFor();}
const tracked=page=>page.waitForFunction(()=>['calibrating','standing','ready','tracking-lost','lowering','bottom','rising','raising','target','target-hold'].includes(document.querySelector('#moveStatus')?.dataset.state),null,{timeout:30000});

try{
  await ready(base);
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--enable-unsafe-swiftshader']});
  // Mocked inference fixtures exercise the full two-movement workflow, not detection accuracy.
  const fixtureFrames=Object.fromEntries(EXERCISE_ORDER.map(id=>[id,sequenceFor(id,3).map(a=>landmarksFor(id,a))]));
  const flow=await localContext({permissions:['camera']});
  await flow.context.addInitScript(({frames})=>{
    if (!navigator.mediaDevices) return;
    window.cameraRequests=0;const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=(constraints)=>{window.cameraRequests++;return original(constraints);};
    window.Worker=class{
      constructor(){this.index=0;this.closed=false;this.timers=[];}
      postMessage(data){
        if(data.type==='init')this.deliver({type:'ready'});
        if(data.type==='frame'){
          data.frame.close();const id=document.querySelector('.move-choice[aria-checked="true"]').dataset.exercise;
          const list=frames[id],i=this.index++;this.deliver({type:'pose',ms:i*100,landmarks:list[Math.min(i,list.length-1)]});
        }
      }
      deliver(data){this.timers.push(setTimeout(()=>{if(!this.closed)this.onmessage?.({data});},0));}
      terminate(){this.closed=true;this.timers.forEach(clearTimeout);}
    };
  },{frames:fixtureFrames});
  const page=await flow.context.newPage();await login(page);
  await page.goto(base+'#/run/cygnus/results');await page.waitForURL('**/#/run/cygnus/brief');
  await recorded(page,'cygnus');
  const first=await page.locator('.move-choice[aria-checked="true"]').getAttribute('data-exercise');
  assert.equal(await page.locator('#moveReps').innerText(),'0 / 3');assert.equal(await page.locator('.move-choice').count(),3);
  await page.locator('#btnMoveEnable').click();
  await page.waitForFunction(()=>document.querySelector('#moveProgress').textContent.startsWith('Movement 2 of 2'));
  assert.equal(await page.locator('#moveReps').innerText(),'0 / 3');
  assert.equal(await page.locator('#moveVideo').evaluate(v=>v.srcObject),null);
  assert.equal(await page.evaluate(()=>window.cameraRequests),1);
  assert.notEqual(await page.locator('.move-choice[aria-checked="true"]').getAttribute('data-exercise'),first);
  await page.locator('#btnMoveEnable').click();await observations(page,'cygnus');
  assert.match(await page.locator('#movementResult').innerText(),/Both movements completed/);
  const rows=JSON.parse(await page.evaluate(()=>localStorage.getItem('crewready.v5.sessions')));
  assert.equal(rows.length,1);assert.equal(rows[0].movementResults.attempts.length,2);assert.ok(rows[0].movementResults.attempts.every(a=>a.reps===3));
  const downloadPromise=page.waitForEvent('download');await page.locator('#btnExportSession').click();const download=await downloadPromise;
  const exported=JSON.parse(readFileSync(await download.path(),'utf8'));
  assert.deepEqual(Object.keys(exported).sort(),['checkIn','cognitiveResults','context','movementResults','syncStatus']);assert.ok(!/landmarks|data:image|video\/webm/i.test(JSON.stringify(exported)));
  await page.locator('#btnToPlan').click();await page.locator('#agreement').fill('Confirm the command aloud.');await page.locator('#agreed').check();await page.locator('#btnCopy').click();await page.locator('#toast.show').waitFor();
  assert.match(await page.locator('#summary').innerText(),/Side-view squat: completed/);
  await recorded(page,'cygnus');assert.equal(await page.locator('#moveReps').innerText(),'0 / 3');assert.notEqual(await page.locator('.move-choice[aria-checked="true"]').getAttribute('data-exercise'),first);
  const selected=await page.locator('.move-choice[aria-checked="true"]').getAttribute('data-exercise');await page.locator('.move-choice[aria-checked="true"]').focus();await page.keyboard.press('ArrowRight');assert.notEqual(await page.locator('.move-choice[aria-checked="true"]').getAttribute('data-exercise'),selected);assert.equal(await page.locator('#moveReps').innerText(),'0 / 3');
  await page.locator('#btnMoveNext').click();assert.equal(await page.locator('#moveReps').innerText(),'0 / 3');await page.locator('#btnMoveSkip').click();await observations(page,'cygnus');
  for(const id of ids){
    await recorded(page,id);assert.equal(await page.locator('#moveReps').innerText(),'0 / 3');await page.locator('#btnMoveSkip').click();await observations(page,id);
    assert.match(await page.locator('#indPanel').innerText(),/Task observations/);assert.doesNotMatch(await page.locator('#indPanel').innerText(),/Ready for this task|Ready with a cross-check/);
  }
  assert.deepEqual(flow.errors,[]);assert.deepEqual(flow.external,[]);await flow.context.close();

  // Actual local model initialization/inference on Chrome's fake camera feed.
  const real=await localContext({permissions:['camera']});const realPage=await real.context.newPage(),requests=[];realPage.on('request',r=>requests.push(r.url()));await login(realPage);await recorded(realPage,'docking');
  await realPage.locator('#btnMoveEnable').click();await tracked(realPage);
  assert.ok(requests.some(u=>u.endsWith('pose_landmarker_lite.task')));assert.ok(requests.some(u=>u.endsWith('.wasm')));
  const alignment=await realPage.evaluate(()=>{const v=document.querySelector('#moveVideo'),c=document.querySelector('#moveCanvas');return v.videoWidth===c.width&&v.videoHeight===c.height&&getComputedStyle(v).transform===getComputedStyle(c).transform;});assert.equal(alignment,true);
  await realPage.setViewportSize({width:390,height:844});assert.ok(await realPage.locator('.move-pool').evaluate(e=>e.getBoundingClientRect().width<390));
  const hiddenStopped=await realPage.evaluate(()=>{const stream=document.querySelector('#moveVideo').srcObject;Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));return stream.getTracks().every(t=>t.readyState==='ended')&&document.querySelector('#moveVideo').srcObject===null;});assert.equal(hiddenStopped,true);
  await realPage.locator('#btnMoveSkip').focus();await realPage.keyboard.press('Enter');await observations(realPage,'docking');assert.deepEqual(real.external,[]);assert.deepEqual(real.errors,[]);await real.context.close();

  // Latest seven cognitive controllers and local 3D views remain usable.
  const live=await localContext();const livePage=await live.context.newPage();await login(livePage,'guest');
  for(const id of ids){await assessment(livePage,id);await livePage.locator('#btnStartCheck').click();await livePage.locator('#chkStage .overlay button').waitFor();await livePage.locator('#chkStage .is3d').first().waitFor({timeout:30000});await livePage.locator('#btnAbortCheck').click();}
  await assessment(livePage,'water');await livePage.locator('#btnStartCheck').click();await livePage.locator('#chkStage .overlay button').click();
  for(let i=0;i<6;i++){await livePage.waitForFunction(n=>document.querySelector('#chkStage .seq-status span')?.textContent?.includes(`Work order ${n} of 6`),i+1);const code=await livePage.locator('#chkStage .ref b').innerText();const index=await livePage.locator('#chkStage .unit').evaluateAll((nodes,target)=>nodes.findIndex(n=>n.dataset.c===target),code);await livePage.locator('#chkStage .unit').nth(index).click();}
  await livePage.locator('[data-pane="movement"].active').waitFor();await livePage.locator('#btnMoveSkip').click();await observations(livePage,'water');assert.match(await livePage.locator('#verdict').innerText(),/baseline.*forming/i);await livePage.locator('#btnRepeat').click();await livePage.locator('#chkStage .overlay button').waitFor();assert.deepEqual(live.errors,[]);assert.deepEqual(live.external,[]);await live.context.close();

  for(const [name,message] of [['NotAllowedError',/permission denied/i],['NotFoundError',/no camera found/i]]){
    const fail=await localContext();await fail.context.addInitScript(name=>{if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>Promise.reject(Object.assign(new Error(name),{name}))});},name);const p=await fail.context.newPage();await login(p);await recorded(p,'cygnus');await p.locator('#btnMoveEnable').click();await p.locator('#moveStatus[data-state="error"]').waitFor();assert.match(await p.locator('#moveStatus').innerText(),message);await p.locator('#btnMoveContinue').click();await observations(p,'cygnus');assert.match(await p.locator('#movementResult').innerText(),/unavailable/);await fail.context.close();
  }
  const pending=await localContext();await pending.context.addInitScript(()=>{if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>new Promise(resolve=>window.resolveCamera=resolve)});});const p=await pending.context.newPage();await login(p);await recorded(p,'cygnus');await p.locator('#btnMoveEnable').click();await p.goto(base+'#/');assert.equal(await p.evaluate(async()=>{const stream=document.createElement('canvas').captureStream(1);window.resolveCamera(stream);await new Promise(r=>setTimeout(r,100));return stream.getTracks().every(t=>t.readyState==='ended');}),true);await pending.context.close();
  const corrupt=await localContext({permissions:['camera']});await corrupt.context.route('**/pose_landmarker_lite.task',r=>r.fulfill({status:200,contentType:'text/html',body:'<html>bad model</html>'}));const cp=await corrupt.context.newPage();await login(cp);await recorded(cp,'cygnus');await cp.locator('#btnMoveEnable').click();await cp.locator('#moveStatus[data-state="error"]').waitFor({timeout:45000});assert.equal(await cp.locator('#moveVideo').evaluate(v=>v.srcObject),null);await corrupt.context.close();
  subServer=spawn('python',['-m','http.server','18766','--bind','127.0.0.1','--directory','.'],{stdio:'ignore'});const subBase='http://127.0.0.1:18766/dist/';await ready(subBase);const sub=await localContext({permissions:['camera']});const sp=await sub.context.newPage();await login(sp,'crew',subBase);await recorded(sp,'cygnus',subBase);await sp.locator('#btnMoveEnable').click();await tracked(sp);assert.deepEqual(sub.external,[]);await sub.context.close();
  console.log('Browser passed: rotating two-exercise routine and zeroed counters (synthetic inference), seven latest checks/3D scenes, live water check, indicators, export/summary, local model inference (fake camera), camera errors/late permission/hidden cleanup, mobile alignment, subpath and blocked external traffic.');
}finally{await browser?.close();server.kill();subServer?.kill();}
