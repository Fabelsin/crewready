'use strict';

/* =========================================================
   CrewReady — NASA Space Apps 2026 prototype
   Pages (hash router): #/  #/tasks  #/about  #/run/<mission>/<step>
   Run steps: brief → check (mission-specific) → results → plan
   ========================================================= */

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

// ---------- Config ----------
const BASELINE_N = 5;                                  // baseline = median of the last 5 checks of a mission
const RULE = { worse: 0.20, sleepLostMin: 120, sleepy: 4 };
const STORAGE_PREFIX = 'crewready.v3.hist.';
const STEPS = ['brief', 'check', 'results', 'plan'];
const CREW_SLEEP = { base: [445, 430, 440, 450, 440], baseSleepy: [2, 2, 2, 1, 2], today: 310, todaySleepy: 4 };

const fmtMs = (v) => `${Math.round(v)} ms`;
const fmtPct = (v) => `${Math.round(v)}%`;

// ---------- Missions ----------
const OPS = [
  {
    id: 'cygnus', name: 'Capture a cargo spacecraft', short: 'Cargo capture', img: 'cygnus.jpg',
    detail: 'Grapple a free-flying Cygnus with Canadarm2. Prime and backup robotics operators.',
    step: 'Capture only on the backup operator\'s call', partner: 'backup operator',
    skill: 'Timing on a partner\'s call', check: 'capture',
    title: 'Grapple the free-flyer',
    instr: 'Steer the end effector onto the grapple fixture in two axes. When you have held alignment, the backup operator calls CAPTURE. Grapple only during CAPTURE. Three captures are needed.',
    keys: '← ↑ → ↓ or WASD steer · Space captures',
    metric: { label: 'Response to CAPTURE call', better: 'lower', fmt: fmtMs },
    crew: { base: [610, 640, 590, 625, 600], today: 790, extras: [['Premature captures', 1, true], ['Missed CAPTURE windows', 1, true], ['Captures off target', 0, false]], flags: { premature: 1, missed: 1 } },
  },
  {
    id: 'docking', name: 'Monitor spacecraft docking', short: 'Docking monitor', img: 'docking.jpg',
    detail: 'Watch the final approach of a crew vehicle: closing rate, lateral offset and alignment.',
    step: 'Flag the indicator that leaves its range', partner: 'flight partner',
    skill: 'Sustained vigilance', check: 'monitor',
    title: 'Final approach monitor',
    instr: 'Three approach indicators drift inside their green bands for 30 seconds. When one leaves its band, flag it within 3 seconds. Do not flag a value that is still in range.',
    keys: 'Flag buttons or keys 1 · 2 · 3',
    metric: { label: 'Time to flag an excursion', better: 'lower', fmt: fmtMs },
    gauges: [
      { name: 'Closing rate', unit: 'm/s', lo: 0.05, hi: 0.15, min: 0, max: 0.25, dec: 2 },
      { name: 'Lateral offset', unit: 'cm', lo: -8, hi: 8, min: -20, max: 20, dec: 0 },
      { name: 'Pitch alignment', unit: '°', lo: -1.5, hi: 1.5, min: -4, max: 4, dec: 1 },
    ],
    crew: { base: [820, 760, 800, 850, 790], today: 1090, extras: [['Missed excursions', 1, true], ['False flags', 1, true]], flags: { missed: 1, falses: 1 } },
  },
  {
    id: 'solar', name: 'Install a solar array (spacewalk)', short: 'Solar array EVA', img: 'solar.jpg',
    detail: 'Secure a roll-out solar array at four attach points on the truss during a spacewalk.',
    step: 'Drive the bolts in order, each to the torque window', partner: 'EVA partner',
    skill: 'Fine motor control & sequence', check: 'torque',
    title: 'Bolt the array to the truss',
    instr: 'Memorise the bolt order shown for 4 seconds. Then, from memory, pick each attach point and drive its bolt: hold the button (or Space) and release when the needle is inside the green torque window.',
    keys: 'Click the attach point · hold Space or the button to torque',
    metric: { label: 'Mean torque error', better: 'lower', fmt: (v) => `${v.toFixed(1)}% of scale` },
    crew: { base: [4.1, 3.6, 4.4, 3.9, 4.0], today: 6.4, extras: [['Bolt order errors', 1, true], ['Bolts outside window', 2, true]], flags: { seq: 1, out: 2 } },
  },
  {
    id: 'water', name: 'Service the water recovery system', short: 'Water recovery', img: 'water.jpg',
    detail: 'Swap one of several nearly identical replaceable units in the water processor rack.',
    step: 'Match the unit ID before acting', partner: 'crew partner',
    skill: 'Visual discrimination', check: 'verify',
    title: 'Match the unit ID',
    instr: 'The work order shows the unit to replace. Pick the rack unit with exactly the same ID. Look-alike characters (8/B, 0/O, 1/I, 5/S, 2/Z) are swapped on purpose. Six work orders, 6 seconds each.',
    keys: 'Click the matching unit',
    metric: { label: 'Decision time per unit', better: 'lower', fmt: fmtMs },
    prefixes: ['WPA-', 'UPA-', 'ORU-'],
    crew: { base: [2100, 2250, 1980, 2200, 2050], today: 2900, extras: [['Wrong units', 1, true], ['Timed out', 0, false]], flags: { errors: 1 } },
  },
  {
    id: 'drill', name: 'Run an emergency drill', short: 'Emergency drill', img: 'drill.jpg',
    detail: 'Respond to simulated alarms: find the module on the station map and choose the first response.',
    step: 'Locate the module and pick the right first response', partner: 'crew commander',
    skill: 'Decision speed under alarm', check: 'triage',
    title: 'Alarm triage (training)',
    instr: 'An alarm names a module. Click that module on the station map, then choose the first response: fire → extinguisher, toxic atmosphere → emergency mask, rapid depressurisation → close the hatch. Six alarms, 8 seconds each. This is a simplified training mapping, not the real ISS procedure.',
    keys: 'Click the module, then the response',
    metric: { label: 'Alarm response time', better: 'lower', fmt: fmtMs },
    crew: { base: [2600, 2450, 2700, 2550, 2500], today: 3400, extras: [['Wrong module', 1, true], ['Wrong response', 0, false], ['Timed out', 0, false]], flags: { wrongModule: 1 } },
  },
  {
    id: 'ultrasound', name: 'Perform an ultrasound scan', short: 'Ultrasound scan', img: 'ultrasound.jpg',
    detail: 'Onboard vascular imaging guided in real time by a sonographer on the ground.',
    step: 'Hold the image steady; save only on the ground call', partner: 'ground sonographer',
    skill: 'Smooth pursuit tracking', check: 'pursuit',
    title: 'Keep the vessel in view',
    instr: 'Move the probe (mouse, finger or arrow keys) to keep the crosshair on the moving vessel. The image quality fills while you stay on it; when it is full the sonographer calls SAVE. Save three images. Saving before the call does not count.',
    keys: 'Mouse / touch or arrows move the probe · Space saves',
    metric: { label: 'Time on target', better: 'higher', fmt: fmtPct },
    crew: { base: [78, 81, 76, 80, 79], today: 59, extras: [['Saves before the call', 1, true], ['Images lost before saving', 2, true]], flags: { early: 1, lost: 2 } },
  },
  {
    id: 'experiment', name: 'Run a microgravity experiment', short: 'Science glovebox', img: 'experiment.jpg',
    detail: 'Transfer samples from a tray into the Microgravity Science Glovebox in the order of the record.',
    step: 'Take the sample named in the record, from the right slot', partner: 'crew partner',
    skill: 'Working memory', check: 'tray',
    title: 'Sample tray recall',
    instr: 'Study the sample tray for 6 seconds. The vials are then capped. For each line of the experiment record, tap the slot that holds that sample. Two trays, three samples each.',
    keys: 'Tap the slot',
    metric: { label: 'Recall accuracy', better: 'higher', fmt: fmtPct },
    crew: { base: [100, 83, 100, 100, 83], today: 67, extras: [['Wrong slots', 2, true], ['Median time per sample', '3.1 s', false]], flags: { errors: 2 } },
  },
];
const opById = (id) => OPS.find((o) => o.id === id);

