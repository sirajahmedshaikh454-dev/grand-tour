// A small Nelder-Mead optimiser plus an "auto-aim" built on the simulator.
// Everything is async so the browser can pass a yield function and stay responsive while it searches.
import { simulate, launchState } from './sim.js';
import { indexOf, AU_KM } from './ephem.js';

// Minimise f over n numbers. step[i] is the size of the first probe along axis i.
export async function nelderMead(f, x0, step, { iters = 200, tol = 1e-9, yieldFn = null } = {}) {
  const n = x0.length;
  let evals = 0;
  const F = async x => { const v = f(x); if (yieldFn && ++evals % 6 === 0) await yieldFn(); return v; };
  let pts = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step[i]; pts.push(x); }
  let vals = [];
  for (const p of pts) vals.push(await F(p));
  const comb = (c, x, k) => c.map((ci, i) => ci + k * (x[i] - ci));
  for (let it = 0; it < iters; it++) {
    const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    pts = order.map(i => pts[i]); vals = order.map(i => vals[i]);
    if (Math.abs(vals[n] - vals[0]) < tol) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
    const xr = comb(c, pts[n], -1), fr = await F(xr);
    if (fr < vals[0]) {
      const xe = comb(c, pts[n], -2), fe = await F(xe);
      if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) { pts[n] = xr; vals[n] = fr; }
    else {
      const xc = fr < vals[n] ? comb(c, pts[n], -0.5) : comb(c, pts[n], 0.5), fc = await F(xc);
      if (fc < Math.min(fr, vals[n])) { pts[n] = xc; vals[n] = fc; }
      else for (let i = 1; i <= n; i++) { pts[i] = comb(pts[0], pts[i], 0.5); vals[i] = await F(pts[i]); }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: pts[best], f: vals[best] };
}

// Launch limits a real rocket could manage (excess speed in km/s, angles in degrees).
export const LIMITS = { vinf: [3, 14], angle: [-60, 60], pitch: [-20, 20] };
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const penalty = x => 1e3 * (['vinf', 'angle', 'pitch'].reduce((s, k, i) => s + Math.max(0, LIMITS[k][0] - x[i]) ** 2 + Math.max(0, x[i] - LIMITS[k][1]) ** 2, 0));

// Find a (speed, angle, pitch) that makes the probe pass `bodyId` at about `radiusKm` from its centre.
// `grid` = [speeds, angles, pitches] each as [from, to, step]. Returns { vinf, angle, pitch, missKm, t }.
export async function autoAim(eph, t0, bodyId, { radiusKm = null, days = 365 * 6, burns = [], grid = null, yieldFn = null, onProgress = null } = {}) {
  const ib = indexOf(bodyId), planetKm = 1;   // radiusKm default is set below once we know the body
  const target = (radiusKm ?? 0) / AU_KM;
  const run = x => simulate(eph, launchState(eph, t0, x[0], x[1], x[2]), { days, burns });
  const cost = x => { const r = run(x); return Math.abs(r.minD[ib] - target) + penalty(x) + (r.end.reason === 'impact' && r.end.body === bodyId && !radiusKm ? 0 : 0); };
  const g = grid ?? [[5, 13, 1], [-10, 30, 5], [-6, 8, 2]];
  let best = { f: Infinity, x: [8, 10, 0] };
  const total = (Math.floor((g[0][1] - g[0][0]) / g[0][2]) + 1) * (Math.floor((g[1][1] - g[1][0]) / g[1][2]) + 1) * (Math.floor((g[2][1] - g[2][0]) / g[2][2]) + 1);
  let done = 0;
  for (let v = g[0][0]; v <= g[0][1] + 1e-9; v += g[0][2]) for (let a = g[1][0]; a <= g[1][1] + 1e-9; a += g[1][2]) for (let q = g[2][0]; q <= g[2][1] + 1e-9; q += g[2][2]) {
    const x = [v, a, q], f = cost(x);
    if (f < best.f) best = { f, x };
    if (++done % 8 === 0) { if (onProgress) onProgress(done / total * 0.6); if (yieldFn) await yieldFn(); }
  }
  const r = await nelderMead(cost, best.x, [0.3, 1.5, 1.2], { iters: 160, tol: 1e-12, yieldFn });
  if (onProgress) onProgress(1);
  const x = [clamp(r.x[0], LIMITS.vinf), clamp(r.x[1], LIMITS.angle), clamp(r.x[2], LIMITS.pitch)];
  const out = run(x);
  return { vinf: x[0], angle: x[1], pitch: x[2], missKm: out.minD[ib] * AU_KM, t: out.minT[ib] };
}
