// @ts-check
// Software demo settings. These are not exercise prescriptions or clinical cutoffs.
/** @type {Readonly<Record<import('./contracts').ExerciseID, import('./contracts').ExerciseConfig>>} */
export const EXERCISES = Object.freeze({
  'side-view-squat': {name: 'Side-view squat', view: 'side', targetReps: 3, maxDemoMs: 180_000, setup: 'Place the camera to your side. Keep your whole body, especially one hip, knee and ankle, in frame.', action: 'Stand still until tracking says Standing. Bend hips and knees to lower, pause, then stand fully upright. Repeat 3 times.', signal: 'Approximate knee angle', standDeg: 155, bottomDeg: 115},
  'overhead-reach': {name: 'Overhead reach', view: 'front', targetReps: 3, maxDemoMs: 180_000, setup: 'Face the camera with both arms, shoulders and hips visible. Leave space above your head.', action: 'Start with arms down. Raise both arms overhead, hold briefly, then lower them to your sides. Repeat 3 times.', signal: 'Approximate arm elevation'},
  't-pose-open': {name: 'T-pose arm open', view: 'front', targetReps: 3, maxDemoMs: 180_000, setup: 'Face the camera with both arms and hips visible. Leave room on both sides.', action: 'Start with arms down. Lift both arms out to shoulder height to make a T, hold briefly, then lower them. Repeat 3 times.', signal: 'Approximate arm elevation'},
});
export const EXERCISE_ORDER = Object.freeze(Object.keys(EXERCISES));
export const ROUTINE_LENGTH = 2;
const STABLE_FRAMES = 5, MIN_PHASE_MS = 250, MIN_REP_MS = 800, MAX_GAP_MS = 350;
const ok = n => typeof n === 'number' && Number.isFinite(n);

export function planRoutine(missionIndex, previousSessions) {
  const start = ((missionIndex + previousSessions) % EXERCISE_ORDER.length + EXERCISE_ORDER.length) % EXERCISE_ORDER.length;
  return Array.from({length: ROUTINE_LENGTH}, (_, i) => EXERCISE_ORDER[(start + i) % EXERCISE_ORDER.length]);
}

