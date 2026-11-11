import { createEphemeris, BODIES, dateToDays, daysToDate, AU_KM } from './ephem.js';
import { simulate, launchState, KMS } from './sim.js';
import { autoAim } from './solve.js';
import { PRESETS } from './presets.js';

const $ = id => document.getElementById(id);
if (!window.Astronomy) { $('loading').textContent = 'The planet library failed to load.'; throw new Error('Astronomy library missing'); }
const eph = createEphemeris(window.Astronomy);

const REACH = { mercury: 0.02, venus: 0.02, earth: 0.02, mars: 0.02, jupiter: 0.1, saturn: 0.1, uranus: 0.08, neptune: 0.08 };
const ORBIT_A = [0.387, 0.723, 1.0, 1.524, 5.203, 9.537, 19.19, 30.07];
const GIANTS = ['jupiter', 'saturn', 'uranus', 'neptune'];
const NAME = Object.fromEntries(BODIES.map(b => [b.id, b.name]));
const fmtDate = t => daysToDate(t).toISOString().slice(0, 10);
const km = au => Math.round(au * AU_KM).toLocaleString('en-US');
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };

const state = { t0: 0, vinf: 9, angle: 15, pitch: 5, burns: [], cursor: 0, playing: false, rate: 1, preset: PRESETS[0].id };
let res = null, speeds = [], dur = 1, egg = false;

// ---------- controls ----------
const refreshers = [];
let burnRefreshers = [];
function field(parent, o, list = refreshers) {
  const wrap = el('div', undefined, 'field'), id = 'f' + Math.random().toString(36).slice(2, 8);
  const lab = el('label', o.label); lab.htmlFor = id;
  const num = el('input'); num.type = 'number'; num.id = id; num.min = o.min; num.max = o.max; num.step = 'any';
  const rng = el('input'); rng.type = 'range'; rng.min = o.min; rng.max = o.max; rng.step = o.step; rng.setAttribute('aria-label', o.label);
  const digits = o.digits ?? 3;
  const show = () => { const v = o.get(); num.value = +v.toFixed(digits); rng.value = v; };
  num.addEventListener('input', () => { const v = parseFloat(num.value); if (Number.isFinite(v)) { o.set(Math.min(o.max, Math.max(o.min, v))); rng.value = o.get(); changed(); } });
  rng.addEventListener('input', () => { o.set(parseFloat(rng.value)); num.value = +o.get().toFixed(digits); changed(); });
  wrap.append(lab, num, rng); parent.append(wrap); list.push(show); show();
}

const D0 = dateToDays(new Date('1960-01-01T00:00:00Z')), D1 = dateToDays(new Date('2090-12-31T00:00:00Z'));
function dateField(parent) {
  const wrap = el('div', undefined, 'field'), lab = el('label', 'Launch date'), inp = el('input'), rng = el('input');
  lab.htmlFor = 'launchDate'; inp.id = 'launchDate'; inp.type = 'date'; inp.min = '1960-01-01'; inp.max = '2090-12-31';
  rng.type = 'range'; rng.min = D0; rng.max = D1; rng.step = 1; rng.setAttribute('aria-label', 'Launch date');
  const show = () => { inp.value = fmtDate(state.t0); rng.value = Math.round(state.t0); };
  inp.addEventListener('input', () => { const t = Date.parse(inp.value + 'T12:00:00Z'); if (Number.isFinite(t)) { state.t0 = Math.min(D1, Math.max(D0, t / 864e5)); rng.value = Math.round(state.t0); changed(); } });
  rng.addEventListener('input', () => { state.t0 = parseFloat(rng.value) + 0.5; inp.value = fmtDate(state.t0); changed(); });
  wrap.append(lab, inp, rng); parent.append(wrap); refreshers.push(show); show();
}

function buildLaunch() {
  const box = $('launch');
  dateField(box);
  field(box, { label: 'Speed leaving Earth (km/s)', min: 3, max: 14, step: 0.01, digits: 4, get: () => state.vinf, set: v => { state.vinf = v; } });
  field(box, { label: 'Direction, degrees left of Earth\'s motion', min: -60, max: 60, step: 0.1, digits: 3, get: () => state.angle, set: v => { state.angle = v; } });
  field(box, { label: 'Tilt out of the planets\' plane (deg)', min: -20, max: 20, step: 0.1, digits: 3, get: () => state.pitch, set: v => { state.pitch = v; } });
}

