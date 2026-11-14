// @ts-check
let detector = null;
let lastTimestamp = -1;
self.onmessage = async ({data}) => {
  if (data.type === 'init') {
    try {
      const {FilesetResolver, PoseLandmarker} = await import('./public/models/vision_bundle.mjs');
      const files = await FilesetResolver.forVisionTasks(new URL('./public/models/', import.meta.url).href);
      detector = await PoseLandmarker.createFromOptions(files, { baseOptions: {modelAssetPath: new URL('./public/models/pose_landmarker_lite.task', import.meta.url).href, delegate: 'CPU'}, runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: false });
      self.postMessage({type: 'ready'});
    } catch (e) { self.postMessage({type: 'error', reason: String(e)}); }
  } else if (data.type === 'frame') {
    const frame = data.frame;
    try {
      if (!detector || data.ms <= lastTimestamp) return;
      lastTimestamp = data.ms;
      const result = detector.detectForVideo(frame, data.ms);
      self.postMessage({type: 'pose', ms: data.ms, landmarks: result.landmarks?.[0] || null});
    } catch (e) { self.postMessage({type: 'error', reason: String(e)}); }
    finally { frame.close(); }
  } else if (data.type === 'dispose') { detector?.close(); detector = null; self.close(); }
};
