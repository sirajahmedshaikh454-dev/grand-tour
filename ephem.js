// Planet table and a cached, interpolated ephemeris. Time is "unix days" (ms since 1970 / 86400000).
// Positions are heliocentric, ecliptic J2000, in AU. The astronomy library is passed in so the same
// code runs in Node (npm package) and in the browser (vendored build).

export const K2 = 2.959122082855911e-4;            // Sun's GM in AU^3 / day^2 (Gauss's constant squared)
export const AU_KM = 149597870.7;

// massRatio = Sun mass / planet mass (IAU values; Earth includes the Moon).
// rEnc (AU) is how close counts as a "flyby" worth reporting: 3x this starts an encounter record.
export const BODIES = [
  { id: 'mercury', name: 'Mercury', astro: 'Mercury', massRatio: 6023600, radiusKm: 2439.7, rEnc: 0.01, color: '#b9b2a7' },
  { id: 'venus', name: 'Venus', astro: 'Venus', massRatio: 408523.71, radiusKm: 6051.8, rEnc: 0.01, color: '#e8c98a' },
  { id: 'earth', name: 'Earth', astro: 'Earth', massRatio: 328900.56, radiusKm: 6371, rEnc: 0.01, color: '#6fa8dc' },
  { id: 'mars', name: 'Mars', astro: 'Mars', massRatio: 3098708, radiusKm: 3389.5, rEnc: 0.01, color: '#d9694a' },
  { id: 'jupiter', name: 'Jupiter', astro: 'Jupiter', massRatio: 1047.3486, radiusKm: 69911, rEnc: 0.05, color: '#d8a56b' },
  { id: 'saturn', name: 'Saturn', astro: 'Saturn', massRatio: 3497.898, radiusKm: 58232, rEnc: 0.05, color: '#e3cf8f' },
  { id: 'uranus', name: 'Uranus', astro: 'Uranus', massRatio: 22902.98, radiusKm: 25362, rEnc: 0.04, color: '#8fd3d6' },
  { id: 'neptune', name: 'Neptune', astro: 'Neptune', massRatio: 19412.24, radiusKm: 24622, rEnc: 0.04, color: '#6f8cf0' },
];
export const GM = BODIES.map(b => K2 / b.massRatio);
export const indexOf = id => BODIES.findIndex(b => b.id === id);

export const dateToDays = d => d.getTime() / 864e5;
export const daysToDate = t => new Date(t * 864e5);

export function createEphemeris(Astronomy) {
  const rot = Astronomy.Rotation_EQJ_ECL();         // equatorial J2000 -> ecliptic J2000
  const cache = new Map();                          // integer day -> Float64Array(N * 3)
  const N = BODIES.length;

  function sample(day) {
    let a = cache.get(day);
    if (!a) {
      a = new Float64Array(N * 3);
      const t = Astronomy.MakeTime(new Date(day * 864e5));
      for (let i = 0; i < N; i++) {
        const v = Astronomy.RotateVector(rot, Astronomy.HelioVector(BODIES[i].astro, t));
        a[i * 3] = v.x; a[i * 3 + 1] = v.y; a[i * 3 + 2] = v.z;
      }
      cache.set(day, a);
    }
    return a;
  }

  // Catmull-Rom cubic through the four nearest daily samples.
  const cr = (y0, y1, y2, y3, f) => 0.5 * (2 * y1 + (y2 - y0) * f + (2 * y0 - 5 * y1 + 4 * y2 - y3) * f * f + (3 * y1 - y0 - 3 * y2 + y3) * f * f * f);

  function all(t, out) {
    const n = Math.floor(t), f = t - n;
    const a = sample(n - 1), b = sample(n), c = sample(n + 1), d = sample(n + 2);
    for (let k = 0; k < N * 3; k++) out[k] = cr(a[k], b[k], c[k], d[k], f);
    return out;
  }
  const tmp = new Float64Array(N * 3);
  function pos(i, t, out) {
    all(t, tmp);
    out[0] = tmp[i * 3]; out[1] = tmp[i * 3 + 1]; out[2] = tmp[i * 3 + 2];
    return out;
  }
  // The direct (uninterpolated) library value, used by tests to measure interpolation error.
  function exact(i, t) {
    const v = Astronomy.RotateVector(rot, Astronomy.HelioVector(BODIES[i].astro, Astronomy.MakeTime(new Date(t * 864e5))));
    return [v.x, v.y, v.z];
  }
  return { all, pos, exact, size: () => cache.size, N };
}
