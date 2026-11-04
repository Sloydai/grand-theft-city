// Procedural vehicles, all built the same way so traffic looks consistent: one smooth skin
// lofted from cross-sections (rounded plan, tumblehome, wheel arches, glass greenhouse),
// its faces sorted into paint, glass, trim and lamps, plus seams, handles, mirrors, plates
// and separate wheels that spin and (front) steer.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Dimensions in metres. z runs forward (+z is the nose), y up, wheels on y = 0.
// cabin: [windshield base, roof front, roof rear, rear glass base] as fractions of length
// from the nose; tail: 'notch' (sedan boot), 'hatch' (near-vertical tailgate), 'box'.
// front: 'flat' for a bus face; glassRoof: tinted glass roof; chromeLine: chrome window line.
export const BODY_STYLES = {
  bus: { belt: 1.05, cabin: [0.01, 0.03, 0.99, 1.0], clearance: 0.3, front: 'flat', height: 3.2, hood: 0.02, len: 12, nose: 0.15, tail: 'box', wheelR: 0.5, wheelbase: 6.2, width: 2.55 },
  police: { belt: 0.93, cabin: [0.3, 0.44, 0.84, 0.96], chromeLine: true, clearance: 0.16, height: 1.5, hood: 0.3, len: 4.85, nose: 0.62, tail: 'hatch', wheelR: 0.35, wheelbase: 2.94, width: 1.88 },
  sedan: { belt: 0.88, cabin: [0.29, 0.44, 0.68, 0.87], clearance: 0.14, glassRoof: true, height: 1.44, hood: 0.29, len: 4.72, nose: 0.6, tail: 'notch', wheelR: 0.34, wheelbase: 2.875, width: 1.85 },
  sports: { belt: 0.74, cabin: [0.36, 0.53, 0.68, 0.93], clearance: 0.12, glassRoof: true, height: 1.28, hood: 0.36, len: 4.52, nose: 0.5, tail: 'notch', wheelR: 0.35, wheelbase: 2.45, width: 1.9 },
  suv: { belt: 0.98, cabin: [0.27, 0.42, 0.8, 0.95], clearance: 0.18, glassRoof: true, height: 1.62, hood: 0.27, len: 4.75, nose: 0.66, tail: 'hatch', wheelR: 0.37, wheelbase: 2.89, width: 1.92 },
  taxi: { belt: 0.98, cabin: [0.27, 0.42, 0.86, 0.97], chromeLine: true, clearance: 0.19, height: 1.66, hood: 0.27, len: 4.75, nose: 0.68, tail: 'hatch', wheelR: 0.37, wheelbase: 2.89, width: 1.92 },
  van: { belt: 1.05, cabin: [0.16, 0.27, 0.99, 1.0], clearance: 0.2, height: 1.98, hood: 0.16, len: 5.0, nose: 0.72, tail: 'box', wheelR: 0.36, wheelbase: 3.1, width: 1.95 },
  wagon: { belt: 0.9, cabin: [0.3, 0.45, 0.9, 0.98], chromeLine: true, clearance: 0.15, height: 1.48, hood: 0.3, len: 4.75, nose: 0.6, tail: 'hatch', wheelR: 0.34, wheelbase: 2.87, width: 1.88 },
};

// Tyre tread: grooves across the running surface (u runs around the tyre).
const treadTexture = (() => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1b1b';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#0b0b0b';
  for (let x = 0; x < 256; x += 8) { g.fillRect(x, 18, 3, 28); g.fillRect(x + 4, 4, 2, 12); g.fillRect(x + 4, 48, 2, 12); }
  g.fillRect(0, 30, 256, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();
const materials = {
  caliper: new THREE.MeshStandardMaterial({ color: 0x8e1b1b, metalness: 0.3, roughness: 0.5 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 1, roughness: 0.2 }),
  disc: new THREE.MeshStandardMaterial({ color: 0x6b6f73, metalness: 0.8, roughness: 0.45 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x141b22, metalness: 0.7, opacity: 0.92, roughness: 0.05, transparent: true }),
  head: new THREE.MeshBasicMaterial({ color: 0xf4f7ff }),
  indicator: new THREE.MeshBasicMaterial({ color: 0xffa31a }),
  liner: new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 1, side: THREE.DoubleSide }),
  rim: new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.9, roughness: 0.3 }),
  tail: new THREE.MeshBasicMaterial({ color: 0xd0102a }),
  trim: new THREE.MeshStandardMaterial({ color: 0x17191c, metalness: 0.2, roughness: 0.6 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0xffffff, map: treadTexture, metalness: 0, roughness: 0.92 }),
};

const paints = new Map();
export function carPaint(color) {
  if (!paints.has(color)) paints.set(color, new THREE.MeshPhysicalMaterial({ clearcoat: 1, clearcoatRoughness: 0.06, color, metalness: 0.45, roughness: 0.32 }));
  return paints.get(color);
}