function renderBurns() {
  const box = $('burns'); box.replaceChildren(); burnRefreshers = [];
  state.burns.forEach((b, i) => {
    const row = el('div', undefined, 'burn'), head = el('div', undefined, 'head'), rm = el('button', 'Remove');
    rm.type = 'button'; rm.addEventListener('click', () => { state.burns.splice(i, 1); renderBurns(); changed(); });
    head.append(el('span', 'Correction ' + (i + 1)), rm); row.append(head);
    field(row, { label: 'Days after launch', min: 1, max: 9000, step: 1, digits: 1, get: () => b.after, set: v => { b.after = v; } }, burnRefreshers);
    field(row, { label: 'Along the path (m/s)', min: -500, max: 500, step: 1, digits: 2, get: () => b.pro, set: v => { b.pro = v; } }, burnRefreshers);
    field(row, { label: 'Sideways (m/s)', min: -500, max: 500, step: 1, digits: 2, get: () => b.norm, set: v => { b.norm = v; } }, burnRefreshers);
    box.append(row);
  });
  $('addBurn').disabled = state.burns.length >= 3;
  $('dvTotal').textContent = state.burns.length ? 'total ' + state.burns.reduce((s, b) => s + Math.hypot(b.pro, b.norm), 0).toFixed(1) + ' m/s' : '';
}
$('addBurn').addEventListener('click', () => { if (state.burns.length < 3) { state.burns.push({ after: 90, pro: 0, norm: 0 }); renderBurns(); changed(); } });

function applyPreset(p) {
  state.preset = p.id; state.t0 = dateToDays(new Date(p.date));
  state.vinf = p.vinf; state.angle = p.angle; state.pitch = p.pitch; state.burns = p.burns.map(b => ({ ...b })); state.cursor = 0;
  $('blurb').textContent = p.blurb;
  document.querySelectorAll('#presets button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === p.id)));
  refreshers.forEach(f => f()); renderBurns(); recompute();
}
for (const p of PRESETS) {
  const b = el('button', p.name); b.type = 'button'; b.dataset.id = p.id; b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => applyPreset(p)); $('presets').append(b);
}

// ---------- simulation ----------
let pending = false;
function changed() { state.preset = null; document.querySelectorAll('#presets button').forEach(b => b.setAttribute('aria-pressed', 'false')); $('dvTotal').textContent = state.burns.length ? 'total ' + state.burns.reduce((s, b) => s + Math.hypot(b.pro, b.norm), 0).toFixed(1) + ' m/s' : ''; if (!pending) { pending = true; setTimeout(() => { pending = false; recompute(); }, 0); } }
const absBurns = () => state.burns.map(b => ({ t: state.t0 + b.after, pro: b.pro, norm: b.norm }));

function recompute() {
  res = simulate(eph, launchState(eph, state.t0, state.vinf, state.angle, state.pitch), { days: 365.25 * 45, burns: absBurns() });
  const n = res.path.length / 4;
  speeds = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const dt = res.path[i * 4] - res.path[(i - 1) * 4] || 1e-9;
    speeds[i] = Math.hypot(res.path[i * 4 + 1] - res.path[(i - 1) * 4 + 1], res.path[i * 4 + 2] - res.path[(i - 1) * 4 + 2], res.path[i * 4 + 3] - res.path[(i - 1) * 4 + 3]) / dt / KMS;
  }
  speeds[0] = speeds[1] || 0;
  dur = Math.max(1, res.end.t - state.t0);
  state.cursor = Math.min(state.cursor, dur);
  $('scrub').max = Math.ceil(dur); $('scrub').value = Math.round(state.cursor);
  renderOutcome(); draw();
}

const visitsOf = () => res.events.filter(e => e.type === 'flyby' && e.dist <= REACH[e.body]);

