// @ts-check
import {EXERCISES, ROUTINE_LENGTH} from './movement-math.js';

export const SESSION_KEY='crewready.v5.sessions';
export const SCHEMA_VERSION=2;
export const SESSION_LIMIT=30;
export const BYTE_LIMIT=140_000;
const MISSIONS=new Set(['cygnus','docking','solar','water','drill','ultrasound','experiment']);
const CHECKS={cygnus:['capture','ms','lower',1],docking:['monitor','ms','lower',1],solar:['torque','percent-of-scale','lower',1],water:['verify','ms','lower',1],drill:['triage','ms','lower',2],ultrasound:['pursuit','percent','higher',2],experiment:['tray','percent','higher',2]};
const STATES=new Set(['not-started','completed','skipped','partial','aborted','unavailable']);
const ATTEMPT_STATES=new Set(['completed','skipped','aborted','insufficient-data','unavailable']);
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const bounded=(s,max)=>typeof s==='string'&&s.length<=max;
const now=()=>new Date().toISOString();
const storageOrDefault=s=>s||globalThis.localStorage;
const bytes=s=>new TextEncoder().encode(JSON.stringify(s)).length;
const validPlan=p=>Array.isArray(p)&&p.length===ROUTINE_LENGTH&&new Set(p).size===ROUTINE_LENGTH&&p.every(id=>!!EXERCISES[id]);

