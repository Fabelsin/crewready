'use strict';

/* =========================================================
   CrewReady — hackathon prototype
   Flow: home → brief → test → results → rehearse → plan
   ========================================================= */

const $ = (s) => document.querySelector(s);

// ---------- Config ----------
const TEST_MS = 25000;          // demo test length (NASA's ISS version: 3 min)
const ISI_MIN = 1500, ISI_MAX = 4000; // random wait before each signal
const RESPONSE_WINDOW = 1500;   // no press within this → miss
const ANTICIPATION_MS = 100;    // faster than this → counted as false start
const MIN_VALID = 3;            // fewer valid responses → ask to repeat
const BASELINE_N = 5;           // personal baseline = median of last 5 checks
const RULE = { slower: 0.20, sleepLostMin: 120, sleepy: 4 }; // demo thresholds
const STORAGE_KEY = 'crewready.v1.history.demo25';

const OPS = [
  { id: 'cygnus', name: 'Capture a cargo spacecraft', detail: 'Grapple Cygnus with Canadarm2 · prime + backup operator', step: 'Capture call — wait for the backup operator', ready: true },
  { id: 'docking', name: 'Monitor spacecraft docking', detail: 'Watch approach speed and alignment', step: 'Flag the indicator that leaves its range' },
  { id: 'solar', name: 'Install a solar array (spacewalk)', detail: 'Checklist at four attach points', step: 'Re-verify an unconfirmed attach point' },
  { id: 'water', name: 'Service the water recovery system', detail: 'Swap one of three similar units', step: 'Match the unit ID before acting' },
  { id: 'drill', name: 'Run an emergency drill', detail: 'Depressurization, ammonia leak, fire', step: 'Pick the priority alert and the right module' },
  { id: 'ultrasound', name: 'Perform an ultrasound scan', detail: 'Onboard vascular imaging', step: 'Hold the view steady before saving' },
  { id: 'experiment', name: 'Run a microgravity experiment', detail: 'Sample handling and photo log', step: 'Match sample code to the record' },
];

// Simulated crew profile (clearly labelled in the UI)
const CREW = {
  history: [
    { rt: 272, sleep: 445, sleepy: 2, misses: 0, falseStarts: 0, input: 'key' },
    { rt: 285, sleep: 430, sleepy: 2, misses: 0, falseStarts: 1, input: 'key' },
    { rt: 280, sleep: 440, sleepy: 2, misses: 0, falseStarts: 0, input: 'key' },
    { rt: 291, sleep: 450, sleepy: 1, misses: 1, falseStarts: 0, input: 'key' },
    { rt: 276, sleep: 440, sleepy: 2, misses: 0, falseStarts: 0, input: 'key' },
  ],
  today: { sleep: 310, sleepy: 4, rt: 350, misses: 1, falseStarts: 0, valid: 8, input: 'key' },
};

// ---------- State ----------
const state = {
  mode: 'guest',          // 'guest' | 'crew'
  op: OPS[0],
  sleepy: 2,
  today: null,            // { rt, sleep, sleepy, misses, falseStarts, valid, input }
  baseline: null,         // { rt, sleep, sleepy, n } or null
  baselineCount: 0,
  evaluation: null,
  rehearsal: [],          // attempts: { outcome, rt? }
};

// ---------- Helpers ----------
const median = (arr) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmtSleep = (min) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} min`;
const fmtDur = (min) => {
  const a = Math.abs(Math.round(min));
  const h = Math.floor(a / 60), m = a % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
};

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveHistory(h) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-30))); } catch { /* storage unavailable: demo still works */ }
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Navigation ----------
let current = 'home';
function show(id) {
  if (current === 'test') abortTest(null);
  if (current === 'rehearse') stopRound();
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${id}`));
  current = id;
  window.scrollTo(0, 0);
  if (id === 'brief') renderBrief();
  if (id === 'results') renderResults();
  if (id === 'rehearse') prepRehearsal();
  if (id === 'plan') renderPlan();
}
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) show(go.dataset.go);
});

