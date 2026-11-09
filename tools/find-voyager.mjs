// Searches for a Voyager-2-style grand tour for a given launch date: Jupiter, Saturn, Uranus, Neptune.
// Usage: node tools/find-voyager.mjs [YYYY-MM-DD]   (default 1977-08-20)
// It aims at Voyager 2's real flyby distances (from planet centre) and real arrival dates.
import * as Astronomy from 'astronomy-engine';
import { createEphemeris, dateToDays, daysToDate, indexOf, AU_KM } from '../ephem.js';
import { simulate, launchState } from '../sim.js';
import { nelderMead as nmAsync } from '../solve.js';

const nelderMead = (...a) => nmAsync(...a);
const eph = createEphemeris(Astronomy);
const day = process.argv[2] || '1977-08-20';
const t0 = dateToDays(new Date(day + 'T14:29:00Z'));
const [J, S, U, N] = ['jupiter', 'saturn', 'uranus', 'neptune'].map(indexOf);
const log = console.log;
const fmt = t => daysToDate(t).toISOString().slice(0, 10);
const km = x => Math.round(x * AU_KM).toLocaleString('en-US');
const T = Date.now();
const day2 = s => dateToDays(new Date(s + 'T12:00:00Z'));
const RJ = 721670 / AU_KM, RS = 101000 / AU_KM, RU = 107000 / AU_KM, RN = 29000 / AU_KM;   // closest approach, from planet centre
const real = { J: day2('1979-07-09'), S: day2('1981-08-26') };
const DV = 2e-6;                                                                           // AU of "cost" per m/s of burn

const pen = x => 1e3 * (Math.max(0, 8 - x[0]) ** 2 + Math.max(0, x[0] - 13.5) ** 2 + Math.max(0, Math.abs(x[2]) - 10) ** 2 + Math.max(0, -x[1]) ** 2 + Math.max(0, x[1] - 40) ** 2);
const fly = (x, burns, days = 365 * 14) => simulate(eph, launchState(eph, t0, x[0], x[1], x[2]), { days, burns });
const crash = r => (r.end.reason === 'impact' ? 5 : 0);

// Stage 1: Jupiter at about the right time, aimed at the real flyby distance.
let best = { f: Infinity, x: null };
const f1 = x => { const r = fly(x, [], 365 * 3); return Math.abs(r.minD[J] - RJ) + 0.0008 * Math.abs(r.minT[J] - real.J) + pen(x) + crash(r); };
for (let v = 9; v <= 12; v += 0.5) for (let a = 10; a <= 26; a += 2) for (let q = -4; q <= 10; q += 2) { const f = f1([v, a, q]); if (f < best.f) best = { f, x: [v, a, q] }; }
const s1 = nelderMead(f1, best.x, [0.3, 1.5, 1.5], { iters: 250, tol: 1e-12 });
{ const r = fly(s1.x, [], 365 * 3); log('Stage 1 Jupiter: v_inf', s1.x[0].toFixed(3), 'angle', s1.x[1].toFixed(2), 'pitch', s1.x[2].toFixed(2), '| flyby at', km(r.minD[J]), 'km on', fmt(r.minT[J])); }

// Stage 2: launch + one correction at day 90: Jupiter AND Saturn at their real distances and dates.
const b1 = x => [{ t: t0 + 90, pro: x[3], norm: x[4] }];
const f2 = x => { const r = fly(x, b1(x), 365 * 6); return Math.abs(r.minD[J] - RJ) + Math.abs(r.minD[S] - RS) + 0.0008 * Math.abs(r.minT[J] - real.J) + 0.0004 * Math.abs(r.minT[S] - real.S) + DV * Math.hypot(x[3], x[4]) + pen(x) + crash(r); };
let s2 = nelderMead(f2, [...s1.x, 0, 0], [0.2, 1, 1, 15, 15], { iters: 600, tol: 1e-12 });
s2 = nelderMead(f2, s2.x, [0.05, 0.3, 0.3, 4, 4], { iters: 600, tol: 1e-13 });
const P = s2.x.slice(0, 3), B1 = b1(s2.x);
{ const r = fly(P, B1, 365 * 6); log('Stage 2 Jupiter+Saturn: Jupiter', km(r.minD[J]), 'km on', fmt(r.minT[J]), '| Saturn', km(r.minD[S]), 'km on', fmt(r.minT[S]), '| burn', s2.x[3].toFixed(1), s2.x[4].toFixed(1), 'm/s'); }

