// Street furniture at real Oslo sizes, built procedurally: the glass bus shelter with an
// ad panel, bench and stop sign (sign 512), the red Posten post box, and the green street bin.
// Each returns { parts: [{ geometry, material, slot }], size } like a baked Sloyd model.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function canvasMap(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Groups geometries by material into baked parts.
function assemble(pieces, size) {
  const byMaterial = new Map();
  for (const [geometry, material] of pieces) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const name of Object.keys(g.attributes)) if (!['normal', 'position', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!byMaterial.has(material)) byMaterial.set(material, []);
    byMaterial.get(material).push(g);
  }
  return { parts: [...byMaterial].map(([material, geos], i) => ({ geometry: mergeGeometries(geos), material, slot: String(i) })), size };
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d40, metalness: 0.6, roughness: 0.45 });
const galvanised = new THREE.MeshStandardMaterial({ color: 0xa3a9ae, metalness: 0.8, roughness: 0.35 });
const glass = new THREE.MeshStandardMaterial({ color: 0xcfe0e6, metalness: 0.1, opacity: 0.28, roughness: 0.05, transparent: true });
const wood = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });

// Bus shelter, 4.4 m x 1.5 m x 2.65 m. x runs along the kerb, +z faces the road.
export function busShelter() {
  const L = 4.4, D = 1.5, H = 2.55, back = -D / 2 + 0.05;
  const ad = new THREE.MeshBasicMaterial({ map: canvasMap(256, 384, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 384);
    grad.addColorStop(0, '#1b4f72'); grad.addColorStop(1, '#0b2236');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 384);
    g.fillStyle = '#f4d35e'; g.beginPath(); g.arc(128, 150, 70, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 40px Arial'; g.textAlign = 'center'; g.fillText('OSLO', 128, 290); g.font = '22px Arial'; g.fillText('sommer i byen', 128, 325);
  }) });
  const stopSign = new THREE.MeshLambertMaterial({ map: canvasMap(128, 192, (g) => {
    g.fillStyle = '#1f5fbf'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#fff'; g.fillRect(24, 34, 80, 50); g.fillStyle = '#1f5fbf'; g.fillRect(30, 40, 68, 20);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(40, 88, 8, 0, Math.PI * 2); g.arc(88, 88, 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c8102e'; g.fillRect(0, 132, 128, 60);
    g.fillStyle = '#fff'; for (let i = 0; i < 4; i++) g.fillRect(12, 142 + i * 12, 104, 4);
  }) });
  const led = new THREE.MeshBasicMaterial({ color: 0xf2f6ff });
  const pieces = [];
  for (const [x, z] of [[-L / 2, back], [L / 2, back], [-L / 2, D / 2 - 0.1], [L / 2, D / 2 - 0.1]]) pieces.push([box(0.07, H, 0.07, x, H / 2, z), steel]);
  pieces.push([box(L + 0.3, 0.1, D + 0.25, 0, H + 0.05, 0.05), steel]);
  pieces.push([box(L - 0.2, 0.02, 0.06, 0, H - 0.01, 0.1), led]);
  // Glass back wall and the open end, with rails.
  pieces.push([box(L - 0.08, 2.0, 0.015, 0, 1.15, back), glass]);
  pieces.push([box(0.015, 2.0, D * 0.6, -L / 2, 1.15, back + D * 0.3), glass]);
  for (const y of [0.13, 2.17]) pieces.push([box(L, 0.05, 0.05, 0, y, back), steel]);
  // Lit ad panel closing the other end.
  pieces.push([box(0.14, 1.85, 1.25, L / 2, 1.1, back + 0.66), steel]);
  for (const s of [-1, 1]) pieces.push([new THREE.PlaneGeometry(1.15, 1.72).rotateY((s * Math.PI) / 2).translate(L / 2 + s * 0.072, 1.1, back + 0.66), ad]);
  // Bench along the back.
  for (let i = 0; i < 3; i++) pieces.push([box(2.2, 0.035, 0.11, -0.4, 0.46, back + 0.14 + i * 0.13), wood]);
  for (const x of [-1.3, 0.5]) pieces.push([box(0.05, 0.46, 0.35, x, 0.23, back + 0.27), steel]);
  // Stop sign with the timetable plate, on its own post beside the shelter.
  pieces.push([new THREE.CylinderGeometry(0.03, 0.03, 2.9, 8).translate(L / 2 + 0.5, 1.45, D / 2 + 0.1), galvanised]);
  const sign = new THREE.PlaneGeometry(0.42, 0.63).translate(0, 0, 0.035);
  pieces.push([sign.clone().translate(L / 2 + 0.5, 2.5, D / 2 + 0.1), stopSign]);
  pieces.push([sign.clone().rotateY(Math.PI).translate(L / 2 + 0.5, 2.5, D / 2 + 0.1), stopSign]);
  pieces.push([box(0.44, 0.65, 0.04, L / 2 + 0.5, 2.5, D / 2 + 0.1), steel]);
  return assemble(pieces, new THREE.Vector3(L + 1, H + 0.1, D + 0.25));
}