// ---------- State ----------
const state = {
  mode: 'guest',          // 'guest' | 'crew'
  op: OPS[0],
  sleepy: 2,
  pendingSleep: 420,
  today: null,            // { metric, valid, extras:[[label, value, bad]], flags, sleep, sleepy, recorded }
  baseline: null,         // { metric, sleep, sleepy }
  baselineCount: 0,
  baselineSimulated: false,
  evaluation: null,
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
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function loadHistory(op) {
  try { return JSON.parse(localStorage.getItem(STORAGE_PREFIX + op.id) || '[]'); } catch { return []; }
}
function saveHistory(op, h) {
  try { localStorage.setItem(STORAGE_PREFIX + op.id, JSON.stringify(h.slice(-30))); } catch { /* storage unavailable */ }
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

// =========================================================
// Intro
// =========================================================
const intro = {
  el: $('#intro'), video: $('#introVideo'), done: false, raf: 0,
  open() {
    this.done = false;
    this.el.hidden = false;
    this.el.classList.remove('closing');
    document.body.classList.add('intro-open');
    $$('.intro-content > *').forEach((n) => { n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; });
    try { this.video.currentTime = 0; const p = this.video.play(); if (p && p.catch) p.catch(() => {}); } catch { /* autoplay blocked */ }
    const tick = () => {
      if (this.done) return;
      const d = this.video.duration || 14;
      $('#introProgress').style.width = `${Math.min(100, (this.video.currentTime / d) * 100)}%`;
      this.raf = requestAnimationFrame(tick);
    };
    tick();
    setTimeout(() => $('#btnEnter').focus({ preventScroll: true }), 2300);
  },
  close() {
    if (this.done) return;
    this.done = true;
    cancelAnimationFrame(this.raf);
    try { sessionStorage.setItem('crewready.introSeen', '1'); } catch { /* ignore */ }
    this.el.classList.add('closing');
    document.body.classList.remove('intro-open');
    setTimeout(() => { this.el.hidden = true; this.video.pause(); }, 800);
  },
};
$('#btnEnter').addEventListener('click', () => intro.close());
$('#btnSkip').addEventListener('click', () => intro.close());
intro.video.addEventListener('ended', () => intro.close());
$('#btnReplayIntro').addEventListener('click', () => intro.open());

// =========================================================
// Router
// =========================================================
let route = { page: 'home' };

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return { page: 'home' };
  if (parts[0] === 'tasks') return { page: 'tasks' };
  if (parts[0] === 'about') return { page: 'about' };
  if (parts[0] === 'run' && opById(parts[1])) return { page: 'run', op: parts[1], step: STEPS.includes(parts[2]) ? parts[2] : 'brief' };
  return { page: 'home' };
}
const go = (hash) => { if (location.hash === hash) onRoute(); else location.hash = hash; };
const runHash = (step, op = state.op.id) => `#/run/${op}/${step}`;

function onRoute() {
  stopCheck();
  const r = parseHash();
  if (r.page === 'run') {
    const op = opById(r.op);
    if (op !== state.op) resetRun(op);
    if (['results', 'plan'].includes(r.step) && !state.today) { go(runHash('brief')); return; }
  }
  route = r;
  $$('.page').forEach((p) => p.classList.toggle('active', p.dataset.page === r.page));
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === r.page || (r.page === 'run' && a.dataset.nav === 'tasks')));
  closeMenu();
  window.scrollTo(0, 0);
  if (r.page === 'home') renderHome();
  if (r.page === 'tasks') renderTasks();
  if (r.page === 'run') showStep(r.step);
}
window.addEventListener('hashchange', onRoute);

function closeMenu() { $('#navLinks').classList.remove('open'); $('#navToggle').setAttribute('aria-expanded', 'false'); }
$('#navToggle').addEventListener('click', () => {
  const open = $('#navLinks').classList.toggle('open');
  $('#navToggle').setAttribute('aria-expanded', String(open));
});

// =========================================================
// Mode
// =========================================================
function setMode(mode) {
  state.mode = mode;
  document.body.classList.toggle('crew', mode === 'crew');
  $$('.mode-switch [data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  try { localStorage.setItem('crewready.mode', mode); } catch { /* ignore */ }
}
$$('.mode-switch [data-mode]').forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.mode); resetRun(state.op); renderTasks(); }));

function resetRun(op) {
  state.op = op;
  state.today = null;
  state.evaluation = null;
  state.baseline = null;
  state.baselineSimulated = false;
  if (state.mode === 'crew') { state.pendingSleep = CREW_SLEEP.today; state.sleepy = CREW_SLEEP.todaySleepy; }
  else { state.pendingSleep = 420; state.sleepy = 2; }
}

// =========================================================
// Home & Tasks
// =========================================================
function renderHome() {
  const strip = $('#homeTasks');
  if (strip.childElementCount) return;
  strip.innerHTML = OPS.map((o) => `
    <a class="strip-card" href="${runHash('brief', o.id)}" data-start="${o.id}">
      <img src="assets/img/${o.img}" alt=""><span>${esc(o.short)}<small>${esc(o.skill)}</small></span>
    </a>`).join('');
}

function renderTasks() {
  $('#taskGrid').innerHTML = OPS.map((o) => `
    <article class="task-card">
      <div class="task-card-img">
        <img src="assets/img/${o.img}" alt="${esc(o.name)}" loading="lazy">
        <span class="chip">${esc(o.skill)}</span>
      </div>
      <div class="task-card-body">
        <h3>${esc(o.name)}</h3>
        <p>${esc(o.detail)}</p>
        <p class="crit"><span>Mission check</span><b>${esc(o.title)}</b></p>
        <p class="crit"><span>Critical step</span><b>${esc(o.step)}</b></p>
        <a class="btn btn-primary" href="${runHash('brief', o.id)}" data-start="${o.id}">Start mission check</a>
      </div>
    </article>`).join('');
}
// starting a mission from a card always starts a fresh run
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-start]');
  if (a) resetRun(opById(a.dataset.start));
});

// =========================================================
// Run: stepper & panes
// =========================================================
function showStep(step) {
  const idx = STEPS.indexOf(step);
  $$('#stepper li').forEach((li, i) => {
    li.classList.toggle('current', i === idx);
    li.classList.toggle('done', i < idx);
  });
  $$('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === step));
  const chip = $('#runMode');
  chip.textContent = state.mode === 'crew' ? 'Crew scenario · simulated history' : 'Live test';
  chip.className = `chip${state.mode === 'crew' ? ' crew' : ''}`;
  if (step === 'brief') renderBrief();
  if (step === 'check') startCheckPane();
  if (step === 'results') renderResults();
  if (step === 'plan') renderPlan();
}

// ---------- Brief ----------
function renderBrief() {
  const o = state.op;
  $('#briefImg').src = `assets/img/${o.img}`;
  $('#briefImg').alt = o.name;
  $('#briefKicker').textContent = `Upcoming mission · ${o.skill}`;
  $('#briefName').textContent = o.name;
  $('#briefDetail').textContent = o.detail;
  $('#briefStep').textContent = o.step;
  $('#sleepH').value = Math.floor(state.pendingSleep / 60);
  $('#sleepM').value = state.pendingSleep % 60;
  renderSleepiness();
  $('#btnStartCheck').textContent = `Start check: ${o.title}`;
}

function renderSleepiness() {
  const seg = $('#sleepiness');
  seg.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = i;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(i === state.sleepy));
    b.addEventListener('click', () => { state.sleepy = i; renderSleepiness(); });
    seg.appendChild(b);
  }
}

function readSleep() {
  const h = clamp(parseInt($('#sleepH').value, 10) || 0, 0, 14);
  const m = clamp(parseInt($('#sleepM').value, 10) || 0, 0, 59);
  $('#sleepH').value = h; $('#sleepM').value = m;
  return h * 60 + m;
}

$('#btnStartCheck').addEventListener('click', () => {
  state.pendingSleep = readSleep();
  go(runHash('check'));
});
$('#btnLoadRecorded').addEventListener('click', () => {
  state.pendingSleep = readSleep();
  const c = state.op.crew;
  state.today = {
    metric: c.today, valid: true, extras: c.extras.map(([l, v, b]) => [l, v, b]), flags: { ...c.flags },
    sleep: state.pendingSleep, sleepy: state.sleepy, recorded: true,
  };
  useSimulatedBaseline();
  go(runHash('results'));
});

// =========================================================
// Mission check pane
// =========================================================
const chk = { current: null };

function startCheckPane() {
  const o = state.op;
  $('#chkTitle').textContent = o.title;
  $('#chkSkill').textContent = o.skill;
  $('#chkInstr').textContent = o.instr;
  $('#chkKeys').textContent = o.keys;
  const stage = $('#chkStage');
  stage.innerHTML = '';
  chk.current = CHECKS[o.check](stage, o, finishCheck);
}

function stopCheck() { if (chk.current) { chk.current.stop(); chk.current = null; } }

function finishCheck(result) {
  stopCheck();
  const o = state.op;
  state.today = { ...result, sleep: state.pendingSleep, sleepy: state.sleepy, recorded: false };
  if (state.mode === 'crew') {
    useSimulatedBaseline();
  } else {
    const history = loadHistory(o);
    computeBaseline(history);
    state.baselineSimulated = false;
    if (result.valid) {
      history.push({ metric: result.metric, sleep: state.pendingSleep, sleepy: state.sleepy, date: new Date().toISOString() });
      saveHistory(o, history);
    }
  }
  setTimeout(() => go(runHash('results')), 900);
}

$('#btnAbortCheck').addEventListener('click', (e) => { e.preventDefault(); stopCheck(); go(runHash('brief')); });

document.addEventListener('visibilitychange', () => {
  if (document.hidden && chk.current && chk.current.running()) {
    stopCheck();
    if (route.page === 'run' && parseHash().step === 'check') { startCheckPane(); toast('Check interrupted: the tab was hidden. Start again.'); }
  }
});

