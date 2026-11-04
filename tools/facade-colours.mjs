// Samples real facade colours from the geotagged Commons photos in data/<city>/photos/index.json.
// A photo with a camera heading is matched to the first building footprint its centre line
// hits; the facade colour is the median of the centre of the frame, with sky, foliage and
// dark windows masked out. Writes data/<city>/facade-colours.json: { osmWayId: '#rrggbb' }.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import CITY from './city.cjs';

const { DATA, project } = CITY;
const UA = { 'User-Agent': 'oslo-gta-local/1.0 (personal project; colour reference)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const raw = JSON.parse(readFileSync(`${DATA}base-raw.json`));
const buildings = raw.elements
  .filter((e) => e.type === 'way' && e.tags?.building && e.geometry?.length >= 4)
  .map((e) => ({ id: e.id, p: e.geometry.map((g) => project(g.lat, g.lon)), tagged: !!e.tags['building:colour'] }));

// Distance along the ray (ox, oz) + t (dx, dz) to the nearest footprint edge.
function firstHit(ox, oz, dx, dz) {
  let best = null;
  for (const b of buildings) {
    for (let i = 0; i < b.p.length - 1; i++) {
      const [ax, az] = b.p[i], [bx, bz] = b.p[i + 1];
      const ex = bx - ax, ez = bz - az, den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((ax - ox) * ez - (az - oz) * ex) / den, u = ((ax - ox) * dz - (az - oz) * dx) / den;
      if (t > 3 && t < 70 && u >= 0 && u <= 1 && (!best || t < best.t)) best = { b, t };
    }
  }
  return best;
}

// Median facade colour of the frame centre, or null when too little facade shows.
function facadeColour(img) {
  const { data, height, width } = img, kept = [];
  for (let y = Math.floor(height * 0.25); y < height * 0.75; y += 2) {
    for (let x = Math.floor(width * 0.3); x < width * 0.7; x += 2) {
      const i = (y * width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 60 || lum > 245) continue; // windows, shadow, blown-out sky
      if (b > r + 12 && b > g) continue; // sky and glass reflections
      if (g > r + 8 && g > b + 8) continue; // trees
      kept.push([r, g, b, lum]);
    }
  }
  if (kept.length < 400) return null;
  // The lit facade: pixels between the 40th and 90th brightness percentile.
  kept.sort((a, b) => a[3] - b[3]);
  const lit = kept.slice(Math.floor(kept.length * 0.4), Math.floor(kept.length * 0.9));
  const median = (k) => lit.map((p) => p[k]).sort((a, b) => a - b)[lit.length >> 1];
  return [median(0), median(1), median(2)];
}

const photos = JSON.parse(readFileSync(`${DATA}photos/index.json`));
const cacheDir = `${DATA}photos/cache/`;
if (!existsSync(cacheDir)) mkdirSync(cacheDir);
const samples = new Map();
// Match photos to buildings first, then download the thumbnails six at a time.
const jobs = [];
for (const photo of photos.filter((p) => Number.isFinite(p.heading))) {
  const [ox, oz] = project(photo.lat, photo.lon), a = (photo.heading * Math.PI) / 180;
  const hit = firstHit(ox, oz, Math.sin(a), -Math.cos(a));
  if (hit && !hit.b.tagged) jobs.push({ file: cacheDir + encodeURIComponent(photo.title.replace(/^File:/, '')), hit, photo });
}
console.log('photos facing a building', jobs.length);
let next = 0, used = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < jobs.length) {
    const { file, photo } = jobs[next++];
    if (existsSync(file)) continue;
    const res = await fetch(photo.thumb, { headers: UA });
    if (res.ok) writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    else await sleep(2000);
  }
}));
for (const { file, hit } of jobs) {
  if (!existsSync(file)) continue;
  let img;
  try { img = jpeg.decode(readFileSync(file), { maxMemoryUsageInMB: 256, useTArray: true }); } catch { continue; }
  const c = facadeColour(img);
  if (!c) continue;
  used++;
  if (!samples.has(hit.b.id)) samples.set(hit.b.id, []);
  samples.get(hit.b.id).push(c);
}

// Per building: channel median across photos, with lightness clamped so a photo taken in
// shade or against the sun doesn't paint the building black or white.
const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const out = {};
for (const [id, list] of samples) {
  const median = (k) => list.map((c) => c[k]).sort((a, b) => a - b)[list.length >> 1];
  let c = [median(0), median(1), median(2)];
  const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2], target = Math.max(120, Math.min(225, lum * 1.15));
  c = c.map((v) => v * (target / lum));
  out[id] = hex(c);
}
writeFileSync(`${DATA}facade-colours.json`, JSON.stringify(out, null, 0));
console.log('photos used', used, 'buildings coloured', Object.keys(out).length, 'of', buildings.length);
