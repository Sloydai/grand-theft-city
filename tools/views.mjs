// Screenshots from fixed viewpoints: node tools/views.mjs [name...]
// Each view: player position (keeps shadows and props around it) and a free camera.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const VIEWS = {
  akerbrygge: { cam: [-1010, 45, 330], look: [-880, 0, 150], player: [-900, 180] },
  aerial: { cam: [-200, 420, 650], look: [-150, 0, -100], player: [-200, 100] },
  domkirke: { cam: [20, 14, -60], look: [110, 18, -85], player: [60, -80] },
  karljohan: { cam: [-160, 9, -95], look: [-330, 6, -190], player: [-220, -130] },
  opera: { cam: [300, 40, 640], look: [440, 5, 480], player: [420, 520] },
  radhus: { cam: [-620, 22, 140], look: [-625, 30, -40], player: [-620, 60] },
  university: { cam: [-560, 28, -300], look: [-555, 8, -420], player: [-560, -330] },
  kjped: { cam: [-760, 3, -440], look: [-700, 1.2, -425], player: [-735, -448] },
  signs: { cam: [463.5, 2.6, 365], look: [468.2, 2.8, 354.6], player: [462, 362] },
  namesign: { cam: [-281, 2.2, 21], look: [-288.4, 2.6, 27.3], player: [-286, 24] },
  top: { cam: [55.9, 358, 15.1], look: [55.9, 0, 14.99], player: [55, 15] },
  spire: { cam: [55, 44, -60], look: [83.4, 43, -92.6], player: [60, -80] },
  tiger: { cam: [293.5, 1.6, 66.8], look: [303.6, 4, 76.1], player: [290, 62] },
  oslos: { cam: [262, 6, 100], look: [330, 8, 90], player: [270, 98] },
  stairs: { cam: [-680, 2.5, -460], look: [-693, 2.5, -440], player: [-685, -455] },
  lawntop: { cam: [-875, 120, -520.1], look: [-875, 0, -520], player: [-875, -525] },
  bridge: { cam: [640, 2, 40], look: [700, 5, 110], player: [645, 45] },
  akrobaten: { cam: [800, 3, 240], look: [845, 8, 205], player: [805, 245] },
  bridgetop: { cam: [610, 70, 70], look: [650, 0, 50], player: [645, 45] },
  grunerlokka: { cam: [790, 3, -1360], look: [830, 6, -1440], player: [795, -1365] },
  majorstuen: { cam: [-1640, 3, -1930], look: [-1700, 8, -2000], player: [-1645, -1935] },
  toyen: { cam: [1560, 4, -320], look: [1640, 10, -380], player: [1565, -325] },
  hovedoya: { cam: [-560, 40, 1600], look: [-500, 5, 1750], player: [-560, 1600] },
  wide: { cam: [0, 900, 1800], look: [0, 0, -800], player: [0, 0] },
  oslos2: { cam: [330, 3, 40], look: [470, 15, 100], player: [330, 40] },
  operafront: { cam: [330, 6, 650], look: [440, 6, 480], player: [330, 640] },
  oslostop: { cam: [300, 160, 110], look: [450, 0, 100], player: [300, 100] },
  operatop: { cam: [300, 160, 480], look: [440, 0, 478], player: [300, 470] },
  stopclose: { cam: [296, 1.7, 14], look: [284, 1.6, 30], player: [296, 14] },
  jbtop: { cam: [230, 70, 30], look: [290, 0, 25], player: [230, 30] },
  tramstop: { cam: [262, 2.2, 70], look: [290, 1, 15], player: [262, 70] },
  busstop: { cam: [345, 2.2, -42], look: [372, 1, -54], player: [345, -42] },
  kerb: { cam: [300, 1.8, -40], look: [318, 0, -26], player: [300, -40] },
  kerb2: { cam: [-366, 2, -230], look: [-352, 0, -218], player: [-366, -230] },
  operaplaza: { cam: [290, 4, 520], look: [420, 12, 470], player: [290, 520] },
  sagene: { cam: [915, 1.7, -2735], look: [874, 1.2, -2811], player: [912, -2740] },
  frognertop: { cam: [-1650, 60, -760], look: [-1690, 0, -800], player: [-1670, -790] },
  frogner: { cam: [-1665, 1.7, -790], look: [-1700, 1.2, -800], player: [-1668, -792] },
  junction: { cam: [-829, 14, -206], look: [-811, 0, -224], player: [-815, -220] },
  lawn: { cam: [-870, 1.4, -520], look: [-930, 2.5, -560], player: [-875, -525] },
  cars: { cam: [-357, 1.6, -230], look: [-364, 0.8, -222], player: [-400, -250], spawn: [['police', -364, -222, 3.3], ['taxi', -369, -224, 2.5], ['sedan', -359, -224, 0.6]] },
  bus: { cam: [-357, 1.8, -214], look: [-363, 1.5, -219], player: [-400, -250], spawn: [['bus', -363, -219, 1.9]] },
  tram: { cam: [325, 3, -222], look: [290, 4, -195], player: [310, -210] },
  street: { cam: [-352, 2.2, -212], look: [-470, 0.5, -300], player: [-400, -250] },
  street2: { cam: [180, 2.2, -40], look: [260, 0.5, 20], player: [220, -10] },
  slottsparken: { cam: [-760, 30, -420], look: [-985, 10, -565], player: [-860, -500] },
};
// HOURS=22 node tools/views.mjs ... renders at that time of day.
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(VIEWS);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9342', '--user-data-dir=/tmp/oslo-gta-views', '--window-size=1280,720', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch('http://127.0.0.1:9342/json')).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') console.log('[exception]', m.params.exceptionDetails.exception?.description?.split('\n').slice(0, 2).join(' | '));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => (await send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })).result?.value;
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8777/' });
for (let i = 0; i < 160; i++) { await sleep(500); if ((await evalJs("document.getElementById('loading')?.textContent")) === 'Ready.') break; }
await evalJs("document.getElementById('start').click(); document.querySelectorAll('.hud').forEach((h) => h.style.display = 'none'); true");
for (const name of names) {
  // '@x,z,lookX,lookZ[,camY]' is an ad-hoc street-level view.
  const at = name.startsWith('@') && name.slice(1).split(',').map(Number);
  const v = at ? { cam: [at[0], at[4] ?? 1.7, at[1]], look: [at[2], 1, at[3]], player: [at[0], at[1]] } : VIEWS[name];
  if (process.env.HOURS) await evalJs(`oslo.setHours(${Number(process.env.HOURS)}); true`);
  await evalJs(`(() => { oslo.player.x = ${v.player[0]}; oslo.player.z = ${v.player[1]}; oslo.debugCam = { from: ${JSON.stringify(v.cam)}, to: ${JSON.stringify(v.look)} }; return true; })()`);
  // Build the streamed tiles around the camera at once (headless runs too slowly to wait).
  // (Tiles waiting for their street file finish on later updates.)
  for (let k = 0; k < 8; k++) { await evalJs(`(() => { oslo.streamer.update(${v.cam[0]}, ${v.cam[2]}, Infinity); return true; })()`); await sleep(400); }
  if (v.spawn) await evalJs(`(() => { for (const [k, x, z, h] of ${JSON.stringify(v.spawn)}) oslo.spawnVehicle(k, x, z, h); return true; })()`);
  await sleep(4000);
  // PROBE='<js expression>' prints a value from the page at each view.
  if (process.env.PROBE) console.log(name, JSON.stringify(await evalJs(process.env.PROBE)));
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
  writeFileSync(new URL(`../shots/view-${at ? 'at' + names.indexOf(name) : name}.jpg`, import.meta.url), Buffer.from(data, 'base64'));
  console.log('shot', name);
}
ws.close();
chrome.kill();
process.exit(0);
