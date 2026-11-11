import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

function start() {
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: '0' } });
  return new Promise((resolve, reject) => {
    child.stdout.on('data', d => { const m = /localhost:(\d+)/.exec(String(d)); if (m) resolve({ child, port: Number(m[1]) }); });
    child.on('error', reject);
    setTimeout(() => reject(new Error('server did not start')), 5000);
  });
}
// Raw request, so paths like /%2e%2e/x are sent exactly as written (fetch would tidy them up).
const ask = (port, path, { method = 'GET', host } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, path, method, headers: host ? { host } : {} }, res => {
    const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
  });
  r.on('error', reject); r.end();
});

test('server: serves only the allow-listed files, with the right types and security headers', async () => {
  const { child, port } = await start();
  try {
    for (const [path, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/style.css', 'text/css'], ['/vendor/astronomy.browser.min.js', 'text/javascript']]) {
      const r = await ask(port, path);
      assert.equal(r.status, 200, path);
      assert.ok(r.headers['content-type'].startsWith(type), path);
    }
    const page = await ask(port, '/');
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(page.headers['x-frame-options'], 'DENY');
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    assert.ok(page.body.includes('<title>Grand Tour</title>'));
    // none of these may ever be served
    for (const path of ['/server.js', '/server.test.js', '/sim.test.js', '/package.json', '/package-lock.json', '/node_modules/astronomy-engine/package.json',
      '/.git/config', '/..%2fpackage.json', '/%2e%2e/package.json', '/%252e%252e/package.json', '//app.js', '/app.js%00', '/app.js.', '/APP.JS', '/tools/find-mars.mjs', '/docs/jupiter-saturn.jpg']) {
      assert.equal((await ask(port, path)).status, 404, path);
    }
    assert.equal((await ask(port, '/%E0%A4%A')).status, 400);                       // malformed escape: refused, not a crash
    assert.equal((await ask(port, '/')).status, 200);                               // still alive afterwards
  } finally { child.kill(); }
});

test('server: refuses other Host names (DNS rebinding) and write methods', async () => {
  const { child, port } = await start();
  try {
    assert.equal((await ask(port, '/', { host: 'evil.example' })).status, 403);
    assert.equal((await ask(port, '/', { host: `localhost:${port}` })).status, 200);
    assert.equal((await ask(port, '/', { method: 'POST' })).status, 405);
    assert.equal((await ask(port, '/', { method: 'DELETE' })).status, 405);
    const head = await ask(port, '/app.js', { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(head.body, '');
  } finally { child.kill(); }
});
