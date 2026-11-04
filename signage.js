// Shop signs from OSM: every named shop, café or restaurant gets a fascia sign on the
// building face it stands at, in the band above the shopfront and its awning (4 m). Known chains
// use their own colours; independents get dark fascias with gilt or white lettering.
// Signs are packed into 2048 px atlases (128 per sheet) and merged per sheet.
import * as THREE from 'three';

const BRANDS = [
  ['7-eleven', '#ffffff', '#00815f', '#ee2e24'], ['narvesen', '#e2001a', '#ffffff'], ['deli de luca', '#1d1d1b', '#f8b334'],
  ['joker', '#ffd400', '#d2001e'], ['rema 1000', '#0a3a85', '#ffffff'], ['kiwi', '#00a04b', '#ffffff'], ['meny', '#d6001c', '#ffffff'],
  ['coop', '#0058a3', '#ffffff'], ['vinmonopolet', '#003b2a', '#ffffff'], ['apotek 1', '#00a14b', '#ffffff'], ['vitusapotek', '#e3001b', '#ffffff'],
  ['boots', '#05054b', '#ffffff'], ["mcdonald", '#da291c', '#ffc72c'], ['burger king', '#502314', '#f5ebdc'], ['starbucks', '#00704a', '#ffffff'],
  ['espresso house', '#1d1d1b', '#ffffff'], ['kaffebrenneriet', '#2b1d16', '#e9d8b0'], ['h&m', '#ffffff', '#e50010'], ['clas ohlson', '#0b2b5a', '#ffffff'],
  ['norli', '#d1001c', '#ffffff'], ['ark', '#ffffff', '#1d1d1b'], ['dnb', '#007272', '#ffffff'], ['nordea', '#0000a0', '#ffffff'], ['peppes', '#c8102e', '#ffffff'],
  ['circle k', '#ee2e24', '#ffffff'], ['bunnpris', '#e3001b', '#ffffff'], ['vita', '#ffffff', '#c4007a'], ['xxl', '#000000', '#ffd400'],
];
const INDEPENDENT = [['#1f2a2e', '#d9b45a'], ['#2b2b2b', '#ffffff'], ['#3b1f1f', '#e6c27a'], ['#16304a', '#f2f2f2'], ['#f2efe8', '#1d1d1d'], ['#2e3b2a', '#e8dfc4']];
const styleOf = (name, brand, i) => {
  const key = (brand || name).toLowerCase();
  const hit = BRANDS.find(([b]) => key.startsWith(b) || key.includes(b));
  return hit ? { accent: hit[3], bg: hit[1], fg: hit[2] } : { bg: INDEPENDENT[i % INDEPENDENT.length][0], fg: INDEPENDENT[i % INDEPENDENT.length][1] };
};

// Building faces in a coarse grid, each with its outward normal.
function faceIndex(buildings) {
  const cells = new Map(), C = 20, faces = [];
  for (const b of buildings) {
    const p = b.p;
    let area = 0;
    for (let i = 0; i < p.length; i++) { const a = p[i], c = p[(i + 1) % p.length]; area += a[0] * c[1] - c[0] * a[1]; }
    const sign = area > 0 ? 1 : -1;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], c = p[(i + 1) % p.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 3) continue;
      // Outward normal: for counter-clockwise rings (area > 0) it is (dz, -dx).
      const face = { a, c, len, nx: (sign * (c[1] - a[1])) / len, nz: (-sign * (c[0] - a[0])) / len, top: b.h || 10 };
      faces.push(face);
      for (let x = Math.floor(Math.min(a[0], c[0]) / C); x <= Math.floor(Math.max(a[0], c[0]) / C); x++) {
        for (let z = Math.floor(Math.min(a[1], c[1]) / C); z <= Math.floor(Math.max(a[1], c[1]) / C); z++) {
          const k = `${x}|${z}`;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(face);
        }
      }
    }
  }
  return (x, z, r) => {
    let best = null;
    for (let cx = Math.floor((x - r) / C); cx <= Math.floor((x + r) / C); cx++) {
      for (let cz = Math.floor((z - r) / C); cz <= Math.floor((z + r) / C); cz++) {
        for (const f of cells.get(`${cx}|${cz}`) || []) {
          const dx = f.c[0] - f.a[0], dz = f.c[1] - f.a[1], t = Math.max(0.1, Math.min(0.9, ((x - f.a[0]) * dx + (z - f.a[1]) * dz) / (f.len * f.len)));
          const px = f.a[0] + dx * t, pz = f.a[1] + dz * t, d = Math.hypot(px - x, pz - z);
          // Only faces that look towards the shop's point (it stands in front of them).
          if (d < r && (x - px) * f.nx + (z - pz) * f.nz > -0.5 && (!best || d < best.d)) best = { d, f, px, pz, t };
        }
      }
    }
    return best;
  };
}