// Stage 3: add a second correction just after Jupiter and make Uranus part of the same search, so the Saturn flyby
// is the one that points us at Uranus. Seven numbers: launch (3) + two corrections (4).
const tJup = fly(P, B1, 365 * 6).minT[J] + 30;
const b2 = x => [{ t: t0 + 90, pro: x[3], norm: x[4] }, { t: tJup, pro: x[5], norm: x[6] }];
const f3 = x => { const r = fly(x, b2(x), 365 * 10); return Math.abs(r.minD[J] - RJ) + Math.abs(r.minD[S] - RS) + Math.abs(r.minD[U] - RU) + 0.0008 * Math.abs(r.minT[J] - real.J) + 0.0004 * Math.abs(r.minT[S] - real.S) + DV * (Math.hypot(x[3], x[4]) + Math.hypot(x[5], x[6])) + pen(x) + crash(r); };
let s3 = { x: [...P, ...s2.x.slice(3), 0, 0], f: Infinity };
for (const scale of [1, 0.4, 0.15]) {
  s3 = nelderMead(f3, s3.x, [0.2 * scale, 1 * scale, 1 * scale, 6 * scale, 6 * scale, 12 * scale, 12 * scale], { iters: 700, tol: 1e-13 });
  const r = fly(s3.x, b2(s3.x), 365 * 10);
  log(`Stage 3 (x${scale}): Jupiter`, km(r.minD[J]), 'km', fmt(r.minT[J]), '| Saturn', km(r.minD[S]), 'km', fmt(r.minT[S]), '| Uranus', km(r.minD[U]), 'km', fmt(r.minT[U]), '| f', s3.f.toExponential(2));
}
const P3 = s3.x.slice(0, 3);
Object.assign(P, P3);
const B2 = b2(s3.x);

// Stage 4: after Uranus, one correction to reach Neptune; then refine everything together.
const tUra = fly(P, B2, 365 * 10).minT[U] + 20;
const mk = (z, y) => [...b2(z), { t: tUra, pro: y[0], norm: y[1] }];
const g4 = y => { const r = fly(P, mk(s3.x, y)); return Math.abs(r.minD[N] - RN) + DV * Math.hypot(...y) + crash(r); };
let s4 = nelderMead(g4, [0, 0], [10, 10], { iters: 400, tol: 1e-14 });
s4 = nelderMead(g4, s4.x, [2, 2], { iters: 400, tol: 1e-14 });
{ const r = fly(P, mk(s3.x, s4.x)); log('Stage 4 Neptune:', km(r.minD[N]), 'km on', fmt(r.minT[N]), '| burn', s4.x.map(v => v.toFixed(1)).join(' / '), 'm/s'); }
const f5 = z => { const r = fly(z, mk(z, z.slice(7)), 365 * 14); return Math.abs(r.minD[J] - RJ) + Math.abs(r.minD[S] - RS) + Math.abs(r.minD[U] - RU) + Math.abs(r.minD[N] - RN) + 0.0008 * Math.abs(r.minT[J] - real.J) + DV * (Math.hypot(z[3], z[4]) + Math.hypot(z[5], z[6]) + Math.hypot(z[7], z[8])) + pen(z) + crash(r); };
let s5 = { x: [...s3.x, ...s4.x] };
for (const scale of [0.3, 0.1]) s5 = nelderMead(f5, s5.x, [0.1 * scale, 0.5 * scale, 0.5 * scale, 4 * scale, 4 * scale, 8 * scale, 8 * scale, 6 * scale, 6 * scale], { iters: 600, tol: 1e-14 });
Object.assign(P, s5.x.slice(0, 3));
const bs = mk(s5.x, s5.x.slice(7));

const final = fly(P, bs);
log('\nRESULT launch', day, 'v_inf', P[0].toFixed(4), 'angle', P[1].toFixed(3), 'pitch', P[2].toFixed(3));
log('burns:', bs.map(b => `${fmt(b.t)} pro ${b.pro.toFixed(1)} norm ${b.norm.toFixed(1)}`).join(' | '));
log('total delta-v', bs.reduce((s, b) => s + Math.hypot(b.pro, b.norm), 0).toFixed(1), 'm/s');
for (const e of final.events.filter(e => e.type === 'flyby')) log(fmt(e.t), e.body.padEnd(8), 'from centre', km(e.dist).padStart(10), 'km   speed', e.vIn.toFixed(1), '->', e.vOut.toFixed(1), 'km/s');
log('ended:', final.end.reason, fmt(final.end.t), ' elapsed', ((Date.now() - T) / 1000).toFixed(0), 's');
log(JSON.stringify({ day, vinf: +P[0].toFixed(5), angle: +P[1].toFixed(4), pitch: +P[2].toFixed(4), burns: bs.map(b => ({ t: +b.t.toFixed(3), pro: +b.pro.toFixed(2), norm: +b.norm.toFixed(2) })) }));