/** @param {string} mission @param {string} profileScope @param {import('./contracts').ExerciseID[]} plan @returns {import('./contracts').Session} */
export function newSession(mission,profileScope,plan) {
  if (!MISSIONS.has(mission)||!bounded(profileScope,48)||!validPlan(plan)) throw Error('Invalid session context');
  const at=now();
  return {
    checkIn:{sleepMinutes:null,sleepiness:null,at},
    cognitiveResults:null,
    movementResults:{status:'not-started',plan:[...plan],attempts:[],reason:null},
    context:{schemaVersion:SCHEMA_VERSION,sessionId:globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`,startedAt:at,updatedAt:at,mission,profileScope,environment:'earth-training',order:['check-in','cognitive','movement'],routineVersion:2,modelVersion:'pose-landmarker-lite',sdkVersion:'0.10.32',baseline:{cognitive:'none',movement:{}},agreement:null},
    syncStatus:{state:'not-saved',at,reason:null},
  };
}
/** @param {any} s @returns {s is import('./contracts').Session} */
export function validSession(s) {
  try {
    if (!s||typeof s!=='object'||Object.keys(s).sort().join(',')!=='checkIn,cognitiveResults,context,movementResults,syncStatus') return false;
    const {checkIn:c,cognitiveResults:q,movementResults:m,context:x,syncStatus:z}=s;
    if (!c||!m||!x||!z||x.schemaVersion!==SCHEMA_VERSION||!MISSIONS.has(x.mission)||!bounded(x.sessionId,64)||!bounded(x.profileScope,48)||!bounded(x.startedAt,40)||!bounded(x.updatedAt,40)||x.environment!=='earth-training'||x.order?.join(',')!=='check-in,cognitive,movement'||x.routineVersion!==2||x.sdkVersion!=='0.10.32'||x.modelVersion!=='pose-landmarker-lite') return false;
    if (c.sleepMinutes!==null&&(!finite(c.sleepMinutes)||c.sleepMinutes<0||c.sleepMinutes>899)) return false;
    if (c.sleepiness!==null&&(!Number.isInteger(c.sleepiness)||c.sleepiness<1||c.sleepiness>5)) return false;
    if (q!==null&&(q.checkId!==CHECKS[x.mission][0]||q.version!==CHECKS[x.mission][3]||q.metric?.id!==x.mission||q.metric?.unit!==CHECKS[x.mission][1]||q.metric?.direction!==CHECKS[x.mission][2]||typeof q.valid!=='boolean'||(q.valid?(!finite(q.metric.value)||q.metric.value<0):q.metric.value!==null&&!finite(q.metric.value))||!['live','simulated'].includes(q.source)||!Array.isArray(q.extras)||q.extras.length>20||q.extras.some(e=>!bounded(e.label,80)||!(finite(e.value)||bounded(e.value,80))||typeof e.flag!=='boolean')||!q.flags||Object.keys(q.flags).length>20||Object.keys(q.flags).some(k=>!bounded(k,40)||!finite(q.flags[k]))||!bounded(q.startedAt,40)||!bounded(q.completedAt,40))) return false;
    if (!STATES.has(m.status)||!validPlan(m.plan)||!Array.isArray(m.attempts)||m.attempts.length>ROUTINE_LENGTH||m.attempts.some((a,i)=>a.exercise!==m.plan[i]||!validAttempt(a))||(m.reason!==null&&!bounded(m.reason,200))) return false;
    if (m.status==='completed'&&(!m.attempts.length||!m.attempts.some(a=>a.status==='completed'))) return false;
    if (x.agreement!==null&&(!bounded(x.agreement?.step,500)||typeof x.agreement?.discussed!=='boolean')) return false;
    if (!x.baseline||!['none','forming','local-recent','simulated-fixture'].includes(x.baseline.cognitive)||!x.baseline.movement||Object.keys(x.baseline.movement).length>3) return false;
    if (!['local-only','not-saved'].includes(z.state)||!bounded(z.at,40)||(z.reason!==null&&!bounded(z.reason,200))) return false;
    return bytes(s)<=16_000;
  } catch { return false; }
}
function validAttempt(a) {
  const cfg=EXERCISES[a.exercise];
  if (!cfg||a.view!==cfg.view||a.calibration!=='stable-pose-v2'||a.protocolVersion!==2||!ATTEMPT_STATES.has(a.status)||![null,'camera'].includes(a.source)||a.targetReps!==cfg.targetReps||!Array.isArray(a.repetitions)||a.repetitions.length>20||!finite(a.trackedMs)||!finite(a.lostMs)||a.trackedMs<0||a.lostMs<0||a.trackedMs>14_400_000||a.lostMs>14_400_000||!Number.isInteger(a.interruptions)||a.interruptions<0||a.interruptions>1000) return false;
  if (a.reps!==null&&(!Number.isInteger(a.reps)||a.reps<0||a.reps!==a.repetitions.length)) return false;
  if (a.status==='completed'&&(a.source!=='camera'||a.reps<cfg.targetReps)) return false;
  if (a.repetitions.some(r=>!finite(r.rangeDeg)||!finite(r.durationSec)||r.rangeDeg<0||r.rangeDeg>180||r.durationSec<=0||r.durationSec>120)) return false;
  for (const key of ['meanRangeDeg','meanDurationSec','rangeVariationDeg','timingVariationSec']) if (a[key]!==null&&a[key]!==undefined&&!finite(a[key])) return false;
  if (a.repetitions.length&&(!finite(a.meanRangeDeg)||!finite(a.meanDurationSec))) return false;
  return a.reason===null||bounded(a.reason,200);
}
export function readSessions(storage=null) {
  try {
    const raw=storageOrDefault(storage).getItem(SESSION_KEY);
    if (!raw) return {rows:[],warning:null};
    if (new TextEncoder().encode(raw).length>BYTE_LIMIT) return {rows:[],warning:'Stored session data exceeded the size limit.'};
    const data=JSON.parse(raw); if (!Array.isArray(data)) throw Error('not an array');
    const rows=data.filter(validSession).slice(-SESSION_LIMIT);
    return {rows,warning:rows.length!==data.length?'Some malformed local sessions were ignored.':null};
  } catch { return {rows:[],warning:'Local session history is unavailable or invalid.'}; }
}
/** @param {import('./contracts').Session} session */
export function upsertSession(session,storage=null) {
  if (!validSession(session)) return {ok:false,reason:'Invalid session data; nothing was saved.'};
  const {rows,warning}=readSessions(storage); if (warning) return {ok:false,reason:warning};
  const fresh=JSON.parse(JSON.stringify(session)); fresh.context.updatedAt=now(); fresh.syncStatus={state:'local-only',at:now(),reason:null};
  const next=rows.filter(r=>r.context.sessionId!==fresh.context.sessionId); next.push(fresh);
  while(next.length>SESSION_LIMIT||bytes(next)>BYTE_LIMIT) next.shift();
  try {storageOrDefault(storage).setItem(SESSION_KEY,JSON.stringify(next));return {ok:true,session:fresh};}
  catch {return {ok:false,reason:'Browser storage is disabled or full.'};}
}
export function clearSessions(storage=null) {try{storageOrDefault(storage).removeItem(SESSION_KEY);return true;}catch{return false;}}
export function cognitiveReferences(mission,profileScope,sessions) {
  return sessions.filter(s=>validSession(s)&&s.context.mission===mission&&s.context.profileScope===profileScope&&s.cognitiveResults?.valid&&s.cognitiveResults.source==='live'&&s.cognitiveResults.version===CHECKS[mission][3]).map(s=>({metric:s.cognitiveResults.metric.value,sleep:s.checkIn.sleepMinutes,sleepy:s.checkIn.sleepiness,date:s.context.updatedAt})).filter(r=>finite(r.metric)&&finite(r.sleep)&&finite(r.sleepy)).sort((a,b)=>a.date.localeCompare(b.date)).slice(-30);
}
export function movementReferences(candidate,sessions,exercise) {
  const planned=EXERCISES[exercise];
  return sessions.filter(s=>validSession(s)&&s.context.sessionId!==candidate.context.sessionId&&s.context.profileScope===candidate.context.profileScope&&s.context.environment===candidate.context.environment).flatMap(s=>s.movementResults.attempts.filter(a=>a.exercise===exercise&&a.status==='completed'&&a.source==='camera'&&a.protocolVersion===2&&a.view===planned.view&&a.calibration==='stable-pose-v2')).slice(-5);
}
export function cognitiveRule(metric,reference,direction,sleep,referenceSleep,sleepy,rule) {
  if (![metric,reference,sleep,referenceSleep,sleepy].every(finite)||metric<0||reference<1e-6||!['lower','higher'].includes(direction)) return null;
  const worse=direction==='lower'?(metric-reference)/reference:(reference-metric)/reference;
  const sleepLost=referenceSleep-sleep;
  const c={worse:worse>=rule.worse,sleep:sleepLost>=rule.sleepLostMin,sleepy:sleepy>=rule.sleepy};
  return {worse,sleepLost,c,flag:c.worse&&(c.sleep||c.sleepy)};
}