// Monotone cubic through [f, y] keys (Fritsch-Carlson): smooth, but flat runs stay flat.
export function monotone(keys) {
  const n = keys.length, xs = keys.map((k) => k[0]), ys = keys.map((k) => k[1]);
  const d = xs.slice(0, -1).map((x, i) => (ys[i + 1] - ys[i]) / (xs[i + 1] - x));
  const m = xs.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = Math.max(0, Math.min(1, (x - xs[i]) / h)), t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

// The body's shape along its length. f is the fraction of the length from the nose.
// Returns at(f): bottom (rises over the wheel arches), belt, top (bonnet, roof, boot),
// half widths at the rocker and the shoulder, the glass shoulder inset, and the slope of the top.
function bodyFrame(s, axles) {
  const L = s.len, c = s.clearance, belt = s.belt, H = s.height;
  const [wBase, rFront, rRear, gBase] = s.cabin;
  const n0 = s.front === 'flat' ? H - 0.2 : c + (belt - c) * s.nose;
  const keys = s.front === 'flat'
    ? [[0, n0], [rFront, H]]
    : [[0, n0], [0.025, lerp(n0, belt, 0.75)], [0.08, belt + 0.02], [wBase, belt + 0.08], [lerp(wBase, rFront, 0.55), lerp(belt + 0.08, H, 0.62)], [rFront, H - 0.01]];
  keys.push([lerp(rFront, rRear, 0.5), H]);
  if (s.tail === 'notch') keys.push([rRear, H - 0.03], [lerp(rRear, gBase, 0.55), lerp(H, belt + 0.12, 0.62)], [gBase, belt + 0.12], [0.975, belt + 0.09], [1, belt - 0.12]);
  else if (s.tail === 'hatch') keys.push([rRear, H - 0.02], [lerp(rRear, gBase, 0.55), H - 0.14], [gBase, lerp(belt, H, 0.3)], [1, belt - 0.12]);
  else keys.push([rRear, H], [1, H - 0.08]);
  const top = monotone(keys);
  const bottom = monotone([[0, c + 0.12], [0.06, c + 0.02], [0.12, c], [0.88, c], [0.94, c + 0.03], [1, c + 0.16]]);
  const archR = s.wheelR + 0.07, corner = s.front === 'flat' ? 0.22 : 0.5, tailCorner = s.tail === 'box' ? 0.25 : 0.42;
  return (f) => {
    const z = L / 2 - f * L, end = Math.min(f * L / corner, (1 - f) * L / tailCorner);
    let w = (s.width / 2) * Math.pow(1 - Math.pow(Math.max(0, 1 - Math.min(1, end)), 2.4), 1 / 2.4);
    let b = bottom(f);
    for (const a of axles) {
      const dz = z - a;
      if (Math.abs(dz) < archR) b = Math.max(b, s.wheelR + Math.sqrt(archR * archR - dz * dz));
      if (s.kind !== 'bus') w *= 1 + 0.018 * smooth(1 - Math.abs(dz) / (archR * 1.5));
    }
    const t = Math.max(top(f), b + 0.08), yb = Math.min(belt + 0.03 * f, t - 0.04);
    const cabin = smooth((t - yb - 0.06) / 0.2);
    const slope = (top(Math.min(1, f + 0.004)) - top(Math.max(0, f - 0.004))) / (0.008 * L);
    return { bottom: b, cabin, slope, top: t, w, wTop: w * (s.kind === 'bus' ? 0.995 : 0.975), yb, z };
  };
}

// One cross-section, bottom centre round the +x side to the top centre: a rounded rocker,
// a side with slight tumblehome, the glass shoulder, then the greenhouse or bonnet crown.
// Mesh resolution: FULL near the camera, COARSE beyond LOD_DISTANCE (about 1/7 the triangles).
const FULL = { detail: true, lathe: 36, lower: 9, side: 5, spokes: 10, stations: 160, upper: 12 };
const COARSE = { detail: false, lathe: 14, lower: 4, side: 2, spokes: 5, stations: 40, upper: 5 };
export const LOD_DISTANCE = 45;
const WHEELS_DISTANCE = 90;
let res = FULL;
function halfSection(st, s) {
  const LOWER = res.lower, SIDE = res.side, UPPER = res.upper;
  const pts = [], n = s.kind === 'bus' ? 8 : 4, rr = Math.min(0.16, (st.yb - st.bottom) * 0.45), yc = st.bottom + rr;
  const pow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
  for (let k = 0; k < LOWER; k++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (k / (LOWER - 1));
    pts.push([st.w * pow(Math.cos(a), 2 / n), yc + rr * pow(Math.sin(a), 2 / n), 'lower']);
  }
  for (let k = 1; k <= SIDE; k++) { const t = k / SIDE; pts.push([st.w - (st.w - st.wTop) * t * t, lerp(yc, st.yb, t), 'side']); }
  const inset = (s.kind === 'bus' ? 0.01 : 0.075) * st.cabin, wg = st.wTop - inset, base = st.yb + 0.012 * st.cabin;
  pts.push([st.wTop - inset * 0.6, st.yb + 0.006 * st.cabin, 'shoulder']);
  const nUp = s.kind === 'bus' ? 10 : s.kind === 'van' ? 5 : 2.6 + 2 * (1 - st.cabin);
  for (let k = 0; k < UPPER; k++) {
    const a = (Math.PI / 2) * (k / (UPPER - 1));
    pts.push([wg * pow(Math.cos(a), 2 / nUp), base + (st.top - base) * pow(Math.sin(a), 2 / nUp), k === 0 ? 'seal' : 'upper']);
  }
  return pts;
}

// x of the lower body side at height y (for decals and seams that sit on the skin).
function sideX(st, y) {
  const rr = Math.min(0.16, (st.yb - st.bottom) * 0.45), yc = st.bottom + rr;
  if (y < yc) return st.w * Math.pow(Math.max(0, 1 - Math.pow((yc - y) / rr, 4)), 1 / 4);
  const t = Math.min(1, (y - yc) / Math.max(0.01, st.yb - yc));
  return st.w - (st.w - st.wTop) * t * t;
}

// A strip lying on the lower skin between heights y0 and y1, over the stations where keep(st,
// ax) holds (ax: |x| as a fraction of half the width), lifted a few mm off the paint.
function skinBand(stations, s, side, y0, y1, keep) {
  const pos = [], index = [], W2 = s.width / 2;
  let prev = false;
  for (const st of stations) {
    const ya = Math.max(y0, st.bottom + 0.01), yb = Math.min(y1, st.yb - 0.005);
    const x0 = sideX(st, ya), x1 = sideX(st, yb);
    if (yb <= ya || !keep(st, (x0 + x1) / 2 / W2)) { prev = false; continue; }
    const n = pos.length / 3;
    pos.push(side * x0, ya, st.z, side * x1, yb, st.z);
    if (prev) index.push(n - 2, n, n - 1, n - 1, n, n + 1);
    prev = true;
  }
  if (!index.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // Face outwards (away from the car's centre line), then lift along the normal.
  const p = g.attributes.position, nr = g.attributes.normal;
  let out = 0;
  for (let i = 0; i < p.count; i++) out += nr.getX(i) * p.getX(i) + nr.getZ(i) * p.getZ(i);
  if (out < 0) { g.setIndex(index.map((_, i) => index[i - (i % 3) + [0, 2, 1][i % 3]])); g.computeVertexNormals(); }
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + nr.getX(i) * 0.004, p.getY(i) + nr.getY(i) * 0.004, p.getZ(i) + nr.getZ(i) * 0.004);
  return g;
}

// Lofts the body from cross-sections at cosine-spaced stations (dense at nose and tail),
// smooth-shades it, then sorts every face into paint, glass, trim or a lamp by where it is.
function loftBody(s, frame, axles) {
  const STATIONS = res.stations, rows = [], tags = [], stations = [];
  for (let i = 0; i <= STATIONS; i++) {
    const f = 0.5 - 0.5 * Math.cos((Math.PI * i) / STATIONS), st = frame(f);
    stations.push({ ...st, f });
    const half = halfSection(st, s);
    const ring = [...half, ...half.slice(1, -1).reverse().map(([x, y, tag]) => [-x, y, tag])];
    rows.push(ring.map(([x, y]) => [x, y, st.z]));
    if (!tags.length) tags.push(...ring.map((p) => p[2]));
  }
  const R = rows[0].length, positions = new Float32Array(rows.length * R * 3), index = [];
  rows.forEach((ring, i) => ring.forEach((p, j) => positions.set(p, (i * R + j) * 3)));
  for (let i = 0; i < STATIONS; i++) {
    for (let j = 0; j < R; j++) {
      const a = i * R + j, b = i * R + ((j + 1) % R), c = (i + 1) * R + j, d = (i + 1) * R + ((j + 1) % R);
      index.push(a, c, b, b, c, d);
    }
  }
  const skin = new THREE.BufferGeometry();
  skin.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  skin.setIndex(index);
  skin.computeVertexNormals();
  const normals = skin.attributes.normal.array;
  const L = s.len, bus = s.kind === 'bus';
  const posts = bus ? 6 : s.kind === 'sports' ? 0 : s.kind === 'van' ? 2 : 1;
  const [, rFront, rRear] = s.cabin, roofLen = (rRear - rFront) * L;
  const postZ = Array.from({ length: posts }, (_, k) => L / 2 - rFront * L - (roofLen * (k + 1)) / (posts + 1));
  const clad = s.kind === 'suv' || s.kind === 'taxi' || s.kind === 'van';
  const roofBand = bus ? 0.5 : s.glassRoof ? 0 : 0.06;
  // Classifies a whole quad (both its triangles) by its centre, ring tag and mean normal.
  const pick = (q) => {
    const k4 = [index[q * 6], index[q * 6 + 1], index[q * 6 + 2], index[q * 6 + 5]];
    const mean = (arr, c) => k4.reduce((sum, k) => sum + arr[k * 3 + c], 0) / 4;
    const [x, y, z] = [0, 1, 2].map((c) => mean(positions, c)), ny = mean(normals, 1), nz = mean(normals, 2);
    const st = stations[Math.floor(k4[0] / R)], tag = tags[k4[0] % R];
    if (ny < -0.6) return 'trim';
    if (tag === 'upper' || tag === 'seal') {
      if (st.cabin < 0.5) return 'paint';
      if (tag === 'seal' && !bus) return 'trim';
      if (y > st.top - roofBand && Math.abs(st.slope) < 0.6) return 'paint';
      if (!bus && Math.abs(st.slope) > 0.5 && Math.abs(x) > 0.8 * st.wTop) return 'paint';
      if (postZ.some((pz) => Math.abs(z - pz) < (bus ? 0.07 : 0.05))) return bus ? 'paint' : 'trim';
      return 'glass';
    }
    if (bus) {
      if (nz > 0.5 && y > 1.0 && y < s.height - 0.3) return 'glass';
      if (x > 0 && Math.abs(z - L * 0.38) < 0.55 && y > st.bottom + 0.1) return 'glass';
      if (x > 0 && Math.abs(z + L * 0.05) < 0.55 && y > st.bottom + 0.1) return 'glass';
    }
    if (clad && y < s.clearance + 0.13) return 'trim';
    if (clad && st.bottom > s.clearance + 0.05 && y < st.bottom + 0.07) return 'trim';
    return 'paint';
  };
  const buckets = {};
  for (let t = 0; t < index.length; t += 3) {
    const tri = [index[t], index[t + 1], index[t + 2]], name = pick(Math.floor(t / 6));
    const bucket = (buckets[name] ||= { n: [], p: [] });
    for (const k of tri) { bucket.p.push(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]); bucket.n.push(normals[k * 3], normals[k * 3 + 1], normals[k * 3 + 2]); }
  }
  const out = {};
  for (const [name, { n, p }] of Object.entries(buckets)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    out[name] = g;
  }
  return { parts: out, stations };
}

