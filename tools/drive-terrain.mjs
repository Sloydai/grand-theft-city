// Terrain for driving (after Worldhood's scripts/city-terrain.mjs, github.com/worldhood/worldhood,
// MIT): the 2 m city grid from Kartverket's laser terrain model (tools/elevation.mjs, kept as
// data/terrain-raw.bin) made into one smooth height field that streets, kerbs, vehicles and
// people all stand on, so nothing pokes through anything:
//  1. The land is smoothed (Gaussian, sigma 4 m). Sea cells keep their level and land cells
//     average only land, so quay edges stay sharp instead of becoming beaches.
//  2. Every ground-level carriageway gets its own height profile: sampled every 2 m along it,
//     outliers against a running median over ±15 m replaced (kerbs, walls, embankment edges and
//     cars the model kept), then a Gaussian (sigma 6 m), and held under a 12 % grade unless
//     the street itself is steeper (up to 20 %).
//  3. The profiles are laid into the grid across each carriageway (to its half width, then
//     blending back into the ground over 6 m); crossing streets share cells by averaging.
//  4. A light final smoothing (sigma 1.6 m) removes the last seams.
// Writes data/terrain.bin (Int16, cm above NN2000). Run after tools/preprocess.cjs.
import fs from 'node:fs';
import CITY from './city.cjs';

const { DATA } = CITY;
const G = JSON.parse(fs.readFileSync(`${DATA}terrain.json`, 'utf8'));
if (!fs.existsSync(`${DATA}terrain-raw.bin`)) fs.copyFileSync(`${DATA}terrain.bin`, `${DATA}terrain-raw.bin`);
const raw = new Int16Array(fs.readFileSync(`${DATA}terrain-raw.bin`).buffer.slice(0));
const data = JSON.parse(fs.readFileSync(`${DATA}world.json`, 'utf8'));
const { cell, minX, minZ, nx, nz } = G, N = nx * nz;
const dem = Float32Array.from(raw, (v) => v / 100);
const sample = (grid) => (x, z) => {
  const u = Math.max(0, Math.min(nx - 1.001, (x - minX) / cell)), v = Math.max(0, Math.min(nz - 1.001, (z - minZ) / cell)), i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, k = j * nx + i;
  return (grid[k] * (1 - a) + grid[k + 1] * a) * (1 - b) + (grid[k + nx] * (1 - a) + grid[k + nx + 1] * a) * b;
};

// Sea mask (the coast polygons from preprocess): those cells keep their level.
const sea = new Uint8Array(N);
for (const poly of data.sea || []) {
  const zs = poly.map((q) => q[1]);
  for (let j = Math.max(0, Math.floor((Math.min(...zs) - minZ) / cell)); j <= Math.min(nz - 1, Math.ceil((Math.max(...zs) - minZ) / cell)); j++) {
    const z = minZ + j * cell, xs = [];
    for (let k = 0; k < poly.length; k++) { const a = poly[k], c = poly[(k + 1) % poly.length]; if ((a[1] > z) !== (c[1] > z)) xs.push(a[0] + ((z - a[1]) * (c[0] - a[0])) / (c[1] - a[1])); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.ceil((xs[k] - minX) / cell)); i <= Math.min(nx - 1, Math.floor((xs[k + 1] - minX) / cell)); i++) sea[j * nx + i] = 1;
  }
}

// Separable Gaussian over land cells only (sea cells unchanged and not averaged in).
function blurLand(values, sigmaCells) {
  const r = Math.ceil(sigmaCells * 2.5), k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigmaCells * sigmaCells)));
  const pass = (src, si, sj) => {
    const out = Float32Array.from(src);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const q = j * nx + i;
      if (sea[q]) continue;
      let s = 0, w = 0;
      for (let d = -r; d <= r; d++) {
        const ii = i + d * si, jj = j + d * sj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const p = jj * nx + ii;
        if (sea[p]) continue;
        s += src[p] * k[d + r]; w += k[d + r];
      }
      out[q] = s / w;
    }
    return out;
  };
  return pass(pass(values, 1, 0), 0, 1);
}