// Posten post box: red with the slot and horn badge, 1.2 m tall on its post. +z is the front.
export function postbox() {
  const red = new THREE.MeshStandardMaterial({ color: 0xd4002a, metalness: 0.2, roughness: 0.45 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const badge = new THREE.MeshBasicMaterial({ map: canvasMap(64, 64, (g) => {
    g.fillStyle = '#d4002a'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.beginPath(); g.arc(32, 32, 20, 0.3, Math.PI * 1.7); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 6, 0, Math.PI * 2); g.fill();
  }) });
  return assemble([
    [new THREE.CylinderGeometry(0.035, 0.035, 0.75, 8).translate(0, 0.375, -0.05), galvanised],
    [new RoundedBoxGeometry(0.38, 0.5, 0.27, 3, 0.05).translate(0, 0.95, 0), red],
    [new RoundedBoxGeometry(0.42, 0.05, 0.31, 2, 0.02).translate(0, 1.205, 0), red],
    [box(0.22, 0.02, 0.01, 0, 1.08, 0.137), dark],
    [new THREE.PlaneGeometry(0.12, 0.12).translate(0, 0.92, 0.138), badge],
  ], new THREE.Vector3(0.42, 1.23, 0.31));
}

// Oslo street bin: dark green drum with a domed lid and side opening, about 1 m tall.
export function streetBin() {
  const green = new THREE.MeshStandardMaterial({ color: 0x2c4536, metalness: 0.4, roughness: 0.5 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x111111 });
  return assemble([
    [new THREE.CylinderGeometry(0.26, 0.24, 0.82, 14).translate(0, 0.45, 0), green],
    [new THREE.CylinderGeometry(0.2, 0.22, 0.04, 14).translate(0, 0.02, 0), steel],
    [new THREE.SphereGeometry(0.27, 14, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1).translate(0, 0.86, 0), green],
    [box(0.2, 0.09, 0.02, 0, 0.8, 0.252), dark],
  ], new THREE.Vector3(0.54, 0.98, 0.54));
}

// Modern Oslo street light: tapered dark grey pole to 6 m with a flat post-top LED lantern
// (the night glow sits at 6.15 m).
export function streetLight() {
  const pole = new THREE.MeshStandardMaterial({ color: 0x2f3336, metalness: 0.7, roughness: 0.4 });
  const lens = new THREE.MeshBasicMaterial({ color: 0xfff4dc });
  return assemble([
    [new THREE.CylinderGeometry(0.05, 0.085, 5.9, 8, 1, true).translate(0, 2.95, 0), pole],
    [new THREE.CylinderGeometry(0.12, 0.12, 0.35, 8, 1, true).translate(0, 0.175, 0), pole],
    [new THREE.CylinderGeometry(0.34, 0.3, 0.1, 16).translate(0, 6.07, 0), pole],
    [new THREE.CylinderGeometry(0.36, 0.34, 0.03, 16).translate(0, 6.13, 0), pole],
    [new THREE.CircleGeometry(0.28, 16).rotateX(Math.PI / 2).translate(0, 6.015, 0), lens],
  ], new THREE.Vector3(0.72, 6.15, 0.72));
}

// Barriers from OSM ways, laid along the ground: steel bar fences and railings (alpha-cut
// bars on posts), stone walls with a coping, clipped hedges. heightAt(x, z) gives the ground.
const fenceTexture = canvasMap(256, 128, (g) => {
  g.fillStyle = '#2a2f2c';
  g.fillRect(0, 4, 256, 9);
  g.fillRect(0, 112, 256, 8);
  for (let x = 4; x < 256; x += 16) g.fillRect(x, 4, 4, 116);
});
fenceTexture.wrapS = THREE.RepeatWrapping;
fenceTexture.anisotropy = 8;
const railTexture = canvasMap(256, 128, (g) => {
  g.fillStyle = '#5d6266';
  g.fillRect(0, 2, 256, 10);
  g.fillRect(0, 60, 256, 6);
  g.fillRect(0, 0, 8, 128);
});
railTexture.wrapS = THREE.RepeatWrapping;
railTexture.anisotropy = 8;
const wallTexture = canvasMap(256, 128, (g) => {
  g.fillStyle = '#9d978c';
  g.fillRect(0, 0, 256, 128);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      g.fillStyle = ['#b3ab9e', '#a39b8f', '#bab3a7', '#aaa294'][(row * 3 + col) % 4];
      g.fillRect(col * 56 + (row % 2) * 28 - 28 + 2, row * 32 + 2, 52, 28);
    }
  }
});
wallTexture.wrapS = THREE.RepeatWrapping;
const hedgeTexture = canvasMap(128, 128, (g) => {
  g.fillStyle = '#2f4f25';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = ['#3d6630', '#4a7a36', '#2a4620', '#55853c'][i % 4];
    g.beginPath();
    g.ellipse((i * 37) % 128, (i * 61) % 128, 3, 2, i, 0, Math.PI * 2);
    g.fill();
  }
});
hedgeTexture.wrapS = hedgeTexture.wrapT = THREE.RepeatWrapping;

