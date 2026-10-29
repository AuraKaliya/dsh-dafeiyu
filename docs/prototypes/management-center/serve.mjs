// Preview only the explicit prototype assets on loopback; no application APIs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const routes = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/prototype.css', ['prototype.css', 'text/css; charset=utf-8']],
  ['/design-pages.js', ['design-pages.js', 'text/javascript; charset=utf-8']],
  ['/panels.js', ['panels.js', 'text/javascript; charset=utf-8']],
  ['/prompt-layout.js', ['prompt-layout.js', 'text/javascript; charset=utf-8']],
  ['/prototype.js', ['prototype.js', 'text/javascript; charset=utf-8']],
]);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const asset = routes.get(pathname);
  if (request.method !== 'GET' || !asset) { response.writeHead(404); response.end(); return; }
  try {
    const content = await readFile(new URL(asset[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'" });
    response.end(content);
  } catch { response.writeHead(500); response.end('Preview asset unavailable'); }
});
const port = Number(process.argv[2] ?? 0);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid preview port');
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/`, root: fileURLToPath(new URL('.', import.meta.url)), mode: 'prototype-only' })));
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