const plateTextures = new Map();
function plateMaterial(text) {
  if (!plateTextures.has(text)) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 56;
    const g = c.getContext('2d');
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, 256, 56);
    g.fillStyle = '#1e4fa3';
    g.fillRect(0, 0, 26, 56);
    g.fillStyle = '#111';
    g.font = 'bold 40px Arial';
    g.textBaseline = 'middle';
    g.fillText(text, 36, 30);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    plateTextures.set(text, new THREE.MeshBasicMaterial({ map: tex }));
  }
  return plateTextures.get(text);
}
function canvasMaterial(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true });
}
// Norwegian police checks with POLITI, and the TAXI roof sign.
const politiSide = canvasMaterial(512, 96, (g) => {
  for (let i = 0; i < 16; i++) for (let j = 0; j < 3; j++) { g.fillStyle = (i + j) % 2 ? '#f2c400' : '#123c8c'; g.fillRect(i * 32, j * 32, 32, 32); }
});
const politiText = canvasMaterial(256, 64, (g) => { g.fillStyle = '#123c8c'; g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.fillText('POLITI', 128, 48); });
const taxiText = canvasMaterial(256, 64, (g) => { g.fillStyle = '#ffd400'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#111'; g.font = 'bold 50px Arial'; g.textAlign = 'center'; g.fillText('TAXI', 128, 50); });

// A wheel: lathe-turned tyre with tread, dished ten-spoke rim, hub and brake disc.
// `spin` turns about x for rolling; the caliper stays on the steering mount.
function wheel(s, side) {
  const r = s.wheelR, w = s.kind === 'bus' ? 0.32 : 0.24, rim = r * 0.68;
  const spin = new THREE.Group();
  // Tyre cross-section: inner bead, rounded sidewalls, flat tread.
  const profile = [[rim, -w / 2], [r - 0.04, -w / 2], [r - 0.005, -w / 2 + 0.03], [r, -w / 4], [r, w / 4], [r - 0.005, w / 2 - 0.03], [r - 0.04, w / 2], [rim, w / 2]];
  const tyreGeo = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), res.lathe);
  tyreGeo.rotateZ(Math.PI / 2);
  spin.add(new THREE.Mesh(tyreGeo, materials.tyre));
  const face = side * (w / 2 - 0.035);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(rim, rim * 0.92, 0.05, res.lathe, 1, true).rotateZ(Math.PI / 2), materials.rim);
  dish.position.x = face - side * 0.02;
  spin.add(dish);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rim, rim, w * 0.8, res.lathe, 1, true).rotateZ(Math.PI / 2), materials.trim);
  spin.add(barrel);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.06, 14).rotateZ(Math.PI / 2), materials.chrome);
  hub.position.x = face + side * 0.005;
  spin.add(hub);
  for (let i = 0; i < res.spokes; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.025, rim - 0.07, 0.035), materials.rim);
    spoke.position.set(face - side * 0.01, 0, 0);
    spoke.rotation.x = (i * Math.PI * 2) / res.spokes + (i % 2) * 0.12;
    spoke.translateY((rim - 0.07) / 2 + 0.05);
    spoke.rotateZ(side * 0.18);
    spin.add(spoke);
  }
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rim - 0.05, rim - 0.05, 0.025, 24).rotateZ(Math.PI / 2), materials.disc);
  disc.position.x = face - side * 0.07;
  spin.add(disc);
  spin.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return spin;
}
function caliper(s, side) {
  const rim = s.wheelR * 0.68, w = s.kind === 'bus' ? 0.32 : 0.24;
  const g = new THREE.BoxGeometry(0.06, rim * 0.55, 0.12).translate(side * (w / 2 - 0.1), rim * 0.45, -rim * 0.35);
  return g;
}

let plateSeed = 10000;
// Stand-in for the per-car paint while a template is built.
const PAINT = new THREE.MeshBasicMaterial();
const PLATE = new THREE.MeshBasicMaterial();