function renderOutcome() {
  const v = visitsOf(), out = $('outcome'), log = $('log');
  const end = res.end;
  let text, cls = '';
  if (end.reason === 'impact') { text = `Crashed into ${NAME[end.body]} on ${fmtDate(end.t)}.`; cls = 'bad'; }
  else if (end.reason === 'sun') { text = `Fell into the Sun on ${fmtDate(end.t)}.`; cls = 'bad'; }
  else if (end.reason === 'escaped') { text = `Left the planetary region (80 AU) on ${fmtDate(end.t)}.`; cls = v.length ? 'good' : ''; }
  else { text = `Still flying after ${(dur / 365.25).toFixed(0)} years.`; cls = v.length ? 'good' : ''; }
  out.textContent = text + (v.length ? ` ${v.length} planet flyby${v.length > 1 ? 's' : ''}.` : ' No planet flybys yet.'); out.className = 'outcome ' + cls;
  log.replaceChildren();
  const rows = [...v.map(e => ({ t: e.t, e })), ...res.events.filter(e => e.type === 'burn').map(e => ({ t: e.t, e }))].sort((a, b) => a.t - b.t);
  for (const { e } of rows) {
    const li = el('li');
    if (e.type === 'burn') { li.append(el('span', `${fmtDate(e.t)} · correction burn`), el('small', `${e.pro.toFixed(1)} m/s along the path, ${e.norm.toFixed(1)} m/s sideways`)); }
    else li.append(el('span', `${fmtDate(e.t)} · ${NAME[e.body]}`), el('small', `${km(e.dist)} km from centre (${Math.max(0, Math.round(e.altKm)).toLocaleString('en-US')} km above the surface) · speed ${e.vIn.toFixed(1)} to ${e.vOut.toFixed(1)} km/s`));
    log.append(li);
  }
  if (!rows.length) log.append(el('li', 'Nothing yet. Move a slider.'));
  const g = $('giants'); g.replaceChildren();
  for (const id of GIANTS) { const d = el('div', NAME[id], 'giant' + (v.some(e => e.body === id) ? ' on' : '')); d.prepend(el('i')); g.append(d); }
  $('map').setAttribute('aria-label', `Top-down map of the solar system. ${out.textContent}`);
}