// Shared start overlay
function overlay(parent, label, onStart, note) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `${note ? `<p class="ov-note">${note}</p>` : ''}<button class="btn btn-primary btn-lg" type="button">${label}</button>`;
  ov.querySelector('button').addEventListener('click', () => { ov.hidden = true; onStart(); });
  parent.appendChild(ov);
  setTimeout(() => { const b = ov.querySelector('button'); if (b && !ov.hidden) b.focus({ preventScroll: true }); }, 60);
  return ov;
}

// Shared loop helper
function loop(fn) {
  const L = { on: false, raf: 0, last: 0 };
  const tick = (now) => {
    if (!L.on) return;
    const dt = Math.min(0.25, (now - L.last) / 1000);   // real time, robust to slow frames
    L.last = now;
    if (fn(now, dt) === false) { L.on = false; return; }
    L.raf = requestAnimationFrame(tick);
  };
  return {
    start() { L.on = true; L.last = performance.now(); L.raf = requestAnimationFrame(tick); },
    stop() { L.on = false; cancelAnimationFrame(L.raf); },
    get on() { return L.on; },
  };
}

// ---------------------------------------------------------
// 1. Cargo capture — 2D steering, act only on CAPTURE
// ---------------------------------------------------------
function captureCheck(stage, op, done) {
  stage.innerHTML = `
    <div class="reh-wrap">
      <div class="sim-box field2d">
        <div class="grid-lines"></div>
        <div class="target fixture"><i></i></div>
        <div class="reticle"></div>
        <div class="hud-tl">Captures <b class="c-n">0</b> / 3</div>
        <div class="hud-tr c-time">50.0 s</div>
      </div>
      <aside class="cmd-panel">
        <span class="label">Backup operator</span>
        <div class="cmd hold">HOLD</div>
        <div class="align-state">Not aligned</div>
        <div class="pad5">
          <button class="btn" type="button" data-k="up" aria-label="Up">▲</button>
          <button class="btn" type="button" data-k="left" aria-label="Left">◀</button>
          <button class="btn cap-btn" type="button" data-k="act">Capture</button>
          <button class="btn" type="button" data-k="right" aria-label="Right">▶</button>
          <button class="btn" type="button" data-k="down" aria-label="Down">▼</button>
        </div>
      </aside>
    </div>`;
  const box = $('.field2d', stage), tgt = $('.target', stage), ret = $('.reticle', stage);
  const cmd = $('.cmd', stage), al = $('.align-state', stage);
  const TOL = 0.055, SPEED = 0.36, WINDOW = 2500, LIMIT = 50000, NEED = 3;
  const S = { t0: 0, x: 0.2, y: 0.5, tx: 0.5, ty: 0.5, p1: 0, p2: 0, cmd: 'hold', alignedFor: 0, goAt: null, shownAt: 0, cool: 0,
    rts: [], premature: 0, missed: 0, off: 0, keys: { left: false, right: false, up: false, down: false } };
  const setCmd = (k) => { S.cmd = k; cmd.textContent = k === 'hold' ? 'HOLD' : 'CAPTURE'; cmd.className = `cmd ${k}`; };
  const aspect = () => box.clientWidth / Math.max(1, box.clientHeight);
  const dist = () => Math.hypot((S.x - S.tx) * aspect(), S.y - S.ty) / aspect();
  const render = (aligned) => {
    tgt.style.left = `${S.tx * 100}%`; tgt.style.top = `${S.ty * 100}%`;
    ret.style.left = `${S.x * 100}%`; ret.style.top = `${S.y * 100}%`;
    ret.classList.toggle('aligned', aligned);
    al.textContent = aligned ? 'Aligned on the grapple fixture' : 'Not aligned';
    al.classList.toggle('on', aligned);
    $('.c-n', stage).textContent = S.rts.length;
  };
  const L = loop((now, dt) => {
    const t = (now - S.t0) / 1000;
    if (now > S.cool) {
      S.tx = 0.5 + 0.30 * Math.sin(0.33 * t + S.p1) + 0.06 * Math.sin(1.05 * t + S.p2);
      S.ty = 0.5 + 0.26 * Math.sin(0.27 * t + S.p2) + 0.05 * Math.sin(0.85 * t + S.p1);
    }
    const dx = (S.keys.right ? 1 : 0) - (S.keys.left ? 1 : 0);
    const dy = (S.keys.down ? 1 : 0) - (S.keys.up ? 1 : 0);
    S.x = clamp(S.x + dx * SPEED * dt / aspect() * 1.6, 0.04, 0.96);
    S.y = clamp(S.y + dy * SPEED * dt, 0.06, 0.94);
    const aligned = dist() < TOL;
    if (S.cmd === 'hold') {
      S.alignedFor = aligned ? S.alignedFor + dt : 0;
      if (S.goAt === null && S.alignedFor >= 0.8) S.goAt = now + rand(600, 1600);
      if (S.goAt !== null && now >= S.goAt) { S.goAt = null; S.shownAt = now; setCmd('go'); }
    } else if (now - S.shownAt > WINDOW) {
      S.missed++; S.alignedFor = 0; setCmd('hold');
      toast('CAPTURE window missed');
    }
    const left = LIMIT - (now - S.t0);
    $('.c-time', stage).textContent = `${Math.max(0, left / 1000).toFixed(1)} s`;
    render(aligned);
    if (left <= 0) { finish(); return false; }
    return true;
  });
  function act() {
    if (!L.on) return;
    const aligned = dist() < TOL;
    if (S.cmd === 'hold') { S.premature++; toast('Premature capture: wait for the CAPTURE call'); return; }
    if (!aligned) { S.off++; toast('CAPTURE was called, but you were off the fixture'); return; }
    S.rts.push(performance.now() - S.shownAt);
    setCmd('hold'); S.alignedFor = 0; S.goAt = null;
    box.classList.add('flash'); setTimeout(() => box.classList.remove('flash'), 350);
    if (S.rts.length >= NEED) { finish(); return; }
    // the next free-flyer drifts in from a new position
    S.p1 += rand(1.5, 3); S.p2 += rand(1.5, 3); S.cool = performance.now() + 400;
  }
  function finish() {
    L.stop();
    const valid = S.rts.length >= 2;
    done({
      metric: valid ? Math.round(median(S.rts)) : NaN, valid,
      extras: [['Captures', `${S.rts.length} / ${NEED}`, S.rts.length < NEED], ['Premature captures', S.premature, S.premature > 0],
        ['Missed CAPTURE windows', S.missed, S.missed > 0], ['Captures off target', S.off, S.off > 0]],
      flags: { premature: S.premature, missed: S.missed, off: S.off },
    });
  }
  function start() {
    Object.assign(S, { t0: performance.now(), x: Math.random() < 0.5 ? 0.12 : 0.88, y: rand(0.2, 0.8), p1: rand(0, 6.28), p2: rand(0, 6.28),
      alignedFor: 0, goAt: null, cool: 0, rts: [], premature: 0, missed: 0, off: 0 });
    setCmd('hold');
    if (document.activeElement) document.activeElement.blur();
    L.start();
  }
  overlay(box, 'Start capture', start);
  render(false);
  $$('.pad5 [data-k]', stage).forEach((b) => {
    const k = b.dataset.k;
    if (k === 'act') { b.addEventListener('pointerdown', (e) => { e.preventDefault(); act(); }); return; }
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); S.keys[k] = true; b.setPointerCapture(e.pointerId); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, () => { S.keys[k] = false; }));
  });
  const KEYMAP = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down' };
  return {
    stop: () => L.stop(), running: () => L.on,
    key(e, down) {
      if (KEYMAP[e.key]) { S.keys[KEYMAP[e.key]] = down; return L.on; }
      if (down && e.code === 'Space' && L.on) { if (!e.repeat) act(); return true; }
      return false;
    },
  };
}