// Points every `step` metres along a polyline.
const resample = (pts, step = 2) => {
  const s = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = i > 1 ? 1 : 0; k <= n; k++) s.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return s;
};
// A carriageway's own profile: outliers against a running median replaced, then a Gaussian.
function roadProfile(h, { reach = 15, sigma = 6, step = 2 } = {}) {
  const r = Math.round(reach / step), g = Math.round((sigma / step) * 2.5);
  const m = h.map((_, i) => { const w = h.slice(Math.max(0, i - r), i + r + 1).sort((a, b) => a - b); return w[w.length >> 1]; });
  h = h.map((v, i) => (Math.abs(v - m[i]) > 0.3 ? m[i] : v));
  return h.map((_, i) => { let a = 0, w = 0; for (let k = -g; k <= g; k++) { const j = Math.max(0, Math.min(h.length - 1, i + k)), q = Math.exp(-((k * step) ** 2) / (2 * sigma * sigma)); a += h[j] * q; w += q; } return a / w; });
}
// Grade over ±span samples; the allowance is 12 %, or the street's own grade where it is
// genuinely steeper, never more than 20 %.
const grades = (h, step, span) => h.map((_, i) => { const a = Math.max(0, i - span), b = Math.min(h.length - 1, i + span); return b > a ? Math.abs(h[b] - h[a]) / ((b - a) * step) : 0; });
const allowedGrades = (h, step) => grades(h, step, 3).map((g) => Math.min(0.2, Math.max(0.12, g * 1.15)));
// Mean of the upper and lower grade-limited envelopes: a spike becomes a ramp, a dip a sag.
function limitProfile(h, allow, step) {
  const n = h.length, U = h.slice(), D = h.slice();
  for (let i = 1; i < n; i++) { const g = Math.max(allow[i], allow[i - 1]) * step; U[i] = Math.min(U[i], U[i - 1] + g); D[i] = Math.max(D[i], D[i - 1] - g); }
  for (let i = n - 2; i >= 0; i--) { const g = Math.max(allow[i], allow[i + 1]) * step; U[i] = Math.min(U[i], U[i + 1] + g); D[i] = Math.max(D[i], D[i + 1] - g); }
  return U.map((u, i) => (u + D[i]) / 2);
}

// 1. Smooth land.
let ground = blurLand(dem, 2);
// 2–3. Carriageway profiles from the unsmoothed model, laid along each street.
const PAVED = new Set(['living_street', 'pedestrian']);
const roads = data.roads.filter((r) => !PAVED.has(r.k) && !r.height && !r.br && r.w > 0);
const at = sample(dem), num = new Float32Array(N), den = new Float32Array(N), best = new Float32Array(N), FALL = 6, STEP = 2;
for (const r of roads) {
  const s = resample(r.p, STEP);
  if (s.length < 2) continue;
  let h = roadProfile(s.map(([x, z]) => at(x, z)), { step: STEP });
  h = limitProfile(h, allowedGrades(h, STEP), STEP);
  const half = r.w / 2 + 1, R = half + FALL;
  for (let i = 0; i < s.length; i++) {
    const [x, z] = s[i];
    for (let j = Math.max(0, Math.floor((z - R - minZ) / cell)); j <= Math.min(nz - 1, Math.ceil((z + R - minZ) / cell)); j++) for (let k = Math.max(0, Math.floor((x - R - minX) / cell)); k <= Math.min(nx - 1, Math.ceil((x + R - minX) / cell)); k++) {
      const q = j * nx + k;
      if (sea[q]) continue;
      const d = Math.hypot(minX + k * cell - x, minZ + j * cell - z);
      if (d > R) continue;
      const t = d <= half ? 1 : 1 - (d - half) / FALL, w = t * t * (3 - 2 * t);
      num[q] += w * h[i]; den[q] += w;
      if (w > best[q]) best[q] = w;
    }
  }
}
for (let q = 0; q < N; q++) if (den[q] > 0) ground[q] = ground[q] * (1 - best[q]) + (num[q] / den[q]) * best[q];
// 4. Light final smoothing.
ground = blurLand(ground, 0.8);

const out = new Int16Array(N);
for (let q = 0; q < N; q++) out[q] = Math.round(Math.max(0, ground[q]) * 100);
fs.writeFileSync(`${DATA}terrain.bin`, Buffer.from(out.buffer));
let changed = 0;
for (let q = 0; q < N; q++) if (Math.abs(out[q] - raw[q]) > 20) changed++;
console.log(`drive terrain: ${roads.length} carriageways profiled; ${(100 * changed / N).toFixed(1)} % of cells moved over 20 cm`);