// ---------- drawing ----------
const cv = $('map'), g = cv.getContext('2d');
let W = 0, H = 0;
function size() {
  const dpr = Math.min(devicePixelRatio || 1, 2), r = cv.getBoundingClientRect();
  W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const bodyBuf = new Float64Array(BODIES.length * 3);
const hue = v => `hsl(${Math.round(232 - 190 * Math.min(1, Math.max(0, (v - 5) / 30)))}, 88%, 63%)`;

function probeAt(t) {
  const p = res.path, n = p.length / 4;
  let lo = 0, hi = n - 1;
  while (lo < hi - 1) { const m = (lo + hi) >> 1; if (p[m * 4] <= t) lo = m; else hi = m; }
  const k = p[hi * 4] === p[lo * 4] ? 0 : Math.min(1, Math.max(0, (t - p[lo * 4]) / (p[hi * 4] - p[lo * 4])));
  return { x: p[lo * 4 + 1] + k * (p[hi * 4 + 1] - p[lo * 4 + 1]), y: p[lo * 4 + 2] + k * (p[hi * 4 + 2] - p[lo * 4 + 2]), z: p[lo * 4 + 3] + k * (p[hi * 4 + 3] - p[lo * 4 + 3]), v: speeds[hi] };
}

function draw() {
  if (!res || !W) return;
  const cx = W / 2, cy = H / 2, S = Math.min(W, H) / 2 * 0.93 / Math.sqrt(33), T = state.t0 + state.cursor;
  const P = (x, y) => { const r = Math.hypot(x, y); if (r < 1e-9) return [cx, cy]; const f = Math.sqrt(r) * S / r; return [cx + x * f, cy - y * f]; };
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#05060a'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(239,230,208,.35)';                      // a few fixed stars
  for (let i = 0; i < 90; i++) { const a = Math.sin(i * 91.7) * 43758.5, b = Math.sin(i * 12.9 + 4) * 24634.6; g.fillRect((a - Math.floor(a)) * W, (b - Math.floor(b)) * H, 1, 1); }
  g.lineWidth = 1;
  ORBIT_A.forEach((a, i) => { g.strokeStyle = 'rgba(226,182,89,.13)'; g.beginPath(); g.arc(cx, cy, Math.sqrt(a) * S, 0, Math.PI * 2); g.stroke(); });
  const sun = g.createRadialGradient(cx, cy, 0, cx, cy, 16); sun.addColorStop(0, '#fff3c4'); sun.addColorStop(1, 'rgba(255,200,90,0)');
  g.fillStyle = sun; g.beginPath(); g.arc(cx, cy, 16, 0, Math.PI * 2); g.fill();

  // flight path: bright up to now, dim ahead; colour = speed
  const p = res.path, n = p.length / 4;
  g.lineCap = 'round'; g.lineWidth = 2;
  let [px, py] = P(p[1], p[2]);
  for (let i = 1; i < n; i++) {
    const [x, y] = P(p[i * 4 + 1], p[i * 4 + 2]);
    g.strokeStyle = hue(speeds[i]); g.globalAlpha = p[i * 4] <= T ? 0.95 : 0.32;
    g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke(); px = x; py = y;
  }
  g.globalAlpha = 1;

  // planets
  eph.all(T, bodyBuf);
  g.font = '11px "Share Tech Mono", monospace'; g.textBaseline = 'middle';
  BODIES.forEach((b, i) => {
    const [x, y] = P(bodyBuf[i * 3], bodyBuf[i * 3 + 1]), r = i >= 4 ? 5 : 3.2;
    g.fillStyle = b.color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(239,230,208,.7)'; g.fillText(b.name, x + r + 4, y);
  });

  // flyby and burn markers
  for (const e of res.events) {
    if (e.type === 'flyby' && e.dist > REACH[e.body]) continue;
    const q = probeAt(e.t), [x, y] = P(q.x, q.y);
    if (e.type === 'burn') { g.fillStyle = '#c97d4a'; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 5, y + 4); g.lineTo(x - 5, y + 4); g.closePath(); g.fill(); continue; }
    g.strokeStyle = '#e2b659'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#efe6d0'; g.textAlign = x > W * 0.7 ? 'right' : 'left';
    g.fillText(`${NAME[e.body]} ${(e.vOut - e.vIn >= 0 ? '+' : '')}${(e.vOut - e.vIn).toFixed(1)} km/s`, x + (g.textAlign === 'right' ? -14 : 14), y - 12);
    g.textAlign = 'left';
  }

  // the probe
  const q = probeAt(T), [qx, qy] = P(q.x, q.y);
  const glow = g.createRadialGradient(qx, qy, 0, qx, qy, 14); glow.addColorStop(0, 'rgba(255,255,255,.95)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow; g.beginPath(); g.arc(qx, qy, 14, 0, Math.PI * 2); g.fill();

  if (egg) {                                                  // easter egg: a ray of light through Earth, and one pale dot
    const [ex, ey] = P(bodyBuf[6], bodyBuf[7]), a = Math.atan2(ey - cy, ex - cx);
    const beam = g.createLinearGradient(cx, cy, cx + Math.cos(a) * W, cy + Math.sin(a) * W); beam.addColorStop(0, 'rgba(255,230,160,.0)'); beam.addColorStop(0.35, 'rgba(255,230,160,.13)'); beam.addColorStop(1, 'rgba(255,230,160,0)');
    g.fillStyle = beam; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a - 0.05) * W * 1.4, cy + Math.sin(a - 0.05) * W * 1.4); g.lineTo(cx + Math.cos(a + 0.05) * W * 1.4, cy + Math.sin(a + 0.05) * W * 1.4); g.closePath(); g.fill();
    g.fillStyle = '#9fc4ff'; g.fillRect(ex - 1, ey - 1, 2, 2);
  }
  $('clock').textContent = `${fmtDate(T)}  ·  day ${Math.round(state.cursor).toLocaleString('en-US')}`;
  $('vitals').textContent = `Distance from the Sun ${Math.hypot(q.x, q.y, q.z).toFixed(2)} AU\nSpeed ${q.v.toFixed(1)} km/s`;
}