function setMode(mode) {
  state.mode = mode;
  state.today = null;
  state.rehearsal = [];
  document.body.classList.toggle('crew', mode === 'crew');
  const badge = $('#modeBadge');
  badge.hidden = false;
  badge.textContent = mode === 'crew' ? 'Crew scenario · simulated' : 'Live test';
}

$('#btnGuest').addEventListener('click', () => {
  setMode('guest');
  $('#sleepH').value = 7; $('#sleepM').value = 0; state.sleepy = 2;
  show('brief');
});
$('#btnCrew').addEventListener('click', () => {
  setMode('crew');
  $('#sleepH').value = 5; $('#sleepM').value = 10; state.sleepy = 4;
  state.op = OPS[0];
  show('brief');
});

// ---------- Brief ----------
function renderBrief() {
  const list = $('#opList');
  list.innerHTML = '';
  OPS.forEach((op) => {
    const b = document.createElement('button');
    b.className = 'op';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(op === state.op));
    b.disabled = !op.ready;
    b.innerHTML = `<span class="op-name"></span><span class="op-detail"></span>
      ${op.ready ? '<span class="op-step"></span>' : '<span class="op-soon">Rehearsal coming next</span>'}`;
    b.querySelector('.op-name').textContent = op.name;
    b.querySelector('.op-detail').textContent = op.detail;
    if (op.ready) b.querySelector('.op-step').textContent = `Critical step: ${op.step}`;
    b.addEventListener('click', () => { state.op = op; renderBrief(); });
    list.appendChild(b);
  });

  const seg = $('#sleepiness');
  seg.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.textContent = i;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(i === state.sleepy));
    b.addEventListener('click', () => { state.sleepy = i; renderBrief(); });
    seg.appendChild(b);
  }
  $('#btnStartCheck').textContent = state.mode === 'crew' ? "Load today's recorded check" : 'Start reaction check';
}

function readSleep() {
  const h = Math.min(14, Math.max(0, parseInt($('#sleepH').value, 10) || 0));
  const m = Math.min(59, Math.max(0, parseInt($('#sleepM').value, 10) || 0));
  return h * 60 + m;
}

$('#btnStartCheck').addEventListener('click', () => {
  const sleep = readSleep();
  if (state.mode === 'crew') {
    state.today = { ...CREW.today, sleep, sleepy: state.sleepy };
    computeBaseline(CREW.history, state.today.input);
    show('results');
  } else {
    state.pendingSleep = sleep;
    show('test');
    resetTestUI();
  }
});

// ---------- Reaction test ----------
const T = { running: false, phase: 'idle', timers: [], start: 0, signalAt: 0, rts: [], misses: 0, falseStarts: 0, input: null, raf: 0 };

function resetTestUI() {
  $('#testIntro').hidden = false;
  $('#signal').classList.remove('on');
  $('#testFeedback').textContent = '';
  $('#testProgress').style.width = '0%';
  setTimeout(() => $('#btnBeginTest').focus(), 50);
}

function clearTimers() { T.timers.forEach(clearTimeout); T.timers = []; }

function beginTest() {
  Object.assign(T, { running: true, phase: 'wait', rts: [], misses: 0, falseStarts: 0, input: null, start: performance.now() });
  $('#testIntro').hidden = true;
  document.activeElement && document.activeElement.blur();
  $('#testArea').focus({ preventScroll: true });
  T.timers.push(setTimeout(finishTest, TEST_MS));
  scheduleSignal();
  const tick = () => {
    if (!T.running) return;
    const p = Math.min(1, (performance.now() - T.start) / TEST_MS);
    $('#testProgress').style.width = `${p * 100}%`;
    T.raf = requestAnimationFrame(tick);
  };
  tick();
}

