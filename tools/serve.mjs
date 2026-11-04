// Static server for the game that disables caching, so edits always load fresh.
// Usage: node tools/serve.mjs [port]
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const port = Number(process.argv[2] || 8777);
const TYPES = { '.css': 'text/css', '.glb': 'model/gltf-binary', '.html': 'text/html', '.jpg': 'image/jpeg', '.js': 'text/javascript', '.json': 'application/json', '.mjs': 'text/javascript', '.png': 'image/png', '.wasm': 'application/wasm' };
const handler = (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, path);
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    statSync(file);
  } catch {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'cache-control': 'no-store', 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
};
// Loopback only, on both IPv4 and IPv6 so "localhost" works in every browser.
createServer(handler).listen(port, '127.0.0.1', () => console.log(`Grand Theft Oslo on http://localhost:${port}`));
createServer(handler).listen(port, '::1');
