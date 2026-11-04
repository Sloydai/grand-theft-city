// Headless sky-traffic test: watches the flying Roadsters over the centre and out of town while
// the camera sweeps round, counting take-offs and landings and any car that appears or is
// removed while on screen (there should be none), then films a take-off and a landing.
// Saves shots/sky-*.jpg and prints any exceptions.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const outDir = new URL('../shots/', import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9338', '--user-data-dir=/tmp/oslo-gta-sky-chrome', '--window-size=1280,760', ...(process.env.GPU ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']), 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 120 && !target; i++) { await sleep(250); try { target = (await (await fetch('http://127.0.0.1:9338/json')).json()).find((t) => t.type === 'page'); } catch {} }
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
  writeFileSync(`${outDir}sky-${name}.jpg`, Buffer.from(data, 'base64'));
  console.log(name, JSON.stringify(await evalJs(SKY)));
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
const SKY = "(() => { const sky = oslo.skyAgents, by = {}; for (const a of sky) by[a.sky.state] = (by[a.sky.state] || 0) + 1; return { cars: sky.length, full: sky.filter((a) => a.car).length, ...by, log: window.skyLog }; })()";
// In-page monitor, every 0.1 s.
await evalJs(`(() => {
  window.skyLog = { appearedInView: 0, landings: 0, max: 0, removedInView: 0, takeoffs: 0 };
  const snapshot = () => new Map(oslo.skyAgents.map((a) => [a, { seen: oslo.inView(a.x, (a.air ?? a.groundY) + 1, a.z), state: a.sky.state }]));
  let prev = snapshot();
  setInterval(() => {
    const now = snapshot();
    // (A car removed past the fog of where the camera is now, after a jump, doesn't count.)
    for (const [a, p] of prev) if (!now.has(a) && p.seen) { if (Math.hypot(a.x - oslo.camera.position.x, a.z - oslo.camera.position.z) > 1350) skyLog.removedPastFog = (skyLog.removedPastFog || 0) + 1; else skyLog.removedInView++; }
    for (const [v, n] of now) {
      const p = prev.get(v);
      if (!p && n.seen) skyLog.appearedInView++;
      if (p && p.state !== n.state) { if (n.state === 'ground') skyLog.landings++; if (n.state === 'takeoff') skyLog.takeoffs++; }
    }
    skyLog.max = Math.max(skyLog.max, now.size);
    prev = now;
  }, 100);
  // Sweep the camera round, once every 12 s.
  setInterval(() => { oslo.view.yaw += 0.05; }, 100);
  return true;
})()`);
for (let i = 1; i <= 6; i++) { await sleep(10000); await shot(`centre-${i * 10}s`); }
// Out of town: the count should fall by landings, not by cars vanishing.
await evalJs('(() => { oslo.player.x = -1660; oslo.player.z = -790; return true; })()');
for (let i = 1; i <= 5; i++) { await sleep(10000); await shot(`outside-${i * 10}s`); }
await evalJs('(() => { oslo.player.x = 296; oslo.player.z = 40; return true; })()');
await sleep(15000);
await shot('back-centre');
// Film a take-off and a landing from close by.
const film = async (state, name) => {
  const found = await evalJs(`(() => { const v = oslo.skyAgents.filter((o) => o.sky.state === '${state}').sort((a, b) => Math.hypot(a.x - oslo.player.x, a.z - oslo.player.z) - Math.hypot(b.x - oslo.player.x, b.z - oslo.player.z))[0]; window.filmed = v; return !!v; })()`);
  if (!found) return console.log('no car in', state);
  for (let f = 0; f < 15; f++) {
    await evalJs(`(() => { const v = window.filmed, y = (v.air ?? v.groundY) - oslo.terrainAt(v.x, v.z); oslo.debugCam = { from: [v.x + Math.cos(v.h) * 14 - Math.sin(v.h) * 6, y + 3, v.z - Math.sin(v.h) * 14 - Math.cos(v.h) * 6], to: [v.x, y + 1, v.z] }; return true; })()`);
    await sleep(100);
  }
  await shot(name);
  console.log(name, JSON.stringify(await evalJs('(() => { const v = window.filmed; return { state: v.sky.state, alt: +((v.air ?? v.groundY) - v.groundY).toFixed(1), kmh: Math.round(v.sky.now * 3.6), full: !!v.car }; })()')));
};
await film('takeoff', 'takeoff');
await film('landing', 'landing');
await evalJs('oslo.debugCam = null; true');
console.log('fps', await evalJs('new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(Math.round(n / 2)); }; requestAnimationFrame(f); })'), 'calls', await evalJs('oslo.renderer.info.render.calls'));
ws.close();
chrome.kill();
process.exit(0);
