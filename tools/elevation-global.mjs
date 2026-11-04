// Ground heights for cities outside Norway, in the same grid elevation-kartverket.mjs writes:
// data/<city>/terrain.bin and surface.bin (Int16 cm on a 2 m grid in game coordinates; the
// surface is the ground, as there is no surface model) and terrain.json.
//   "elevation": "global"  AWS Terrain Tiles (Terrarium PNGs at zoom 15, cached in
//                          data/<city>/terrarium/). Mostly 30 m SRTM, finer where countries
//                          publish more; credit "Terrain Tiles: Mapzen and data sources",
//                          https://github.com/tilezen/joerd/blob/master/docs/attribution.md
//   "elevation": "flat"    every height 0, no download.
// Heights are stored relative to "elevationBase" (metres; default 0, sea level, so a coastal
// city's sea sits at the game's water level). Inland cities set a number near their lowest
// ground, or "min" for the lowest point in the box: the grid holds Int16 cm, ±327 m.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import CITY from './city.cjs';

const { BOX, DATA, city } = CITY;
const ZOOM = 15, flat = city.elevation === 'flat';

// Decodes an 8-bit RGB or RGBA PNG (what Terrarium tiles are) to [width, height, bytes per
// pixel, pixels].
function decodePng(buf) {
  let pos = 8, width = 0, height = 0, channels = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || (body[9] !== 2 && body[9] !== 6)) throw new Error(`PNG must be 8-bit RGB or RGBA (depth ${body[8]}, colour type ${body[9]})`);
      channels = body[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * channels, out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[o + x - channels] : 0, b = y ? out[o - stride + x] : 0, c = x >= channels && y ? out[o - stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      out[o + x] = (line[x] + predictor) & 255;
    }
  }
  return [width, height, channels, out];
}

// Terrarium tile heights (metres) by tile x/y, downloaded once.
const tiles = new Map(), cache = `${DATA}terrarium/`;
if (!flat) mkdirSync(cache, { recursive: true });
async function tile(tx, ty) {
  const key = `${tx}_${ty}`;
  if (tiles.has(key)) return tiles.get(key);
  const file = `${cache}${ZOOM}_${key}.png`;
  if (!existsSync(file)) {
    const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${tx}/${ty}.png`);
    if (!res.ok) throw new Error(`Terrarium tile ${ZOOM}/${tx}/${ty}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const [w, h, ch, px] = decodePng(readFileSync(file)), m = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = px[i * ch] * 256 + px[i * ch + 1] + px[i * ch + 2] / 256 - 32768;
  tiles.set(key, m);
  return m;
}
// Web Mercator pixel position at ZOOM (256 px tiles).
const pixel = (lat, lon) => {
  const n = 256 * 2 ** ZOOM, s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
};

// The game grid: 2 m cells over the box plus 40 m, as elevation-kartverket.mjs.
const [gx0, gz1] = CITY.project(BOX.minLat, BOX.minLon), [gx1, gz0] = CITY.project(BOX.maxLat, BOX.maxLon);
const G = { cell: 2, minX: Math.floor(gx0 / 2) * 2 - 40, minZ: Math.floor(gz0 / 2) * 2 - 40 };
G.nx = Math.ceil((gx1 + 40 - G.minX) / 2) + 1;
G.nz = Math.ceil((gz1 + 40 - G.minZ) / 2) + 1;

const heights = new Float32Array(G.nx * G.nz);
if (!flat) {
  // Fetch every tile the grid touches first, then sample bilinearly across tile edges.
  const [px0, py0] = pixel(...CITY.unproject(G.minX, G.minZ)), [px1, py1] = pixel(...CITY.unproject(G.minX + G.nx * 2, G.minZ + G.nz * 2));
  for (let tx = Math.floor((px0 - 2) / 256); tx <= Math.floor((px1 + 2) / 256); tx++) for (let ty = Math.floor((py0 - 2) / 256); ty <= Math.floor((py1 + 2) / 256); ty++) await tile(tx, ty);
  console.log('terrarium tiles', tiles.size);
  const at = (x, y) => tiles.get(`${Math.floor(x / 256)}_${Math.floor(y / 256)}`)[(y % 256) * 256 + (x % 256)];
  for (let j = 0; j < G.nz; j++) for (let i = 0; i < G.nx; i++) {
    const [fx, fy] = pixel(...CITY.unproject(G.minX + i * G.cell, G.minZ + j * G.cell)).map((v) => v - 0.5), x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
    heights[j * G.nx + i] = (1 - tx) * (1 - ty) * at(x, y) + tx * (1 - ty) * at(x + 1, y) + (1 - tx) * ty * at(x, y + 1) + tx * ty * at(x + 1, y + 1);
  }
}
// Sea and bathymetry clamp to sea level, as the Kartverket grid does.
let lo = Infinity, hi = -Infinity;
for (let k = 0; k < heights.length; k++) { heights[k] = Math.max(0, heights[k]); lo = Math.min(lo, heights[k]); hi = Math.max(hi, heights[k]); }
const base = city.elevationBase === 'min' ? Math.floor(lo) : city.elevationBase || 0;
if (hi - base > 327) console.warn(`warning: ground up to ${hi.toFixed(0)} m, ${(hi - base - 327).toFixed(0)} m above what the grid holds over elevationBase ${base} m; set "elevationBase" higher`);
const terrain = new Int16Array(G.nx * G.nz);
for (let k = 0; k < heights.length; k++) terrain[k] = Math.round(Math.max(-327, Math.min(327, heights[k] - base)) * 100);
G.base = base;
writeFileSync(`${DATA}terrain.bin`, Buffer.from(terrain.buffer));
writeFileSync(`${DATA}surface.bin`, Buffer.from(terrain.buffer));
writeFileSync(`${DATA}terrain.json`, JSON.stringify(G));
console.log('terrain', `${G.nx}x${G.nz}`, flat ? 'flat' : `range ${lo.toFixed(1)} - ${hi.toFixed(1)} m, stored above ${base} m`);
