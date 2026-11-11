// Flight physics. Units: AU, days. The probe feels the Sun and all eight planets (point masses, positions
// from the ephemeris), in the heliocentric frame with the Sun's reflex acceleration included.
import { K2, AU_KM, BODIES, GM, indexOf } from './ephem.js';

export const KMS = 86400 / AU_KM;                    // km/s -> AU/day
const EARTH = indexOf('earth');
const N = BODIES.length;

export function earthState(eph, t) {
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  eph.pos(EARTH, t, a); eph.pos(EARTH, t - 0.25, b); eph.pos(EARTH, t + 0.25, c);
  return { p: a, v: [(c[0] - b[0]) / 0.5, (c[1] - b[1]) / 0.5, (c[2] - b[2]) / 0.5] };
}

// Patched-conic launch: the probe leaves Earth with hyperbolic excess speed vinf (km/s).
// angleDeg turns the departure direction left (towards the outer planets) of Earth's own motion; 0 = straight ahead.
// pitchDeg tilts it out of the ecliptic plane (positive = north), which the outer planets' tilted orbits need.
export function launchState(eph, t, vinfKms, angleDeg, pitchDeg = 0) {
  if (![t, vinfKms, angleDeg, pitchDeg].every(Number.isFinite) || vinfKms < 0) throw new RangeError('launchState needs finite numbers and a speed of at least 0');
  const e = earthState(eph, t), h = Math.hypot(e.v[0], e.v[1]);
  const ux = e.v[0] / h, uy = e.v[1] / h;
  const a = angleDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const q = pitchDeg * Math.PI / 180, cq = Math.cos(q), sq = Math.sin(q);
  const k = vinfKms * KMS;
  return { t, p: e.p, v: [e.v[0] + (ux * c - uy * s) * cq * k, e.v[1] + (ux * s + uy * c) * cq * k, e.v[2] + sq * k] };
}

export const speedKms = v => Math.hypot(v[0], v[1], v[2]) / KMS;