const BARRIER_STYLES = {
  fence: { h: 1.2, material: new THREE.MeshStandardMaterial({ alphaTest: 0.2, map: fenceTexture, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }), post: 2.4, tile: 2 },
  guard_rail: { h: 0.75, material: new THREE.MeshStandardMaterial({ alphaTest: 0.2, map: railTexture, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }), post: 2, tile: 2 },
  handrail: { h: 1, material: new THREE.MeshStandardMaterial({ alphaTest: 0.2, map: railTexture, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }), post: 1.5, tile: 1.5 },
  hedge: { h: 1.2, material: new THREE.MeshStandardMaterial({ map: hedgeTexture, roughness: 0.9, side: THREE.DoubleSide }), solid: 0.8, tile: 1.2 },
  railing: { h: 1, material: new THREE.MeshStandardMaterial({ alphaTest: 0.2, map: railTexture, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }), post: 1.8, tile: 1.8 },
  retaining_wall: { h: 0.9, material: new THREE.MeshStandardMaterial({ map: wallTexture, roughness: 0.9, side: THREE.DoubleSide }), solid: 0.4, tile: 2.5 },
  wall: { h: 1.1, material: new THREE.MeshStandardMaterial({ map: wallTexture, roughness: 0.9, side: THREE.DoubleSide }), solid: 0.35, tile: 2.5 },
};
export function buildBarriers(barriers, heightAt) {
  const meshes = [], buckets = new Map(), posts = [];
  for (const b of barriers) {
    const style = BARRIER_STYLES[b.k];
    if (!style) continue;
    // One mesh per kind and 600 m tile, so the camera can cull them.
    const key = `${b.k}|${Math.floor(b.p[0][0] / 600)}|${Math.floor(b.p[0][1] / 600)}`;
    const h = Math.min(b.h || style.h, 3), out = buckets.get(key) || { kind: b.k, pos: [], uv: [] };
    buckets.set(key, out);
    let u = 0, nextPost = 0;
    // A wall face from a to c, bottom ya0/yc0 and top ya1/yc1 at the two ends.
    const quad = (a, c, ya0, yc0, ya1, yc1, ua, uc, va, vc) => {
      out.pos.push(a[0], ya0, a[1], c[0], yc0, c[1], c[0], yc1, c[1], a[0], ya0, a[1], c[0], yc1, c[1], a[0], ya1, a[1]);
      out.uv.push(ua, va, uc, va, uc, vc, ua, va, uc, vc, ua, vc);
    };
    // Bottom and top of the barrier at a point. Retaining walls hold up the ground on one side:
    // they run from the lower ground to just above the higher (sampled 0.6 m either side).
    // Plain walls with the ground stepping 0.5 m or more across them hold it up too.
    const step = (x, z, nx, nz) => Math.abs(heightAt(x - nx * 1.5, z - nz * 1.5) - heightAt(x + nx * 1.5, z + nz * 1.5));
    const holding = b.k === 'retaining_wall' || (b.k === 'wall' && b.p.length > 1 && (() => { const [a, c] = b.p, l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1; return step((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, -(c[1] - a[1]) / l, (c[0] - a[0]) / l) >= 0.5; })());
    const span = (x, z, nx, nz) => {
      if (!holding) { const y = heightAt(x, z); return [y, y + h]; }
      const left = heightAt(x - nx * 0.6, z - nz * 0.6), right = heightAt(x + nx * 0.6, z + nz * 0.6), lo = Math.min(left, right), hi = Math.max(left, right);
      return [lo - 0.05, Math.max(hi + 0.15, lo + 0.4)];
    };
    // The barrier as 1 m pieces along its whole length, with its spans at every joint.
    // Fences, railings, walls and hedges stand on the ground smoothed over ±2 m, so their
    // tops run straight over the terrain's small bumps.
    const joints = [];
    for (let i = 0; i + 1 < b.p.length; i++) {
      const a0 = b.p[i], c0 = b.p[i + 1], len0 = Math.hypot(c0[0] - a0[0], c0[1] - a0[1]);
      if (len0 < 0.05) continue;
      const ux = (c0[0] - a0[0]) / len0, uz = (c0[1] - a0[1]) / len0, n = Math.max(1, Math.ceil(len0));
      for (let k = joints.length ? 1 : 0; k <= n; k++) {
        const x = a0[0] + ux * len0 * k / n, z = a0[1] + uz * len0 * k / n;
        joints.push({ span: span(x, z, -uz, ux), ux, uz, x, z });
      }
    }
    // Retaining walls smooth their foot and top separately (over ±3 m), so the coping runs
    // level along a terrace instead of tracing every bump.
    const avg = (list, i, k) => { const near = list.slice(Math.max(0, i - k), i + k + 1); return near.reduce((a, v) => a + v, 0) / near.length; };
    const foot = joints.map((j) => j.span[0]), crest = joints.map((j) => j.span[1]);
    joints.forEach((j, i) => {
      if (!holding) { const y = avg(foot, i, 2); j.span = [y, y + h]; return; }
      // The foot reaches the lowest ground nearby, so no gap shows under it.
      const lo = Math.min(...foot.slice(Math.max(0, i - 2), i + 3)) - 0.1, hi = avg(crest, i, 3);
      j.span = [lo, Math.max(hi, lo + 0.4)];
    });
    for (let i = 0; i + 1 < joints.length; i++) {
      const A = joints[i], C = joints[i + 1], a = [A.x, A.z], c = [C.x, C.z], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.01) continue;
      const ux = (c[0] - a[0]) / len, uz = (c[1] - a[1]) / len, [ya0, ya1] = A.span, [yc0, yc1] = C.span, u1 = u + len / style.tile;
      if (style.solid) {
        // Both faces and the top (coping).
        const nx = -uz * style.solid / 2, nz = ux * style.solid / 2;
        const L = (p, m) => [p[0] + nx * m, p[1] + nz * m];
        quad(L(a, 1), L(c, 1), ya0, yc0, ya1, yc1, u, u1, 0, 1);
        quad(L(c, -1), L(a, -1), yc0, ya0, yc1, ya1, u1, u, 0, 1);
        for (const [v, y] of [[L(a, 1), ya1], [L(c, 1), yc1], [L(c, -1), yc1], [L(a, 1), ya1], [L(c, -1), yc1], [L(a, -1), ya1]]) out.pos.push(v[0], y, v[1]);
        out.uv.push(u, 0, u1, 0, u1, 0.3, u, 0, u1, 0.3, u, 0.3);
      } else {
        quad(a, c, ya0, yc0, ya1, yc1, u, u1, 0, 1);
        // Posts every style.post metres along the whole barrier, at its smoothed foot.
        for (; nextPost < u * style.tile + len; nextPost += style.post) { const d = nextPost - u * style.tile, t = d / len; posts.push([a[0] + ux * d, ya0 + (yc0 - ya0) * t, a[1] + uz * d, h]); }
      }
      u = u1;
    }
  }
  for (const { kind, pos, uv } of buckets.values()) {
    if (!pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, BARRIER_STYLES[kind].material);
    mesh.castShadow = mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  if (posts.length) {
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x2a2f2c, metalness: 0.6, roughness: 0.5 }), posts.length);
    const m = new THREE.Matrix4();
    posts.forEach(([x, y, z, h], i) => post.setMatrixAt(i, m.makeScale(1, h + 0.05, 1).setPosition(x, y, z)));
    meshes.push(post);
  }
  return meshes;
}

