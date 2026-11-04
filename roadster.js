// The player's Tesla Roadster (October 2026 reveal), built from Tesla's launch photos:
// a faceted wedge with Countach-style fender blades over a flat bonnet, a long bronze-tinted
// canopy, black five-spoke wheels, full-width light bars front and rear, a bronze swan-neck
// wing, and the SpaceX package: ten cold-gas thrusters (four nozzles across the tail over
// four suction fans, four firing down at the corners, one each side) whose vapour plumes,
// fans and wing the game drives through update(). Same interface as cars.js buildCar().
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { monotone } from './cars.js';

// Metres. z forward (+z is the nose), y up, wheels on y = 0.
export const ROADSTER = { clearance: 0.12, height: 1.15, len: 4.4, rearWheelR: 0.37, wheelbase: 2.7, wheelR: 0.36, width: 2.0 };
const L = ROADSTER.len, W2 = ROADSTER.width / 2;
const AXLES = [{ r: ROADSTER.rearWheelR, z: -ROADSTER.wheelbase / 2 }, { r: ROADSTER.wheelR, z: ROADSTER.wheelbase / 2 }];
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

// Day/night brightness for the unlit vapour (the game sets it from the sun).
const LIGHT = { value: 1 };
export function setRoadsterLight(day) { LIGHT.value = 0.25 + 0.75 * day; }

function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
// 2x2 twill carbon weave.
const carbonMap = canvasTexture(64, 64, (g) => {
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const along = (i + j) % 4 < 2, grad = g.createLinearGradient(i * 8, j * 8, i * 8 + (along ? 8 : 0), j * 8 + (along ? 0 : 8));
    grad.addColorStop(0, '#0d0e10');
    grad.addColorStop(0.5, along ? '#2a2c30' : '#1d1f22');
    grad.addColorStop(1, '#0d0e10');
    g.fillStyle = grad;
    g.fillRect(i * 8, j * 8, 8, 8);
  }
}, [10, 4]);
const treadMap = canvasTexture(256, 64, (g) => {
  g.fillStyle = '#1a1a1a';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#0a0a0a';
  for (let x = 0; x < 256; x += 8) { g.fillRect(x, 8, 2, 14); g.fillRect(x + 4, 42, 2, 14); }
  g.fillRect(0, 22, 256, 3);
  g.fillRect(0, 39, 256, 3);
}, [7, 1]);
// Brushed-metal plate with the embossed RDSTR from the reveal photos.
const plateMap = canvasTexture(256, 64, (g) => {
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, '#d9dcdf');
  grad.addColorStop(1, '#a9adb1');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#8d9196';
  g.lineWidth = 4;
  g.strokeRect(3, 3, 250, 58);
  g.font = 'bold 40px Arial';
  g.textAlign = 'center';
  g.fillStyle = '#f4f6f8';
  g.fillText('RDSTR', 129, 47);
  g.fillStyle = '#6f7378';
  g.fillText('RDSTR', 128, 46);
});

const materials = {
  bronze: new THREE.MeshStandardMaterial({ color: 0x9a7350, metalness: 1, roughness: 0.26 }),
  caliper: new THREE.MeshStandardMaterial({ color: 0x9a1b1b, metalness: 0.4, roughness: 0.4 }),
  carbon: new THREE.MeshStandardMaterial({ color: 0xffffff, map: carbonMap, metalness: 0.5, roughness: 0.32 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd6d9dc, metalness: 1, roughness: 0.15 }),
  disc: new THREE.MeshStandardMaterial({ color: 0x6b6f73, metalness: 0.85, roughness: 0.4 }),
  fan: new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }),
  // Bronze-gold tint, "like a spacesuit visor".
  glass: new THREE.MeshPhysicalMaterial({ clearcoat: 1, color: 0x3b2a1c, depthWrite: false, metalness: 0.55, opacity: 0.72, roughness: 0.04, side: THREE.DoubleSide, transparent: true }),
  head: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  interior: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.75 }),
  marker: new THREE.MeshBasicMaterial({ color: 0xff9a1a }),
  nozzle: new THREE.MeshStandardMaterial({ color: 0x77706a, metalness: 1, roughness: 0.3, side: THREE.DoubleSide }),
  plate: new THREE.MeshStandardMaterial({ map: plateMap, metalness: 0.6, roughness: 0.35 }),
  rim: new THREE.MeshStandardMaterial({ color: 0x0f1012, metalness: 0.6, roughness: 0.22 }),
  rimFace: new THREE.MeshStandardMaterial({ color: 0x45484c, metalness: 0.85, roughness: 0.32 }),
  screen: new THREE.MeshBasicMaterial({ color: 0x2d4f73 }),
  tail: new THREE.MeshBasicMaterial({ color: 0xff2a1f }),
  tailDim: new THREE.MeshBasicMaterial({ color: 0x8c0d0d }),
  trim: new THREE.MeshStandardMaterial({ color: 0x0e0f11, metalness: 0.3, roughness: 0.5 }),
  tyre: new THREE.MeshStandardMaterial({ map: treadMap, metalness: 0, roughness: 0.9 }),
};
// "Ano White": a satin, slightly pearly white.
export function roadsterPaint(color = 0xe8eae9) {
  return new THREE.MeshPhysicalMaterial({ clearcoat: 1, clearcoatRoughness: 0.08, color, metalness: 0.2, roughness: 0.3, sheen: 0.3, sheenColor: new THREE.Color(0xdfe8ff) });
}

