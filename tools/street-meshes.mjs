// Builds the street surfaces ahead of time (after Worldhood's prebuilt surface chunks): for every
// 300 m tile of data/streets.json, the carriageway, sidewalks, dropped kerbs, paths, setts,
// wooden decks and zebra bars are triangulated and laid on the drive terrain, and the kerbs
// and gutters built along the sidewalk edges (street-geometry.js). The game only loads them.
// Writes data/street-mesh/<ix>_<iz>.bin: a Uint32 header length, a JSON header
// { origin: [x, z, y], layers: { name: [offset, count] } }, padding to 4 bytes, then Int16
// centimetres: positions (x and z from the tile's origin, y from the tile's lowest point:
// origin[2]), and for the kerbs `curbAlong`, one value per vertex (metres along the kerb).
// Run after tools/streets.mjs and tools/drive-terrain.mjs.
import fs from 'node:fs';
import CITY from './city.cjs';
import { DATUM } from '../terrain.js';
import { kerbPositions, polygonPositions, ROAD_Y, KERB_TOP } from '../street-geometry.js';

const { DATA } = CITY;
const G = JSON.parse(fs.readFileSync(`${DATA}terrain.json`, 'utf8'));
const cm = new Int16Array(fs.readFileSync(`${DATA}terrain.bin`).buffer.slice(0));
// The game's heightAt: bilinear in the 2 m grid, metres above DATUM.
const height = (x, z) => {
  const at = (i, j) => cm[Math.min(G.nz - 1, Math.max(0, j)) * G.nx + Math.min(G.nx - 1, Math.max(0, i))] / 100 - DATUM;
  const fx = (x - G.minX) / G.cell, fz = (z - G.minZ) / G.cell, i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  return (1 - tx) * (1 - tz) * at(i, j) + tx * (1 - tz) * at(i + 1, j) + (1 - tx) * tz * at(i, j + 1) + tx * tz * at(i + 1, j + 1);
};
const streets = JSON.parse(fs.readFileSync(`${DATA}streets.json`, 'utf8'));
// Surfaces and their heights above the ground.
const SURFACES = { drop: ROAD_Y + 0.02, path: 0.07, road: ROAD_Y, sett: 0.07, walk: KERB_TOP, wood: 0.09, zebra: ROAD_Y + 0.015 };
const dir = `${DATA}street-mesh`;
fs.rmSync(dir, { force: true, recursive: true });
fs.mkdirSync(dir);
let bytes = 0, done = 0;
const started = Date.now();
for (const [key, t] of Object.entries(streets.tiles)) {
  const layers = {};
  for (const [name, y] of Object.entries(SURFACES)) if (t[name]?.length) layers[name] = polygonPositions(t[name], y, height);
  if (t.kerbs?.length) Object.assign(layers, kerbPositions(t.kerbs, t.walk || [], height));
  const [ix, iz] = key.split('|').map(Number), header = { layers: {}, origin: [ix * streets.tile, iz * streets.tile, 0] }, parts = [];
  let offset = 0;
  for (const [name, pos] of Object.entries(layers)) {
    if (!pos.length) continue;
    header.layers[name] = [offset, pos.length];
    parts.push(pos);
    offset += pos.length;
  }
  if (!parts.length) continue;
  let ymin = Infinity;
  for (const [name, p] of Object.entries(layers)) if (name !== 'curbAlong') for (let i = 1; i < p.length; i += 3) ymin = Math.min(ymin, p[i]);
  header.origin[2] = Math.floor(ymin);
  const json = Buffer.from(JSON.stringify(header)), pad = (4 - ((4 + json.length) % 4)) % 4;
  const ints = new Int16Array(offset);
  let o = 0;
  for (const [name, p] of Object.entries(layers)) {
    if (!p.length) continue;
    if (name === 'curbAlong') { for (let i = 0; i < p.length; i++) ints[o++] = Math.round(p[i] * 100); continue; }
    for (let i = 0; i < p.length; i++) ints[o++] = Math.round((p[i] - header.origin[i % 3 === 0 ? 0 : i % 3 === 2 ? 1 : 2]) * 100);
  }
  const out = Buffer.concat([Buffer.from(new Uint32Array([json.length]).buffer), json, Buffer.alloc(pad, 32), Buffer.from(ints.buffer)]);
  fs.writeFileSync(`${dir}/${key.replace('|', '_')}.bin`, out);
  bytes += out.length;
  if (++done % 40 === 0) console.log(`${done} tiles, ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
console.log(`street meshes: ${done} tiles, ${(bytes / 1e6).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(0)} s`);
