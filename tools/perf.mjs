// Measures frame time on the real GPU (Metal) at a few spots: node tools/perf.mjs
// Prints average and worst frame (ms), draw calls, triangles and shader programs.
import { spawn } from 'node:child_process';
const SPOTS = { karljohan: [-735, -448, -700, -425], junction: [-815, -220, -811, -224], slottsparken: [-860, -500, -985, -565], street: [-400, -250, -470, -300] };
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9351', '--user-data-dir=/tmp/oslo-gta-perf', '--window-size=1600,900', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch('http://127.0.0.1:9351/json')).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => (await send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })).result?.value;
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Runtime.enable');
const loadStart = Date.now();
await send('Page.navigate', { url: `http://127.0.0.1:8777/${process.env.QUERY || ''}` });
for (let i = 0; i < 160; i++) { await sleep(500); if ((await evalJs("document.getElementById('loading')?.textContent")) === 'Ready.') break; }
console.log('load', ((Date.now() - loadStart) / 1000).toFixed(1) + ' s', 'heap', await evalJs('Math.round(performance.memory?.usedJSHeapSize / 1e6) + " MB"'));
console.log('gpu', await evalJs("(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(d.UNMASKED_RENDERER_WEBGL); })()"));
await evalJs("document.getElementById('start').click(); true");
// PERF_SPLIT=1 also measures the junction with peds, foliage, grass or shadows switched off.
const measure = `new Promise((done) => { const t = []; let last = performance.now(); const tick = (now) => { t.push(now - last); last = now; if (t.length < 240) requestAnimationFrame(tick); else { t.shift(); t.sort((a, b) => a - b); const info = oslo.renderer.info; done({ avg: +(t.reduce((s, v) => s + v, 0) / t.length).toFixed(1), p95: +t[Math.floor(t.length * 0.95)].toFixed(1), worst: +t[t.length - 1].toFixed(1), calls: info.render.calls, tris: info.render.triangles, programs: info.programs.length, peds: oslo.peds.length }); } }; requestAnimationFrame(tick); })`;
// PERF_PROFILE=1 records a 4 s CPU profile at the junction and prints the top functions.
// PERF_CALLS=1 estimates draw calls at the junction by owner (frustum-visible meshes).
if (process.env.PERF_CALLS) {
  const [px, pz, lx, lz] = SPOTS.junction;
  await evalJs(`(() => { oslo.player.x = ${px}; oslo.player.z = ${pz}; oslo.debugCam = { from: [${px}, 1.7, ${pz}], to: [${lx}, 1.5, ${lz}] }; return true; })()`);
  await sleep(6000);
  console.log(JSON.stringify(await evalJs(`(() => {
    const cam = oslo.scene.getObjectByProperty('isPerspectiveCamera', true) || window.__camera;
    const owners = new Map(); oslo.vehicles.forEach((v) => v.mesh.root.traverse((o) => owners.set(o, 'cars'))); oslo.peds.forEach((p) => p.model.root.traverse((o) => owners.set(o, 'peds')));
    const out = {}, tris = {}; oslo.scene.traverseVisible((o) => { if (!o.isMesh || !o.layers.isEnabled(0)) return; const m = [].concat(o.material)[0]; const k = owners.get(o) || (o.isInstancedMesh ? (m.alphaTest > 0.4 ? 'foliage' : m.vertexColors && m.side === 2 ? 'grass' : 'props') : m.vertexColors && (m.map || m.roughnessMap) ? 'buildings' : m.vertexColors ? 'buildings-plain' : 'mesh'); const groups = Array.isArray(o.material) ? o.geometry.groups.length : 1; out[k] = (out[k] || 0) + groups; const n = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); tris[k] = Math.round((tris[k] || 0) + n / 1000); });
    const props = {}; oslo.scene.traverseVisible((o) => { if (!o.isInstancedMesh || !o.layers.isEnabled(0)) return; const per = Math.round((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3); const key = per + ' tris ' + ([].concat(o.material)[0].color?.getHexString() || ''); const e = (props[key] ||= { inst: 0, kTris: 0 }); e.inst += o.count; e.kTris += Math.round(per * o.count / 1000); });
    const top = Object.entries(props).sort((a, b) => b[1].kTris - a[1].kTris).slice(0, 12);
    return { calls: out, kTris: tris, top };
    })()`)));
  ws.close(); chrome.kill(); process.exit(0);
}
// PERF_COUNT=1 counts scene objects by owner (vehicles, people, the rest).
if (process.env.PERF_COUNT) {
  await sleep(4000);
  console.log(JSON.stringify(await evalJs(`(() => { let all = 0; oslo.scene.traverse(() => all++); const count = (root) => { let n = 0; root.traverse(() => n++); return n; }; const cars = oslo.vehicles.reduce((s, v) => s + count(v.mesh.root), 0); const people = oslo.peds.reduce((s, p) => s + count(p.model.root), 0); const kinds = {}; for (const o of oslo.scene.children) { const k = o.type + '|' + (o.userData.detail || o.name || (o.material?.type ?? '')) + '|' + (o.visible ? 'on' : 'off'); kinds[k] = (kinds[k] || 0) + 1; } return { all, cars, carCount: oslo.vehicles.length, people, top: oslo.scene.children.length, rail: oslo.railVehicles.length, kinds: Object.fromEntries(Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 15)), auto: (() => { let auto = 0, autoVisible = 0, visible = 0; oslo.scene.traverse((o) => { if (o.matrixAutoUpdate) auto++; }); oslo.scene.traverseVisible((o) => { visible++; if (o.matrixAutoUpdate) autoVisible++; }); return { auto, autoVisible, visible }; })() }; })()`)));
  ws.close(); chrome.kill(); process.exit(0);
}
// PERF_CPU=1 splits each frame's CPU time at the junction: game update before the render
// call, the render call itself, and the frame-to-frame interval.
if (process.env.PERF_CPU) {
  const [px, pz, lx, lz] = SPOTS[process.env.SPOT || 'junction'];
  await evalJs(`(() => { oslo.player.x = ${px}; oslo.player.z = ${pz}; oslo.debugCam = { from: [${px}, 1.7, ${pz}], to: [${lx}, 1.5, ${lz}] }; return true; })()`);
  await sleep(8000);
  console.log(JSON.stringify(await evalJs(`new Promise((done) => {
    const r = oslo.renderer, render = r.render.bind(r), update = [], draw = [], gap = [];
    let frameStart = 0, last = 0;
    const tick = (now) => { frameStart = performance.now(); if (last) gap.push(now - last); last = now; if (gap.length < 240) requestAnimationFrame(tick); else finish(); };
    r.render = (s, c) => { const t0 = performance.now(); update.push(t0 - frameStart); render(s, c); draw.push(performance.now() - t0); };
    const stat = (a) => { const b = a.slice().sort((x, y) => x - y); return { avg: +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(1), p95: +b[Math.floor(b.length * 0.95)].toFixed(1), max: +b[b.length - 1].toFixed(1) }; };
    const finish = () => { r.render = render; done({ draw: stat(draw), gap: stat(gap), update: stat(update) }); };
    requestAnimationFrame(tick);
  })`)));
  ws.close(); chrome.kill(); process.exit(0);
}
if (process.env.PERF_PROFILE) {
  const [px, pz, lx, lz] = SPOTS.junction;
  await evalJs(`(() => { oslo.player.x = ${px}; oslo.player.z = ${pz}; oslo.debugCam = { from: [${px}, 1.7, ${pz}], to: [${lx}, 1.5, ${lz}] }; return true; })()`);
  await sleep(6000);
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 200 });
  await send('Profiler.start');
  await sleep(4000);
  const { profile } = await send('Profiler.stop');
  const self = new Map(), dt = new Map();
  profile.samples.forEach((n, i) => dt.set(n, (dt.get(n) || 0) + (profile.timeDeltas[i] || 0)));
  for (const node of profile.nodes) {
    const f = node.callFrame, key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + (dt.get(node.id) || 0) / 1000);
  }
  // INCLUSIVE=1 prints time including callees (per function, summed over its call sites).
  if (process.env.INCLUSIVE) {
    const byId = new Map(profile.nodes.map((n) => [n.id, n])), total = new Map();
    const inclusive = (n) => (n.total ??= (dt.get(n.id) || 0) / 1000 + (n.children || []).reduce((s, c) => s + inclusive(byId.get(c)), 0));
    for (const n of profile.nodes) { const f = n.callFrame, key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`; total.set(key, (total.get(key) || 0) + inclusive(n)); }
    for (const [k, v] of [...total].sort((a, b) => b[1] - a[1]).filter(([k]) => !process.env.ONLY || k.includes(process.env.ONLY)).slice(0, 25)) console.log(v.toFixed(0).padStart(6), 'ms', k);
  } else for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).filter(([k]) => !process.env.ONLY || k.includes(process.env.ONLY)).slice(0, 25)) console.log(v.toFixed(0).padStart(6), 'ms', k);
  ws.close(); chrome.kill(); process.exit(0);
}
if (process.env.PERF_SPLIT) {
  const [px, pz, lx, lz] = SPOTS[process.env.SPOT || 'junction'];
  await evalJs(`(() => { oslo.player.x = ${px}; oslo.player.z = ${pz}; oslo.debugCam = { from: [${px}, 1.7, ${pz}], to: [${lx}, 1.5, ${lz}] }; return true; })()`);
  await sleep(10000);
  const toggles = {
    all: 'true',
    noSigns: "oslo.scene.traverse((o) => { if (o.userData.detail === 'signs') o.visible = false; })",
    noBarriers: "oslo.scene.traverse((o) => { if (o.userData.detail === 'barriers') o.visible = false; })",
    noPeds: 'oslo.peds.forEach((p) => { p.model.root.visible = false; })',
    noShadows: 'oslo.renderer.shadowMap.autoUpdate = false',
    halfRes: 'oslo.renderer.setPixelRatio(oslo.renderer.getPixelRatio() / 2)',
  };




  for (const [name, code] of Object.entries(toggles)) {
    await evalJs(`(() => { ${code}; return true; })()`);
    await sleep(1500);
    console.log(name, JSON.stringify(await evalJs(measure)));
  }
  ws.close(); chrome.kill(); process.exit(0);
}
for (const [name, [px, pz, lx, lz]] of Object.entries(SPOTS)) {
  await evalJs(`(() => { oslo.player.x = ${px}; oslo.player.z = ${pz}; oslo.debugCam = { from: [${px}, 1.7, ${pz}], to: [${lx}, 1.5, ${lz}] }; return true; })()`);
  await sleep(10000);
  const r = await evalJs(`new Promise((done) => { const t = []; let last = performance.now(); const tick = (now) => { t.push(now - last); last = now; if (t.length < 240) requestAnimationFrame(tick); else { t.shift(); t.sort((a, b) => a - b); const info = oslo.renderer.info; done({ avg: +(t.reduce((s, v) => s + v, 0) / t.length).toFixed(1), p95: +t[Math.floor(t.length * 0.95)].toFixed(1), worst: +t[t.length - 1].toFixed(1), calls: info.render.calls, tris: info.render.triangles, programs: info.programs.length, peds: oslo.peds.length }); } }; requestAnimationFrame(tick); })`);
  console.log(name, JSON.stringify(r));
}
ws.close(); chrome.kill(); process.exit(0);
