// Turns the Kartverket grids (tools/fetch-elevation-kartverket.mjs) into game data in
// data/<city>/: terrain.bin and surface.bin (ground and surface height, Int16 cm, on a 2 m
// grid in game coordinates; terrain.json describes the grid), building-heights.json
// (per-building ground level and roof height from DOM - DTM) and bridge-heights.json.
// Run after tools/preprocess.cjs. (tools/elevation-global.mjs writes the same grids elsewhere.)
import { readFileSync, writeFileSync } from 'node:fs';
import { fromArrayBuffer } from 'geotiff';
import CITY from './city.cjs';
import { toUtm32 } from './utm.mjs';

const { DATA } = CITY;
const box = JSON.parse(readFileSync(`${DATA}elevation-box.json`));
async function grid(name) {
  const W = box.maxX - box.minX, H = box.maxY - box.minY, out = new Float32Array(W * H).fill(NaN);
  for (const [i, [x0, y0, x1, y1]] of box.tiles.entries()) {
    const buf = readFileSync(`${DATA}elevation-${name}-${i}.tif`);
    const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    const img = await tiff.getImage(), [data] = await img.readRasters(), w = img.getWidth(), h = img.getHeight();
    // Tile rows run north to south from y1; the grid's rows run from box.maxY.
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const v = data[r * w + c], row = box.maxY - y1 + r, col = x0 - box.minX + c;
      if (row >= 0 && row < H && col >= 0 && col < W && v > -500) out[row * W + col] = v;
    }
  }
  // sample(utmX, utmY): bilinear, rows from the north edge.
  return (x, y) => {
    const fx = x - box.minX - 0.5, fy = box.maxY - y - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const at = (c, r) => out[Math.min(H - 1, Math.max(0, r)) * W + Math.min(W - 1, Math.max(0, c))];
    const v = (1 - tx) * (1 - ty) * at(ix, iy) + tx * (1 - ty) * at(ix + 1, iy) + (1 - tx) * ty * at(ix, iy + 1) + tx * ty * at(ix + 1, iy + 1);
    return Number.isNaN(v) ? at(ix, iy) : v;
  };
}
const dtm = await grid('dtm'), dom = await grid('dom');
const { KX, KZ, LAT0, LON0 } = CITY;
const utmOf = (x, z) => toUtm32(...CITY.unproject(x, z));

// Terrain (DTM) and surface (DOM) on a 2 m grid over the game box, in cm above NN2000
// (sea clamped to 0). The surface carries buildings' real roof shapes.
const B = CITY.BOX;
const [gx0, gz1] = [(B.minLon - LON0) * KX, -(B.minLat - LAT0) * KZ], [gx1, gz0] = [(B.maxLon - LON0) * KX, -(B.maxLat - LAT0) * KZ];
const G = { cell: 2, minX: Math.floor(gx0 / 2) * 2 - 40, minZ: Math.floor(gz0 / 2) * 2 - 40 };
G.nx = Math.ceil((gx1 + 40 - G.minX) / 2) + 1;
G.nz = Math.ceil((gz1 + 40 - G.minZ) / 2) + 1;
const terrain = new Int16Array(G.nx * G.nz), surface = new Int16Array(G.nx * G.nz);
let lo = Infinity, hi = -Infinity;
for (let j = 0; j < G.nz; j++) for (let i = 0; i < G.nx; i++) {
  const u = utmOf(G.minX + i * G.cell, G.minZ + j * G.cell), v = dtm(...u), w = dom(...u);
  const h = Number.isFinite(v) ? Math.max(0, v) : 0;
  terrain[j * G.nx + i] = Math.round(h * 100);
  surface[j * G.nx + i] = Math.round((Number.isFinite(w) ? Math.max(h, w) : h) * 100);
  lo = Math.min(lo, h); hi = Math.max(hi, h);
}
writeFileSync(`${DATA}terrain.bin`, Buffer.from(terrain.buffer));
writeFileSync(`${DATA}surface.bin`, Buffer.from(surface.buffer));
writeFileSync(`${DATA}terrain.json`, JSON.stringify(G));
console.log('terrain', G.nx + 'x' + G.nz, 'range', lo.toFixed(1), '-', hi.toFixed(1), 'm');

// Buildings: sample a 1.5 m grid inside each footprint; ground = 10th percentile DTM,
// roof = 90th percentile of DOM - DTM (ignores antennas and overhanging trees).
const data = JSON.parse(readFileSync(`${DATA}world.json`));
const inside = (x, z, p) => { let r = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) r = !r; return r; };
const pct = (a, q) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))];
const heights = {};
data.buildings.forEach((b, k) => {
  const xs = b.p.map((q) => q[0]), zs = b.p.map((q) => q[1]), ground = [], top = [];
  for (let x = Math.min(...xs) + 0.75; x < Math.max(...xs); x += 1.5) for (let z = Math.min(...zs) + 0.75; z < Math.max(...zs); z += 1.5) {
    if (!inside(x, z, b.p) || (b.holes || []).some((h) => inside(x, z, h))) continue;
    const u = utmOf(x, z), g = dtm(...u), s = dom(...u);
    if (Number.isFinite(g) && Number.isFinite(s)) { ground.push(g); top.push(s - g); }
  }
  // Ground under the walls too (the edges), so the base meets the lowest corner.
  for (const [x, z] of b.p) { const g = dtm(...utmOf(x, z)); if (Number.isFinite(g)) ground.push(g); }
  if (top.length >= 6) heights[`${Math.round(b.p[0][0] * 10)},${Math.round(b.p[0][1] * 10)}`] = [+pct(ground, 0.05).toFixed(2), +pct(top, 0.9).toFixed(1)];
});
writeFileSync(`${DATA}building-heights.json`, JSON.stringify(heights));
console.log('buildings measured', Object.keys(heights).length, 'of', data.buildings.length);

// Bridge decks: the terrain model leaves bridges out but the surface model has them, so
// the deck is measured along each bridge's centre line every 2 m (the lowest of three points
// across it, which skips lamp posts and railings). data/bridge-heights.json, keyed like the
// buildings: { 'x,z of first point': [heights in m above NN2000 at s = 0, 2, 4, ...] }.
const decks = {};
for (const line of [...data.roads, ...data.walks].filter((l) => l.br)) {
  const out = [];
  let s = 0, next = 0;
  for (let i = 0; i + 1 < line.p.length; i++) {
    const [ax, az] = line.p[i], [bx, bz] = line.p[i + 1], len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / (len || 1), nz = (bx - ax) / (len || 1);
    for (; next <= s + len; next += 2) {
      const t = (next - s) / (len || 1), x = ax + (bx - ax) * t, z = az + (bz - az) * t, off = (line.w || 3) / 4;
      const tops = [0, off, -off].map((o) => dom(...utmOf(x + nx * o, z + nz * o))).filter(Number.isFinite);
      out.push(tops.length ? +Math.min(...tops).toFixed(2) : null);
    }
    s += len;
  }
  decks[`${Math.round(line.p[0][0] * 10)},${Math.round(line.p[0][1] * 10)}`] = out;
}
writeFileSync(`${DATA}bridge-heights.json`, JSON.stringify(decks));
console.log('bridge decks measured', Object.keys(decks).length);