// ---------------------------------------------------------
// 2. Docking monitor — vigilance on three indicators
// ---------------------------------------------------------
function monitorCheck(stage, op, done) {
  const G = op.gauges;
  const ROUND = 30000, REACT = 3000;
  stage.innerHTML = `
    <div class="sim-box">
      <div class="gauges">${G.map((g, i) => `
        <div class="gauge">
          <div class="gauge-name">${esc(g.name)}<br>(${esc(g.unit)})</div>
          <div class="gauge-bar"><div class="gauge-band"></div><div class="gauge-needle"></div></div>
          <div class="gauge-val">—</div>
          <button class="btn" type="button" data-flag="${i}">Flag</button>
          <span class="gauge-key">key ${i + 1}</span>
        </div>`).join('')}
      </div>
    </div>
    <div class="seq-status under"><span class="m-time">30.0 s</span><span class="m-score">Caught 0 · Missed 0 · False flags 0</span></div>`;
  const box = $('.sim-box', stage);
  const els = $$('.gauge', stage).map((el, i) => {
    const g = G[i];
    const pct = (v) => 100 - ((v - g.min) / (g.max - g.min)) * 100;
    const band = $('.gauge-band', el);
    band.style.top = `${pct(g.hi)}%`;
    band.style.height = `${pct(g.lo) - pct(g.hi)}%`;
    return { el, needle: $('.gauge-needle', el), val: $('.gauge-val', el), pct };
  });
  const S = { t0: 0, v: [], target: [], drift: -1, outAt: 0, nextAt: 0, caught: 0, missed: 0, falses: 0, rts: [], ack: new Set() };
  const isOut = (i) => S.v[i] < G[i].lo || S.v[i] > G[i].hi;
  const reset = () => {
    S.v = G.map((g) => (g.lo + g.hi) / 2); S.target = [...S.v];
    S.drift = -1; S.outAt = 0; S.caught = S.missed = S.falses = 0; S.rts = []; S.ack.clear();
  };
  const draw = () => {
    els.forEach((e, i) => {
      const g = G[i], v = S.v[i];
      e.needle.style.top = `${e.pct(v)}%`;
      e.val.textContent = `${v >= 0 && g.min < 0 ? '+' : ''}${v.toFixed(g.dec)}`;
      e.el.classList.toggle('out', (v < g.lo || v > g.hi) && !S.ack.has(i));
      e.el.classList.toggle('acked', S.ack.has(i));
    });
    $('.m-score', stage).textContent = `Caught ${S.caught} · Missed ${S.missed} · False flags ${S.falses}`;
  };
  const endExcursion = (now) => {
    const g = G[S.drift];
    S.target[S.drift] = (g.lo + g.hi) / 2;
    S.ack.add(S.drift);               // handled: the needle returns to its band, no more flags expected
    S.drift = -1; S.outAt = 0; S.nextAt = now + rand(2500, 4500);
  };
  const L = loop((now, dt) => {
    G.forEach((g, i) => {
      if (i !== S.drift && !S.ack.has(i) && Math.random() < dt * 0.8) S.target[i] = g.lo + (g.hi - g.lo) * rand(0.2, 0.8);
      S.v[i] += (S.target[i] - S.v[i]) * Math.min(1, dt * (S.ack.has(i) ? 2.4 : 1.6));
      if (S.ack.has(i) && !isOut(i)) S.ack.delete(i);
    });
    if (S.drift < 0 && !S.ack.size && now >= S.nextAt && now - S.t0 < ROUND - REACT - 1500) {
      S.drift = Math.floor(Math.random() * G.length);
      const g = G[S.drift];
      S.target[S.drift] = Math.random() < 0.5 ? g.hi + (g.max - g.hi) * 0.7 : g.lo - (g.lo - g.min) * 0.7;
      S.outAt = 0;
    }
    if (S.drift >= 0) {
      const g = G[S.drift], v = S.v[S.drift];
      if ((v < g.lo || v > g.hi) && !S.outAt) S.outAt = now;
      if (S.outAt && now - S.outAt > REACT) { S.missed++; toast(`${g.name} out of range was not flagged`); endExcursion(now); }
    }
    const left = ROUND - (now - S.t0);
    $('.m-time', stage).textContent = `${Math.max(0, left / 1000).toFixed(1)} s`;
    draw();
    if (left <= 0) { finish(); return false; }
    return true;
  });
  function flag(i) {
    if (!L.on) return;
    const g = G[i], v = S.v[i];
    if (S.ack.has(i)) return;          // already handled, returning to range
    if (i === S.drift && (v < g.lo || v > g.hi) && S.outAt) {
      S.caught++; S.rts.push(performance.now() - S.outAt); endExcursion(performance.now());
    } else { S.falses++; toast(`${g.name} is still in range: false flag`); }
    draw();
  }
  function finish() {
    L.stop();
    if (S.drift >= 0 && S.outAt) S.missed++;
    const valid = S.caught >= 2;
    done({
      metric: valid ? Math.round(median(S.rts)) : NaN, valid,
      extras: [['Excursions caught', `${S.caught} / ${S.caught + S.missed}`, S.missed > 0], ['Missed excursions', S.missed, S.missed > 0], ['False flags', S.falses, S.falses > 1]],
      flags: { missed: S.missed, falses: S.falses },
    });
  }
  reset(); draw();
  overlay(box, 'Start final approach (30 s)', () => {
    reset(); S.t0 = performance.now(); S.nextAt = S.t0 + rand(2500, 4500);
    if (document.activeElement) document.activeElement.blur();
    L.start();
  });
  $$('[data-flag]', stage).forEach((b) => b.addEventListener('click', () => flag(+b.dataset.flag)));
  return {
    stop: () => L.stop(), running: () => L.on,
    key(e, down) {
      if (!L.on || !down) return false;
      const n = ['1', '2', '3'].indexOf(e.key);
      if (n >= 0) { if (!e.repeat) flag(n); return true; }
      return false;
    },
  };
}

// ---------------------------------------------------------
// 3. Solar array EVA — bolt order from memory + torque window
// ---------------------------------------------------------
function torqueCheck(stage, op, done) {
  const POINTS = ['A', 'B', 'C', 'D'];
  const MEMO = 4000, RATE = 38, LIMIT = 75000;   // torque rises RATE % of scale per second
  stage.innerHTML = `
    <div class="sim-box eva">
      <div class="eva-order"><span class="label">Bolt order</span><b class="o-seq">— → — → — → —</b><div class="timer-bar"><div></div></div></div>
      <div class="truss">
        <div class="truss-beam"></div>
        <div class="array-wing"></div>
        ${POINTS.map((p) => `<button class="ap" type="button" data-p="${p}" disabled><span>${p}</span></button>`).join('')}
      </div>
      <div class="torque">
        <div class="torque-head"><span class="label">Torque · <b class="t-bolt">pick an attach point</b></span><span class="t-val">0%</span></div>
        <div class="torque-track"><div class="torque-win"></div><div class="torque-fill"></div><div class="torque-tick"></div></div>
        <button class="btn btn-outline hold-btn" type="button" disabled>Hold to drive the bolt</button>
      </div>
      <div class="seq-status"><span class="t-done">Bolts 0 / 4</span><span class="t-err">Order errors 0</span><span class="t-time">75 s</span></div>
    </div>`;
  const box = $('.eva', stage), holdBtn = $('.hold-btn', stage);
  const S = { order: [], idx: 0, active: null, win: 0, torque: 0, holding: false, holdT: 0, errors: [], seqErr: 0, outCount: 0, t0: 0, phase: 'idle', memoT: 0 };
  // torque grows with the time the tool is held (wall clock), slightly accelerating
  const torqueAt = (now) => { const t = (now - S.holdT) / 1000; return RATE * t + 7 * t * t; };
  const setTorque = (v) => {
    S.torque = v;
    $('.torque-fill', stage).style.width = `${clamp(v, 0, 100)}%`;
    $('.torque-tick', stage).style.left = `${clamp(v, 0, 100)}%`;
    $('.t-val', stage).textContent = `${Math.round(v)}%`;
  };
  const setWindow = (c) => {
    S.win = c;
    const w = $('.torque-win', stage);
    w.style.left = `${c - 4}%`; w.style.width = '8%';
  };
  const L = loop((now, dt) => {
    if (S.phase === 'memo') {
      const p = Math.min(1, (now - S.memoT) / MEMO);
      $('.eva-order .timer-bar > div', stage).style.width = `${(1 - p) * 100}%`;
      if (p >= 1) {
        S.phase = 'work';
        $('.o-seq', stage).textContent = 'Hidden: work from memory';
        $('.eva-order', stage).classList.add('hidden-order');
        $$('.ap', stage).forEach((b) => { b.disabled = false; });
      }
    }
    if (S.phase === 'work' && S.holding && S.active) {
      setTorque(torqueAt(now));
      if (S.torque >= 100) release();
    }
    const left = LIMIT - (now - S.t0);
    $('.t-time', stage).textContent = `${Math.max(0, Math.ceil(left / 1000))} s`;
    if (left <= 0) { finish(); return false; }
    return true;
  });
  function choosePoint(b) {
    if (S.phase !== 'work' || S.active || b.classList.contains('done')) return;
    const p = b.dataset.p;
    if (p !== S.order[S.idx]) {
      S.seqErr++;
      $('.t-err', stage).textContent = `Order errors ${S.seqErr}`;
      b.classList.remove('wrong'); void b.offsetWidth; b.classList.add('wrong');
      toast(`Attach point ${p} is not next in the order`);
      return;
    }
    S.active = b;
    b.classList.add('active');
    setTorque(0);
    setWindow(Math.round(rand(52, 82)));
    $('.t-bolt', stage).textContent = `bolt ${p}`;
    holdBtn.disabled = false;
    holdBtn.focus({ preventScroll: true });
  }
  function press() { if (S.active && !S.holding) { S.holding = true; S.holdT = performance.now(); setTorque(0); holdBtn.classList.add('pressed'); } }
  function release() {
    if (!S.holding || !S.active) return;
    S.holding = false; holdBtn.classList.remove('pressed');
    setTorque(Math.min(100, torqueAt(performance.now())));
    const err = Math.abs(S.torque - S.win);
    const inWin = err <= 4;
    if (!inWin) S.outCount++;
    S.errors.push(err);
    const b = S.active;
    b.classList.remove('active'); b.classList.add('done', inWin ? 'good' : 'warn');
    b.title = `${Math.round(S.torque)}% (window ${S.win - 4}–${S.win + 4}%)`;
    toast(inWin ? `Bolt ${b.dataset.p}: ${Math.round(S.torque)}%, in the window` : `Bolt ${b.dataset.p}: ${Math.round(S.torque)}%, ${S.torque > S.win ? 'over' : 'under'}-torqued`);
    S.active = null; S.idx++;
    holdBtn.disabled = true;
    $('.t-bolt', stage).textContent = S.idx < 4 ? 'pick the next attach point' : 'done';
    $('.t-done', stage).textContent = `Bolts ${S.idx} / 4`;
    if (S.idx >= 4) finish();
  }
  function finish() {
    L.stop(); S.holding = false;
    const valid = S.errors.length >= 3;
    done({
      metric: valid ? S.errors.reduce((a, b) => a + b, 0) / S.errors.length : NaN, valid,
      extras: [['Bolts driven', `${S.errors.length} / 4`, S.errors.length < 4], ['Bolt order errors', S.seqErr, S.seqErr > 0], ['Bolts outside window', S.outCount, S.outCount > 0]],
      flags: { seq: S.seqErr, out: S.outCount },
    });
  }
  function start() {
    Object.assign(S, { order: shuffle(POINTS), idx: 0, active: null, errors: [], seqErr: 0, outCount: 0, t0: performance.now(), phase: 'memo', memoT: performance.now() });
    $('.o-seq', stage).textContent = S.order.join(' → ');
    L.start();
  }
  overlay(box, 'Show the bolt order', start, 'You will see the order for 4 seconds.');
  $$('.ap', stage).forEach((b) => b.addEventListener('click', () => choosePoint(b)));
  holdBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); holdBtn.setPointerCapture(e.pointerId); });
  ['pointerup', 'pointercancel'].forEach((ev) => holdBtn.addEventListener(ev, () => release()));
  return {
    stop: () => { L.stop(); S.holding = false; }, running: () => L.on,
    key(e, down) {
      if (!L.on || e.code !== 'Space') return false;
      if (down && !e.repeat) press(); else if (!down) release();
      return true;
    },
  };
}