// Builds the parts of one vehicle kind (paint and plates as stand-ins). Run once per kind.
function buildParts(kind) {
  const s = { ...BODY_STYLES[kind], kind };
  const paint = PAINT;
  const group = new THREE.Group();
  const add = (geometry, material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    group.add(m);
    return m;
  };
  const L = s.len, W = s.width, H = s.height, front = L / 2, rear = -L / 2;
  const axles = [-s.wheelbase / 2 + (s.kind === 'bus' ? -0.4 : 0.05), s.wheelbase / 2 + (s.kind === 'bus' ? 1.6 : 0.05)];
  // Lofted body: paint, glass, black trim and lamps all come from one smooth skin.
  const frame = bodyFrame(s, axles);
  const { parts, stations } = loftBody(s, frame, axles);
  const skinMaterial = { glass: materials.glass, head: materials.head, indicator: materials.indicator, paint, tail: materials.tail, trim: materials.trim };
  for (const [name, geometry] of Object.entries(parts)) add(geometry, skinMaterial[name]);
  // Lamps, grille and diffuser as bands on the nose and tail.
  const lampY = s.front === 'flat' ? 0.55 : stations[0].top - 0.075, tailY = s.kind === 'bus' ? 0.9 : s.belt - 0.06, c = s.clearance;
  const nose = (st) => st.f < 0.14, tail = (st) => st.f > 0.86;
  for (const side of [-1, 1]) {
    const bands = [
      [lampY - 0.028, lampY + 0.028, (st, ax) => nose(st) && ax > 0.3 && ax < 0.86, materials.head],
      [lampY - 0.024, lampY + 0.024, (st, ax) => st.f < 0.08 && ax >= 0.86, materials.indicator],
      [c + 0.07, c + 0.23, (st, ax) => nose(st) && ax < 0.6, materials.trim],
      [tailY - 0.045, tailY + 0.045, (st, ax) => tail(st) && ax > 0.45, materials.tail],
      [tailY - 0.012, tailY + 0.012, (st, ax) => tail(st) && ax <= 0.45, materials.tail],
      [c + 0.03, c + 0.16, (st, ax) => tail(st) && ax < 0.8, materials.trim],
    ];
    for (const [y0, y1, keep, material] of bands) {
      const g = skinBand(stations, s, side, y0, y1, keep);
      if (g) add(g, material).castShadow = false;
    }
  }
  const z = (f) => front - f * L;
  const near = (zz) => stations.reduce((best, st) => (Math.abs(st.z - zz) < Math.abs(best.z - zz) ? st : best));
  const [wBase, rFront, rRear] = s.cabin;
  const roofLen = z(rFront) - z(rRear);
  const tube = (points, radius, material) => add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(8, points.length * 2), radius, 5), material);
  for (const side of res.detail ? [-1, 1] : []) {
    // Window line along the shoulder, under the glass.
    const cabin = stations.filter((st) => st.cabin > 0.6 && st.z < z(wBase) - 0.1);
    if (cabin.length > 3 && s.kind !== 'bus') tube(cabin.filter((_, i) => i % 3 === 0).map((st) => new THREE.Vector3(side * (st.wTop - 0.01), st.yb + 0.01, st.z)), 0.008, s.chromeLine ? materials.chrome : materials.trim);
    // Door shut lines and flush handles, following the curved side.
    const doors = s.kind === 'bus' ? [] : s.kind === 'sports' ? [z(rFront) - 0.1] : [z(rFront) - 0.05, z(rFront) - roofLen / 2 - 0.05];
    for (const dz of doors) {
      const st = near(dz), pts = [];
      for (let y = st.bottom + 0.06; y <= st.yb - 0.01; y += 0.05) pts.push(new THREE.Vector3(side * (sideX(st, y) + 0.002), y, dz));
      if (pts.length > 2) tube(pts, 0.005, materials.trim);
      const hs = near(dz - 0.35), hy = st.yb - 0.1;
      const handle = add(new RoundedBoxGeometry(0.02, 0.03, 0.17, 2, 0.008), materials.chrome, side * (sideX(hs, hy) + 0.004), hy, dz - 0.35);
      handle.castShadow = false;
    }
    if (s.kind !== 'bus') {
      // Mirror on a short arm at the base of the windshield.
      const ms = near(z(wBase) - 0.18);
      add(new RoundedBoxGeometry(0.2, 0.12, 0.09, 3, 0.035), paint, side * (ms.wTop + 0.09), ms.yb + 0.11, ms.z);
      add(new THREE.BoxGeometry(0.08, 0.03, 0.04), materials.trim, side * (ms.wTop + 0.02), ms.yb + 0.08, ms.z);
    }
    // Black wheel-well liners so the arches don't show through the car.
    for (const a of axles) {
      const liner = add(new THREE.CylinderGeometry(s.wheelR + 0.07, s.wheelR + 0.07, 0.42, 20, 1, true, 0, Math.PI).rotateZ(Math.PI / 2), materials.liner, side * (W / 2 - 0.24), s.wheelR, a);
      liner.castShadow = false;
    }
  }
  const plateGeo = new THREE.PlaneGeometry(0.52, 0.11);
  add(plateGeo, PLATE, 0, s.clearance + 0.3, front + 0.006);
  add(plateGeo, PLATE, 0, s.clearance + 0.36, rear - 0.006).rotation.y = Math.PI;
  // Livery and roof equipment.
  if (kind === 'police') {
    // Battenburg band wrapped onto the curved door skin.
    const band = stations.filter((st) => Math.abs(st.z) < L * 0.36);
    for (const side of [-1, 1]) {
      const pos = [], uv = [], index = [], y0 = s.belt - 0.38, y1 = s.belt - 0.12;
      band.forEach((st, i) => {
        for (const [k, y] of [[0, y0], [1, y1]]) {
          pos.push(side * (sideX(st, Math.max(y, st.bottom + 0.02)) + 0.004), Math.max(y, st.bottom + 0.02), st.z);
          uv.push((st.z + L * 0.36) / (L * 0.72), k);
        }
        if (i) { const a = (i - 1) * 2; index.push(...(side > 0 ? [a, a + 2, a + 1, a + 1, a + 2, a + 3] : [a, a + 1, a + 2, a + 1, a + 3, a + 2])); }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(index);
      g.computeVertexNormals();
      add(g, politiSide).castShadow = false;
    }
    const hood = near(front - 0.6);
    const word = add(new THREE.PlaneGeometry(0.8, 0.2), politiText, 0, hood.top + 0.006, front - 0.6);
    word.rotation.x = -Math.PI / 2 + Math.atan(hood.slope);
    add(new RoundedBoxGeometry(1.1, 0.1, 0.28, 2, 0.04), materials.trim, 0, H + 0.08, z(rFront) - 0.4);
  }
  if (kind === 'taxi') {
    const sign = add(new THREE.BoxGeometry(0.7, 0.2, 0.28), [materials.indicator, materials.indicator, materials.indicator, materials.indicator, taxiText, taxiText], 0, H + 0.14, z(rFront) - 0.5);
    sign.castShadow = false;
  }
  // Wheel positions; front ones get a steering pivot.
  const wheels = [];
  for (const [i, a] of axles.entries()) for (const side of [-1, 1]) wheels.push({ front: i === 1, position: new THREE.Vector3(side * (W / 2 - 0.14), s.wheelR, a), side });
  return { group, s, top: H + 0.05, wheels };
}

// Merges a group's meshes into one geometry per material (multi-material meshes stay).
// Plain-coloured details share two materials (lit trim and metal, unlit lamps), their own
// colour baked into vertex colours, to keep each car to a few draw calls.
const detail = new THREE.MeshStandardMaterial({ metalness: 0.5, roughness: 0.45, side: THREE.DoubleSide, vertexColors: true });
const lamps = new THREE.MeshBasicMaterial({ vertexColors: true });
const SHARED = new Map([[materials.chrome, detail], [materials.disc, detail], [materials.liner, detail], [materials.rim, detail], [materials.trim, detail], [materials.head, lamps], [materials.indicator, lamps], [materials.tail, lamps]]);
function mergeByMaterial(group) {
  group.updateMatrixWorld(true);
  const byMaterial = new Map(), kept = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) { kept.push(o); return; }
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (!['normal', 'position', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const c = SHARED.has(o.material) ? o.material.color : new THREE.Color(1, 1, 1);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(0).flatMap(() => [c.r, c.g, c.b]), 3));
    const material = SHARED.get(o.material) || o.material;
    if (!byMaterial.has(material)) byMaterial.set(material, []);
    byMaterial.get(material).push(g);
  });
  return { kept, parts: [...byMaterial].map(([material, geos]) => ({ geometry: mergeGeometries(geos), material })) };
}

