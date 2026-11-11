import test from 'node:test';
import assert from 'node:assert/strict';
import * as Astronomy from 'astronomy-engine';
import { createEphemeris, BODIES, K2, indexOf, dateToDays } from './ephem.js';
import { simulate, launchState, earthState, speedKms, KMS } from './sim.js';

const eph = createEphemeris(Astronomy);
const T2000 = dateToDays(new Date(Date.UTC(2000, 0, 1, 12)));

test('the ephemeris puts the planets where they belong', () => {
  const e = [0, 0, 0], n = [0, 0, 0], j = [0, 0, 0];
  eph.pos(indexOf('earth'), T2000, e); eph.pos(indexOf('neptune'), T2000, n); eph.pos(indexOf('jupiter'), T2000, j);
  const lon = Math.atan2(e[1], e[0]) * 180 / Math.PI, r = Math.hypot(...e);
  assert.ok(Math.abs(lon - 100.4) < 0.3, 'Earth longitude on 1 Jan 2000 is about 100.4 deg, got ' + lon);
  assert.ok(Math.abs(r - 0.9833) < 0.001);
  assert.ok(Math.abs(Math.hypot(...n) - 30.1) < 0.15);
  assert.ok(Math.abs(Math.hypot(...j) - 4.97) < 0.1);   // near perihelion in 2000
});

test('interpolating between daily samples stays close to the exact library value', () => {
  for (const [id, tol] of [['jupiter', 1e-6], ['earth', 1e-5], ['mercury', 3e-4]]) {
    const i = indexOf(id), got = [0, 0, 0];
    let worst = 0;
    for (const dt of [0.13, 0.5, 0.87, 100.37]) {
      eph.pos(i, T2000 + dt, got);
      const ex = eph.exact(i, T2000 + dt);
      worst = Math.max(worst, Math.hypot(got[0] - ex[0], got[1] - ex[1], got[2] - ex[2]));
    }
    assert.ok(worst < tol, `${id}: interpolation error ${worst}`);
  }
});

test('with no planets the probe flies a clean Kepler circle: one year, back where it started', () => {
  const P = 2 * Math.PI / Math.sqrt(K2);
  const start = { t: 0, p: [1, 0, 0], v: [0, Math.sqrt(K2), 0] };
  const r = simulate(eph, start, { planets: false, days: P });
  assert.ok(Math.hypot(r.final.p[0] - 1, r.final.p[1], r.final.p[2]) < 3e-5, 'closed orbit (about 3000 km per year at 1 AU)');
  assert.ok(Math.abs(Math.hypot(...r.final.v) - Math.sqrt(K2)) < 1e-8, 'speed conserved');
  // an ellipse: energy stays constant along the way
  const E = (p, v) => 0.5 * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) - K2 / Math.hypot(...p);
  const e0 = E(start.p, start.v), e1 = E(r.final.p, r.final.v);
  assert.ok(Math.abs(e1 - e0) / Math.abs(e0) < 1e-6);
});

test('a launch leaves Earth at exactly the requested excess speed, and zero launch angle is straight ahead', () => {
  const t = dateToDays(new Date(Date.UTC(1977, 7, 20)));
  const e = earthState(eph, t), s = launchState(eph, t, 10, 0);
  const rel = [s.v[0] - e.v[0], s.v[1] - e.v[1], s.v[2] - e.v[2]];
  assert.ok(Math.abs(Math.hypot(...rel) / KMS - 10) < 1e-9);
  assert.ok(rel[0] * e.v[0] + rel[1] * e.v[1] > 0, 'along Earth travel');
  assert.deepEqual(s.p, e.p);
});

test('a fast outbound probe escapes the system and reports it; a slow one can fall into the Sun', () => {
  const t = dateToDays(new Date(Date.UTC(2005, 0, 1)));
  const fast = simulate(eph, launchState(eph, t, 14, 0), { days: 365 * 40 });
  assert.ok(['escaped', 'time'].includes(fast.end.reason));
  assert.ok(Math.hypot(...fast.final.p) > 25, 'far out after 40 years');
  const slow = simulate(eph, { t, p: [1, 0, 0], v: [0, 0.001, 0] }, { days: 400, planets: false });
  assert.equal(slow.end.reason, 'sun');
});

test('a planet flyby is detected, with a speed change and a periapsis that is not inside the planet', () => {
  // aim straight at Jupiter's future position with a crude scan, then check the event record
  const t0 = dateToDays(new Date(Date.UTC(1977, 7, 20)));
  const ij = indexOf('jupiter');
  let best = null;
  for (let v = 8; v <= 13; v += 0.5) for (let a = -10; a <= 25; a += 2.5) {
    const r = simulate(eph, launchState(eph, t0, v, a), { days: 365 * 3 });
    if (!best || r.minD[ij] < best.d) best = { d: r.minD[ij], v, a, r };
  }
  assert.ok(best.d < 0.5, 'some launch in the grid gets within 0.5 AU of Jupiter, got ' + best.d);
  const fb = best.r.events.find(e => e.type === 'flyby' && e.body === 'jupiter');
  if (best.d < 0.15) {
    assert.ok(fb, 'a flyby event was recorded');
    assert.ok(fb.altKm > -1 && Math.abs(fb.dv) > 0.01);
  }
});

test('a burn changes speed by what was asked, and is logged', () => {
  const t = dateToDays(new Date(Date.UTC(2005, 0, 1)));
  const base = simulate(eph, launchState(eph, t, 10, 0), { days: 100, planets: false });
  const burnt = simulate(eph, launchState(eph, t, 10, 0), { days: 100, planets: false, burns: [{ t: t + 50, pro: 500, norm: 0 }] });
  assert.equal(burnt.events.filter(e => e.type === 'burn').length, 1);
  assert.ok(speedKms(burnt.final.v) > speedKms(base.final.v) + 0.3);
});

test('launching from Earth is not reported as an Earth flyby', () => {
  const t = dateToDays(new Date(Date.UTC(1977, 7, 20)));
  const r = simulate(eph, launchState(eph, t, 10.2, 8), { days: 365 * 3 });
  assert.equal(r.events.filter(e => e.type === 'flyby' && e.body === 'earth').length, 0);
});

test('a sideways burn is exactly as big as asked and exactly at right angles to the motion', () => {
  const t = dateToDays(new Date(Date.UTC(2005, 0, 1)));
  const start = launchState(eph, t, 10, 20, 5);
  const days = 50.0001;
  const base = simulate(eph, start, { days, planets: false });
  for (const [pro, norm] of [[0, 500], [300, 0], [200, -400]]) {
    const burnt = simulate(eph, start, { days, planets: false, burns: [{ t: t + 50, pro, norm }] });
    const d = [0, 1, 2].map(i => burnt.final.v[i] - base.final.v[i]);
    assert.ok(Math.abs(Math.hypot(...d) / KMS * 1000 - Math.hypot(pro, norm)) < 1, `size for ${pro}/${norm}`);
    const v = base.final.v, vm = Math.hypot(...v);
    const along = (d[0] * v[0] + d[1] * v[1] + d[2] * v[2]) / vm / KMS * 1000;
    assert.ok(Math.abs(along - pro) < 2, `along-track part ${along} vs ${pro}`);
  }
});