function scheduleSignal() {
  T.phase = 'wait';
  $('#signal').classList.remove('on');
  const isi = ISI_MIN + Math.random() * (ISI_MAX - ISI_MIN);
  // don't start a signal that can't finish before the test ends
  if (performance.now() - T.start + isi + 300 > TEST_MS) return;
  T.timers.push(setTimeout(showSignal, isi));
}

function showSignal() {
  if (!T.running) return;
  $('#signal').classList.add('on');
  // timestamp right before the frame that paints the signal
  requestAnimationFrame(() => {
    if (!T.running) return;
    T.signalAt = performance.now();
    T.phase = 'signal';
    T.timers.push(setTimeout(() => {
      if (T.phase !== 'signal') return;
      T.misses++;
      feedback('Missed', true);
      scheduleSignal();
    }, RESPONSE_WINDOW));
  });
}

function respond(ts, input) {
  if (!T.running) return;
  T.input = T.input || input;
  if (T.phase === 'signal') {
    const rt = ts - T.signalAt;
    clearTimers();
    T.timers.push(setTimeout(finishTest, Math.max(0, TEST_MS - (performance.now() - T.start))));
    if (rt < ANTICIPATION_MS) { T.falseStarts++; feedback('Too early', true); }
    else { T.rts.push(rt); feedback(`${Math.round(rt)} ms`); }
    T.phase = 'wait';
    scheduleSignal();
  } else if (T.phase === 'wait') {
    T.falseStarts++;
    feedback('Too early — wait for the signal', true);
  }
}

function feedback(msg, bad = false) {
  const f = $('#testFeedback');
  f.textContent = msg;
  f.classList.toggle('bad', bad);
}

function finishTest() {
  if (!T.running) return;
  T.running = false;
  clearTimers();
  cancelAnimationFrame(T.raf);
  $('#signal').classList.remove('on');
  $('#testProgress').style.width = '100%';

  const today = {
    rt: Math.round(median(T.rts)),
    valid: T.rts.length,
    misses: T.misses,
    falseStarts: T.falseStarts,
    sleep: state.pendingSleep,
    sleepy: state.sleepy,
    input: T.input || 'key',
  };
  const history = loadHistory();
  computeBaseline(history, today.input);
  state.today = today;
  if (today.valid >= MIN_VALID) {
    history.push({ ...today, date: new Date().toISOString() });
    saveHistory(history);
  }
  show('results');
}

function abortTest(reason) {
  if (!T.running) return;
  T.running = false;
  clearTimers();
  cancelAnimationFrame(T.raf);
  $('#signal').classList.remove('on');
  if (reason) {
    resetTestUI();
    feedback(reason, true);
  }
}

$('#btnBeginTest').addEventListener('click', (e) => { e.stopPropagation(); beginTest(); });
$('#btnAbortTest').addEventListener('click', () => { abortTest(null); show('brief'); });
$('#testArea').addEventListener('pointerdown', (e) => {
  if (!T.running) return;
  e.preventDefault();
  respond(e.timeStamp || performance.now(), 'pointer');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    abortTest('Check interrupted — the tab was hidden. Start again.');
    stopRound();
  }
});

// ---------- Baseline & rule ----------
function computeBaseline(history, input) {
  const same = history.filter((h) => (h.input || 'key') === input && h.valid !== 0);
  state.baselineCount = Math.min(same.length, BASELINE_N);
  if (same.length < BASELINE_N) { state.baseline = null; return; }
  const last = same.slice(-BASELINE_N);
  state.baseline = {
    rt: Math.round(median(last.map((h) => h.rt))),
    sleep: Math.round(median(last.map((h) => h.sleep))),
    sleepy: median(last.map((h) => h.sleepy)),
    misses: median(last.map((h) => h.misses || 0)),
    n: BASELINE_N,
  };
}

