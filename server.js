// Zero-dependency static server: `npm start` then open http://localhost:5300
// It serves ONLY the files the page needs (an allow-list), on 127.0.0.1.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT) || 5300;
const FILES = {
  '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'],
  '/app.js': ['app.js', 'text/javascript'], '/ephem.js': ['ephem.js', 'text/javascript'], '/sim.js': ['sim.js', 'text/javascript'],
  '/solve.js': ['solve.js', 'text/javascript'], '/presets.js': ['presets.js', 'text/javascript'],
  '/vendor/astronomy.browser.min.js': ['vendor/astronomy.browser.min.js', 'text/javascript'],
};

createServer(async (req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end('bad request'); return; }
  const hit = Object.hasOwn(FILES, path) ? FILES[path] : null;
  if (!hit) { res.writeHead(404).end('not found'); return; }
  try {
    res.writeHead(200, { 'content-type': hit[1] + '; charset=utf-8', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' })
      .end(await readFile(root + hit[0]));
  } catch { res.writeHead(404).end('not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Grand Tour -> http://localhost:${port}`));