// One multi-material mesh for the body (plates are its last groups) and one per wheel,
// so a car is a handful of objects for the renderer instead of dozens.
function meshesFor(kind, resolution) {
  res = resolution;
  const raw = buildParts(kind);
  const plates = [];
  raw.group.traverse((o) => { if (o.isMesh && o.material === PLATE) plates.push(o); });
  for (const p of plates) raw.group.remove(p);
  const body = mergeByMaterial(raw.group);
  const plateGeos = [mergeGeometries(plates.map((p) => {
    p.updateMatrixWorld(true);
    const g = p.geometry.toNonIndexed().applyMatrix4(p.matrixWorld);
    return g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(1), 3));
  }))];
  const wheelMesh = Object.fromEntries([-1, 1].map((side) => {
    const parts = mergeByMaterial(wheel(raw.s, side)).parts;
    return [side, { geometry: mergeGeometries(parts.map((p) => p.geometry), true), materials: parts.map((p) => p.material) }];
  }));
  res = FULL;
  return { bodyGeometry: mergeGeometries([...body.parts.map((p) => p.geometry), ...plateGeos], true), bodyMaterials: [...body.parts.map((p) => p.material), PLATE], kept: body.kept, lampGeometry: body.parts.find((p) => p.material === lamps)?.geometry, plateGeometry: plateGeos[0], raw, wheelMesh };
}
// Sloyd bodies (models/cars/<kind>.glb, made by tools/sloyd-generate.mjs from text prompts):
// realistic textured shells that replace the lofted body for their kind. AI models come with
// their wheels moulded on, so those are cut out (every triangle inside each wheel's disc on
// the outer side) and the game's own wheels, which spin and steer, are mounted in their place.
// (The bus model came out broken; the lofted bus stays.)
const SLOYD_KINDS = ['police', 'sedan', 'sports', 'suv', 'taxi', 'van', 'wagon'];
const sloydBodies = new Map();
export async function loadSloydCars() {
  const loader = new GLTFLoader();
  await Promise.all(SLOYD_KINDS.map(async (kind) => {
    let gltf;
    try { gltf = await loader.loadAsync(new URL(`models/cars/${kind}.glb`, new URL('.', import.meta.url)).href); } catch { return; }
    let mesh = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) return;
    const s = BODY_STYLES[kind];
    let g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    g = g.index ? g.toNonIndexed() : g;
    // Lengthwise along z (some models come lying along x).
    g.computeBoundingBox();
    if (g.boundingBox.max.x - g.boundingBox.min.x > g.boundingBox.max.z - g.boundingBox.min.z) g.rotateY(Math.PI / 2);
    // Scale to the kind's length, wheels on y = 0, centred along x and z.
    g.computeBoundingBox();
    const b = g.boundingBox, k = s.len / (b.max.z - b.min.z);
    g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2).scale(k, k, k);
    // AI models face either way: turn the body round so +z is always the nose.
    const turned = facesBack(g);
    if (turned) g.rotateY(Math.PI);
    g.computeBoundingBox();
    const half = g.boundingBox.max.x, pos = g.attributes.position.array;
    // Axles: where the tyres touch the ground (the lowest few centimetres), front and back.
    const touch = [[], []];
    for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] < 0.06 && Math.abs(pos[i]) > half * 0.5) touch[pos[i + 2] > 0 ? 1 : 0].push(pos[i + 2]);
    if (!touch[0].length || !touch[1].length) return;
    const median = (v) => v.sort((a, c) => a - c)[v.length >> 1], axles = [median(touch[0]), median(touch[1])], r = s.wheelR;
    // Drop triangles inside a wheel disc (a little larger than the tyre) on the outer side.
    const keep = [];
    for (let t = 0; t < pos.length; t += 9) {
      const cx = (pos[t] + pos[t + 3] + pos[t + 6]) / 3, cy = (pos[t + 1] + pos[t + 4] + pos[t + 7]) / 3, cz = (pos[t + 2] + pos[t + 5] + pos[t + 8]) / 3;
      const inWheel = Math.abs(cx) > half * 0.55 && axles.some((a) => Math.hypot(cz - a, cy - r) < r * 1.08);
      if (!inWheel) keep.push(t / 9);
    }
    const cut = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      const n = attr.itemSize * 3, out = new Float32Array(keep.length * n);
      keep.forEach((t, i) => out.set(attr.array.subarray(t * n, (t + 1) * n), i * n));
      cut.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
    }
    // Windows: the AI paints its glass into the texture, so the body is opaque all round.
    // Triangles above the belt line whose texture there is dark and unsaturated (tinted glass)
    // become a separate see-through glass mesh, so the driver and riders show inside.
    // (A bus's big side windows are a lighter grey than a car's tinted glass.)
    const { body: shell, glass } = splitGlass(cut, mesh.material.map, g.boundingBox.max.y, s.belt / s.height);
    // The AI's own lamps light up: bright, pale faces at the nose (headlights) and red faces
    // at the tail (tail lights) move to a mesh drawn unlit, so they glow at night.
    const { body: paintwork, lamps: lampFaces, tailFaces, tailLamps } = splitLamps(shell, mesh.material.map, g.boundingBox);
    // (The model's own smooth normals are kept: recomputing them on separate triangles shaded
    // every face on its own, patchy light and dark.)
    paintwork.computeBoundingSphere();
    const material = mesh.material.clone();
    material.side = THREE.DoubleSide;
    if (material.map) material.map = evenTexture(material.map);
    for (const m of [material]) if (m.map) { m.map.anisotropy = 16; m.map.needsUpdate = true; }
    // Unlit and brightened, so dark red tail lights read as lit.
    const lampMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 1.6), map: mesh.material.map, side: THREE.DoubleSide });
    // Plates: on the body's surface at the middle of the nose and the tail, 38 cm up.
    const plateY = Math.min(0.5, s.clearance + 0.25), ends = [-Infinity, Infinity], pp = paintwork.attributes.position.array;
    for (let i = 0; i < pp.length; i += 3) if (Math.abs(pp[i]) < 0.2 && Math.abs(pp[i + 1] - plateY) < 0.08) { ends[0] = Math.max(ends[0], pp[i + 2]); ends[1] = Math.min(ends[1], pp[i + 2]); }
    const plates = [[ends[0] + 0.012, 0], [ends[1] - 0.012, Math.PI]].filter(([z]) => Number.isFinite(z));
    // Where the AI painted no red tail lights, two lamp bars on the tail's surface at the corners.
    let tails = null;
    if (tailFaces < 15) {
      const ty = s.belt - 0.08, spot = (x0) => { let z = Infinity; for (let i = 0; i < pp.length; i += 3) if (Math.abs(pp[i] - x0) < 0.12 && Math.abs(pp[i + 1] - ty) < 0.06) z = Math.min(z, pp[i + 2]); return z; };
      // The tail's own half width at that height (cars narrow towards the back).
      let zMin = Infinity, rear = 0;
      for (let i = 0; i < pp.length; i += 3) zMin = Math.min(zMin, pp[i + 2]);
      for (let i = 0; i < pp.length; i += 3) if (pp[i + 2] < zMin + 0.35 && Math.abs(pp[i + 1] - ty) < 0.06) rear = Math.max(rear, Math.abs(pp[i]));
      const bars = [];
      for (const side of [-1, 1]) {
        // Turned to follow the tail's curve (its surface 12 cm either side).
        const x = side * Math.max(0.2, rear * 0.62), z = spot(x), za = spot(x - 0.12), zb = spot(x + 0.12);
        if (!Number.isFinite(z)) continue;
        const turn = Number.isFinite(za) && Number.isFinite(zb) ? Math.atan2(zb - za, 0.24) : 0;
        bars.push(new THREE.BoxGeometry(0.24, 0.06, 0.02).rotateY(-turn).translate(x, ty, z - 0.012));
      }
      if (bars.length) tails = mergeGeometries(bars.map((b) => { const t = new THREE.BufferGeometry(); t.setAttribute('position', b.toNonIndexed().attributes.position); return t; }));
    }
    // The AI's tail lights join them, drawn solid bright red (lit at any hour).
    if (tailLamps?.attributes.position.count) {
      const own = new THREE.BufferGeometry();
      own.setAttribute('position', tailLamps.attributes.position);
      tails = tails ? mergeGeometries([tails, own]) : own;
    }
    const wheels = [];
    for (const [i, a] of axles.entries()) for (const side of [-1, 1]) wheels.push({ front: i === 1, position: new THREE.Vector3(side * (half - 0.14), r, a), side });
    sloydBodies.set(kind, { geometry: paintwork, lampMaterial, lamps: lampFaces, plateY, plates, tails, roofY: g.boundingBox.max.y, glass, glassShare: +(glass.attributes.position.count / Math.max(1, cut.attributes.position.count)).toFixed(3), material, roof: facesBack.last, top: g.boundingBox.max.y + 0.05, turned, wheels });
  }));
  return Object.fromEntries([...sloydBodies].map(([kind, b]) => [kind, { glass: b.glassShare, turned: b.turned }]));
}