// ---------------------------------------------------------------------------
// Body: cross-sections along the length (f = 0 nose, 1 tail), each eleven points from the
// bottom centre round the +x side to the top centre: underside, the wheel well's inner wall
// and roof (zero height away from the wheels), black sill, the lower side up to the chine,
// the upper side, the fender top, then the bonnet (in front of the windscreen) or the canopy
// glass. Each band between two points is its own strip, so the creases stay sharp.
const curves = {
  chineW: monotone([[0, 0.8], [0.06, 0.93], [0.15, 0.99], [0.5, 1], [0.85, 0.99], [1, 0.94]]),
  chineY: monotone([[0, 0.34], [0.07, 0.48], [0.3, 0.55], [0.7, 0.6], [0.93, 0.62], [1, 0.6]]),
  // Fender blades peak over the front wheels, well above the bonnet; haunches over the rear.
  deckY: monotone([[0, 0.53], [0.07, 0.74], [0.19, 0.9], [0.3, 0.86], [0.62, 0.85], [0.8, 0.93], [0.95, 0.93], [1, 0.9]]),
  glassW: monotone([[0, 0.42], [0.1, 0.5], [0.2, 0.53], [0.27, 0.6], [0.34, 0.66], [0.55, 0.7], [0.8, 0.66], [0.9, 0.6], [1, 0.58]]),
  shoulderY: monotone([[0, 0.46], [0.08, 0.66], [0.19, 0.82], [0.32, 0.79], [0.62, 0.8], [0.8, 0.9], [0.95, 0.9], [1, 0.87]]),
  // Centre line: low bonnet, steep windscreen, roof peak, long fastback glass, short deck.
  top: monotone([[0, 0.43], [0.04, 0.57], [0.15, 0.72], [0.27, 0.78], [0.36, 0.97], [0.48, 1.12], [0.56, 1.15], [0.7, 1.11], [0.86, 1], [0.9, 0.97], [1, 0.92]]),
  under: monotone([[0, 0.24], [0.035, 0.14], [0.09, 0.12], [0.9, 0.12], [0.965, 0.2], [1, 0.3]]),
};
const canopyAt = (f) => smooth((f - 0.265) / 0.03) * (1 - smooth((f - 0.855) / 0.03));
function section(f) {
  const z = L / 2 - f * L;
  // Chamfered corners in plan.
  const end = lerp(0.93, 1, smooth((f * L) / 0.35)) * lerp(0.93, 1, smooth(((1 - f) * L) / 0.25));
  const under = curves.under(f);
  let well = under, arch = 0, flare = 0;
  for (const a of AXLES) {
    const R = a.r + 0.06, dz = Math.abs(z - a.z);
    if (dz < R) { well = Math.max(well, a.r + Math.sqrt(R * R - dz * dz)); arch = 1; }
    flare = Math.max(flare, smooth(1 - dz / (R * 1.6)));
  }
  const cw = curves.chineW(f) * W2 * end, canopy = canopyAt(f), top = curves.top(f), inner = cw - 0.34;
  const y1 = well, y2 = y1 + 0.13 * (1 - arch) + 0.01;
  const y3 = Math.max(curves.chineY(f), y2 + 0.02), y4 = Math.max(curves.shoulderY(f), y3 + 0.03), y5 = Math.max(curves.deckY(f), y4 + 0.02);
  const x6 = curves.glassW(f) * end, y6 = lerp(top + 0.012, y5 + 0.025, canopy);
  const x7 = x6 * lerp(0.62, 0.8, canopy), y7 = lerp(top + 0.005, lerp(y6, top, 0.82), canopy);
  return { canopy, f, pts: [[0, under], [inner, under], [inner, y1], [cw - 0.1, y1], [cw - 0.08, y2], [cw + 0.03 * flare, y3], [cw - 0.04 + 0.015 * flare, y4], [cw - 0.09, y5], [x6, y6], [x7, y7], [0, top]], z };
}
// x of the side skin at height y (on the painted bands), for parts that sit on it.
function sideX(f, y) {
  const p = section(f).pts;
  for (let j = 4; j < 7; j++) {
    const [xa, ya] = p[j], [xb, yb] = p[j + 1];
    if (y >= ya && y <= yb) return lerp(xa, xb, (y - ya) / Math.max(1e-4, yb - ya));
  }
  return p[5][0];
}