// ---------------------------------------------------------
// 4. Water recovery — unit ID among look-alikes
// ---------------------------------------------------------
const LOOKALIKE = { 8: 'B', B: '8', 0: 'O', O: '0', 1: 'I', I: '1', 5: 'S', S: '5', 2: 'Z', Z: '2', 6: 'G', G: '6' };
const CODE_CHARS = '0123456789ABCDEFGHJKLMNPRSTUVXZ'.split('');
function verifyCheck(stage, op, done) {
  const TRIALS = 6, LIMIT = 6000;
  const S = { trial: 0, errors: 0, timeouts: 0, times: [], on: false, t0: 0, timer: 0, raf: 0 };
  const makeCode = () => {
    const pool = Object.keys(LOOKALIKE);
    let body = '';
    for (let i = 0; i < 4; i++) body += i < 2 ? pick(pool) : pick(CODE_CHARS);
    return pick(op.prefixes) + shuffle(body.split('')).join('');
  };
  const variants = (code) => {
    const prefix = code.slice(0, code.indexOf('-') + 1), body = code.slice(prefix.length).split('');
    const set = new Set([code]);
    let guard = 0;
    while (set.size < 4 && guard++ < 60) {
      const b = [...body];
      const idx = b.map((ch, i) => (LOOKALIKE[ch] ? i : -1)).filter((i) => i >= 0);
      if (idx.length && Math.random() < 0.75) { const i = pick(idx); b[i] = LOOKALIKE[b[i]]; }
      else { const i = Math.floor(Math.random() * (b.length - 1)); [b[i], b[i + 1]] = [b[i + 1], b[i]]; }
      set.add(prefix + b.join(''));
    }
    return shuffle([...set]);
  };
  function nextTrial() {
    clearTimeout(S.timer); cancelAnimationFrame(S.raf);
    if (S.trial >= TRIALS) { finish(); return; }
    const code = makeCode(), opts = variants(code);
    stage.innerHTML = `
      <div class="sim-box seq-card rack">
        <div class="seq-status"><span>Work order ${S.trial + 1} of ${TRIALS}</span><span>Wrong units: ${S.errors}</span></div>
        <div class="ref"><span>Work order: replace unit</span><b>${code}</b></div>
        <div class="timer-bar"><div></div></div>
        <div class="units">${opts.map((o, i) => `
          <button class="unit" type="button" data-c="${o}"><span class="unit-slot">Rack slot ${i + 1}</span><span class="unit-plate">${o}</span><span class="unit-leds"><i></i><i></i><i></i></span></button>`).join('')}
        </div>
      </div>`;
    S.t0 = performance.now();
    const bar = $('.timer-bar > div', stage);
    const tick = () => { const p = Math.min(1, (performance.now() - S.t0) / LIMIT); bar.style.width = `${(1 - p) * 100}%`; if (p < 1 && S.on) S.raf = requestAnimationFrame(tick); };
    tick();
    S.timer = setTimeout(() => { S.timeouts++; S.errors++; toast('Time is up for this work order'); S.trial++; nextTrial(); }, LIMIT);
    $$('.unit', stage).forEach((b) => b.addEventListener('click', () => {
      if (!S.on || b.disabled) return;
      clearTimeout(S.timer); cancelAnimationFrame(S.raf);
      const ok = b.dataset.c === code;
      S.times.push(performance.now() - S.t0);
      if (!ok) S.errors++;
      b.classList.add(ok ? 'right' : 'wrong');
      if (!ok) $$('.unit', stage).find((x) => x.dataset.c === code).classList.add('right');
      $$('.unit', stage).forEach((x) => { x.disabled = true; });
      S.trial++;
      S.timer = setTimeout(nextTrial, ok ? 450 : 1300);
    }));
  }
  function finish() {
    S.on = false;
    const valid = S.times.length >= 4;
    done({
      metric: valid ? Math.round(median(S.times)) : NaN, valid,
      extras: [['Correct units', `${TRIALS - S.errors} / ${TRIALS}`, S.errors > 0], ['Wrong units', S.errors - S.timeouts, S.errors - S.timeouts > 0], ['Timed out', S.timeouts, S.timeouts > 0]],
      flags: { errors: S.errors },
    });
  }
  stage.innerHTML = '<div class="sim-box seq-card rack"></div>';
  overlay($('.sim-box', stage), `Open work orders (${TRIALS})`, () => { Object.assign(S, { trial: 0, errors: 0, timeouts: 0, times: [], on: true }); nextTrial(); });
  return { stop: () => { S.on = false; clearTimeout(S.timer); cancelAnimationFrame(S.raf); }, running: () => S.on, key: () => false };
}