function evaluate(today, base) {
  if (!base || !(today.valid >= MIN_VALID)) return null;
  const slower = (today.rt - base.rt) / base.rt;
  const sleepLost = base.sleep - today.sleep;
  const c = {
    slower: slower >= RULE.slower,
    sleep: sleepLost >= RULE.sleepLostMin,
    sleepy: today.sleepy >= RULE.sleepy,
  };
  return { slower, sleepLost, c, flag: c.slower && (c.sleep || c.sleepy) };
}

// ---------- Results ----------
function renderResults() {
  const t = state.today, b = state.baseline;
  if (!t) return;
  const v = $('#verdict'), body = $('#compareBody'), rule = $('#rulePanel');
  const valid = t.valid >= MIN_VALID;
  const ev = state.evaluation = valid ? evaluate(t, b) : null;

  if (!valid) {
    v.className = 'verdict retry';
    v.innerHTML = `<h3>Repeat the check</h3><p>Only ${t.valid} valid response${t.valid === 1 ? '' : 's'} — not enough to summarise. Stay on the tab and press only when the signal appears.</p>`;
  } else if (!b) {
    v.className = 'verdict';
    v.innerHTML = `<h3>Your reaction: ${t.rt} ms</h3><p>Personal baseline is still forming — ${state.baselineCount} of ${BASELINE_N} previous checks on this device. Comparison appears once there are ${BASELINE_N}.</p>`;
  } else if (ev.flag) {
    const parts = [`reaction ${Math.round(ev.slower * 100)}% slower than usual`];
    if (ev.c.sleep) parts.push(`${fmtDur(ev.sleepLost)} less sleep`);
    if (ev.c.sleepy) parts.push(`sleepiness ${t.sleepy}/5`);
    v.className = 'verdict flag';
    v.innerHTML = `<h3>Review before task</h3><p>Today: ${parts.join(', ')}. Discuss the result with your backup operator before <b>${escapeHtml(state.op.name.toLowerCase())}</b>.</p>`;
  } else {
    v.className = 'verdict ok';
    v.innerHTML = `<h3>No flagged changes</h3><p>Today's values are close to your usual. Proceed with the standard procedure.</p>`;
  }

  const row = (label, today, usual, change, bad) =>
    `<tr><th>${label}</th><td>${today}</td><td>${usual}</td><td class="${bad ? 'delta-bad' : 'delta-ok'}">${change}</td></tr>`;
  const dash = '—';
  let html = '';
  if (b) {
    const dSleep = t.sleep - b.sleep;
    html += row('Sleep last night', fmtSleep(t.sleep), fmtSleep(b.sleep),
      dSleep === 0 ? 'same' : `${dSleep < 0 ? '−' : '+'}${fmtDur(dSleep)}`, ev && ev.c.sleep);
    html += row('Sleepiness', `${t.sleepy} / 5`, `${b.sleepy} / 5`,
      t.sleepy === b.sleepy ? 'same' : `${t.sleepy > b.sleepy ? '+' : '−'}${Math.abs(t.sleepy - b.sleepy)}`, ev && ev.c.sleepy);
    const dRt = valid ? t.rt - b.rt : NaN;
    html += row('Median reaction', valid ? `${t.rt} ms` : dash, `${b.rt} ms`,
      valid ? `${dRt >= 0 ? '+' : '−'}${Math.abs(dRt)} ms (${dRt >= 0 ? '+' : '−'}${Math.abs(Math.round((dRt / b.rt) * 100))}%)` : dash, ev && ev.c.slower);
    html += row('Missed signals', t.misses, b.misses, t.misses > b.misses ? `+${t.misses - b.misses}` : 'same', false);
  } else {
    html += row('Sleep last night', fmtSleep(t.sleep), dash, dash);
    html += row('Sleepiness', `${t.sleepy} / 5`, dash, dash);
    html += row('Median reaction', valid ? `${t.rt} ms` : dash, dash, dash);
    html += row('Missed signals', t.misses, dash, dash);
  }
  html += row('Early presses', t.falseStarts, dash, dash);
  body.innerHTML = html;

  if (ev) {
    rule.hidden = false;
    rule.innerHTML = `<h4>Why this result</h4><ul>
      <li class="${ev.c.slower ? 'met' : ''}">Reaction at least ${RULE.slower * 100}% slower than usual</li>
      <li class="${ev.c.sleep ? 'met' : ''}">and at least ${RULE.sleepLostMin / 60} h less sleep than usual</li>
      <li class="${ev.c.sleepy ? 'met' : ''}">or sleepiness ${RULE.sleepy}–5 of 5</li></ul>
      <p class="fineprint">Demo thresholds set for the hackathon scenario. The card explains what changed; the crew decides how to proceed.</p>`;
  } else {
    rule.hidden = true;
  }
  $('#btnToRehearse').disabled = !state.op.ready;
}