// Splits a textured body into { body, glass } by sampling the texture at each triangle.
// Glass is the band above the belt line: faces there that are not roof (facing up) and whose
// texture is darker than the paint around (tinted glass, interior seen through it). The paint
// colour is the median brightness of the band, so a black taxi still finds its windows.
function splitGlass(g, map, height, belt) {
  const image = map?.image, uv = g.attributes.uv;
  if (!image || !uv) return { body: g, glass: new THREE.BufferGeometry() };
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data, pos = g.attributes.position.array, isGlass = [];
  const sample = (u, v) => { const x = Math.min(canvas.width - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * canvas.width))), y = Math.min(canvas.height - 1, Math.max(0, Math.floor((((v % 1) + 1) % 1) * canvas.height))), k = (y * canvas.width + x) * 4; return [px[k], px[k + 1], px[k + 2]]; };
  const n = uv.count / 3, lums = new Float32Array(n), band = new Uint8Array(n), up = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    const o = t * 9, cy = (pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3;
    e1.set(pos[o + 3] - pos[o], pos[o + 4] - pos[o + 1], pos[o + 5] - pos[o + 2]);
    e2.set(pos[o + 6] - pos[o], pos[o + 7] - pos[o + 1], pos[o + 8] - pos[o + 2]);
    up.crossVectors(e1, e2).normalize();
    band[t] = cy > height * (belt + 0.03) && cy < height * 0.96 && Math.abs(up.y) < 0.8 ? 1 : 0;
    const [r, gr, b] = sample((uv.getX(t * 3) + uv.getX(t * 3 + 1) + uv.getX(t * 3 + 2)) / 3, (uv.getY(t * 3) + uv.getY(t * 3 + 1) + uv.getY(t * 3 + 2)) / 3);
    lums[t] = (0.3 * r + 0.59 * gr + 0.11 * b) / 255;
  }
  const inBand = [...lums].filter((_, t) => band[t]).sort((a, b) => a - b), paint = inBand.length ? inBand[Math.floor(inBand.length * 0.85)] : 1;
  for (let t = 0; t < n; t++) isGlass.push(band[t] === 1 && lums[t] < Math.min(0.32, paint * 0.7));
  const pick = (want) => {
    const out = new THREE.BufferGeometry(), ids = isGlass.map((v, i) => (v === want ? i : -1)).filter((i) => i >= 0);
    for (const [name, attr] of Object.entries(g.attributes)) {
      const n = attr.itemSize * 3, arr = new Float32Array(ids.length * n);
      ids.forEach((t, i) => arr.set(attr.array.subarray(t * n, (t + 1) * n), i * n));
      out.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize));
    }
    return out;
  };
  const glass = pick(true);
  return { body: pick(false), glass };
}
// Evens out an AI texture's colour casts (patches tinted pink, green or blue on one paint)
// without touching its detail or brightness: each pixel keeps its luminance, and its colour
// ratios move 65 % of the way to the texture's median ratios. Works pixel by pixel, so the
// texture's separate UV islands can't bleed into each other. At most 2048 px.
function evenTexture(map) {
  const image = map.image, W = Math.min(2048, image.width), H = Math.min(2048, image.height);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H), px = data.data, ratios = [[], [], []];
  const lumOf = (k) => 0.3 * px[k] + 0.59 * px[k + 1] + 0.11 * px[k + 2];
  for (let k = 0; k < px.length; k += 4 * 37) { const l = lumOf(k); if (l > 25) for (let c = 0; c < 3; c++) ratios[c].push(px[k + c] / l); }
  const median = ratios.map((r) => r.sort((a, b) => a - b)[r.length >> 1] || 1);
  for (let k = 0; k < px.length; k += 4) {
    const l = lumOf(k);
    if (l < 1) continue;
    for (let c = 0; c < 3; c++) px[k + c] = Math.min(255, l * (px[k + c] / l + (median[c] - px[k + c] / l) * 0.65));
  }
  ctx.putImageData(data, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = map.flipY;
  tex.colorSpace = map.colorSpace;
  tex.wrapS = map.wrapS;
  tex.wrapT = map.wrapT;
  tex.anisotropy = 16;
  return tex;
}
// Splits { body, lamps } by the texture at each triangle: at the nose (last 12 % of the length)
// faces brighter than 0.72 and nearly colourless; at the tail (last 10 %) red faces, lit up.
function splitLamps(g, map, box) {
  const image = map?.image, uv = g.attributes.uv;
  if (!image || !uv) return { body: g, lamps: null };
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data, pos = g.attributes.position.array, len = box.max.z - box.min.z, hgt = box.max.y;
  const lit = [];
  let tailFaces = 0, tailRegion = 0;
  // The paint: median colour of the faces along the middle of the body (sides, 35–65 % up).
  const paintSamples = [];
  for (let t = 0; t < uv.count / 3; t += 7) {
    const o = t * 9, cy = (pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3, cz = (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3;
    if (cy < hgt * 0.35 || cy > hgt * 0.65 || Math.abs(cz - (box.max.z + box.min.z) / 2) > len * 0.25) continue;
    const u = (((uv.getX(t * 3)) % 1) + 1) % 1, v = (((uv.getY(t * 3)) % 1) + 1) % 1, k = (Math.min(canvas.height - 1, Math.floor(v * canvas.height)) * canvas.width + Math.min(canvas.width - 1, Math.floor(u * canvas.width))) * 4;
    paintSamples.push([px[k] / 255, px[k + 1] / 255, px[k + 2] / 255]);
  }
  const mid = (c) => paintSamples.map((p) => p[c]).sort((a, b) => a - b)[paintSamples.length >> 1] ?? 0.5;
  const paint = [mid(0), mid(1), mid(2)], paintLum = 0.3 * paint[0] + 0.59 * paint[1] + 0.11 * paint[2], redPaint = paint[0] > paint[1] * 1.4 && paint[0] > paint[2] * 1.4;
  for (let t = 0; t < uv.count / 3; t++) {
    const o = t * 9, cy = (pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3, cz = (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3;
    const nose = cz > box.max.z - len * 0.12, tail = cz < box.min.z + len * 0.1;
    if ((!nose && !tail) || cy < hgt * 0.2 || cy > hgt * 0.8) { lit.push(0); continue; }
    const u = (((uv.getX(t * 3) + uv.getX(t * 3 + 1) + uv.getX(t * 3 + 2)) / 3) % 1 + 1) % 1, v = (((uv.getY(t * 3) + uv.getY(t * 3 + 1) + uv.getY(t * 3 + 2)) / 3) % 1 + 1) % 1;
    const k = (Math.min(canvas.height - 1, Math.floor(v * canvas.height)) * canvas.width + Math.min(canvas.width - 1, Math.floor(u * canvas.width))) * 4, r = px[k] / 255, gr = px[k + 1] / 255, b = px[k + 2] / 255;
    const lum = 0.3 * r + 0.59 * gr + 0.11 * b, sat = Math.max(r, gr, b) - Math.min(r, gr, b);
    // (Tail lights are often a dark red in the texture.)
    // On a red car only red clearly brighter than the paint is a lamp.
    const red = r > 0.16 && r > gr * 1.45 && r > b * 1.45 && (!redPaint || (lum > paintLum * 1.35 && r > 0.6));
    const on = nose ? lum > 0.72 && sat < 0.3 && lum > paintLum + 0.12 : red;
    if (tail) tailRegion++;
    lit.push(on ? (tail ? 2 : 1) : 0);
    if (on && tail) tailFaces++;
  }
  // Lamps are small: if "lamps" cover over a quarter of the tail, it was paint after all.
  if (tailFaces > tailRegion * 0.25) { for (let i = 0; i < lit.length; i++) if (lit[i] === 2) lit[i] = 0; tailFaces = 0; }
  if (!lit.some(Boolean)) return { body: g, lamps: null, tailFaces: 0, tailLamps: null };
  const pick = (want) => {
    const out = new THREE.BufferGeometry(), ids = lit.map((l, i) => (want(l) ? i : -1)).filter((i) => i >= 0);
    for (const [name, attr] of Object.entries(g.attributes)) {
      const n = attr.itemSize * 3, arr = new Float32Array(ids.length * n);
      ids.forEach((t, i) => arr.set(attr.array.subarray(t * n, (t + 1) * n), i * n));
      out.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize));
    }
    return out;
  };
  return { body: pick((l) => !l), lamps: pick((l) => l === 1), tailLamps: pick((l) => l === 2), tailFaces };
}
const PLATE_GEOMETRY = new THREE.PlaneGeometry(0.52, 0.114);
const TAIL_LAMP = new THREE.MeshBasicMaterial({ color: 0xff1a1a });
const TAXI_SIGN_GEOMETRY = new THREE.BoxGeometry(0.62, 0.18, 0.26);
const TAXI_SIGN = (() => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 72;
  const g = c.getContext('2d');
  g.fillStyle = '#ffd21f';
  g.fillRect(0, 0, 256, 72);
  g.fillStyle = '#111';
  g.font = 'bold 54px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TAXI', 128, 38);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.MeshBasicMaterial({ map: t }), plain = new THREE.MeshBasicMaterial({ color: 0xffd21f });
  // Box faces: +x, -x, +y, -y, +z (front), -z (back): lettering front and back.
  return [plain, plain, plain, plain, face, face];
})();
// Police livery (the AI can't paint lettering): a blue and yellow Battenburg band along both
// sides at door height and POLITI on the front doors, crisp from a canvas, laid on the body's
// side surface.
const POLICE_LIVERY = new THREE.MeshBasicMaterial({ map: (() => {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 32; i++) for (let row = 0; row < 2; row++) { g.fillStyle = (i + row) % 2 ? '#1d3f9e' : '#f2c81c'; g.fillRect(i * 32, row * 32 + 64, 32, 32); }
  g.fillStyle = '#1d3f9e';
  g.font = 'bold 54px Arial';
  g.textBaseline = 'middle';
  g.fillText('POLITI', 590, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
})(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide, transparent: true });
function policeLivery(body) {
  const pos = body.geometry.attributes.position.array, box = body.geometry.boundingBox ?? (body.geometry.computeBoundingBox(), body.geometry.boundingBox);
  const z0 = box.min.z + (box.max.z - box.min.z) * 0.12, z1 = box.max.z - (box.max.z - box.min.z) * 0.14, y0 = box.max.y * 0.36, y1 = box.max.y * 0.58;
  // The body's half width at door height along the band (a few slices), so the band hugs it.
  const slices = 12, half = new Array(slices + 1).fill(0);
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i + 1] < y0 || pos[i + 1] > y1 || pos[i + 2] < z0 || pos[i + 2] > z1) continue;
    const k = Math.round(((pos[i + 2] - z0) / (z1 - z0)) * slices);
    half[k] = Math.max(half[k], Math.abs(pos[i]));
  }
  const parts = [];
  for (const side of [-1, 1]) {
    const verts = [], uvs = [];
    for (let k = 0; k < slices; k++) {
      const za = z0 + ((z1 - z0) * k) / slices, zb = z0 + ((z1 - z0) * (k + 1)) / slices, xa = side * (half[k] + 0.006), xb = side * (half[k + 1] + 0.006);
      // u runs nose to tail on the right side and tail to nose on the left, so the text reads.
      const ua = side > 0 ? 1 - k / slices : k / slices, ub = side > 0 ? 1 - (k + 1) / slices : (k + 1) / slices;
      verts.push(xa, y0, za, xb, y0, zb, xb, y1, zb, xa, y0, za, xb, y1, zb, xa, y1, za);
      uvs.push(ua, 0, ub, 0, ub, 1, ua, 0, ub, 1, ua, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    parts.push(g);
  }
  return mergeGeometries(parts);
}
const SLOYD_GLASS = new THREE.MeshStandardMaterial({ color: 0x1b252c, depthWrite: false, metalness: 0.7, opacity: 0.45, roughness: 0.04, side: THREE.DoubleSide, transparent: true });
// A seated person (torso, head, hair) for behind the glass, merged and vertex-coloured.
const DRIVER_COLOURS = { hair: ['#2a1d14', '#4a3222', '#8a6a3a', '#c9a76a', '#1b1b1b'], shirt: ['#2b2f36', '#3d4a5c', '#6b2e2e', '#2f4a3a', '#8a8d91', '#d8d4cc'], skin: ['#f1c9a5', '#e0b08a', '#c68d63', '#8d5a3b'] };
const DRIVER_MATERIAL = new THREE.MeshLambertMaterial({ vertexColors: true });
function seatedPerson(x, y, z) {
  const pickOne = (list) => new THREE.Color(list[Math.floor(Math.random() * list.length)]);
  const tint = (geometry, c) => { const g = geometry.toNonIndexed(), n = g.attributes.position.count, col = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv'); return g; };
  return [
    tint(new THREE.BoxGeometry(0.4, 0.55, 0.24).translate(x, y + 0.27, z), pickOne(DRIVER_COLOURS.shirt)),
    tint(new THREE.SphereGeometry(0.1, 10, 8).translate(x, y + 0.7, z + 0.02), pickOne(DRIVER_COLOURS.skin)),
    tint(new THREE.SphereGeometry(0.107, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(x, y + 0.715, z), pickOne(DRIVER_COLOURS.hair)),
  ];
}

// Whether a body faces -z: a car's roof (its highest tenth) sits behind the middle, since the
// bonnet is longer than the boot (a van's cab still starts after its short bonnet).
function facesBack(g) {
  g.computeBoundingBox();
  const { max, min } = g.boundingBox, pos = g.attributes.position.array, top = max.y - (max.y - min.y) * 0.1;
  let sum = 0, n = 0;
  for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] > top) { sum += pos[i + 2]; n++; }
  const roof = n ? sum / n : 0;
  facesBack.last = +(roof / (max.z - min.z)).toFixed(3);
  return roof > 0;
}

const templates = new Map();
function template(kind) {
  if (!templates.has(kind)) {
    const near = meshesFor(kind, FULL), far = meshesFor(kind, COARSE), { raw } = near, s = raw.s;
    const calipers = Object.fromEntries([-1, 1].map((side) => [side, caliper(s, side)]));
    const shadowGeometry = new THREE.BoxGeometry(s.width * 0.95, s.height - s.clearance, s.len * 0.95).translate(0, (s.height + s.clearance) / 2, 0);
    const sloyd = sloydBodies.get(kind);
    templates.set(kind, { calipers, far, near, shadowGeometry, sloyd, top: sloyd?.top ?? raw.top, wheelR: s.wheelR, wheels: sloyd?.wheels ?? raw.wheels });
  }
  return templates.get(kind);
}

// Builds one vehicle from its kind's template, with its own paint and number plate.
// The chassis (body) sits on the suspension and can pitch and roll; wheels stay grounded.
// Returns { group, chassis, paint, setDistance(metres), setPaint(material), shadow, top, wheels: [{ spin, steer, r }] }.
const BUS_GLASS = new THREE.MeshStandardMaterial({ color: 0x34444e, metalness: 0.5, opacity: 0.6, roughness: 0.05, transparent: true });
export function buildCar(kind, color) {
  const t = template(kind);
  const paint = carPaint(color);
  const group = new THREE.Group();
  const chassis = new THREE.Group();
  group.add(chassis);
  const plate = plateMaterial(`EL ${plateSeed++}`);
  // Buses get clearer glass, so the riders inside show.
  const ownMaterials = (list) => list.map((m) => (m === PAINT ? paint : m === PLATE ? plate : kind === 'bus' && m === materials.glass ? BUS_GLASS : m));
  // A Sloyd body keeps its own textured paint (no repaint); near and far share it.
  const body = t.sloyd ? new THREE.Mesh(t.sloyd.geometry, t.sloyd.material) : new THREE.Mesh(t.near.bodyGeometry, ownMaterials(t.near.bodyMaterials));
  const farBody = t.sloyd ? new THREE.Mesh(t.sloyd.geometry, t.sloyd.material) : new THREE.Mesh(t.far.bodyGeometry, ownMaterials(t.far.bodyMaterials));
  farBody.visible = false;
  chassis.add(body, farBody);
  if (t.sloyd) {
    if (t.sloyd.lamps) chassis.add(new THREE.Mesh(t.sloyd.lamps, t.sloyd.lampMaterial));
    // Number plates flat on the bumpers, front and back.
    for (const [z, turn] of t.sloyd.plates) {
      const p = new THREE.Mesh(PLATE_GEOMETRY, plate);
      p.position.set(0, t.sloyd.plateY, z);
      p.rotation.y = turn;
      chassis.add(p);
    }
    if (kind === 'police') chassis.add(new THREE.Mesh(t.sloyd.livery ??= policeLivery(t.sloyd), POLICE_LIVERY));
    if (t.sloyd.tails) chassis.add(new THREE.Mesh(t.sloyd.tails, TAIL_LAMP));
    // Taxis carry a lit TAXI box on the roof.
    if (kind === 'taxi') { const sign = new THREE.Mesh(TAXI_SIGN_GEOMETRY, TAXI_SIGN); sign.position.set(0, t.sloyd.roofY + 0.09, -0.15); chassis.add(sign); }
  }
  if (t.sloyd?.glass.attributes.position?.count) {
    chassis.add(new THREE.Mesh(t.sloyd.glass, SLOYD_GLASS));
    // The driver on the left (cars drive on the right in Norway), now and then a passenger.
    // (Buses get their driver and riders from the game, see addPassengers.)
    if (kind !== 'bus') {
      const s = BODY_STYLES[kind], seatY = s.clearance + 0.3, seatZ = s.len * 0.02, sideX = s.width * 0.22;
      const people = seatedPerson(sideX, seatY, seatZ);
      if (Math.random() < 0.35) people.push(...seatedPerson(-sideX, seatY, seatZ));
      chassis.add(new THREE.Mesh(mergeGeometries(people), DRIVER_MATERIAL));
    }
  }
  // One box stands in for the whole car in the shadow map (the caller puts it on the
  // shadow layer); the detailed body and wheels cast nothing themselves.
  const shadow = new THREE.Mesh(t.shadowGeometry, PAINT);
  chassis.add(shadow);
  // (The lofted body's separate parts, mirrors and lamps, belong to it alone.)
  const kept = t.sloyd ? [] : t.near.kept.map((k) => k.clone()), calipers = [];
  for (const k of kept) chassis.add(k);
  const farWheels = [];
  const wheels = t.wheels.map(({ front, position, side }) => {
    const mount = new THREE.Group();
    mount.position.copy(position);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(t.near.wheelMesh[side].geometry, t.near.wheelMesh[side].materials));
    const farWheel = new THREE.Mesh(t.far.wheelMesh[side].geometry, t.far.wheelMesh[side].materials);
    farWheel.visible = false;
    farWheels.push(farWheel);
    spin.add(farWheel);
    mount.add(spin);
    const caliper = new THREE.Mesh(t.calipers[side], materials.caliper);
    calipers.push(caliper);
    mount.add(caliper);
    group.add(mount);
    return { r: t.wheelR, spin, steer: front ? mount : null };
  });
  // Swaps the paint (e.g. for a burnt-out wreck) without touching glass, lamps or trim.
  // A Sloyd body (one textured material) is darkened instead, keeping its texture.
  const setPaint = (material) => {
    if (t.sloyd) { const burnt = t.sloyd.material.clone(); burnt.color.copy(material.color ?? new THREE.Color(0x222222)); for (const b of [body, farBody]) b.material = burnt; return; }
    for (const b of [body, farBody]) b.material = b.material.map((m) => (m === paint ? material : m));
  };
  // Switches between the full meshes, the coarse ones, and beyond WHEELS_DISTANCE the coarse
  // body alone (wheels, calipers and small parts are a few pixels there, but a draw call
  // each). Call with the camera distance.
  let level = 0;
  const setDistance = (d) => {
    const next = d < LOD_DISTANCE ? 0 : d < WHEELS_DISTANCE ? 1 : 2;
    if (next === level) return;
    level = next;
    body.visible = level === 0;
    farBody.visible = level > 0;
    wheels.forEach((w, i) => { w.spin.children[0].visible = level === 0; farWheels[i].visible = level === 1; });
    for (const part of calipers) part.visible = level === 0;
    for (const part of kept) part.visible = level < 2;
  };
  return { chassis, group, paint, setDistance, setPaint, shadow, top: t.top, wheels };
}
