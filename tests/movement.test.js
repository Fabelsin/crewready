import test from 'node:test';
import assert from 'node:assert/strict';
import {EXERCISE_ORDER,kneeAngle,armPose,initialTracker,updateTracker,movementSummary,planRoutine} from '../movement-math.js';
import {landmarksFor,sequenceFor} from './fixtures.js';
const run=(id,angles,t=initialTracker(id),start=0)=>angles.reduce((state,a,i)=>updateTracker(state,a===null?null:landmarksFor(id,a),640,480,start+i*100),t);
test('aspect-correct geometry and degenerate landmarks',()=>{
  const p=landmarksFor('side-view-squat',90);assert.ok(Math.abs(kneeAngle(p,640,480,'left')-90)<1);assert.equal(kneeAngle(p,640,480,'right'),null);
  p[25]={...p[23]};assert.equal(kneeAngle(p,640,480,'left'),null);
  const arms=armPose(landmarksFor('t-pose-open',90),640,480);assert.ok(Math.abs(arms.angle-90)<1&&arms.extended);
});
for(const id of EXERCISE_ORDER) test(`${id}: complete cycles count and fresh trackers start at zero`,()=>{
  const t=run(id,sequenceFor(id,3));assert.equal(t.reps.length,3);assert.equal(movementSummary(t).status,'completed');assert.ok(t.reps.every(r=>r.rangeDeg>40&&r.durationSec>=.8));assert.equal(initialTracker(id).reps.length,0);
});
test('partial, noisy and briefly crossed target poses do not count',()=>{
  assert.equal(run('side-view-squat',[180,180,180,180,180,150,130,125,155,180]).reps.length,0);
  assert.equal(run('side-view-squat',[180,180,180,180,180,151,154,150,155,152,180]).reps.length,0);
  assert.equal(run('overhead-reach',[0,0,0,0,0,60,100,160,100,60,0,0]).reps.length,0);
  assert.equal(run('t-pose-open',[0,0,0,0,0,30,60,90,60,0,0]).reps.length,0);
});
test('loss/reacquisition clears partial, side stays fixed, timestamps are monotonic',()=>{
  let t=run('side-view-squat',[180,180,180,180,180,150,125,95,95]);t=updateTracker(t,null,640,480,900);assert.equal(t.phase,'tracking-lost');
  t=run('side-view-squat',[180,180,180,180,180,95,95,180],t,1000);assert.equal(t.reps.length,0);assert.equal(t.side,'left');assert.equal(t.interruptions,1);
  assert.equal(updateTracker(t,landmarksFor('side-view-squat',180,'right'),640,480,1900).phase,'tracking-lost');assert.equal(updateTracker(t,null,640,480,t.lastMs),t);assert.equal(updateTracker(t,null,640,480,NaN),t);
  let a=run('overhead-reach',[0,0,0,0,0,60,150,160,160]);a=updateTracker(a,null,640,480,900);a=run('overhead-reach',[0,0,0,0,0,0],a,1000);assert.equal(a.reps.length,0);
});
test('routine has two different exercises and rotates between assessments',()=>{
  assert.equal(new Set(planRoutine(0,0)).size,2);assert.notEqual(planRoutine(0,0)[0],planRoutine(1,0)[0]);assert.notEqual(planRoutine(0,0)[0],planRoutine(0,1)[0]);
});