// ---------------------------------------------------------
// 5. Emergency drill — alarm → module on the map → response
// ---------------------------------------------------------
const MODULES = [
  { id: 'columbus', name: 'Columbus', area: 'columbus' }, { id: 'kibo', name: 'Kibo', area: 'kibo' },
  { id: 'node2', name: 'Node 2 Harmony', area: 'node2' }, { id: 'lab', name: 'US Lab Destiny', area: 'lab' },
  { id: 'node1', name: 'Node 1 Unity', area: 'node1' }, { id: 'node3', name: 'Node 3 Tranquility', area: 'node3' },
  { id: 'zarya', name: 'Zarya', area: 'zarya' }, { id: 'zvezda', name: 'Zvezda', area: 'zvezda' },
];
const ALARMS = [
  { type: 'fire', label: 'FIRE', resp: 'ext' },
  { type: 'tox', label: 'TOXIC ATMOSPHERE', resp: 'mask' },
  { type: 'dep', label: 'RAPID DEPRESS', resp: 'hatch' },
];
const RESPONSES = [{ id: 'ext', label: 'Fire extinguisher' }, { id: 'mask', label: 'Emergency mask' }, { id: 'hatch', label: 'Close the hatch' }];
function triageCheck(stage, op, done) {
  const N = 6, LIMIT = 8000;
  stage.innerHTML = `
    <div class="sim-box drill">
      <div class="alarm idle"><span class="alarm-type">STANDBY</span><span class="alarm-mod">Waiting for the drill to start</span></div>
      <div class="iss-map">${MODULES.map((m) => `<button class="mod" type="button" style="grid-area:${m.area}" data-m="${m.id}">${m.name}</button>`).join('')}</div>
      <div class="responses">${RESPONSES.map((r) => `<button class="btn resp" type="button" data-r="${r.id}" disabled>${r.label}</button>`).join('')}</div>
      <div class="timer-bar"><div></div></div>
      <div class="seq-status"><span class="d-n">Alarm 0 / ${N}</span><span class="d-err">Wrong module 0 · Wrong response 0</span></div>
    </div>`;
  const box = $('.drill', stage), alarmEl = $('.alarm', stage);
  const S = { n: 0, cur: null, found: false, t0: 0, times: [], wrongModule: 0, wrongResp: 0, timeouts: 0, timer: 0, raf: 0, on: false };
  const status = () => {
    $('.d-n', stage).textContent = `Alarm ${Math.min(S.n, N)} / ${N}`;
    $('.d-err', stage).textContent = `Wrong module ${S.wrongModule} · Wrong response ${S.wrongResp}`;
  };
  function nextAlarm() {
    clearTimeout(S.timer); cancelAnimationFrame(S.raf);
    $$('.mod', stage).forEach((b) => b.classList.remove('hit', 'miss', 'target'));
    $$('.resp', stage).forEach((b) => { b.disabled = true; b.classList.remove('wrong'); });
    if (S.n >= N) { finish(); return; }
    alarmEl.className = 'alarm idle';
    $('.alarm-type', stage).textContent = 'ALL CLEAR';
    $('.alarm-mod', stage).textContent = 'Stand by…';
    S.timer = setTimeout(() => {
      if (!S.on) return;
      S.cur = { alarm: pick(ALARMS), mod: pick(MODULES) };
      S.found = false; S.n++; status();
      alarmEl.className = `alarm ${S.cur.alarm.type}`;
      $('.alarm-type', stage).textContent = S.cur.alarm.label;
      $('.alarm-mod', stage).textContent = S.cur.mod.name;
      S.t0 = performance.now();
      const bar = $('.timer-bar > div', stage);
      const tick = () => { const p = Math.min(1, (performance.now() - S.t0) / LIMIT); bar.style.width = `${(1 - p) * 100}%`; if (p < 1 && S.on) S.raf = requestAnimationFrame(tick); };
      tick();
      S.timer = setTimeout(() => { S.timeouts++; toast('Alarm timed out'); S.cur = null; nextAlarm(); }, LIMIT);
    }, rand(700, 1400));
  }
  function clickModule(b) {
    if (!S.on || !S.cur || S.found) return;
    if (b.dataset.m === S.cur.mod.id) {
      S.found = true; b.classList.add('hit');
      $$('.resp', stage).forEach((r) => { r.disabled = false; });
    } else {
      S.wrongModule++; status();
      b.classList.remove('miss'); void b.offsetWidth; b.classList.add('miss');
    }
  }
  function clickResp(b) {
    if (!S.on || !S.cur || !S.found) return;
    if (b.dataset.r === S.cur.alarm.resp) {
      S.times.push(performance.now() - S.t0);
      S.cur = null;
      toast('Correct first response');
      nextAlarm();
    } else {
      S.wrongResp++; status();
      b.classList.remove('wrong'); void b.offsetWidth; b.classList.add('wrong');
    }
  }
  function finish() {
    S.on = false;
    alarmEl.className = 'alarm idle';
    $('.alarm-type', stage).textContent = 'DRILL COMPLETE';
    $('.alarm-mod', stage).textContent = '';
    const valid = S.times.length >= 4;
    done({
      metric: valid ? Math.round(median(S.times)) : NaN, valid,
      extras: [['Alarms handled', `${S.times.length} / ${N}`, S.times.length < N], ['Wrong module', S.wrongModule, S.wrongModule > 0], ['Wrong response', S.wrongResp, S.wrongResp > 0], ['Timed out', S.timeouts, S.timeouts > 0]],
      flags: { wrongModule: S.wrongModule, wrongResp: S.wrongResp, timeouts: S.timeouts },
    });
  }
  overlay(box, 'Start the drill (6 alarms)', () => { Object.assign(S, { n: 0, times: [], wrongModule: 0, wrongResp: 0, timeouts: 0, on: true }); status(); nextAlarm(); });
  $$('.mod', stage).forEach((b) => b.addEventListener('click', () => clickModule(b)));
  $$('.resp', stage).forEach((b) => b.addEventListener('click', () => clickResp(b)));
  return { stop: () => { S.on = false; clearTimeout(S.timer); cancelAnimationFrame(S.raf); }, running: () => S.on, key: () => false };
}

// ---------------------------------------------------------
// 6. Ultrasound — pursuit tracking, save on the ground call
// ---------------------------------------------------------
function pursuitCheck(stage, op, done) {
  const NEED = 3, LIMIT = 45000, TOL = 0.075;
  stage.innerHTML = `
    <div class="reh-wrap">
      <div class="sim-box us-screen">
        <div class="us-fan"></div>
        <div class="us-vessel"></div>
        <div class="us-probe"></div>
        <div class="hud-tl">Images <b class="u-n">0</b> / 3</div>
        <div class="hud-tr u-time">45.0 s</div>
      </div>
      <aside class="cmd-panel">
        <span class="label">Ground sonographer</span>
        <div class="cmd hold">WAIT</div>
        <span class="label">Image quality</span>
        <div class="meter"><div></div></div>
        <div class="align-state u-on">On target 0%</div>
        <button class="btn cap-btn u-save" type="button">Save image</button>
      </aside>
    </div>`;
  const box = $('.us-screen', stage), ves = $('.us-vessel', stage), probe = $('.us-probe', stage), cmd = $('.cmd', stage);
  const S = { t0: 0, x: 0.5, y: 0.5, vx: 0.5, vy: 0.5, p1: 0, p2: 0, q: 0, cmd: 'hold', on: 0, total: 0, saved: 0, early: 0, lost: 0, keys: {}, usePointer: false };
  const setCmd = (k) => { S.cmd = k; cmd.textContent = k === 'hold' ? 'WAIT' : 'SAVE'; cmd.className = `cmd ${k}`; };
  const L = loop((now, dt) => {
    const t = (now - S.t0) / 1000;
    S.vx = 0.5 + 0.28 * Math.sin(0.41 * t + S.p1) + 0.07 * Math.sin(1.37 * t + S.p2);
    S.vy = 0.55 + 0.22 * Math.sin(0.53 * t + S.p2) + 0.06 * Math.sin(1.11 * t);
    if (!S.usePointer) {
      const dx = (S.keys.right ? 1 : 0) - (S.keys.left ? 1 : 0), dy = (S.keys.down ? 1 : 0) - (S.keys.up ? 1 : 0);
      S.x = clamp(S.x + dx * 0.45 * dt, 0.03, 0.97); S.y = clamp(S.y + dy * 0.45 * dt, 0.05, 0.95);
    }
    const asp = box.clientWidth / Math.max(1, box.clientHeight);
    const onT = Math.hypot((S.x - S.vx) * asp, S.y - S.vy) / asp < TOL;
    S.total += dt; if (onT) S.on += dt;
    S.q = clamp(S.q + (onT ? 0.42 : -0.55) * dt, 0, 1);
    if (S.cmd === 'hold' && S.q >= 1) setCmd('go');
    if (S.cmd === 'go' && S.q < 0.55) { setCmd('hold'); S.lost++; toast('Image lost before saving'); }
    ves.style.left = `${S.vx * 100}%`; ves.style.top = `${S.vy * 100}%`;
    probe.style.left = `${S.x * 100}%`; probe.style.top = `${S.y * 100}%`;
    probe.classList.toggle('on', onT);
    $('.meter > div', stage).style.width = `${S.q * 100}%`;
    $('.u-on', stage).textContent = `On target ${Math.round((S.on / Math.max(0.01, S.total)) * 100)}%`;
    const left = LIMIT - (now - S.t0);
    $('.u-time', stage).textContent = `${Math.max(0, left / 1000).toFixed(1)} s`;
    if (left <= 0) { finish(); return false; }
    return true;
  });
  function save() {
    if (!L.on) return;
    if (S.cmd !== 'go') { S.early++; toast('Not yet: wait for the SAVE call'); return; }
    S.saved++; S.q = 0; setCmd('hold');
    $('.u-n', stage).textContent = S.saved;
    box.classList.add('flash'); setTimeout(() => box.classList.remove('flash'), 300);
    if (S.saved >= NEED) finish();
  }
  function finish() {
    L.stop();
    const valid = S.total >= 8;
    done({
      metric: valid ? (S.on / S.total) * 100 : NaN, valid,
      extras: [['Images saved', `${S.saved} / ${NEED}`, S.saved < NEED], ['Saves before the call', S.early, S.early > 0], ['Images lost before saving', S.lost, S.lost > 1]],
      flags: { early: S.early, lost: S.lost },
    });
  }
  box.addEventListener('pointermove', (e) => {
    if (!L.on) return;
    const r = box.getBoundingClientRect();
    S.usePointer = true;
    S.x = clamp((e.clientX - r.left) / r.width, 0.03, 0.97);
    S.y = clamp((e.clientY - r.top) / r.height, 0.05, 0.95);
  });
  box.addEventListener('pointerdown', (e) => { if (L.on && e.pointerType !== 'mouse') e.preventDefault(); });
  $('.u-save', stage).addEventListener('click', save);
  overlay(box, 'Start the scan', () => {
    Object.assign(S, { t0: performance.now(), x: 0.15, y: 0.3, p1: rand(0, 6.28), p2: rand(0, 6.28), q: 0, on: 0, total: 0, saved: 0, early: 0, lost: 0, usePointer: false });
    setCmd('hold');
    L.start();
  });
  const KEYMAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  return {
    stop: () => L.stop(), running: () => L.on,
    key(e, down) {
      if (KEYMAP[e.key]) { S.keys[KEYMAP[e.key]] = down; if (down) S.usePointer = false; return L.on; }
      if (down && e.code === 'Space' && L.on) { if (!e.repeat) save(); return true; }
      return false;
    },
  };
}

