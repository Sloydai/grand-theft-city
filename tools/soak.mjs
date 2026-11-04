// Loads the game headless (GPU), starts it, and walks the player through a list of spots,
// streaming each, printing every exception and console error. Usage: node tools/soak.mjs
import { spawn } from 'node:child_process';
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9344', '--user-data-dir=/tmp/oslo-gta-soak', '--window-size=1280,720', '--use-angle=metal', '--enable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('exit', () => chrome.kill());
let target;
for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch('http://127.0.0.1:9344/json')).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') console.log('[exception]', m.params.exceptionDetails.exception?.description?.split('\n').slice(0, 4).join(' | '));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) console.log(`[${m.params.type}]`, m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  if (m.method === 'Inspector.targetCrashed') console.log('[renderer crashed]');
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => (await send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })).result?.value;
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Runtime.enable');
await send('Inspector.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8777/' });
for (let i = 0; i < 160; i++) { await sleep(500); const t = await evalJs("document.getElementById('loading')?.textContent"); if (t === 'Ready.') break; if (i % 20 === 0) console.log('loading:', t); }
await evalJs("document.getElementById('start').click(); true");
const spots = (process.argv[2] || '290,40 440,480 -380,-240 800,-1380 -1660,-790 1560,-320 -900,180 0,0 900,-2740 -560,1600').split(' ').map((s) => s.split(',').map(Number));
for (const [x, z] of spots) {
  await evalJs(`(() => { oslo.player.x = ${x}; oslo.player.z = ${z}; return true; })()`);
  await sleep(6000);
  console.log('at', x, z, JSON.stringify(await evalJs('({ heap: Math.round(performance.memory.usedJSHeapSize / 1e6), calls: oslo.renderer.info.render.calls, geos: oslo.renderer.info.memory.geometries, lost: oslo.renderer.getContext().isContextLost() })')));
  // AI cars standing on a kerb (the surface a kerb above the terrain), with where they are.
  console.log('  on kerb', JSON.stringify(await evalJs("oslo.vehicles.filter((v) => v.mode === 'ai' && oslo.surfaceHeight(v.x, v.z, 0) - oslo.terrainAt(v.x, v.z) > 0.2).map((v) => [Math.round(v.x), Math.round(v.z), v.kind])"), null, 0), 'of', await evalJs("oslo.vehicles.filter((v) => v.mode === 'ai').length"));
}
process.exit(0);