// ---------- playback and sound ----------
let audio = null, soundOn = true, last = 0;
function blip(id) {
  if (!soundOn || !audio) return;
  const f = { mercury: 880, venus: 740, earth: 660, mars: 587, jupiter: 220, saturn: 262, uranus: 330, neptune: 196 }[id] || 400, t = audio.currentTime;
  for (const [mult, vol] of [[1, 0.13], [1.5, 0.06], [2, 0.03]]) {
    const o = audio.createOscillator(), gn = audio.createGain();
    o.type = 'sine'; o.frequency.value = f * mult; gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol, t + 0.03); gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(gn).connect(audio.destination); o.start(t); o.stop(t + 1.7);
  }
}
function tick(now) {
  if (!state.playing) return;
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  const before = state.cursor;
  state.cursor = Math.min(dur, state.cursor + dt * (365.25 / 3) * state.rate);
  for (const e of visitsOf()) { const rt = e.t - state.t0; if (rt > before && rt <= state.cursor) blip(e.body); }
  $('scrub').value = Math.round(state.cursor); draw();
  if (state.cursor >= dur) { setPlaying(false); return; }
  requestAnimationFrame(tick);
}
function setPlaying(on) {
  state.playing = on; $('play').textContent = on ? 'Pause' : (state.cursor >= dur ? 'Replay' : 'Play');
  if (on) { if (state.cursor >= dur) state.cursor = 0; if (!audio && soundOn) { try { audio = new AudioContext(); } catch { audio = null; } } if (audio) audio.resume(); last = performance.now(); requestAnimationFrame(tick); }
}
$('play').addEventListener('click', () => setPlaying(!state.playing));
$('scrub').addEventListener('input', e => { state.cursor = parseFloat(e.target.value); draw(); });
$('rate').addEventListener('change', e => { state.rate = parseFloat(e.target.value); });
$('sound').addEventListener('click', () => { soundOn = !soundOn; $('sound').textContent = soundOn ? 'Sound on' : 'Sound off'; $('sound').setAttribute('aria-pressed', String(soundOn)); });

// ---------- auto-aim ----------
const TARGETS = [['mars', 'Mars', 20000, 2, 'near'], ['venus', 'Venus', 20000, 2, 'near'], ['jupiter', 'Jupiter', 700000, 5, 'far'], ['saturn', 'Saturn', 100000, 8, 'far'], ['uranus', 'Uranus', 100000, 13, 'far'], ['neptune', 'Neptune', 60000, 20, 'far']];
for (const t of TARGETS) { const o = el('option', t[1]); o.value = t[0]; $('target').append(o); }
$('target').value = 'jupiter';
$('aim').addEventListener('click', async () => {
  const [id, name, radiusKm, years, kind] = TARGETS.find(t => t[0] === $('target').value), btn = $('aim'), status = $('aimStatus');
  btn.disabled = true; status.textContent = `Searching for a way to ${name}...`;
  try {
    const r = await autoAim(eph, state.t0, id, {
      radiusKm, days: 365.25 * years, burns: absBurns(),
      grid: kind === 'near' ? [[2.5, 8, 0.5], [-40, 10, 5], [-4, 4, 2]] : [[5, 13, 1], [-10, 30, 5], [-6, 8, 2]],
      yieldFn: () => new Promise(res => setTimeout(res, 0)), onProgress: f => { status.textContent = `Searching for a way to ${name}... ${Math.round(f * 100)}%`; },
    });
    state.vinf = r.vinf; state.angle = r.angle; state.pitch = r.pitch; state.preset = null; state.cursor = 0;
    refreshers.forEach(f => f()); recompute();
    status.textContent = r.missKm < radiusKm * 3 ? `Aimed: passes ${name} at ${Math.round(r.missKm).toLocaleString('en-US')} km from its centre on ${fmtDate(r.t)}.` : `No good aim for this date. Closest found: ${Math.round(r.missKm).toLocaleString('en-US')} km from ${name}. Try another launch date.`;
  } finally { btn.disabled = false; }
});

// ---------- keys, easter egg, boot ----------
let typed = '';
addEventListener('keydown', e => {
  const tag = e.target.tagName;
  if (e.key.length === 1 && tag !== 'INPUT' && tag !== 'SELECT') {
    typed = (typed + e.key.toLowerCase()).slice(-3);
    if (typed === 'dot') { typed = ''; egg = !egg; $('egg').hidden = !egg; $('egg').textContent = 'From out here, everything you have ever known fits in a single pixel of light.'; draw(); }
  }
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') return;
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
  else if (e.key === 'ArrowRight') { state.cursor = Math.min(dur, state.cursor + 30); $('scrub').value = Math.round(state.cursor); draw(); }
  else if (e.key === 'ArrowLeft') { state.cursor = Math.max(0, state.cursor - 30); $('scrub').value = Math.round(state.cursor); draw(); }
});
new ResizeObserver(() => { size(); draw(); }).observe(cv);
buildLaunch();
size();
setTimeout(() => { applyPreset(PRESETS[0]); $('loading').classList.add('hide'); }, 40);
