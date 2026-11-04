// Headless flight test: gets in the Roadster at the spawn, boosts, takes off, climbs, flies and
// lands, saving a screenshot per step to shots/fly-*.png and printing any exceptions.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const outDir = new URL('../shots/', import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9337', '--user-data-dir=/tmp/oslo-gta-fly-chrome', '--window-size=1280,760', ...(process.env.GPU ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']), 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 120 && !target; i++) { await sleep(250); try { target = (await (await fetch('http://127.0.0.1:9337/json')).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') console.log('[exception]', m.params.exceptionDetails.exception?.description?.split('\n').slice(0, 3).join(' | '));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.log('[console.error]', m.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => (await send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })).result?.value;
const key = (code, down = true) => evalJs(`dispatchEvent(new KeyboardEvent('${down ? 'keydown' : 'keyup'}', { code: '${code}' })); true`);
const hold = async (codes, ms) => { for (const c of codes) await key(c); await sleep(ms); for (const c of codes) await key(c, false); };
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
  writeFileSync(`${outDir}fly-${name}.jpg`, Buffer.from(data, 'base64'));
  console.log(name, JSON.stringify(await evalJs('(() => { const v = oslo.player.vehicle; return v ? { kind: v.kind, air: v.air && +v.air.toFixed(1), alt: +v.altitude.toFixed(1), kmh: Math.round(v.speed * 3.6), flying: v.flying, health: Math.round(v.health) } : { onFoot: true }; })()')));
};
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: process.env.URL || 'http://127.0.0.1:8777/' });
for (let i = 0; i < 200; i++) { await sleep(500); if ((await evalJs("document.getElementById('loading')?.textContent")) === 'Ready.') break; }
await evalJs("document.getElementById('start').click(); true");
// CLEAN=1 hides the HUD, for store-page screenshots.
if (process.env.CLEAN) await evalJs("document.head.insertAdjacentHTML('beforeend', '<style>.hud { display: none !important; }</style>'); true");
await sleep(1500);
console.log('fps', await evalJs('new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(Math.round(n / 2)); }; requestAnimationFrame(f); })'));
// Stand beside the Roadster and get in.
console.log('roadster', await evalJs(`(() => { const v = oslo.vehicles.find((o) => o.kind === 'roadster'); if (!v) return 'missing'; oslo.player.x = v.x + Math.cos(v.h) * 2; oslo.player.z = v.z - Math.sin(v.h) * 2; return [Math.round(v.x), Math.round(v.z)]; })()`));
await sleep(800);
await key('KeyF'); await key('KeyF', false);
await sleep(1500);
await shot('1-parked');
await hold(['KeyW', 'ShiftLeft'], 900);
await shot('2-boost');
await hold(['KeyS'], 1600);
await key('KeyG'); await key('KeyG', false);
await hold(['Space'], 3500);
await shot('3-climb');
// A close look from the side and behind, then back to the chase camera.
for (const [name, side, back] of [['3b-side', 5.5, 2], ['3c-rear', 1.5, -7]]) {
  await evalJs(`(() => { const v = oslo.player.vehicle, fx = Math.sin(v.h), fz = Math.cos(v.h), y = v.air - oslo.terrainAt(v.x, v.z); oslo.debugCam = { from: [v.x + fz * ${side} + fx * ${back}, y + 1.6, v.z - fx * ${side} + fz * ${back}], to: [v.x, y + 0.5, v.z] }; return true; })()`);
  await sleep(400);
  await shot(name);
}
await evalJs('oslo.debugCam = null; true');
await hold(['KeyW'], 4000);
await shot('4-fly');
await hold(['KeyW', 'KeyA'], 2000);
await shot('5-bank');
await key('KeyG'); await key('KeyG', false);
await sleep(9000);
await shot('6-landed');
ws.close();
chrome.kill();
process.exit(0);