// ---------------------------------------------------------
// 7. Microgravity experiment — sample tray working memory
// ---------------------------------------------------------
function trayCheck(stage, op, done) {
  const ROUNDS = 2, PER = 3, STUDY = 6000, LIMIT = 7000, COLS = 4, ROWS = 3;
  const slotName = (i) => `${'ABCD'[i % COLS]}${Math.floor(i / COLS) + 1}`;
  const S = { round: 0, codes: [], asks: [], ask: 0, correct: 0, errors: 0, timeouts: 0, times: [], t0: 0, timer: 0, raf: 0, on: false, phase: 'idle' };
  const makeCodes = () => {
    const set = new Set();
    while (set.size < COLS * ROWS) set.add(`${pick('123456789')}${pick('ABCDEFHKMNPRTX')}`);
    return [...set];
  };
  function render(showCodes) {
    stage.innerHTML = `
      <div class="sim-box seq-card glovebox">
        <div class="seq-status"><span>Tray ${S.round + 1} of ${ROUNDS}</span><span class="tr-phase"></span><span>Correct ${S.correct} · Wrong ${S.errors}</span></div>
        <div class="record"><span class="label">Experiment record</span><b class="tr-ask">Study the tray</b></div>
        <div class="timer-bar"><div></div></div>
        <div class="tray">${S.codes.map((c, i) => `
          <button class="slot${showCodes ? ' open' : ''}" type="button" data-i="${i}" ${showCodes ? 'disabled' : ''}>
            <span class="slot-id">${slotName(i)}</span><span class="vial">${showCodes ? `SMP-${c}` : ''}</span>
          </button>`).join('')}
        </div>
      </div>`;
    $$('.slot', stage).forEach((b) => b.addEventListener('click', () => answer(b)));
  }
  const runTimer = (ms, onEnd) => {
    S.t0 = performance.now();
    const bar = $('.timer-bar > div', stage);
    const tick = () => { const p = Math.min(1, (performance.now() - S.t0) / ms); bar.style.width = `${(1 - p) * 100}%`; if (p < 1 && S.on) S.raf = requestAnimationFrame(tick); };
    tick();
    S.timer = setTimeout(onEnd, ms);
  };
  function startRound() {
    S.codes = makeCodes();
    S.asks = shuffle(S.codes.map((c, i) => i)).slice(0, PER);
    S.ask = 0; S.phase = 'study';
    render(true);
    $('.tr-phase', stage).textContent = 'Memorise';
    runTimer(STUDY, () => { S.phase = 'recall'; render(false); nextAsk(); });
  }
  function nextAsk() {
    clearTimeout(S.timer); cancelAnimationFrame(S.raf);
    if (S.ask >= PER) {
      S.round++;
      if (S.round >= ROUNDS) { finish(); return; }
      S.timer = setTimeout(startRound, 900);
      return;
    }
    $$('.slot', stage).forEach((b) => { b.disabled = false; });
    $('.tr-phase', stage).textContent = `Sample ${S.ask + 1} of ${PER}`;
    $('.tr-ask', stage).textContent = `Transfer SMP-${S.codes[S.asks[S.ask]]}`;
    runTimer(LIMIT, () => { S.timeouts++; S.errors++; reveal(null); });
  }
  function reveal(clicked) {
    clearTimeout(S.timer); cancelAnimationFrame(S.raf);
    const target = S.asks[S.ask];
    const tb = $(`.slot[data-i="${target}"]`, stage);
    tb.classList.add('open', 'right'); $('.vial', tb).textContent = `SMP-${S.codes[target]}`;
    if (clicked && clicked !== tb) { clicked.classList.add('open', 'wrong'); $('.vial', clicked).textContent = `SMP-${S.codes[+clicked.dataset.i]}`; }
    $$('.slot', stage).forEach((b) => { b.disabled = true; });
    S.ask++;
    S.timer = setTimeout(() => {
      $$('.slot', stage).forEach((b) => { b.classList.remove('open', 'right', 'wrong'); $('.vial', b).textContent = ''; });
      nextAsk();
    }, clicked === tb ? 600 : 1300);
  }
  function answer(b) {
    if (!S.on || S.phase !== 'recall' || b.disabled) return;
    S.times.push(performance.now() - S.t0);
    if (+b.dataset.i === S.asks[S.ask]) S.correct++; else S.errors++;
    reveal(b);
  }
  function finish() {
    S.on = false;
    const total = ROUNDS * PER;
    done({
      metric: (S.correct / total) * 100, valid: true,
      extras: [['Samples found', `${S.correct} / ${total}`, S.correct < total], ['Wrong slots', S.errors - S.timeouts, S.errors - S.timeouts > 0],
        ['Timed out', S.timeouts, S.timeouts > 0], ['Median time per sample', S.times.length ? `${(median(S.times) / 1000).toFixed(1)} s` : '—', false]],
      flags: { errors: S.errors },
    });
  }
  stage.innerHTML = '<div class="sim-box seq-card glovebox"></div>';
  overlay($('.sim-box', stage), 'Open the sample tray', () => { Object.assign(S, { round: 0, correct: 0, errors: 0, timeouts: 0, times: [], on: true }); startRound(); }, 'You will have 6 seconds to memorise 12 samples.');
  return { stop: () => { S.on = false; clearTimeout(S.timer); cancelAnimationFrame(S.raf); }, running: () => S.on, key: () => false };
}

const CHECKS = { capture: captureCheck, monitor: monitorCheck, torque: torqueCheck, verify: verifyCheck, triage: triageCheck, pursuit: pursuitCheck, tray: trayCheck };

// =========================================================
// Baseline & rule
// =========================================================
function computeBaseline(history) {
  const valid = history.filter((h) => Number.isFinite(h.metric));
  state.baselineCount = Math.min(valid.length, BASELINE_N);
  if (valid.length < BASELINE_N) { state.baseline = null; return; }
  const last = valid.slice(-BASELINE_N);
  state.baseline = {
    metric: median(last.map((h) => h.metric)),
    sleep: Math.round(median(last.map((h) => h.sleep))),
    sleepy: median(last.map((h) => h.sleepy)),
  };
}
function useSimulatedBaseline() {
  const c = state.op.crew;
  computeBaseline(c.base.map((m, i) => ({ metric: m, sleep: CREW_SLEEP.base[i], sleepy: CREW_SLEEP.baseSleepy[i] })));
  state.baselineSimulated = true;
}

function evaluate(today, base) {
  if (!base || !today.valid) return null;
  const m = state.op.metric;
  const worse = m.better === 'lower' ? (today.metric - base.metric) / base.metric : (base.metric - today.metric) / base.metric;
  const sleepLost = base.sleep - today.sleep;
  const c = { worse: worse >= RULE.worse, sleep: sleepLost >= RULE.sleepLostMin, sleepy: today.sleepy >= RULE.sleepy };
  return { worse, sleepLost, c, flag: c.worse && (c.sleep || c.sleepy) };
}