$('#btnRepeat').addEventListener('click', () => {
  if (state.mode === 'crew') { show('brief'); return; }
  state.pendingSleep = state.today ? state.today.sleep : readSleep();
  show('test');
  resetTestUI();
});
$('#btnToRehearse').addEventListener('click', () => show('rehearse'));

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Rehearsal: Cygnus capture (HOLD → CAPTURE) ----------
const R = {
  running: false, raf: 0, last: 0, t0: 0,
  reticle: 0.15, target: 0.5, phi: 0,
  cmd: 'HOLD', alignedFor: 0, captureAt: null, captureShownAt: 0, missedWindows: 0,
  keys: { left: false, right: false },
};
const TOL = 0.04;            // capture zone half-width (fraction of field)
const RET_SPEED = 0.38;      // reticle speed, field-widths per second
const CAPTURE_WINDOW = 3000; // ms the CAPTURE call stays up
const ROUND_TIMEOUT = 45000;

function prepRehearsal() {
  stopRound();
  $('#rehTitle').textContent = 'Capture Cygnus';
  $('#rehOverlay').hidden = false;
  $('#rehResult').hidden = true;
  $('#btnRetry').hidden = true;
  $('#btnToPlan').hidden = state.rehearsal.length === 0;
  R.reticle = 0.15; R.target = 0.5;
  setCmd('HOLD');
  renderSim(false);
  setTimeout(() => $('#btnStartRound').focus(), 50);
}

function setCmd(c) {
  R.cmd = c;
  const el = $('#cmd');
  el.textContent = c;
  el.className = `cmd ${c === 'HOLD' ? 'hold' : 'capture'}`;
}

function startRound() {
  Object.assign(R, { running: true, last: performance.now(), t0: performance.now(), phi: Math.random() * Math.PI * 2,
    reticle: Math.random() < 0.5 ? 0.12 : 0.88, alignedFor: 0, captureAt: null, missedWindows: 0 });
  setCmd('HOLD');
  $('#rehOverlay').hidden = true;
  $('#rehResult').hidden = true;
  $('#btnRetry').hidden = true;
  document.activeElement && document.activeElement.blur();
  R.raf = requestAnimationFrame(step);
}

function stopRound() {
  R.running = false;
  cancelAnimationFrame(R.raf);
  R.keys.left = R.keys.right = false;
}