// burns: [{ t (absolute unix days), pro, norm }] in m/s; pro along the velocity, norm 90 degrees to its left.
export function simulate(eph, start, o = {}) {
  if (![start.t, ...start.p, ...start.v].every(Number.isFinite)) throw new RangeError('simulate needs a finite starting state');
  const tEnd = start.t + (o.days ?? 18262), rMax = o.rMax ?? 80, usePlanets = o.planets !== false;
  const burns = (o.burns ?? []).map(b => ({ ...b })).sort((a, b) => a.t - b.t);
  let bi = 0;
  let t = start.t;
  const p = start.p.slice(), v = start.v.slice();
  const bp = new Float64Array(N * 3), bp2 = new Float64Array(N * 3);
  const a0 = [0, 0, 0], a1 = [0, 0, 0];
  const path = [], events = [];
  const minD = new Float64Array(N).fill(Infinity), minT = new Float64Array(N);
  const enc = new Array(N).fill(null);
  let end = { reason: 'time', t: tEnd, body: null }, lastStored = -1e9, steps = 0;

  function accel(pp, bodies, since, out) {
    const r2 = pp[0] * pp[0] + pp[1] * pp[1] + pp[2] * pp[2], r = Math.sqrt(r2), f = -K2 / (r2 * r);
    let ax = f * pp[0], ay = f * pp[1], az = f * pp[2];
    if (usePlanets) {
      for (let i = 0; i < N; i++) {
        if (i === EARTH && since < 20) continue;     // still inside Earth's sphere of influence
        const bx = bodies[i * 3], by = bodies[i * 3 + 1], bz = bodies[i * 3 + 2];
        const dx = bx - pp[0], dy = by - pp[1], dz = bz - pp[2];
        const d2 = dx * dx + dy * dy + dz * dz + 1e-12, g = GM[i] / (d2 * Math.sqrt(d2));
        const rb2 = bx * bx + by * by + bz * bz, ib = GM[i] / (rb2 * Math.sqrt(rb2));   // the planet also pulls the Sun
        ax += g * dx - ib * bx; ay += g * dy - ib * by; az += g * dz - ib * bz;
      }
    }
    out[0] = ax; out[1] = ay; out[2] = az;
  }

  const store = (force) => { if (force || t - lastStored >= 2) { path.push(t, p[0], p[1], p[2]); lastStored = t; } };
  eph.all(t, bp);
  store(true);

  while (t < tEnd && steps++ < 400000) {
    const r = Math.hypot(p[0], p[1], p[2]), since = t - start.t, sp = Math.hypot(v[0], v[1], v[2]);
    let dmin = Infinity;
    if (usePlanets) for (let i = 0; i < N; i++) {
      if (i === EARTH && since < 20) continue;
      const d = Math.hypot(bp[i * 3] - p[0], bp[i * 3 + 1] - p[1], bp[i * 3 + 2] - p[2]);
      if (d < dmin) dmin = d;
    }
    let dt = Math.min(1, 0.02 * dmin / (sp + 0.02), 0.003 * r * Math.sqrt(r / K2));
    dt = Math.max(dt, 2e-4);
    if (t + dt > tEnd) dt = tEnd - t;
    if (bi < burns.length && t + dt > burns[bi].t) dt = Math.max(burns[bi].t - t, 1e-9);

    // velocity Verlet
    accel(p, bp, since, a0);
    p[0] += v[0] * dt + 0.5 * a0[0] * dt * dt; p[1] += v[1] * dt + 0.5 * a0[1] * dt * dt; p[2] += v[2] * dt + 0.5 * a0[2] * dt * dt;
    eph.all(t + dt, bp2);
    accel(p, bp2, since + dt, a1);
    v[0] += 0.5 * (a0[0] + a1[0]) * dt; v[1] += 0.5 * (a0[1] + a1[1]) * dt; v[2] += 0.5 * (a0[2] + a1[2]) * dt;
    t += dt; bp.set(bp2);

    if (bi < burns.length && t >= burns[bi].t - 1e-9) {          // mid-course correction
      const b = burns[bi++], speed = Math.hypot(v[0], v[1], v[2]) || 1, s = Math.hypot(v[0], v[1]) || 1, k = 1e-3 * KMS;
      // work out the whole kick from the velocity BEFORE changing any component
      const dvx = (b.pro * v[0] / speed + b.norm * (-v[1] / s)) * k, dvy = (b.pro * v[1] / speed + b.norm * (v[0] / s)) * k, dvz = b.pro * v[2] / speed * k;
      v[0] += dvx; v[1] += dvy; v[2] += dvz;
      events.push({ type: 'burn', t, pro: b.pro, norm: b.norm });
    }

    let hot = false;
    if (usePlanets) for (let i = 0; i < N; i++) {
      if (i === EARTH && t - start.t < 20) continue;           // the launch itself is not a flyby
      const d = Math.hypot(bp[i * 3] - p[0], bp[i * 3 + 1] - p[1], bp[i * 3 + 2] - p[2]);
      if (d < minD[i]) { minD[i] = d; minT[i] = t; }
      const zone = BODIES[i].rEnc * 3;
      if (d < zone) {
        hot = true;
        if (!enc[i]) enc[i] = { minD: d, t, vIn: speedKms(v) };
        else if (d < enc[i].minD) { enc[i].minD = d; enc[i].t = t; }
        if (d * AU_KM < BODIES[i].radiusKm) { end = { reason: 'impact', t, body: BODIES[i].id }; break; }
      } else if (enc[i]) {
        events.push(flyby(i, enc[i], speedKms(v))); enc[i] = null;
      }
    }
    store(hot);
    if (end.reason === 'impact') break;
    if (r * AU_KM < 700000) { end = { reason: 'sun', t, body: 'sun' }; break; }
    if (r > rMax) { end = { reason: 'escaped', t, body: null }; break; }
  }
  for (let i = 0; i < N; i++) if (enc[i]) events.push(flyby(i, enc[i], speedKms(v)));
  if (t < tEnd - 1e-6 && end.reason === 'time') end = { reason: 'steps', t, body: null };   // the safety cap stopped the run early
  if (t > lastStored) store(true);                                                      // no duplicate final point
  events.sort((a, b) => a.t - b.t);
  return { path: Float64Array.from(path), events, minD, minT, end, final: { t, p: p.slice(), v: v.slice() } };
}

function flyby(i, e, vOut) {
  const b = BODIES[i];
  return { type: 'flyby', body: b.id, t: e.t, dist: e.minD, altKm: e.minD * AU_KM - b.radiusKm, vIn: e.vIn, vOut, dv: vOut - e.vIn };
}

// How near counts as a "visit" to each planet (AU). The page and the tests both use this one table.
export const REACH = { mercury: 0.02, venus: 0.02, earth: 0.02, mars: 0.02, jupiter: 0.1, saturn: 0.1, uranus: 0.08, neptune: 0.08 };

// Which planets did this flight actually pass close to, in order.
export function visits(result, reach = REACH) {
  return result.events.filter(e => e.type === 'flyby' && e.dist <= reach[e.body]);
}