// =========================================================
// Results
// =========================================================
function renderResults() {
  const t = state.today, b = state.baseline, o = state.op, m = o.metric;
  if (!t) return;
  const v = $('#verdict');
  const ev = state.evaluation = evaluate(t, b);
  $('#resBanner').textContent = t.recorded
    ? 'Simulated crew data: five previous checks and today\'s recorded check'
    : 'Your check today, compared with a simulated crew member\'s five previous checks';

  if (!t.valid) {
    v.className = 'verdict retry';
    v.innerHTML = `<h3>Repeat the check</h3><p>Not enough of the check was completed to give a reliable ${esc(m.label.toLowerCase())}. Stay on the tab and finish the task.</p>`;
  } else if (!b) {
    v.className = 'verdict';
    v.innerHTML = `<h3>${esc(m.label)}: ${esc(m.fmt(t.metric))}</h3><p>Your baseline for this mission is still forming: ${state.baselineCount} of ${BASELINE_N} checks on this device. The comparison appears after ${BASELINE_N} checks.</p>`;
  } else if (ev.flag) {
    const parts = [`${m.label.toLowerCase()} ${Math.round(ev.worse * 100)}% worse than usual`];
    if (ev.c.sleep) parts.push(`${fmtDur(ev.sleepLost)} less sleep`);
    if (ev.c.sleepy) parts.push(`sleepiness ${t.sleepy}/5`);
    v.className = 'verdict flag';
    v.innerHTML = `<h3>Review before task</h3><p>Today: ${esc(parts.join(', '))}. Discuss the result with your ${esc(o.partner)} before you <b>${esc(o.name.toLowerCase())}</b>.</p>`;
  } else {
    v.className = 'verdict ok';
    v.innerHTML = `<h3>No flagged changes</h3><p>Today's ${esc(m.label.toLowerCase())} is close to your usual. Proceed with the standard procedure.</p>`;
  }

  const row = (label, today, usual, change, bad) =>
    `<tr><th scope="row">${label}</th><td>${today}</td><td>${usual}</td><td class="${bad ? 'delta-bad' : 'delta-ok'}">${change}</td></tr>`;
  const dash = '—';
  let html = '';
  if (b) {
    const dSleep = t.sleep - b.sleep;
    html += row('Sleep last night', fmtSleep(t.sleep), fmtSleep(b.sleep), dSleep === 0 ? 'same' : `${dSleep < 0 ? '−' : '+'}${fmtDur(dSleep)}`, ev && ev.c.sleep);
    html += row('Sleepiness', `${t.sleepy} / 5`, `${b.sleepy} / 5`, t.sleepy === b.sleepy ? 'same' : `${t.sleepy > b.sleepy ? '+' : '−'}${Math.abs(t.sleepy - b.sleepy)}`, ev && ev.c.sleepy);
    if (t.valid) {
      const pct = Math.round(ev.worse * 100);
      html += row(esc(m.label), esc(m.fmt(t.metric)), esc(m.fmt(b.metric)), pct === 0 ? 'same' : `${pct > 0 ? 'worse' : 'better'} by ${Math.abs(pct)}%`, ev.c.worse);
    } else html += row(esc(m.label), dash, esc(m.fmt(b.metric)), dash);
  } else {
    html += row('Sleep last night', fmtSleep(t.sleep), dash, dash);
    html += row('Sleepiness', `${t.sleepy} / 5`, dash, dash);
    html += row(esc(m.label), t.valid ? esc(m.fmt(t.metric)) : dash, dash, dash);
  }
  t.extras.forEach(([label, val, bad]) => { html += row(esc(label), esc(val), dash, dash, false).replace('<td>' + esc(val), `<td class="${bad ? 'delta-bad' : ''}">` + esc(val)); });
  $('#compareBody').innerHTML = html;

  $('#baselineHelp').hidden = !(t.valid && !b && state.mode === 'guest');
  const rule = $('#rulePanel');
  if (ev) {
    rule.hidden = false;
    rule.innerHTML = `<h4>Why this result${state.baselineSimulated ? ' · baseline is simulated' : ''}</h4><ul>
      <li class="${ev.c.worse ? 'met' : ''}">${esc(m.label)} at least ${RULE.worse * 100}% worse than usual</li>
      <li class="${ev.c.sleep ? 'met' : ''}">and at least ${RULE.sleepLostMin / 60} h less sleep than usual</li>
      <li class="${ev.c.sleepy ? 'met' : ''}">or sleepiness ${RULE.sleepy}–5 of 5</li></ul>
      <p>Demo thresholds for the hackathon scenario. The card explains what changed; the crew decides how to proceed.</p>`;
  } else rule.hidden = true;
}

$('#btnDemoBaseline').addEventListener('click', () => { useSimulatedBaseline(); renderResults(); toast('Simulated five-check baseline loaded'); });
$('#btnRepeat').addEventListener('click', () => go(runHash('check')));
$('#btnToPlan').addEventListener('click', () => go(runHash('plan')));

// =========================================================
// Plan — the suggested cross-check depends on the mission and on what went wrong
// =========================================================
function agreementText() {
  const o = state.op, f = (state.today && state.today.flags) || {}, P = o.partner;
  const flagged = state.evaluation && state.evaluation.flag;
  const tips = {
    cygnus: [
      [f.premature, `${cap(P)} calls CAPTURE aloud; I repeat "capture" before I grapple.`],
      [f.missed, `${cap(P)} counts the capture window down aloud so I don't miss it.`],
      [f.off, `${cap(P)} confirms alignment on the fixture at the moment of the CAPTURE call.`],
    ],
    docking: [
      [f.missed, `${cap(P)} reads every indicator aloud during the final approach; we call any value near its limit.`],
      [f.falses > 1, `Before flagging, I state the value and its limit; ${P} confirms it is out of range.`],
    ],
    solar: [
      [f.seq, `${cap(P)} reads the bolt order aloud before each bolt, and I repeat the attach-point letter.`],
      [f.out, `${cap(P)} reads the torque value back to me before I release the tool.`],
    ],
    water: [[f.errors, `I read the unit ID aloud character by character; ${P} checks it against the work order before I remove the unit.`]],
    drill: [
      [f.wrongModule, `${cap(P)} calls the module and its location; I repeat both before moving.`],
      [f.wrongResp, `We read the response card aloud: alarm type → first action.`],
      [f.timeouts, `${cap(P)} leads the first response; I follow and confirm each step.`],
    ],
    ultrasound: [
      [f.early, `${cap(P)} calls SAVE; I repeat "saving" before I press.`],
      [f.lost > 1, `I brace the probe hand and let the ${P} guide the position verbally before each image.`],
    ],
    experiment: [[f.errors, `Two-person check: ${P} reads the slot and the sample code; I confirm both before each transfer.`]],
  }[o.id] || [];
  const hit = tips.find(([cond]) => cond);
  if (hit) return hit[1];
  if (flagged) return `Keep the ${P} on the critical step today: ${o.step.toLowerCase()}.`;
  return `Standard procedure with the ${P}: ${o.step.toLowerCase()}.`;
}

function renderPlan() {
  $('#agreement').value = agreementText();
  $('#agreed').checked = false;
  $('#agreedLbl').textContent = `Discussed with the ${state.op.partner}`;
  renderSummary();
}

function renderSummary() {
  const t = state.today, b = state.baseline, ev = state.evaluation, o = state.op, m = o.metric;
  const L = [];
  L.push('CrewReady: pre-task check');
  L.push(`Mission: ${o.name}`);
  L.push(`Critical step: ${o.step}`);
  L.push(`Check: ${o.title} (${o.skill})`);
  L.push(`Profile: ${state.mode === 'crew' ? (t && t.recorded ? 'Crew member A, recorded check (simulated)' : 'Live check vs simulated crew history') : 'Live check'}${state.baselineSimulated && state.mode === 'guest' ? ', simulated baseline' : ''}`);
  if (t) {
    L.push(`Sleep: ${fmtSleep(t.sleep)}${b ? ` (usual ${fmtSleep(b.sleep)})` : ''}`);
    L.push(`Sleepiness: ${t.sleepy}/5${b ? ` (usual ${b.sleepy}/5)` : ''}`);
    L.push(`${m.label}: ${t.valid ? m.fmt(t.metric) : 'not enough data'}${b && ev ? ` (usual ${m.fmt(b.metric)}, ${ev.worse >= 0 ? 'worse' : 'better'} by ${Math.abs(Math.round(ev.worse * 100))}%)` : (t.valid ? ' (baseline forming)' : '')}`);
    t.extras.forEach(([label, val]) => L.push(`${label}: ${val}`));
  }
  L.push(`Result: ${ev ? (ev.flag ? 'REVIEW BEFORE TASK' : 'no flagged changes') : 'no comparison yet'}`);
  L.push(`Agreed step: ${$('#agreement').value.trim() || '—'}`);
  L.push(`Discussed with ${o.partner}: ${$('#agreed').checked ? 'yes' : 'not yet'}`);
  L.push('The crew decides whether and how to proceed.');
  $('#summary').textContent = L.join('\n');
}
$('#agreement').addEventListener('input', renderSummary);
$('#agreed').addEventListener('change', renderSummary);

$('#btnCopy').addEventListener('click', async () => {
  const text = $('#summary').textContent;
  try { await navigator.clipboard.writeText(text); toast('Summary copied'); }
  catch {
    const r = document.createRange();
    r.selectNodeContents($('#summary'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    toast('Press Ctrl+C to copy');
  }
});

// =========================================================
// Keyboard
// =========================================================
document.addEventListener('keydown', (e) => {
  if (!intro.el.hidden && !intro.done) {
    if (e.key === 'Escape' || e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); intro.close(); }
    return;
  }
  if (route.page !== 'run' || parseHash().step !== 'check' || !chk.current) return;
  if (e.target.matches && e.target.matches('input, textarea')) return;
  if (e.key === 'Escape' && chk.current.running()) { stopCheck(); startCheckPane(); toast('Check cancelled'); return; }
  if (chk.current.key(e, true)) e.preventDefault();
});
document.addEventListener('keyup', (e) => { if (chk.current) chk.current.key(e, false); });
window.addEventListener('blur', () => {
  if (!chk.current) return;
  ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's'].forEach((k) => chk.current.key({ key: k }, false));
  chk.current.key({ code: 'Space', key: ' ' }, false);
});

// =========================================================
// Boot
// =========================================================
(function boot() {
  let mode = 'guest';
  try { mode = localStorage.getItem('crewready.mode') || 'guest'; } catch { /* ignore */ }
  setMode(mode === 'crew' ? 'crew' : 'guest');
  resetRun(state.op);
  onRoute();
  let seen = false;
  try { seen = sessionStorage.getItem('crewready.introSeen') === '1'; } catch { /* ignore */ }
  if (seen || location.hash.length > 2) { intro.el.hidden = true; intro.done = true; }
  else intro.open();
})();
