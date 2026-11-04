// Headless smoke test: loads the game, starts it, drives around, saves screenshots and console errors.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const outDir = new URL('../shots/', import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=9333', '--user-data-dir=/tmp/oslo-gta-chrome', '--window-size=1280,800',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  try { target = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(`[${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (m.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8777/' });
const evalJs = async (expression) => (await send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })).result?.value;
for (let i = 0; i < 60; i++) { await sleep(500); if ((await evalJs("document.getElementById('loading')?.textContent")) === 'Ready.') break; }
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(outDir + name + '.png', Buffer.from(data, 'base64'));
};
const key = async (code, type) => send('Input.dispatchKeyEvent', { code, key: code.replace('Key', '').toLowerCase(), type, windowsVirtualKeyCode: code.charCodeAt(code.length - 1) });
await shot('1-title');
await evalJs("document.getElementById('start').click()");
await sleep(2500);
await shot('2-on-foot');
console.log('FPS', await evalJs("new Promise((r) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else r(Math.round(n / 3)); }; requestAnimationFrame(tick); })"));
console.log('PROPS', await evalJs("JSON.stringify(Object.entries(oslo.scene.children.filter((o) => o.isInstancedMesh).reduce((m, o) => (m[o.geometry.attributes.position.count / 3 | 0] = (m[o.geometry.attributes.position.count / 3 | 0] || 0) + o.count, m), {})))"));
console.log('RENDER', await evalJs("JSON.stringify({calls: oslo.renderer.info.render.calls, triangles: oslo.renderer.info.render.triangles})"));
console.log('NEAREST CAR', await evalJs("JSON.stringify(oslo.vehicles.map((v) => Math.hypot(v.x - oslo.player.x, v.z - oslo.player.z)).sort((a, b) => a - b).slice(0, 3).map(Math.round))"));
console.log('WORLD', await evalJs("JSON.stringify({peds: oslo.peds.length, vehicles: oslo.vehicles.length, modes: oslo.vehicles.reduce((m, v) => (m[v.mode] = (m[v.mode] || 0) + 1, m), {})})"));
await key('KeyF', 'keyDown'); await key('KeyF', 'keyUp');
await sleep(500);
await shot('3-after-F');
await key('KeyW', 'keyDown');
await sleep(4000);
await shot('4-driving');
await key('KeyA', 'keyDown');
await sleep(1500);
await key('KeyA', 'keyUp');
await key('KeyW', 'keyUp');
await sleep(500);
await shot('5-turn');
await key('KeyF', 'keyDown'); await key('KeyF', 'keyUp');
await sleep(300);
await evalJs("oslo.player.wantedPoints = 4; oslo.player.wanted = 2");
await sleep(6000);
await shot('6-cops');
console.log('COPS', await evalJs("JSON.stringify(oslo.vehicles.filter(v => v.mode === 'police').map(v => Math.round(Math.hypot(v.x - oslo.player.x, v.z - oslo.player.z))))"));
await sleep(6000);
console.log('COPS', await evalJs("JSON.stringify({d: oslo.vehicles.filter(v => v.mode === 'police').map(v => Math.round(Math.hypot(v.x - oslo.player.x, v.z - oslo.player.z))), hp: oslo.player.hp, dead: oslo.player.dead})"));
await shot('7-cops-later');
const state = await evalJs("JSON.stringify({speed: document.getElementById('speed').textContent, street: document.getElementById('street').textContent, objective: document.getElementById('objective').textContent})");
console.log('STATE', state);
console.log('LOGS\n' + logs.join('\n'));
ws.close();
chrome.kill();
process.exit(0);