function step(now) {
  if (!R.running) return;
  const dt = Math.min(0.05, (now - R.last) / 1000);
  R.last = now;
  const t = (now - R.t0) / 1000;

  // target drifts on the track (two slow sine components)
  R.target = 0.5 + 0.26 * Math.sin(0.45 * t + R.phi) + 0.06 * Math.sin(1.3 * t + R.phi * 2);
  // reticle steered by the operator
  const dir = (R.keys.right ? 1 : 0) - (R.keys.left ? 1 : 0);
  R.reticle = Math.min(0.96, Math.max(0.04, R.reticle + dir * RET_SPEED * dt));

  const aligned = Math.abs(R.reticle - R.target) < TOL;
  if (R.cmd === 'HOLD') {
    R.alignedFor = aligned ? R.alignedFor + dt : 0;
    if (R.captureAt === null && R.alignedFor >= 1.0) {
      R.captureAt = now + 800 + Math.random() * 1200; // backup operator confirms after a short delay
    }
    if (R.captureAt !== null && now >= R.captureAt) {
      R.captureAt = null;
      R.captureShownAt = now;
      setCmd('CAPTURE');
    }
  } else if (now - R.captureShownAt > CAPTURE_WINDOW) {
    R.missedWindows++;
    R.alignedFor = 0;
    setCmd('HOLD');
    toast('CAPTURE window missed — realign and wait for the next call');
  }

  if (now - R.t0 > ROUND_TIMEOUT) { endRound({ outcome: 'timeout' }); return; }
  renderSim(aligned);
  R.raf = requestAnimationFrame(step);
}

function renderSim(aligned) {
  $('#target').style.left = `${R.target * 100}%`;
  const ret = $('#reticle');
  ret.style.left = `${R.reticle * 100}%`;
  ret.classList.toggle('aligned', aligned);
  const a = $('#alignState');
  a.textContent = aligned ? 'Aligned — in capture zone' : 'Not aligned';
  a.classList.toggle('on', aligned);
}

function captureCommand(ts) {
  if (!R.running) return;
  const aligned = Math.abs(R.reticle - R.target) < TOL;
  if (R.cmd === 'HOLD') endRound({ outcome: 'early', aligned });
  else if (!aligned) endRound({ outcome: 'outside' });
  else endRound({ outcome: 'success', rt: Math.round(ts - R.captureShownAt) });
}

const REH_TEXT = {
  success: (a) => ['Capture complete', `You waited for the CAPTURE call and grappled ${a.rt} ms after it.`],
  early: (a) => ['Capture commanded during HOLD', a.aligned
    ? 'The reticle was aligned, but the backup operator had not confirmed yet.'
    : 'The backup operator had not called CAPTURE and the reticle was outside the zone.'],
  outside: () => ['Reticle outside capture zone', 'CAPTURE was called, but the fixture had drifted out of the zone when you grappled.'],
  timeout: () => ['Round timed out', 'No capture within 45 seconds. Align the reticle and hold it to get the CAPTURE call.'],
};

function endRound(attempt) {
  stopRound();
  attempt.missedWindows = R.missedWindows;
  state.rehearsal.push(attempt);
  const [title, text] = REH_TEXT[attempt.outcome](attempt);
  const box = $('#rehResult');
  box.hidden = false;
  box.className = `reh-result ${attempt.outcome === 'success' ? 'good' : 'bad'}`;
  box.innerHTML = `<h3></h3><p></p>`;
  box.querySelector('h3').textContent = title;
  box.querySelector('p').textContent = text + (R.missedWindows ? ` CAPTURE windows missed: ${R.missedWindows}.` : '');
  $('#rehOverlay').hidden = false;
  $('#btnStartRound').textContent = 'New round';
  $('#btnRetry').hidden = false;
  $('#btnToPlan').hidden = false;
}

$('#btnStartRound').addEventListener('click', startRound);
$('#btnRetry').addEventListener('click', startRound);
$('#btnToPlan').addEventListener('click', () => show('plan'));
$('#padCapture').addEventListener('pointerdown', (e) => { e.preventDefault(); captureCommand(e.timeStamp || performance.now()); });
[['#padLeft', 'left'], ['#padRight', 'right']].forEach(([sel, k]) => {
  const el = $(sel);
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); R.keys[k] = true; el.setPointerCapture(e.pointerId); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => el.addEventListener(ev, () => { R.keys[k] = false; }));
});