// One sheet: a 2048 x 2048 canvas, 4 columns x 32 rows of 512 x 64 cells, merged into a mesh.
function sheet() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2048;
  return { canvas, cell: 0, g: canvas.getContext('2d'), pos: [], uv: [] };
}
const quad = (s, cx, cy, cz, ax, az, w, h, uv) => {
  const [u0, v0, u1, v1] = uv, corner = (su, sv) => [cx + ax * su * w / 2, cy + sv * h / 2, cz + az * su * w / 2];
  for (const p of [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, -1), corner(1, 1), corner(-1, 1)]) s.pos.push(...p);
  s.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
};

// Draws one sign into the current sheet and places it on the face; returns false when full.
function drawSign(s, text, style, at, y, height = 0.45, font = 'bold 40px "Helvetica Neue", Arial') {
  if (s.cell >= 128) return false;
  const col = s.cell % 4, row = Math.floor(s.cell / 4), x0 = col * 512, y0 = row * 64;
  s.cell++;
  const g = s.g;
  g.font = font;
  const w = Math.min(512, Math.ceil(g.measureText(text).width) + 40);
  g.fillStyle = style.bg; g.fillRect(x0, y0, w, 64);
  if (style.accent) { g.fillStyle = style.accent; g.fillRect(x0, y0 + 54, w, 10); }
  g.fillStyle = style.fg; g.textBaseline = 'middle'; g.fillText(text, x0 + 20, y0 + 32, w - 40);
  const { f, px, pz } = at;
  // The plate faces out of the wall and reads left to right for someone in front of it:
  // its +u axis is the viewer's right, (nz, -nx).
  const width = Math.min((w / 64) * height, f.len * 0.9);
  quad(s, px + f.nx * 0.07, y, pz + f.nz * 0.07, f.nz, -f.nx, width, height, [x0 / 2048, 1 - (y0 + 64) / 2048, (x0 + w) / 2048, 1 - y0 / 2048]);
  return true;
}
function sheetMesh(s, material) {
  const tex = new THREE.CanvasTexture(s.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(s.pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(s.uv, 2));
  geo.computeVertexNormals();
  const m = material(tex);
  return new THREE.Mesh(geo, m);
}

// pois: [{ n, b, x, z }]; heightAt(x, z) gives the ground. material(texture) makes the sign
// material (the caller adds night glow). Returns the meshes.
export function buildShopSigns(pois, buildings, heightAt, material) {
  const nearestFace = faceIndex(buildings), sheets = [sheet()], placed = [];
  pois.forEach((poi, i) => {
    const at = nearestFace(poi.x, poi.z, 14);
    if (!at || placed.some(([x, z]) => Math.hypot(x - at.px, z - at.pz) < 3.5)) return;
    const y = heightAt(poi.x, poi.z) + 4.0;
    if (!drawSign(sheets[sheets.length - 1], poi.n, styleOf(poi.n, poi.b, i), at, y)) {
      sheets.push(sheet());
      drawSign(sheets[sheets.length - 1], poi.n, styleOf(poi.n, poi.b, i), at, y);
    }
    placed.push([at.px, at.pz]);
  });
  return sheets.filter((s) => s.pos.length).map((s) => sheetMesh(s, material));
}

// Named facade lettering for a landmark: text on the face of `building` nearest (x, z),
// centred in front of that point, at height y and letter height h (transparent background).
export function facadeLettering(building, x, z, text, y, h, color, material) {
  const at = faceIndex([building])(x, z, 200);
  if (!at) return null;
  const s = sheet(), g = s.g;
  g.font = 'bold 44px "Helvetica Neue", Arial';
  const style = { bg: 'rgba(0,0,0,0)', fg: color };
  // Centred on the point of the facade line straight in front of (x, z).
  const { f } = at, t = ((x - f.a[0]) * (f.c[0] - f.a[0]) + (z - f.a[1]) * (f.c[1] - f.a[1])) / (f.len * f.len);
  at.px = f.a[0] + (f.c[0] - f.a[0]) * t;
  at.pz = f.a[1] + (f.c[1] - f.a[1]) * t;
  at.f = { ...f, len: 60 };
  drawSign(s, text, style, at, y, h, 'bold 44px "Helvetica Neue", Arial');
  return sheetMesh(s, material);
}
