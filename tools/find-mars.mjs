// Finds a Mars transfer for a launch date. Usage: node tools/find-mars.mjs [YYYY-MM-DD] [body]
import * as Astronomy from 'astronomy-engine';
import { createEphemeris, dateToDays, daysToDate } from '../ephem.js';
import { autoAim } from '../solve.js';

const eph = createEphemeris(Astronomy);
const day = process.argv[2] || '2020-07-30', body = process.argv[3] || 'mars';
const t0 = dateToDays(new Date(day + 'T12:00:00Z'));
const T = Date.now();
const r = await autoAim(eph, t0, body, { radiusKm: body === 'mars' ? 20000 : 150000, days: 365 * 2, grid: [[2.5, 4.5, 0.25], [-8, 12, 2.5], [-3, 3, 1.5]] });
console.log(JSON.stringify({ day, body, vinf: +r.vinf.toFixed(4), angle: +r.angle.toFixed(3), pitch: +r.pitch.toFixed(3) }), 'miss km', Math.round(r.missKm), 'on', daysToDate(r.t).toISOString().slice(0, 10), 'in', Date.now() - T, 'ms');
