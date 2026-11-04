// "Tigeren" (Elena Engelsen, 2000): the walking bronze tiger on Jernbanetorget, 4.5 m long.
// Modelled as a signed distance field (round cones and ellipsoids along a skeleton, blended
// with smooth unions) and turned into one seamless cast-looking surface with marching
// cubes. Dark patinated bronze with the sculpted stripes darker. +x is forward.
import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';

// Distance primitives (after Inigo Quilez).
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const ssub = (a, b, k) => -smin(-a, b, k);
function roundCone(px, py, pz, a, b, r1, r2) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2], l2 = bax * bax + bay * bay + baz * baz;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const t = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / l2));
  return Math.hypot(pax - bax * t, pay - bay * t, paz - baz * t) - (r1 + (r2 - r1) * t);
}
function ellipsoid(px, py, pz, c, r) {
  const x = (px - c[0]) / r[0], y = (py - c[1]) / r[1], z = (pz - c[2]) / r[2];
  const k0 = Math.hypot(x, y, z), k1 = Math.hypot(x / r[0], y / r[1], z / r[2]);
  return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r);
}
// A chain of round cones through points [x, y, z, radius].
const chain = (px, py, pz, pts) => {
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) d = smin(d, roundCone(px, py, pz, pts[i], pts[i + 1], pts[i][3], pts[i + 1][3]), 0.05);
  return d;
};

// Legs in a diagonal walking stride (near fore and far hind forward); z > 0 is the near side.
const LEGS = [
  [[0.8, 0.95, 0.24, 0.25], [1.0, 0.5, 0.25, 0.16], [1.18, 0.16, 0.25, 0.12], [1.25, 0.08, 0.25, 0.12]],
  [[0.7, 0.95, -0.24, 0.25], [0.56, 0.5, -0.25, 0.16], [0.38, 0.16, -0.25, 0.12], [0.36, 0.08, -0.25, 0.12]],
  [[-1.25, 0.95, -0.26, 0.31], [-1.02, 0.6, -0.27, 0.18], [-1.12, 0.3, -0.27, 0.11], [-1.0, 0.08, -0.27, 0.11]],
  [[-1.38, 0.95, 0.26, 0.31], [-1.55, 0.6, 0.27, 0.18], [-1.85, 0.34, 0.27, 0.11], [-1.78, 0.1, 0.27, 0.11]],
];
const TAIL = [[-1.62, 1.12, 0, 0.1], [-1.95, 1.0, 0.04, 0.085], [-2.2, 0.68, 0.09, 0.075], [-2.3, 0.36, 0.17, 0.065], [-2.22, 0.15, 0.3, 0.06]];

function tigerDistance(x, y, z) {
  // Torso (a little narrower than tall), chest and haunch masses, neck.
  let d = roundCone(x, y, z * 1.12, [-1.5, 1.12, 0], [0.7, 1.2, 0], 0.37, 0.43);
  d = smin(d, ellipsoid(x, y, z, [0.78, 1.04, 0], [0.48, 0.52, 0.38]), 0.2);
  d = smin(d, ellipsoid(x, y, z, [-1.28, 1.02, 0], [0.52, 0.46, 0.42]), 0.2);
  d = smin(d, ellipsoid(x, y, z, [-0.4, 0.95, 0], [0.75, 0.32, 0.34]), 0.25);
  d = smin(d, roundCone(x, y, z, [0.95, 1.24, 0], [1.7, 1.04, 0], 0.35, 0.32), 0.15);
  // Head held low: skull, cheek ruff, muzzle, nose, open lower jaw, ears.
  let head = ellipsoid(x, y, z, [1.98, 1.02, 0], [0.45, 0.36, 0.39]);
  head = smin(head, ellipsoid(x, y, Math.abs(z), [1.88, 0.88, 0.25], [0.29, 0.25, 0.2]), 0.1);
  head = smin(head, ellipsoid(x, y, z, [2.36, 0.9, 0], [0.29, 0.18, 0.24]), 0.1);
  head = smin(head, ellipsoid(x, y, z, [2.63, 0.96, 0], [0.08, 0.07, 0.11]), 0.05);
  head = smin(head, ellipsoid(x, y, z, [2.27, 0.67, 0], [0.27, 0.08, 0.18]), 0.07);
  head = ssub(head, ellipsoid(x, y, z, [2.5, 0.79, 0], [0.19, 0.065, 0.16]), 0.03);
  head = smin(head, roundCone(x, y, Math.abs(z), [1.8, 1.28, 0.23], [1.73, 1.44, 0.27], 0.1, 0.04), 0.05);
  d = smin(d, head, 0.12);
  for (const leg of LEGS) {
    d = smin(d, chain(x, y, z, leg), 0.14);
    const paw = leg[leg.length - 1];
    d = smin(d, ellipsoid(x, y, z, [paw[0] + 0.08, 0.08, paw[2]], [0.19, 0.08, 0.13]), 0.05);
  }
  d = smin(d, chain(x, y, z, TAIL), 0.08);
  return Math.max(d, -y); // flat underside on the paving
}

const BRONZE = new THREE.Color(0x3e3e36), STRIPE = new THREE.Color(0x22221d), PATINA = new THREE.Color(0x5a6853);
export function tigerStatue(resolution = 80) {
  const box = { c: [0.2, 0.85, 0], e: [2.62, 0.9, 0.62] };
  const mc = new MarchingCubes(resolution, new THREE.MeshBasicMaterial(), false, false, 160000);
  const n = mc.size, half = mc.halfsize;
  for (let k = 0; k < n; k++) {
    const z = box.c[2] + ((k - half) / half) * box.e[2];
    for (let j = 0; j < n; j++) {
      const y = box.c[1] + ((j - half) / half) * box.e[1];
      for (let i = 0; i < n; i++) {
        const x = box.c[0] + ((i - half) / half) * box.e[0];
        mc.field[i + j * mc.yd + k * mc.zd] = mc.isolation - tigerDistance(x, y, z) * 400;
      }
    }
  }
  mc.update();
  // Copy the triangles out of the marching-cubes buffers into metres.
  const count = mc.count, pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let v = 0; v < count; v++) {
    const x = box.c[0] + mc.positionArray[v * 3] * box.e[0], y = box.c[1] + mc.positionArray[v * 3 + 1] * box.e[1], z = box.c[2] + mc.positionArray[v * 3 + 2] * box.e[2];
    pos.set([x, y, z], v * 3);
    const nx = mc.normalArray[v * 3] / box.e[0], ny = mc.normalArray[v * 3 + 1] / box.e[1], nz = mc.normalArray[v * 3 + 2] / box.e[2], l = Math.hypot(nx, ny, nz) || 1;
    nrm.set([nx / l, ny / l, nz / l], v * 3);
    // Narrow wavy stripes fading towards the belly; green patina in the hollows underneath.
    const stripe = Math.sin(x * 17 + Math.sin(z * 7 + y * 5) * 2.2 + Math.sin(x * 4.3) * 1.2), fade = Math.min(1, Math.max(0, (y - 0.7) * 2.5));
    c.copy(BRONZE).lerp(STRIPE, Math.min(1, Math.max(0, (stripe - 0.55) / 0.3)) * 0.85 * fade);
    if (ny / l < -0.3) c.lerp(PATINA, 0.35);
    colors.set([c.r, c.g, c.b], v * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  mc.geometry.dispose();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ metalness: 0.7, roughness: 0.5, vertexColors: true }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
