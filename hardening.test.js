import test from 'node:test';
import assert from 'node:assert/strict';
import * as Astronomy from 'astronomy-engine';
import { createEphemeris, dateToDays, K2 } from './ephem.js';
import { simulate, launchState, visits, REACH } from './sim.js';

const eph = createEphemeris(Astronomy);
const T = dateToDays(new Date(Date.UTC(2005, 0, 1)));

test('bad inputs are refused with a clear error, not a deep library exception', () => {
  assert.throws(() => launchState(eph, NaN, 10, 0), RangeError);
  assert.throws(() => launchState(eph, T, Infinity, 0), RangeError);
  assert.throws(() => launchState(eph, T, -1, 0), RangeError);
  assert.throws(() => launchState(eph, T, 10, 0, NaN), RangeError);
  assert.throws(() => simulate(eph, { t: T, p: [NaN, 0, 0], v: [0, 0, 0] }), RangeError);
});

test('a run that hits the step cap says so instead of pretending it ran to the end', () => {
  const R = 0.3, tEnd = 45 * 365.25;
  const r = simulate(eph, { t: 0, p: [R, 0, 0], v: [0, Math.sqrt(K2 / R), 0] }, { planets: false, days: tEnd });
  assert.equal(r.end.reason, 'steps');
  assert.ok(r.end.t < tEnd - 100, 'end time is where it really stopped: ' + r.end.t);
});

test('path times strictly increase, so the last point never has a zero-length step', () => {
  for (const days of [0, 1, 365 * 5]) {
    const r = simulate(eph, launchState(eph, T, 10, 8, 2), { days });
    assert.ok(r.path.length >= 4);
    for (let i = 1; i < r.path.length / 4; i++) assert.ok(r.path[i * 4] > r.path[(i - 1) * 4], `day ${days}, point ${i}`);
  }
});

test('"visit" is decided in one place and uses the shared reach table', () => {
  const result = { events: [
    { type: 'flyby', body: 'jupiter', dist: REACH.jupiter - 0.001 }, { type: 'flyby', body: 'jupiter', dist: REACH.jupiter + 0.001 },
    { type: 'flyby', body: 'mars', dist: REACH.mars + 0.001 }, { type: 'burn', t: 1 },
  ] };
  assert.equal(visits(result).length, 1);
  assert.equal(visits(result, { jupiter: 1, mars: 1 }).length, 3);   // three flybys in reach; the burn is never a visit
});