function point(landmarks, index) {
  const p = landmarks?.[index];
  return p && ok(p.x) && ok(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && (p.visibility ?? 1) >= .6 && (p.presence ?? 1) >= .6 ? p : null;
}
function angleAt(a, b, c, width, height) {
  const ax=(a.x-b.x)*width, ay=(a.y-b.y)*height, cx=(c.x-b.x)*width, cy=(c.y-b.y)*height;
  const al=Math.hypot(ax,ay), cl=Math.hypot(cx,cy);
  if (al < 12 || cl < 12) return null;
  return Math.acos(Math.max(-1,Math.min(1,(ax*cx+ay*cy)/(al*cl))))*180/Math.PI;
}
export function kneeAngle(landmarks, width, height, side) {
  if (!Array.isArray(landmarks) || !ok(width) || !ok(height) || width <= 0 || height <= 0) return null;
  const ids = side === 'left' ? [23,25,27] : [24,26,28];
  const p=ids.map(i=>point(landmarks,i));
  return p.some(x=>!x) ? null : angleAt(p[0],p[1],p[2],width,height);
}
export function armPose(landmarks, width, height) {
  if (!Array.isArray(landmarks) || !ok(width) || !ok(height) || width <= 0 || height <= 0) return null;
  const ids=[11,12,13,14,15,16,23,24];
  const p=Object.fromEntries(ids.map(i=>[i,point(landmarks,i)]));
  if (ids.some(i=>!p[i])) return null;
  const left=angleAt(p[23],p[11],p[15],width,height), right=angleAt(p[24],p[12],p[16],width,height);
  if (left === null || right === null) return null;
  const center=(p[11].x+p[12].x)/2, span=Math.abs(p[11].x-p[12].x);
  if (span*width < 18) return null;
  const extended=[11,12].every((shoulder,i)=>Math.abs(p[15+i].x-center) > Math.abs(p[shoulder].x-center)+span*.5);
  return {left,right,angle:(left+right)/2,extended};
}
/** @param {import('./contracts').ExerciseID} exercise @returns {import('./contracts').Tracker} */
export function initialTracker(exercise) {
  if (!EXERCISES[exercise]) throw Error('Unknown exercise');
  return {exercise, phase:'setup', side:null, stable:0, lastMs:null, angle:null, phaseAt:null, repAt:null, minAngle:180, maxAngle:0, reps:[], trackedMs:0, lostMs:0, interruptions:0, lost:false};
}
function lose(t,n,dt) {
  n.lostMs+=dt;
  if (!t.lost && t.lastMs !== null && t.trackedMs > 0) n.interruptions++;
  n.lost=true; n.stable=0; n.phase='tracking-lost'; n.repAt=null; n.phaseAt=null; n.angle=null;
  return n;
}
function appendRep(t,n,ms) {
  if (t.repAt !== null && ms-t.repAt >= MIN_REP_MS && t.reps.length < 20) {
    n.reps=[...t.reps,{rangeDeg:Math.round((Math.max(t.maxAngle,n.angle)-t.minAngle)*10)/10,durationSec:Math.round((ms-t.repAt)/100)/10}];
  }
  n.repAt=null; n.phaseAt=ms;
}
export function updateTracker(t, landmarks, width, height, ms) {
  if (!ok(ms) || (t.lastMs !== null && ms <= t.lastMs)) return t;
  const dt=t.lastMs === null ? 0 : Math.min(ms-t.lastMs,60_000);
  let side=t.side, pose=null;
  if (t.exercise === 'side-view-squat') {
    if (!side) {
      const left=kneeAngle(landmarks,width,height,'left'), right=kneeAngle(landmarks,width,height,'right');
      if (left !== null || right !== null) side=left !== null && (right === null || (landmarks[25].visibility ?? 1) >= (landmarks[26].visibility ?? 1)) ? 'left':'right';
    }
    const angle=side ? kneeAngle(landmarks,width,height,side) : null;
    if (angle !== null) pose={angle};
  } else pose=armPose(landmarks,width,height);
  const n={...t,side,lastMs:ms};
  if (!pose || dt > MAX_GAP_MS) return lose(t,n,dt);
  n.trackedMs+=dt;
  n.angle=t.angle === null ? pose.angle : t.angle+(1-Math.exp(-dt/120))*(pose.angle-t.angle);
  n.lost=false;
  if (t.exercise === 'side-view-squat') {
    const cfg=EXERCISES[t.exercise];
    if (t.lost || ['setup','tracking-lost','calibrating'].includes(t.phase)) {
      n.stable=n.angle >= cfg.standDeg ? t.stable+1:0;
      n.phase=n.stable >= STABLE_FRAMES ? 'standing':'calibrating'; n.phaseAt=ms; return n;
    }
    if (t.phase === 'standing' && n.angle < cfg.standDeg-8) { n.phase='lowering'; n.phaseAt=ms; n.repAt=ms; n.minAngle=n.angle; n.maxAngle=t.angle; }
    else if (t.phase === 'lowering') {
      n.minAngle=Math.min(t.minAngle,n.angle);
      if (n.angle <= cfg.bottomDeg && ms-t.phaseAt >= MIN_PHASE_MS) { n.phase='bottom'; n.phaseAt=ms; }
      else if (n.angle >= cfg.standDeg) { n.phase='standing'; n.repAt=null; }
    } else if (t.phase === 'bottom') {
      n.minAngle=Math.min(t.minAngle,n.angle);
      if (n.angle >= cfg.bottomDeg+8 && ms-t.phaseAt >= MIN_PHASE_MS) { n.phase='rising'; n.phaseAt=ms; }
    } else if (t.phase === 'rising') {
      if (n.angle >= cfg.standDeg && ms-t.phaseAt >= MIN_PHASE_MS) { n.phase='standing'; appendRep(t,n,ms); }
      else if (n.angle < cfg.bottomDeg) { n.phase='bottom'; n.phaseAt=ms; }
    }
    return n;
  }
  const down=pose.left <= 40 && pose.right <= 40;
  const target=t.exercise === 'overhead-reach' ? pose.left >= 135 && pose.right >= 135 : pose.left >= 70 && pose.left <= 110 && pose.right >= 70 && pose.right <= 110 && pose.extended;
  if (t.lost || ['setup','tracking-lost','calibrating'].includes(t.phase)) {
    n.stable=down ? t.stable+1:0; n.phase=n.stable >= STABLE_FRAMES ? 'ready':'calibrating'; n.phaseAt=ms; return n;
  }
  if (t.phase === 'ready' && !down) { n.phase='raising'; n.phaseAt=ms; n.repAt=ms; n.minAngle=t.angle; n.maxAngle=n.angle; }
  else if (t.phase === 'raising') {
    n.maxAngle=Math.max(t.maxAngle,n.angle);
    if (target && ms-t.phaseAt >= MIN_PHASE_MS) { n.phase='target-hold'; n.phaseAt=ms; }
    else if (down) { n.phase='ready'; n.repAt=null; }
  } else if (t.phase === 'target-hold') {
    n.maxAngle=Math.max(t.maxAngle,n.angle);
    if (!target) { n.phase='raising'; n.phaseAt=ms; }
    else if (ms-t.phaseAt >= 300) { n.phase='target'; n.phaseAt=ms; }
  } else if (t.phase === 'target') {
    n.maxAngle=Math.max(t.maxAngle,n.angle);
    if (!target) { n.phase='lowering'; n.phaseAt=ms; }
  } else if (t.phase === 'lowering') {
    n.minAngle=Math.min(t.minAngle,n.angle);
    if (down && ms-t.phaseAt >= MIN_PHASE_MS) { n.phase='ready'; appendRep(t,n,ms); }
    else if (target) { n.phase='target'; n.phaseAt=ms; }
  }
  return n;
}
/** @param {import('./contracts').Tracker} t @returns {import('./contracts').MovementAttempt} */
export function movementSummary(t) {
  const reps=t.reps.slice(0,20), ranges=reps.map(r=>r.rangeDeg), times=reps.map(r=>r.durationSec);
  const mean=a=>a.length ? a.reduce((x,y)=>x+y,0)/a.length:null;
  const variation=a=>a.length<2?null:Math.round((Math.max(...a)-Math.min(...a))*10)/10;
  const target=EXERCISES[t.exercise].targetReps;
  return {exercise:t.exercise, view:EXERCISES[t.exercise].view, calibration:'stable-pose-v2', protocolVersion:2, status:reps.length >= target?'completed':'insufficient-data', source:'camera', reps:reps.length, targetReps:target, repetitions:reps, meanRangeDeg:mean(ranges), meanDurationSec:mean(times), rangeVariationDeg:variation(ranges), timingVariationSec:variation(times), trackedMs:Math.round(t.trackedMs), lostMs:Math.round(t.lostMs), interruptions:t.interruptions, reason:reps.length >= target?null:'Target not reached; incomplete movements are not counted.'};
}
/** @param {import('./contracts').ExerciseID} exercise @param {import('./contracts').AttemptStatus} status @param {string|null} reason @returns {import('./contracts').MovementAttempt} */
export function emptyAttempt(exercise,status,reason) {
  const cfg=EXERCISES[exercise];
  return {exercise,view:cfg.view,calibration:'stable-pose-v2',protocolVersion:2,status,source:null,reps:null,targetReps:cfg.targetReps,repetitions:[],meanRangeDeg:null,meanDurationSec:null,rangeVariationDeg:null,timingVariationSec:null,trackedMs:0,lostMs:0,interruptions:0,reason};
}
