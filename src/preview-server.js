import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ProfileStore } from './store.js';
import { discoverInstallation } from './steam.js';
import { readPreviewFont } from './assets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function startPreview({ port = 0, dataDirectory = path.join(root, '.preview-data') } = {}) {
  const store = await new ProfileStore(dataDirectory).open();
  const token = randomBytes(24).toString('hex');
  let font = null;
  try { font = await readPreviewFont(await discoverInstallation()); } catch { /* The DOM fallback remains fully usable. */ }
  const staticFiles = new Map([
    ['/', ['preview/index.html', 'text/html; charset=utf-8']],
    ['/preview.js', ['preview/preview.js', 'text/javascript; charset=utf-8']],
    ['/src/controller.js', ['src/controller.js', 'text/javascript; charset=utf-8']],
    ['/src/ui.js', ['src/ui.js', 'text/javascript; charset=utf-8']],
  ]);
  const server = createServer(async (request, response) => {
    const send = (status, content, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
      response.end(content);
    };
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'POST' && url.pathname === '/rpc') {
        if (request.headers.authorization !== `Bearer ${token}`) { send(403, JSON.stringify({ error: 'Preview token required.' })); return; }
        let size = 0; const chunks = [];
        for await (const chunk of request) { size += chunk.length; if (size > 20 * 1024 * 1024) { send(413, JSON.stringify({ error: 'Request is too large.' })); return; } chunks.push(chunk); }
        const { method, params } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const result = await store.dispatch(method, params);
        send(200, JSON.stringify({ result })); return;
      }
      if (request.method !== 'GET') { send(405, '{}'); return; }
      if (url.pathname === '/font.png' && font) { send(200, font.image, 'image/png'); return; }
      if (url.pathname === '/font.fnt' && font) { send(200, font.metrics, 'application/xml'); return; }
      const item = staticFiles.get(url.pathname);
      if (!item) { send(404, '{}'); return; }
      send(200, await fs.readFile(path.join(root, item[0])), item[1]);
    } catch (error) { send(400, JSON.stringify({ error: error.message })); }
  });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (error) { await store.close(); throw error; }
  return {
    url: `http://127.0.0.1:${server.address().port}/#${token}`,
    async close() { await new Promise(resolve => server.close(resolve)); await store.close(); },
  };
}