// Black steel bollards with a domed top and a reflective band; granite blocks.
export function buildBollards(list, heightAt) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, metalness: 0.6, roughness: 0.4 });
  const band = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
  const granite = new THREE.MeshStandardMaterial({ color: 0x8f8c86, roughness: 0.85 });
  const kinds = [
    [new THREE.CylinderGeometry(0.09, 0.1, 0.85, 12).translate(0, 0.425, 0), steel],
    [new THREE.SphereGeometry(0.09, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.85, 0), steel],
    [new THREE.CylinderGeometry(0.093, 0.093, 0.05, 12, 1, true).translate(0, 0.72, 0), band],
  ];
  const m = new THREE.Matrix4(), meshes = [];
  const posts = list.filter((b) => !b[2]), blocks = list.filter((b) => b[2]);
  for (const [geometry, material] of kinds) {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, posts.length));
    posts.forEach(([x, z], i) => mesh.setMatrixAt(i, m.makeTranslation(x, heightAt(x, z), z)));
    mesh.count = posts.length;
    mesh.castShadow = true;
    meshes.push(mesh);
  }
  const block = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.6, 0.7).translate(0, 0.3, 0), granite, Math.max(1, blocks.length));
  blocks.forEach(([x, z], i) => block.setMatrixAt(i, m.makeTranslation(x, heightAt(x, z), z)));
  block.count = blocks.length;
  block.castShadow = true;
  meshes.push(block);
  return meshes;
}

