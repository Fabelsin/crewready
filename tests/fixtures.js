// Synthetic software fixtures, not human camera observations.
export function landmarksFor(exercise, angle, side = 'left') {
  const p=Array.from({length:33},()=>({x:.5,y:.5,visibility:0,presence:0}));
  const put=(id,x,y)=>p[id]={x,y,visibility:.95,presence:.95};
  const rad=angle*Math.PI/180;
  if (exercise==='side-view-squat') {
    const ids=side==='left'?[23,25,27]:[24,26,28];
    put(ids[0],.5,.25);put(ids[1],.5,.5);put(ids[2],.5+Math.sin(rad)*.2,.5-Math.cos(rad)*.2*640/480);
  } else {
    for (let i=0;i<2;i++) {
      const x=i===0?.4:.6, direction=i===0?-1:1;
      const wx=x+direction*Math.sin(rad)*.1875, wy=.35+Math.cos(rad)*.25;
      put(11+i,x,.35);put(23+i,x,.65);put(13+i,(x+wx)/2,(.35+wy)/2);put(15+i,wx,wy);
    }
  }
  return p;
}
export function sequenceFor(exercise,reps=1) {
  const start=exercise==='side-view-squat'?180:0;
  const cycle=exercise==='side-view-squat'?[150,135,110,95,95,95,95,105,125,145,160,170,180,180,180]:exercise==='overhead-reach'?[30,60,100,150,160,160,160,160,160,160,120,80,30,0,0,0,0]:[30,60,90,90,90,90,90,90,90,60,30,0,0,0,0];
  return [...Array(6).fill(start),...Array.from({length:reps},()=>cycle).flat()];
}
