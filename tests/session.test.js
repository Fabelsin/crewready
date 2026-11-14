import test from 'node:test';
import assert from 'node:assert/strict';
import {newSession,validSession,readSessions,upsertSession,cognitiveReferences,movementReferences,cognitiveRule,SESSION_KEY,BYTE_LIMIT} from '../session.js';
import {planRoutine,emptyAttempt} from '../movement-math.js';
const db=()=>{const map=new Map();return{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
const fresh=()=>newSession('cygnus','local:CDR:TEST',planRoutine(0,0));
const cognitive=(s,value=100,source='live')=>{s.checkIn.sleepMinutes=420;s.checkIn.sleepiness=2;s.cognitiveResults={checkId:'capture',version:1,metric:{id:'cygnus',value,unit:'ms',direction:'lower'},valid:true,source,extras:[],flags:{},startedAt:s.context.startedAt,completedAt:s.context.startedAt};return s;};
const completed=s=>{s.movementResults.status='completed';s.movementResults.attempts=s.movementResults.plan.map(id=>({...emptyAttempt(id,'completed',null),source:'camera',reps:3,repetitions:Array.from({length:3},()=>({rangeDeg:65,durationSec:2})),meanRangeDeg:65,meanDurationSec:2,trackedMs:6000}));return s;};
test('five sections, stable-ID upsert, corrupt and oversized storage',()=>{
  const store=db(),s=cognitive(fresh());assert.equal(validSession(s),true);assert.equal(upsertSession(s,store).ok,true);completed(s);assert.equal(upsertSession(s,store).ok,true);assert.equal(readSessions(store).rows.length,1);
  s.movementResults.attempts[0].repetitions[0].rangeDeg=Infinity;assert.equal(validSession(s),false);store.setItem(SESSION_KEY,'broken');assert.ok(readSessions(store).warning);store.setItem(SESSION_KEY,'x'.repeat(BYTE_LIMIT+1));assert.ok(readSessions(store).warning);
});
test('profiles, missions and simulated measurements cannot contaminate cognitive references',()=>{
  const live=cognitive(fresh()),sim=cognitive(fresh(),70,'simulated'),other=cognitive(fresh());other.context.profileScope='local:FE-1:OTHER';assert.equal(cognitiveReferences('cygnus','local:CDR:TEST',[live,sim,other]).length,1);
  const old=newSession('drill','local:CDR:TEST',planRoutine(4,0));old.cognitiveResults={...live.cognitiveResults,checkId:'triage',metric:{id:'drill',value:1000,unit:'ms',direction:'lower'}};assert.equal(validSession(old),false);
});
test('five prior attempts match exercise, scope and protocol; candidate excluded',()=>{
  const candidate=completed(cognitive(fresh())),refs=Array.from({length:6},()=>completed(cognitive(fresh())));refs[0].context.profileScope='local:FE-1:OTHER';assert.equal(movementReferences(candidate,[candidate,...refs],'side-view-squat').length,5);refs[1].movementResults.attempts[0].protocolVersion=1;assert.equal(movementReferences(candidate,refs,'side-view-squat').length,4);
});
test('new sessions do not inherit old reps; legacy v4 remains untouched',()=>{
  const store=db();store.setItem('crewready.v4.sessions',JSON.stringify([{movementResults:{reps:3}}]));const s=fresh();assert.equal(s.movementResults.attempts.length,0);assert.equal(readSessions(store).rows.length,0);assert.ok(store.getItem('crewready.v4.sessions'));
});
test('bounded history, malformed rows, quota and zero denominator',()=>{
  const store=db();for(let i=0;i<35;i++)assert.equal(upsertSession(cognitive(fresh(),i),store).ok,true);assert.equal(readSessions(store).rows.length,30);
  const good=cognitive(fresh());store.setItem(SESSION_KEY,JSON.stringify([good,{...good,cognitiveResults:{...good.cognitiveResults,extras:[null]}}]));assert.equal(readSessions(store).rows.length,1);assert.ok(readSessions(store).warning);assert.equal(upsertSession(good,{getItem:()=>null,setItem:()=>{throw Error('quota')}}).ok,false);
  const rule={worse:.2,sleepLostMin:120,sleepy:4};assert.equal(cognitiveRule(20,0,'lower',300,420,4,rule),null);assert.equal(cognitiveRule(120,100,'lower',420,420,4,rule).flag,true);assert.equal(cognitiveRule(110,100,'lower',200,420,4,rule).flag,false);
});
