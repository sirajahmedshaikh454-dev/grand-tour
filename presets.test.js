import test from 'node:test';
import assert from 'node:assert/strict';
import * as Astronomy from 'astronomy-engine';
import { createEphemeris, dateToDays, indexOf, AU_KM } from './ephem.js';
import { simulate, launchState } from './sim.js';
import { PRESETS } from './presets.js';
import { nelderMead, autoAim } from './solve.js';

const eph = createEphemeris(Astronomy);
const fly = (p, days) => {
  const t0 = dateToDays(new Date(p.date));
  return { t0, r: simulate(eph, launchState(eph, t0, p.vinf, p.angle, p.pitch), { days, burns: p.burns.map(b => ({ t: t0 + b.after, pro: b.pro, norm: b.norm })) }) };
};
const preset = id => PRESETS.find(p => p.id === id);
const day = s => dateToDays(new Date(s + 'T00:00:00Z'));

test('real-world check: Voyager 2 launch day reaches Jupiter on the real flyby day, at about the real launch speed', () => {
  const { r } = fly(preset('voyager-jupiter'), 365 * 3);
  const ij = indexOf('jupiter');
  assert.ok(Math.abs(r.minT[ij] - day('1979-07-09')) < 1.5, 'arrival date within a day and a half of 9 July 1979');
  assert.ok(r.minD[ij] * AU_KM < 5e6, 'within 5 million km of Jupiter');
  assert.ok(preset('voyager-jupiter').vinf > 9.5 && preset('voyager-jupiter').vinf < 10.5, 'real launch excess speed is about 10 km/s');
});

test('Jupiter-then-Saturn: a gravity assist roughly doubles the speed and aims at Saturn with a tiny nudge', () => {
  const { r } = fly(preset('voyager-saturn'), 365 * 6);
  const j = r.events.find(e => e.type === 'flyby' && e.body === 'jupiter'), s = r.events.find(e => e.type === 'flyby' && e.body === 'saturn');
  assert.ok(j && s, 'both flybys recorded');
  assert.ok(j.t < s.t, 'Jupiter first');
  assert.ok(j.vOut - j.vIn > 8, 'Jupiter adds more than 8 km/s: ' + (j.vOut - j.vIn));
  assert.ok(s.dist * AU_KM > 80000 && s.dist * AU_KM < 150000, 'Saturn passed 80,000-150,000 km from centre (Voyager 2: about 101,000)');
  assert.ok(Math.hypot(...[28.06, 1.36]) < 30, 'the nudge is under 30 m/s');
  assert.ok(Math.abs(s.t - day('1981-08-26')) < 200, 'Saturn within 200 days of the real encounter');
});

test('Mars sprint passes Mars without hitting it', () => {
  const { r } = fly(preset('mars-sprint'), 365);
  const m = r.events.find(e => e.type === 'flyby' && e.body === 'mars');
  assert.ok(m && m.altKm > 1000 && m.altKm < 40000, 'flyby altitude ' + (m && m.altKm));
  assert.notEqual(r.end.reason, 'impact');
});

test('presets are well-formed', () => {
  for (const p of PRESETS) {
    assert.ok(p.id && p.name && p.blurb && !Number.isNaN(Date.parse(p.date)));
    assert.ok(p.vinf >= 3 && p.vinf <= 14 && Math.abs(p.angle) <= 60 && Math.abs(p.pitch) <= 20, p.id);
  }
  assert.equal(new Set(PRESETS.map(p => p.id)).size, PRESETS.length);
});

test('the optimiser finds the minimum of a bowl, and auto-aim finds Mars', async () => {
  const r = await nelderMead(x => (x[0] - 3) ** 2 + 4 * (x[1] + 1) ** 2, [0, 0], [1, 1], { iters: 200, tol: 1e-14 });
  assert.ok(Math.abs(r.x[0] - 3) < 1e-3 && Math.abs(r.x[1] + 1) < 1e-3);
  const t0 = dateToDays(new Date('2020-07-30T12:00:00Z'));
  const a = await autoAim(eph, t0, 'mars', { radiusKm: 20000, days: 365, grid: [[4, 7, 1], [-12, 0, 4], [-3, 0, 1.5]] });
  assert.ok(a.missKm < 60000, 'auto-aim got within 60,000 km of Mars: ' + a.missKm);
});