// ---------- Plan ----------
function agreementText() {
  const last = state.rehearsal[state.rehearsal.length - 1];
  const flagged = state.evaluation && state.evaluation.flag;
  const early = state.rehearsal.some((a) => a.outcome === 'early');
  if (early) return 'Backup operator calls CAPTURE aloud; prime operator repeats the call before grappling.';
  if (last && last.outcome === 'outside') return 'Backup operator confirms the reticle is aligned at the moment of the CAPTURE call.';
  if (flagged) return 'Keep the backup operator on the CAPTURE call and cross-check alignment before grapple.';
  return 'Standard procedure: backup operator calls CAPTURE, prime operator grapples.';
}

function renderPlan() {
  $('#agreement').value = agreementText();
  $('#agreed').checked = false;
  renderSummary();
}

function renderSummary() {
  const t = state.today, b = state.baseline, ev = state.evaluation;
  const lines = [];
  lines.push('CrewReady — pre-task check');
  lines.push(`Task: ${state.op.name} (Cygnus, Canadarm2)`);
  lines.push(`Profile: ${state.mode === 'crew' ? 'Crew member A (simulated data)' : 'Live demo test'}`);
  if (t) {
    lines.push(`Sleep: ${fmtSleep(t.sleep)}${b ? ` (usual ${fmtSleep(b.sleep)})` : ''}`);
    lines.push(`Sleepiness: ${t.sleepy}/5${b ? ` (usual ${b.sleepy}/5)` : ''}`);
    if (t.valid >= MIN_VALID) {
      lines.push(`Median reaction: ${t.rt} ms${b ? ` (usual ${b.rt} ms, ${ev.slower >= 0 ? '+' : ''}${Math.round(ev.slower * 100)}%)` : ' (baseline forming)'}`);
    } else {
      lines.push('Median reaction: not enough valid responses');
    }
    lines.push(`Missed signals: ${t.misses} · Early presses: ${t.falseStarts}`);
  }
  lines.push(`Reaction check: ${ev ? (ev.flag ? 'REVIEW BEFORE TASK' : 'no flagged changes') : 'no comparison yet'}`);
  if (state.rehearsal.length) {
    const counts = state.rehearsal.reduce((m, a) => (m[a.outcome] = (m[a.outcome] || 0) + 1, m), {});
    const names = { success: 'capture complete', early: 'capture during HOLD', outside: 'outside zone', timeout: 'timed out' };
    lines.push(`Rehearsal (${state.rehearsal.length}): ${Object.entries(counts).map(([k, n]) => `${names[k]} ×${n}`).join(', ')}`);
  }
  lines.push(`Agreed step: ${$('#agreement').value.trim() || '—'}`);
  lines.push(`Discussed with backup operator: ${$('#agreed').checked ? 'yes' : 'not yet'}`);
  lines.push('The crew decides whether and how to proceed.');
  $('#summary').textContent = lines.join('\n');
}
$('#agreement').addEventListener('input', renderSummary);
$('#agreed').addEventListener('change', renderSummary);

$('#btnCopy').addEventListener('click', async () => {
  const text = $('#summary').textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast('Summary copied');
  } catch {
    const r = document.createRange();
    r.selectNodeContents($('#summary'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    toast('Press Ctrl/Cmd+C to copy');
  }
});

// ---------- Keyboard ----------
document.addEventListener('keydown', (e) => {
  if (current === 'test' && T.running) {
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) respond(e.timeStamp || performance.now(), 'key');
    } else if (e.key === 'Escape') {
      abortTest('Check cancelled. Start again when ready.');
    }
    return;
  }
  if (current === 'rehearse' && R.running) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); R.keys.left = true; }
    else if (e.key === 'ArrowRight') { e.preventDefault(); R.keys.right = true; }
    else if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) captureCommand(e.timeStamp || performance.now()); }
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft') R.keys.left = false;
  if (e.key === 'ArrowRight') R.keys.right = false;
});
window.addEventListener('blur', () => { R.keys.left = R.keys.right = false; });