function loftBody() {
  const N = 160, secs = Array.from({ length: N + 1 }, (_, i) => section(i / N)), P = secs[0].pts.length;
  const buckets = { glass: { n: [], p: [] }, paint: { n: [], p: [] }, trim: { n: [], p: [] } };
  const fn = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), vn = new THREE.Vector3();
  for (const side of [1, -1]) {
    for (let j = 0; j < P - 1; j++) {
      const pos = [], idx = [];
      for (const s of secs) pos.push(side * s.pts[j][0], s.pts[j][1], s.z, side * s.pts[j + 1][0], s.pts[j + 1][1], s.z);
      for (let i = 0; i < N; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(...(side > 0 ? [a, c, b, b, c, d] : [a, b, c, b, d, c])); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const nrm = g.attributes.normal.array;
      for (let i = 0; i < N; i++) {
        const name = j < 4 ? 'trim' : j >= 8 && (secs[i].canopy + secs[i + 1].canopy) / 2 > 0.5 ? 'glass' : 'paint', out = buckets[name];
        for (let t = 0; t < 2; t++) {
          const tri = idx.slice(i * 6 + t * 3, i * 6 + t * 3 + 3);
          const [A, B, C] = tri.map((k) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]));
          fn.crossVectors(e1.subVectors(B, A), e2.subVectors(C, A)).normalize();
          for (const k of tri) {
            out.p.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
            // Smooth along the strip, but steps (the wheel arch edges) keep their own facet.
            vn.set(nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]);
            const n = vn.dot(fn) < 0.85 ? fn : vn;
            out.n.push(n.x, n.y, n.z);
          }
        }
      }
    }
  }
  // Flat caps: the black nose band and the tail panel.
  const cap = (s, dir, out) => {
    const ring = [...s.pts, ...s.pts.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
    const cy = ring.reduce((sum, [, y]) => sum + y, 0) / ring.length;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const tri = dir > 0 ? [[0, cy], a, b] : [[0, cy], b, a];
      for (const [x, y] of tri) { out.p.push(x, y, s.z); out.n.push(0, 0, dir); }
    }
  };
  cap(secs[0], 1, buckets.trim);
  cap(secs[N], -1, buckets.paint);
  return Object.fromEntries(Object.entries(buckets).map(([name, { n, p }]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    return [name, g];
  }));
}

// ---------------------------------------------------------------------------
// Parts. Each points along +y from its origin; aim() turns +y to a direction.
const Y = new THREE.Vector3(0, 1, 0);
const aim = (o, dir) => o.quaternion.setFromUnitVectors(Y, dir.clone().normalize());

// A cold-gas nozzle: bronze collar, titanium bell, a throat that glows when it fires, and its
// vapour plume. The group's origin is the exit plane, +y the exhaust direction.
const PLUME_GEOMETRY = new THREE.CylinderGeometry(1, 0.35, 1, 20, 1, true).translate(0, 0.5, 0);
function plumeMaterial() {
  return new THREE.ShaderMaterial({
    depthWrite: false,
    fragmentShader: `
      uniform float uOpacity, uTime, uLight;
      varying float vAlong; varying vec3 vN, vV;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.3);
        float flick = 0.82 + 0.18 * sin(uTime * 71.0 + vAlong * 29.0) * sin(uTime * 43.0 - vAlong * 13.0);
        float a = pow(1.0 - vAlong, 1.5) * smoothstep(0.0, 0.06, vAlong) * edge * uOpacity * flick;
        gl_FragColor = vec4(mix(vec3(1.0), vec3(0.86, 0.92, 1.0), vAlong) * uLight, a);
      }`,
    side: THREE.DoubleSide,
    transparent: true,
    uniforms: { uLight: LIGHT, uOpacity: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `
      varying float vAlong; varying vec3 vN, vV;
      void main() {
        vAlong = position.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = -mv.xyz;
        vN = normalMatrix * normal;
        gl_Position = projectionMatrix * mv;
      }`,
  });
}
// (Its hardware is a subgroup, hidden with the other small parts at a distance; the plume stays.)
const nozzleGeometries = new Map();
function nozzle(exitR, depth, length) {
  const key = `${exitR}|${depth}`;
  if (!nozzleGeometries.has(key)) {
    const bell = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; bell.push(new THREE.Vector2(exitR * (0.36 + 0.64 * Math.pow(t, 1.7)), -depth * (1 - t))); }
    nozzleGeometries.set(key, {
      bell: new THREE.LatheGeometry(bell, 24),
      collar: new THREE.TorusGeometry(exitR + 0.004, 0.009, 8, 28).rotateX(Math.PI / 2),
      glow: new THREE.CircleGeometry(exitR * 0.38, 18).rotateX(-Math.PI / 2).translate(0, -depth * 0.95, 0),
      sleeve: new THREE.CylinderGeometry(exitR + 0.012, exitR * 0.7, depth, 24, 1, true).translate(0, -depth / 2, 0),
    });
  }
  const geo = nozzleGeometries.get(key), group = new THREE.Group(), hardware = new THREE.Group();
  const glowMaterial = new THREE.MeshBasicMaterial({ color: 0x141414 });
  hardware.add(new THREE.Mesh(geo.bell, materials.nozzle), new THREE.Mesh(geo.collar, materials.bronze), new THREE.Mesh(geo.sleeve, materials.bronze), new THREE.Mesh(geo.glow, glowMaterial));
  group.add(hardware);
  const plume = new THREE.Mesh(PLUME_GEOMETRY, plumeMaterial());
  plume.scale.set(exitR * 2.6, length, exitR * 2.6);
  plume.visible = false;
  plume.frustumCulled = false;
  plume.renderOrder = 2;
  group.add(plume);
  return { glowMaterial, group, hardware, length, plume };
}

