// Teleports the player to viewpoints and screenshots each: node tools/tour.mjs
// Override with STOPS='[["name", x, z, yaw]]'. Yaw 0 looks south (+z), PI north, PI/2 east, -PI/2 west.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const stops = process.env.STOPS ? JSON.parse(process.env.STOPS) : [
  ['slottet', -880, -565, -Math.PI / 2], ['stortinget', -271, -60, Math.PI], ['domkirke', 40, -85, Math.PI / 2], ['radhus', -623, 90, Math.PI],
  ['opera', 340, 420, 1.04], ['nationaltheatret', -520, -290, -Math.PI / 2], ['karljohan', -130, -106, -2.0],
];
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9336', '--user-data-dir=/tmp/oslo-gta-tour-chrome', '--window-size=1100,650', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch('http://127.0.0.1:9336/json')).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') console.log('[exception]', m.params.exceptionDetails.exception?.description?.split('\n')[0]);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => (await send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })).result?.value;
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8777/' });
for (let i = 0; i < 120; i++) { await sleep(500); if ((await evalJs("document.getElementById('loading')?.textContent")) === 'Ready.') break; }
await evalJs("document.getElementById('start').click()");
console.log('sites', await evalJs('JSON.stringify(oslo.sites)'));
await sleep(1500);
for (const [name, x, z, yaw] of stops) {
  await evalJs(`(() => { const p = oslo.player; p.x = ${x}; p.z = ${z}; oslo.view.yaw = ${yaw}; oslo.view.pitch = 0.12; return true; })()`);
  await sleep(4500);
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
  writeFileSync(new URL(`../shots/tour-${name}.jpg`, import.meta.url), Buffer.from(data, 'base64'));
  console.log('shot', name);
}
ws.close();
chrome.kill();
process.exit(0);
