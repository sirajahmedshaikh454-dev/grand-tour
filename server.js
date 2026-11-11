// Zero-dependency static server: `npm start` then open http://localhost:5300
// It serves ONLY the files the page needs (an allow-list), on 127.0.0.1, for localhost Host headers only.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = process.env.PORT === undefined ? 5300 : Number(process.env.PORT);   // PORT=0 picks a free port
const HOSTS = new Set(['localhost', '127.0.0.1']);
const FILES = {
  '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'],
  '/app.js': ['app.js', 'text/javascript'], '/ephem.js': ['ephem.js', 'text/javascript'], '/sim.js': ['sim.js', 'text/javascript'],
  '/solve.js': ['solve.js', 'text/javascript'], '/presets.js': ['presets.js', 'text/javascript'],
  '/vendor/astronomy.browser.min.js': ['vendor/astronomy.browser.min.js', 'text/javascript'],
};
// Same policy as the page's <meta> tag, plus the parts a meta tag cannot carry (frame-ancestors).
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
  + "img-src 'self' data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'";

createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }).end('method not allowed'); return; }
  const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  if (!HOSTS.has(host)) { res.writeHead(403).end('forbidden'); return; }              // blocks DNS-rebinding
  let path;
  try { path = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400).end('bad request'); return; }
  const hit = Object.hasOwn(FILES, path) ? FILES[path] : null;
  if (!hit) { res.writeHead(404).end('not found'); return; }
  try {
    const body = await readFile(root + hit[0]);
    res.writeHead(200, {
      'content-type': hit[1] + '; charset=utf-8', 'content-security-policy': CSP, 'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    }).end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404).end('not found'); }
}).listen(port, '127.0.0.1', function () { console.log(`Grand Tour -> http://localhost:${this.address().port}`); });