// A suction fan: shroud ring, hub and seven pitched blades, spinning about +y.
const fanGeometries = new Map();
function fan(R) {
  if (!fanGeometries.has(R)) {
    const parts = [new THREE.TorusGeometry(R, 0.014, 8, 32).rotateX(Math.PI / 2), new THREE.CylinderGeometry(R * 0.22, R * 0.26, 0.05, 20)];
    for (let i = 0; i < 7; i++) parts.push(new THREE.BoxGeometry(R * 0.8, 0.008, R * 0.3).translate(R * 0.55, 0, 0).rotateX(0.5).rotateY((i * Math.PI * 2) / 7));
    fanGeometries.set(R, mergeGeometries(parts.map((p) => p.toNonIndexed())));
  }
  const rotor = new THREE.Mesh(fanGeometries.get(R), materials.fan);
  const mount = new THREE.Group();
  mount.add(rotor);
  return { mount, rotor };
}

// A wheel: low-profile tyre, black rim lip and barrel, recessed gunmetal face, five straight
// black spokes and a brake disc, merged per material (once per size). Spins about x.
const wheelParts = new Map();
function wheel(r, w, side) {
  const rim = r * 0.75, face = side * (w / 2 - 0.02), key = `${r}|${w}|${side}`;
  if (!wheelParts.has(key)) wheelParts.set(key, wheelGeometries(r, w, side));
  const spin = new THREE.Group();
  for (const [m, geometry] of wheelParts.get(key)) spin.add(new THREE.Mesh(geometry, m));
  const caliper = new THREE.Mesh(new RoundedBoxGeometry(0.07, rim * 0.55, 0.14, 2, 0.02), materials.caliper);
  caliper.position.set(face - side * 0.14, rim * 0.42, -rim * 0.3);
  return { caliper, spin };
}
function wheelGeometries(r, w, side) {
  const rim = r * 0.75, face = side * (w / 2 - 0.02), axisX = (g) => g.rotateZ(Math.PI / 2);
  const profile = [[rim, -w / 2], [r - 0.03, -w / 2], [r - 0.004, -w / 2 + 0.03], [r, -w / 4], [r, w / 4], [r - 0.004, w / 2 - 0.03], [r - 0.03, w / 2], [rim, w / 2]];
  const byMaterial = new Map();
  const put = (g, m, x = 0) => { g.translate(x, 0, 0); if (!byMaterial.has(m)) byMaterial.set(m, []); byMaterial.get(m).push(g.index ? g.toNonIndexed() : g); };
  put(axisX(new THREE.LatheGeometry(profile.map(([a, b]) => new THREE.Vector2(a, b)), 40)), materials.tyre);
  put(axisX(new THREE.TorusGeometry(rim, 0.013, 8, 40).rotateX(Math.PI / 2)), materials.rim, face);
  put(axisX(new THREE.CylinderGeometry(rim, rim, w * 0.85, 40, 1, true)), materials.rim);
  put(axisX(new THREE.CylinderGeometry(rim * 0.96, rim * 0.96, 0.012, 40)), materials.rimFace, face - side * 0.06);
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5;
    const spoke = new THREE.BoxGeometry(0.03, rim - 0.06, 0.06).translate(0, (rim - 0.06) / 2 + 0.05, 0).rotateX(a);
    put(spoke, materials.rim, face - side * 0.02);
  }
  put(axisX(new THREE.CylinderGeometry(0.07, 0.075, 0.04, 20)), materials.chrome, face - side * 0.01);
  put(axisX(new THREE.CylinderGeometry(rim - 0.04, rim - 0.04, 0.028, 32)), materials.disc, face - side * 0.11);
  return [...byMaterial].map(([m, list]) => [m, mergeGeometries(list)]);
}

