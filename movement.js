// @ts-check
import {EXERCISES, initialTracker, updateTracker, movementSummary} from './movement-math.js';

const modelDir = new URL('./public/models/', import.meta.url);
export class MovementController {
  constructor(elements, onComplete, onUnavailable) {
    this.el = elements; this.onComplete = onComplete; this.onUnavailable = onUnavailable; this.generation = 0; this.active = false; this.worker = null; this.detector = null; this.stream = null; this.raf = 0; this.busy = false; this.pendingCancel = null; this.lastVideoTime = -1; this.lastMs = -1;
    /** @type {import('./contracts').ExerciseID} */
    this.exercise = 'side-view-squat'; this.tracker = initialTracker(this.exercise); this.state = 'idle';
  }
  status(state, message) { this.state = state; this.el.status.textContent = message; this.el.status.dataset.state = state; }
  /** @param {import('./contracts').ExerciseID} exercise */
  async start(exercise) {
    this.stop(false);
    if (!EXERCISES[exercise]) throw Error('Unknown exercise');
    this.exercise = exercise;
    const generation = ++this.generation;
    this.tracker = initialTracker(exercise); this.active = true; this.startedMs = performance.now(); this.lastVideoTime = -1; this.lastMs = -1;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { this.fail('Camera access requires localhost or HTTPS and a supported browser.'); return; }
    this.status('loading', 'Requesting camera permission. Video stays on this device.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'user'}, audio: false});
      if (!this.active || generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream; this.el.video.srcObject = stream;
      await this.el.video.play();
      if (!this.active || generation !== this.generation) return;
      if (!this.el.video.videoWidth || !this.el.video.videoHeight) await new Promise((resolve, reject) => {
        const done = () => { clearTimeout(timer); this.el.video.removeEventListener('loadedmetadata', ready); this.pendingCancel = null; };
        const ready = () => { done(); resolve(); };
        const timer = setTimeout(() => { done(); reject(Error('Camera metadata timed out.')); }, 8000);
        this.pendingCancel = () => { done(); reject(Error('Camera setup cancelled.')); };
        this.el.video.addEventListener('loadedmetadata', ready);
      });
      if (!this.active || generation !== this.generation) return;
      this.resize();
      this.status('setup', `${EXERCISES[exercise].setup} Loading the local pose model…`);
      await this.initDetector(generation);
      if (!this.active || generation !== this.generation) return;
      this.status('calibrating', exercise === 'side-view-squat' ? 'Stand upright and hold still. Begin squatting when the status says Standing.' : 'Start with both arms down. Hold still until the status says Ready.');
      this.tick(generation);
    } catch (e) {
      if (generation !== this.generation) return;
      const name = e?.name || '';
      this.fail(name === 'NotAllowedError' ? 'Camera permission denied. Allow it in browser settings or skip.' : name === 'NotFoundError' ? 'No camera found. Connect one or skip.' : name === 'NotReadableError' ? 'Camera is busy. Close other apps using it and retry.' : `Camera or model could not start: ${String(e?.message || e).slice(0, 160)}`);
    }
  }
  async initDetector(generation) {
    if (typeof Worker !== 'undefined' && typeof createImageBitmap === 'function') {
      try {
        const worker = new Worker(new URL('./pose-worker.js', import.meta.url), {type: 'module'});
        this.worker = worker;
        await new Promise((resolve, reject) => {
          const done = () => { clearTimeout(timer); this.pendingCancel = null; };
          const timer = setTimeout(() => { done(); reject(Error('Local model initialization timed out.')); }, 20000);
          this.pendingCancel = () => { done(); reject(Error('Model setup cancelled.')); };
          worker.onmessage = ({data}) => {
            if (data.type === 'ready') { done(); resolve(); }
            else if (data.type === 'error') { done(); reject(Error(data.reason)); }
          };
          worker.onerror = () => { done(); reject(Error('Pose Worker failed.')); };
          worker.postMessage({type: 'init'});
        });
        if (generation !== this.generation) { worker.terminate(); return; }
        worker.onmessage = ({data}) => {
          if (generation !== this.generation) return;
          if (data.type === 'pose') { this.busy = false; this.observe(data.landmarks, data.ms); }
          else if (data.type === 'error') this.fail('Local pose inference failed. Check model assets and retry.');
        };
        return;
      } catch (e) { this.worker?.terminate(); this.worker = null; if (generation !== this.generation) return; }
    }
    // Fallback: synchronous inference at <=10 fps. The Worker path avoids main-thread stalls.
    const {FilesetResolver, PoseLandmarker} = await import('./public/models/vision_bundle.mjs');
    const files = await FilesetResolver.forVisionTasks(modelDir.href);
    const detector = await PoseLandmarker.createFromOptions(files, {baseOptions: {modelAssetPath: new URL('pose_landmarker_lite.task', modelDir).href, delegate: 'CPU'}, runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: false});
    if (generation !== this.generation) { detector.close(); return; }
    this.detector = detector;
  }
  resize() {
    const {video, canvas} = this.el;
    if (!video.videoWidth || !video.videoHeight) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.style.aspectRatio = `${video.videoWidth}/${video.videoHeight}`;
  }
  tick(generation) {
    if (!this.active || generation !== this.generation) return;
    if (performance.now() - this.startedMs > EXERCISES[this.exercise].maxDemoMs) {
      const summary = {...movementSummary(this.tracker), status: 'insufficient-data', reason: 'Three-minute demo window ended before the target.'};
      this.stop(false); this.status('insufficient-data', summary.reason); this.onComplete(summary); return;
    }
    const video = this.el.video;
    if (video.readyState >= 2 && video.currentTime !== this.lastVideoTime && !this.busy) {
      const ms = Math.max(performance.now(), this.lastMs + 0.001);
      if (this.worker || ms - this.lastMs >= 100) {
        this.lastVideoTime = video.currentTime; this.lastMs = ms;
        if (video.videoWidth !== this.el.canvas.width || video.videoHeight !== this.el.canvas.height) this.resize();
        if (this.worker) {
          this.busy = true;
          createImageBitmap(video).then(frame => {
            if (!this.active || generation !== this.generation || !this.worker) { frame.close(); return; }
            this.worker.postMessage({type: 'frame', frame, ms}, [frame]);
          }).catch(() => { this.busy = false; });
        } else if (this.detector) {
          const pose = this.detector.detectForVideo(video, ms);
          this.observe(pose.landmarks?.[0] || null, ms);
        }
      }
    }
    this.raf = requestAnimationFrame(() => this.tick(generation));
  }
  observe(landmarks, ms) {
    this.tracker = updateTracker(this.tracker, landmarks, this.el.video.videoWidth, this.el.video.videoHeight, ms);
    const t = this.tracker;
    this.draw(landmarks);
    this.el.reps.textContent = `${t.reps.length} / ${EXERCISES[this.exercise].targetReps}`;
    this.el.angle.textContent = t.angle === null ? '—' : `${Math.round(t.angle)}° est.`;
    this.el.time.textContent = `${(t.trackedMs / 1000).toFixed(1)} s tracked`;
    const squat = {calibrating:'Hold an upright side view until tracking is steady.',standing:'Standing. Bend hips and knees to lower, then return upright.',lowering:'Lower into the squat; pause briefly at the bottom.',bottom:'Bottom detected. Stand fully upright to finish this repetition.',rising:'Keep rising until upright; the repetition counts at standing.'};
    const upper = {calibrating:'Hold both arms down until tracking is steady.',ready:'Ready. '+EXERCISES[this.exercise].action,raising:this.exercise==='overhead-reach'?'Raise both arms overhead.':'Raise both arms out to shoulder height.', 'target-hold':'Pose detected. Hold it briefly.',target:'Pose held. Lower both arms to your sides.',lowering:'Lower both arms fully; the repetition counts at the bottom.'};
    const messages = {...(this.exercise==='side-view-squat'?squat:upper),'tracking-lost':'Tracking lost. Reframe and hold the starting pose; the unfinished repetition was cleared.'};
    if (this.state !== t.phase) this.status(t.phase, messages[t.phase] || 'Tracking.');
    if (t.reps.length >= EXERCISES[this.exercise].targetReps) {
      const summary = movementSummary(t); this.stop(false); this.status('completed', 'Demo target reached. Measurements saved locally.'); this.onComplete(summary);
    }
  }
  draw(landmarks) {
    const canvas = this.el.canvas, ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!landmarks) return;
    const pairs = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
    ctx.strokeStyle = '#34d399'; ctx.lineWidth = Math.max(3, canvas.width / 150);
    for (const [a,b] of pairs) {
      const p = landmarks[a], q = landmarks[b];
      if (!p || !q || (p.visibility ?? 1) < .6 || (q.visibility ?? 1) < .6) continue;
      ctx.beginPath(); ctx.moveTo(p.x * canvas.width, p.y * canvas.height); ctx.lineTo(q.x * canvas.width, q.y * canvas.height); ctx.stroke();
    }
  }
  fail(message) { this.stop(false); this.status('error', message); this.onUnavailable(message); }
  stop(markAborted = true) {
    const wasActive = this.active;
    this.active = false; this.generation++; this.pendingCancel?.(); this.pendingCancel = null; cancelAnimationFrame(this.raf); this.raf = 0; this.busy = false;
    this.worker?.terminate(); this.worker = null;
    this.detector?.close(); this.detector = null;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    this.el.video.pause(); this.el.video.srcObject = null;
    const ctx = this.el.canvas.getContext('2d'); ctx?.clearRect(0,0,this.el.canvas.width,this.el.canvas.height);
    if (markAborted && wasActive) { this.status('aborted', 'Movement stopped. You can retry or continue with the observations so far.'); return movementSummary(this.tracker); }
    return null;
  }
}