// Trafikanten's clock tower on Jernbanetorget: four steel columns braced in a lattice, a box
// on top with clock faces on all four sides and Ruter signs below them, and a mast. h: height
// to the top of the box (m).
export function clockTower(h = 36) {
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x8f969c, metalness: 0.8, roughness: 0.35 });
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x5a3330, metalness: 0.4, roughness: 0.5 });
  const face = new THREE.MeshBasicMaterial({ map: canvasMap(128, 128, (g) => {
    g.fillStyle = '#c8102e'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#f4f1ea'; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#c8102e'; g.lineWidth = 6; g.beginPath(); g.arc(64, 64, 44, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#222'; g.lineCap = 'round'; g.lineWidth = 6; g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 30); g.moveTo(64, 64); g.lineTo(88, 70); g.stroke();
  }) });
  const sign = new THREE.MeshBasicMaterial({ map: canvasMap(128, 32, (g) => {
    g.fillStyle = '#2b2b2b'; g.fillRect(0, 0, 128, 32);
    g.fillStyle = '#e8463c'; g.font = 'bold 22px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Ruter#', 64, 17);
  }) });
  const W = 2.6, boxH = 4.2, colTop = h - boxH, pieces = [];
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pieces.push([new THREE.CylinderGeometry(0.16, 0.2, colTop, 8).translate(x * W / 2, colTop / 2, z * W / 2), steelMat]);
  // Lattice: rings every 3 m and X braces on each side between them.
  for (let y = 3; y < colTop; y += 3) {
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      const a = new THREE.Vector3((ax * W) / 2, y, (az * W) / 2), b = new THREE.Vector3((bx * W) / 2, y, (bz * W) / 2);
      pieces.push([new THREE.BoxGeometry(W, 0.08, 0.08).translate(0, 0, 0).rotateY(ax === bx ? Math.PI / 2 : 0).translate((a.x + b.x) / 2, y, (a.z + b.z) / 2), steelMat]);
      const lo = a.clone().setY(y - 3), diag = new THREE.Vector3().subVectors(b, lo), len = diag.length();
      const g = new THREE.CylinderGeometry(0.04, 0.04, len, 4).translate(0, len / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), diag.normalize()));
      pieces.push([g.translate(lo.x, lo.y, lo.z), steelMat]);
    }
  }
  pieces.push([box(W + 1.2, boxH, W + 1.2, 0, colTop + boxH / 2, 0), boxMat]);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, out = (W + 1.2) / 2 + 0.02;
    pieces.push([new THREE.PlaneGeometry(2.6, 2.6).rotateY(a).translate(Math.sin(a) * out, colTop + boxH * 0.58, Math.cos(a) * out), face]);
    pieces.push([new THREE.PlaneGeometry(2.6, 0.65).rotateY(a).translate(Math.sin(a) * out, colTop + 0.6, Math.cos(a) * out), sign]);
  }
  pieces.push([new THREE.CylinderGeometry(0.06, 0.1, 6, 6).translate(0, h + 3, 0), steelMat]);
  const group = new THREE.Group();
  for (const { geometry, material } of assemble(pieces, new THREE.Vector3(W + 1.2, h + 6, W + 1.2)).parts) {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = true;
    group.add(m);
  }
  return group;
}