// A seated driver for behind the glass (white shirt, as the player on foot).
function driver(x, y, z) {
  const tint = (g, c) => { g = g.toNonIndexed(); const col = new Float32Array(g.attributes.position.count * 3); const k = new THREE.Color(c); for (let i = 0; i < col.length; i += 3) col.set([k.r, k.g, k.b], i); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv'); return g; };
  const g = mergeGeometries([
    tint(new RoundedBoxGeometry(0.4, 0.52, 0.24, 2, 0.06).translate(x, y + 0.27, z), 0xf5f5f5),
    tint(new THREE.SphereGeometry(0.1, 14, 10).translate(x, y + 0.66, z + 0.02), 0xf1c8a5),
    tint(new THREE.SphereGeometry(0.106, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(x, y + 0.675, z), 0x2a1d14),
    tint(new THREE.BoxGeometry(0.08, 0.3, 0.08).rotateX(-1.1).translate(x - 0.17, y + 0.38, z + 0.15), 0xf5f5f5),
    tint(new THREE.BoxGeometry(0.08, 0.3, 0.08).rotateX(-1.1).translate(x + 0.17, y + 0.38, z + 0.15), 0xf5f5f5),
  ]);
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

// The wing over the tail deck: its airfoil, and its height and tilt for a deploy level (0
// stowed, 1 raised for downforce, up to 2 tilted steep as an air brake).
const WING = { deckTop: section((L / 2 + 1.93) / L).pts[10][1], span: 1.86, z: -1.93 };
function wingGeometry() {
  if (!wingGeometry.cache) {
    const airfoil = new THREE.Shape();
    airfoil.moveTo(0, 0);
    for (const [u, v] of [[0.04, 0.026], [0.12, 0.042], [0.26, 0.036], [0.4, 0.012], [0.44, 0.004]]) airfoil.lineTo(u, v);
    for (const [u, v] of [[0.44, -0.004], [0.3, -0.008], [0.12, -0.012], [0.03, -0.01]]) airfoil.lineTo(u, v);
    wingGeometry.cache = new THREE.ExtrudeGeometry(airfoil, { bevelEnabled: false, depth: WING.span }).rotateY(Math.PI / 2).translate(-WING.span / 2, 0, 0.22);
  }
  return wingGeometry.cache;
}
const wingHeight = (level) => WING.deckTop + 0.04 + Math.min(1, level) * 0.3;
const wingTilt = (level) => 0.04 + Math.min(1, level) * 0.12 + Math.max(0, level - 1) * 0.5;

// ---------------------------------------------------------------------------
export function buildRoadster(color) {
  const paint = roadsterPaint(color);
  const group = new THREE.Group(), chassis = new THREE.Group(), details = new THREE.Group();
  group.add(chassis);
  chassis.add(details);
  const add = (geometry, material, x = 0, y = 0, z = 0, parent = chassis) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const body = (loftBody.cache ||= loftBody()), paintMeshes = [];
  paintMeshes.push(add(body.paint, paint));
  add(body.trim, materials.trim);
  add(body.glass, materials.glass).renderOrder = 1;
  const front = L / 2, rear = -L / 2;
  const fAt = (z) => (front - z) / L;

  // Front: the thin light bar along the bonnet's leading edge, LED slits under the blades,
  // a black splitter.
  const nose = section(0).pts;
  add(new THREE.BoxGeometry(nose[8][0] * 2, 0.012, 0.012), materials.head, 0, nose[10][1] - 0.012, front + 0.004, details);
  for (const side of [-1, 1]) {
    const slit = add(new THREE.BoxGeometry(0.12, 0.02, 0.012), materials.head, side * (nose[7][0] - 0.07), nose[7][1] - 0.025, front + 0.004, details);
    slit.rotation.z = side * 0.3;
    // Amber side marker on the front fender.
    const fm = fAt(1.05), y = 0.62;
    add(new THREE.BoxGeometry(0.01, 0.025, 0.09), materials.marker, side * (sideX(fm, y) + 0.004), y, 1.05, details);
  }
  add(new THREE.BoxGeometry(1.4, 0.1, 0.12), materials.trim, 0, 0.18, front - 0.05, details);

  // Tail: two full-width red bars under the deck lip, the RDSTR plate, and the carbon housing
  // with the four main nozzles over the four suction fans.
  const tailW = section(0.99).pts[6][0] * 2;
  add(new THREE.BoxGeometry(tailW - 0.06, 0.026, 0.02), materials.tail, 0, 0.845, rear - 0.004, details);
  add(new THREE.BoxGeometry(tailW - 0.2, 0.01, 0.02), materials.tailDim, 0, 0.8, rear - 0.004, details);
  add(new THREE.PlaneGeometry(0.42, 0.105), materials.plate, 0, 0.665, rear - 0.022, details).rotation.y = Math.PI;
  add(new THREE.BoxGeometry(0.46, 0.13, 0.02), materials.trim, 0, 0.665, rear - 0.006, details);
  add(new RoundedBoxGeometry(1.42, 0.42, 0.12, 3, 0.03), materials.carbon, 0, 0.36, rear - 0.03, details);
  // Bronze diffuser fins between the fans.
  for (const x of [-0.34, 0, 0.34]) add(new THREE.BoxGeometry(0.012, 0.18, 0.1), materials.bronze, x, 0.29, rear - 0.07, details);

  const nozzles = [], fans = [];
  const mount = (n, x, y, z, dir, kind, side = 0) => {
    n.group.position.set(x, y, z);
    aim(n.group, dir);
    chassis.add(n.group);
    nozzles.push({ ...n, dir, kind, phase: Math.random() * 10, side });
  };
  const back = new THREE.Vector3(0, 0, -1), down = new THREE.Vector3(0, -1, 0);
  for (const x of [-0.51, -0.17, 0.17, 0.51]) {
    mount(nozzle(0.055, 0.1, 2.8), x, 0.47, rear - 0.1, back, 'rear');
    const f = fan(0.12);
    f.mount.position.set(x, 0.29, rear - 0.085);
    aim(f.mount, back);
    details.add(f.mount);
    fans.push(f);
  }
  for (const side of [-1, 1]) {
    mount(nozzle(0.045, 0.08, 1.6), side * 0.8, 0.14, -1.98, down, 'down');
    mount(nozzle(0.045, 0.08, 1.6), side * 0.74, 0.15, 1.86, down, 'down');
    mount(nozzle(0.032, 0.05, 1.1), side * (sideX(fAt(-0.3), 0.45) + 0.01), 0.45, -0.3, new THREE.Vector3(side, 0, 0), 'side', side);
  }

  // Swan-neck wing on two struts; stowed flush on the deck, raised and tilted by update().
  const { deckTop, span, z: wingZ } = WING;
  const wing = new THREE.Group();
  wing.add(new THREE.Mesh(wingGeometry(), materials.bronze));
  const endplates = [-1, 1].map((side) => new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.15, 0.48).translate(side * span / 2, 0.02, 0), materials.bronze));
  wing.add(...endplates);
  wing.position.set(0, deckTop + 0.04, wingZ);
  chassis.add(wing);
  const struts = [-0.42, 0.42].map((x) => add(new THREE.BoxGeometry(0.018, 1, 0.11).translate(0, 0.5, 0), materials.trim, x, deckTop - 0.02, -1.9, details));

  // Cabin: floor, two seats, dashboard with its screen, the yoke, and the driver (shown while
  // the player drives).
  add(new THREE.BoxGeometry(1.5, 0.04, 2.2), materials.interior, 0, 0.3, -0.05, details);
  for (const x of [-0.36, 0.36]) {
    add(new RoundedBoxGeometry(0.5, 0.12, 0.52, 2, 0.04), materials.interior, x, 0.38, -0.2, details);
    add(new RoundedBoxGeometry(0.5, 0.62, 0.12, 2, 0.05).rotateX(-0.32), materials.interior, x, 0.68, -0.5, details);
  }
  add(new THREE.BoxGeometry(1.4, 0.16, 0.34), materials.interior, 0, 0.66, 0.62, details);
  add(new THREE.PlaneGeometry(0.34, 0.2).rotateX(-0.5), materials.screen, 0, 0.8, 0.5, details);
  add(new THREE.TorusGeometry(0.15, 0.018, 8, 20, Math.PI).rotateX(-0.3).rotateZ(Math.PI), materials.trim, 0.36, 0.79, 0.4, details);
  const seated = driver(0.36, 0.38, -0.25);
  seated.visible = false;
  details.add(seated);

  // Door shut lines and the canopy's B-pillar, following the skin.
  const line = (points) => add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.004, 4), materials.trim, 0, 0, 0, details);
  for (const side of [-1, 1]) {
    const doorLine = (zLow, zHigh) => {
      const pts = [];
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const z = lerp(zLow, zHigh, t), s = section(fAt(z)), y = lerp(s.pts[4][1] + 0.02, s.pts[7][1] - 0.01, t);
        pts.push(new THREE.Vector3(side * (sideX(fAt(z), y) + 0.003), y, z));
      }
      line(pts);
    };
    doorLine(0.72, 0.66);
    doorLine(-0.62, -0.5);
  }
  const bz = -0.55, bs = section(fAt(bz));
  const bp = bs.pts;
  line([new THREE.Vector3(bp[8][0], bp[8][1], bz), new THREE.Vector3(bp[9][0] + 0.003, bp[9][1] + 0.003, bz - 0.05), new THREE.Vector3(0, bp[10][1] + 0.004, bz - 0.07), new THREE.Vector3(-bp[9][0] - 0.003, bp[9][1] + 0.003, bz - 0.05), new THREE.Vector3(-bp[8][0], bp[8][1], bz)]);

  // Wheels on mounts that stay grounded; front ones steer.
  const wheels = [], calipers = [];
  for (const [i, a] of AXLES.entries()) {
    for (const side of [-1, 1]) {
      const w = wheel(a.r, i === 0 ? 0.31 : 0.27, side), m = new THREE.Group();
      m.position.set(side * (W2 - 0.17), a.r, a.z);
      m.add(w.spin, w.caliper);
      calipers.push(w.caliper);
      group.add(m);
      wheels.push({ r: a.r, spin: w.spin, steer: i === 1 ? m : null });
    }
  }
  // One box stands in for the car in the shadow map (the game puts it on the shadow layer).
  const shadow = new THREE.Mesh(new THREE.BoxGeometry(ROADSTER.width * 0.95, ROADSTER.height - ROADSTER.clearance, L * 0.95).translate(0, (ROADSTER.height + ROADSTER.clearance) / 2, 0), materials.trim);
  chassis.add(shadow);

  // Thrust levels ease in and out; plumes stretch and flicker, throats glow, fans spin up.
  const level = { boost: 0, down: 0, fan: 0, sideL: 0, sideR: 0, wing: 0 };
  let time = 0;
  const glowOff = new THREE.Color(0x141414), glowOn = new THREE.Color(0xcfe6ff);
  const update = (dt, state) => {
    state ||= {};
    time += dt;
    const k = 1 - Math.exp(-dt * 9);
    level.boost += ((state.boost || 0) - level.boost) * k;
    level.down += ((state.lift || 0) - level.down) * k;
    level.sideL += (Math.max(0, state.side || 0) - level.sideL) * k;
    level.sideR += (Math.max(0, -(state.side || 0)) - level.sideR) * k;
    level.fan += ((state.fan || 0) - level.fan) * (1 - Math.exp(-dt * 2));
    level.wing += ((state.wing || 0) - level.wing) * (1 - Math.exp(-dt * 4));
    for (const n of nozzles) {
      const on = n.kind === 'rear' ? level.boost : n.kind === 'down' ? level.down : n.side > 0 ? level.sideL : level.sideR;
      n.plume.visible = on > 0.02 && lod < 2;
      n.plume.scale.y = n.length * (0.2 + on) * (0.92 + 0.08 * Math.sin(time * 37 + n.phase));
      n.plume.material.uniforms.uOpacity.value = Math.min(0.85, on * 1.1);
      n.plume.material.uniforms.uTime.value = time + n.phase;
      n.glowMaterial.color.copy(glowOff).lerp(glowOn, Math.min(1, on * 1.5));
    }
    for (const f of fans) f.rotor.rotation.y += dt * (3 + level.fan * 80);
    // Wing: 0 stowed, 1 raised for downforce, up to 2 tilted steep as an air brake.
    wing.position.y = wingHeight(level.wing);
    wing.rotation.x = wingTilt(level.wing);
    for (const s of struts) s.scale.y = Math.max(0.02, wing.position.y - deckTop + 0.01);
  };

  // Detail by camera distance: everything under 70 m; to 130 m the body, wing, tyres and
  // plumes; beyond, the body and wing alone, exactly as createRoadsterCrowd() draws it.
  let lod = 0;
  const setDistance = (d) => {
    const next = d < 70 ? 0 : d < 130 ? 1 : 2;
    if (next === lod) return;
    lod = next;
    details.visible = lod === 0;
    for (const part of [...calipers, ...endplates, ...nozzles.map((n) => n.hardware)]) part.visible = lod === 0;
    for (const w of wheels) w.spin.children.forEach((m, i) => { m.visible = lod === 0 || (lod === 1 && i === 0); });
  };
  const setPaint = (material) => { for (const m of paintMeshes) m.material = material; };
  return {
    chassis, group, paint, setDistance, setPaint, shadow, top: ROADSTER.height + 0.05, wheels,
    roadster: { nozzles, setDriver: (on) => { seated.visible = on; }, update },
  };
}

// ---------------------------------------------------------------------------
// Distant Roadsters as instances, a few draw calls for hundreds of cars: the body and wing,
// just as a Roadster past 130 m draws itself, so a car can switch between the two unseen.
// Each frame: begin(), add() per car (pose as the game's root: position, then yaw, pitch, roll
// in that order; wing deploy level; paint colour), end().
export function createRoadsterCrowd(max) {
  const body = (loftBody.cache ||= loftBody());
  const make = (geometry, material) => {
    const mesh = new THREE.InstancedMesh(geometry, material, max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  };
  const paint = make(body.paint, roadsterPaint(0xffffff)), glass = make(body.glass, materials.glass);
  const meshes = [paint, make(body.trim, materials.trim), glass, make(wingGeometry(), materials.bronze)];
  glass.renderOrder = 1;
  const car = new THREE.Matrix4(), wing = new THREE.Matrix4(), turn = new THREE.Euler(0, 0, 0, 'YXZ'), q = new THREE.Quaternion(), at = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), colour = new THREE.Color();
  let n = 0;
  return {
    meshes,
    begin() { n = 0; },
    add(x, y, z, yaw, pitch, roll, wingLevel, paintColour) {
      if (n >= max) return;
      car.compose(at.set(x, y, z), q.setFromEuler(turn.set(pitch, yaw, roll)), one);
      for (let i = 0; i < 3; i++) meshes[i].setMatrixAt(n, car);
      wing.compose(at.set(0, wingHeight(wingLevel), WING.z), q.setFromEuler(turn.set(wingTilt(wingLevel), 0, 0)), one);
      meshes[3].setMatrixAt(n, car.multiply(wing));
      paint.setColorAt(n, colour.set(paintColour));
      n++;
    },
    end() {
      for (const mesh of meshes) { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; }
      if (paint.instanceColor) paint.instanceColor.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------------------
// Cold-gas vapour: one point cloud of soft puffs that drift, slow, rise a little and fade.
const puffMap = (() => {
  const t = canvasTexture(128, 128, (g) => {
    for (let i = 0; i < 14; i++) {
      const x = 64 + (Math.random() - 0.5) * 50, y = 64 + (Math.random() - 0.5) * 50, r = 22 + Math.random() * 26, shade = 200 + Math.floor(Math.random() * 55);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${shade},${shade},${shade},0.5)`);
      grad.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    }
    // Fade the square's edges out completely.
    g.globalCompositeOperation = 'destination-in';
    const mask = g.createRadialGradient(64, 64, 20, 64, 64, 64);
    mask.addColorStop(0, 'rgba(0,0,0,1)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = mask;
    g.fillRect(0, 0, 128, 128);
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
})();
export function createVapor(max = 1500) {
  const pos = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max);
  const vel = new Float32Array(max * 3), age = new Float32Array(max).fill(1), life = new Float32Array(max).fill(1), size0 = new Float32Array(max), size1 = new Float32Array(max);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({
    depthWrite: false,
    fragmentShader: `
      uniform sampler2D uMap; uniform float uLight; varying float vA;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        float a = t.a * vA;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vec3(0.93, 0.95, 0.98) * (0.75 + 0.25 * t.r) * uLight, a);
      }`,
    transparent: true,
    uniforms: { uLight: LIGHT, uMap: { value: puffMap }, uScale: { value: 500 } },
    vertexShader: `
      attribute float aSize, aAlpha; uniform float uScale; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / max(0.2, -mv.z);
        vA = aAlpha;
        gl_Position = projectionMatrix * mv;
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  let next = 0;
  const emit = (x, y, z, vx, vy, vz, from, to, seconds) => {
    const i = next;
    next = (next + 1) % max;
    pos.set([x, y, z], i * 3);
    vel.set([vx, vy, vz], i * 3);
    age[i] = 0;
    life[i] = seconds;
    size0[i] = from;
    size1[i] = to;
  };
  const update = (dt, camera, renderer) => {
    material.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < max; i++) {
      if (age[i] >= life[i]) { alpha[i] = 0; size[i] = 0; continue; }
      age[i] += dt;
      const t = Math.min(1, age[i] / life[i]), o = i * 3;
      vel[o] *= drag;
      vel[o + 1] = vel[o + 1] * drag + 0.5 * dt;
      vel[o + 2] *= drag;
      pos[o] += vel[o] * dt;
      pos[o + 1] += vel[o + 1] * dt;
      pos[o + 2] += vel[o + 2] * dt;
      size[i] = lerp(size0[i], size1[i], Math.sqrt(t));
      alpha[i] = Math.min(1, t * 10) * Math.pow(1 - t, 1.3) * 0.5;
    }
    for (const name of ['position', 'aSize', 'aAlpha']) geometry.attributes[name].needsUpdate = true;
  };
  return { emit, points, update };
}
