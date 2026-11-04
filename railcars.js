// Detailed rail cars: an Oslo trikk (CAF SL18 style) and a Vy commuter train.
// Bodies are extruded from a side profile with bevelled edges, so noses curve into the
// windshield; windows, doors, lamps, bogies and roof gear are layered on top.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Physically based materials so paint, glass and metal pick up the scene's reflections.
const pbr = new Map();
function paint(color, options = {}) {
  const key = `${color}|${JSON.stringify(options)}`;
  if (!pbr.has(key)) pbr.set(key, new THREE.MeshPhysicalMaterial({ clearcoat: 0.6, clearcoatRoughness: 0.15, color, metalness: 0.2, roughness: 0.4, ...options }));
  return pbr.get(key);
}

export const RAIL_STYLES = {
  train: {
    body: 0xf1f1ee, cab: 0x2b2f35, doorWidth: 1.5, doors: [-0.3, 0.3], floor: 0.95, glass: 0x18283a, height: 4.15, len: 20,
    nose: 3.2, roof: 0xb4bac1, sign: ['R11', 'Skien'], skirt: 0x34383e, stripe: 0xc8102e, stripeY: 1.55, wheelBase: 0.36, width: 3.1, windowBottom: 2.05,
  },
  tram: {
    body: 0x1f66c4, cab: 0x1f66c4, doorWidth: 1.35, doors: [-0.12, 0.28], floor: 0.42, glass: 0x172636, height: 3.55, len: 10.5,
    nose: 0.9, roof: 0xc4c9ce, sign: ['12', 'Majorstuen'], skirt: 0x2a2e33, stripe: 0xffffff, stripeY: 1.08, wheelBase: 0.3, width: 2.65, windowBottom: 1.45,
  },
};

const BEVEL = 0.12;

// How far the end face is set back at height y: vertical up to the bumper, then a curve
// that leans back into the roof (cab ends) or just a rounded top corner (coupled ends).
function inset(style, y, cab) {
  const { floor, height: H, nose } = style;
  if (cab) {
    const y0 = floor + 1.0;
    if (y <= y0) return 0;
    return nose * ((y - y0) / (H - y0)) ** 1.7;
  }
  const r = 0.35;
  return y > H - r ? r - Math.sqrt(Math.max(0, r * r - (y - (H - r)) ** 2)) : 0;
}

// Body silhouette in (z, y), extruded across the width.
function bodyGeometry(style, front, back) {
  const { floor, height: H, len: L, width: W } = style;
  const shape = new THREE.Shape();
  const steps = 14;
  shape.moveTo(-L / 2 + 0.2, floor);
  shape.lineTo(L / 2 - 0.2, floor);
  shape.quadraticCurveTo(L / 2, floor, L / 2, floor + 0.2);
  for (let i = 0; i <= steps; i++) {
    const y = floor + 0.2 + ((H - floor - 0.2) * i) / steps;
    shape.lineTo(L / 2 - inset(style, y, front), y);
  }
  for (let i = steps; i >= 0; i--) {
    const y = floor + 0.2 + ((H - floor - 0.2) * i) / steps;
    shape.lineTo(-L / 2 + inset(style, y, back), y);
  }
  shape.quadraticCurveTo(-L / 2, floor, -L / 2 + 0.2, floor);
  const geo = new THREE.ExtrudeGeometry(shape, { bevelEnabled: true, bevelSegments: 4, bevelSize: BEVEL, bevelThickness: BEVEL, depth: W - 2 * BEVEL, steps: 1 });
  // Shape x is the car length (world z); the extrusion runs across the width (world x).
  geo.rotateY(-Math.PI / 2);
  geo.translate((W - 2 * BEVEL) / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

// Rounded rectangle plate in the y-z plane, facing +x (mirror with scale.x = -1).
function plate(w, h, depth, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const g = new THREE.ExtrudeGeometry(s, { bevelEnabled: false, depth });
  g.rotateY(Math.PI / 2);
  return g;
}

function signTexture([line, destination]) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0b0b';
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#ffb000';
  g.font = 'bold 66px Arial';
  g.textBaseline = 'middle';
  g.fillText(line, 18, 50);
  g.font = 'bold 52px Arial';
  g.fillText(destination, 150, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Collects geometry per material, then merges it into one mesh per material.
class Builder {
  constructor() { this.parts = new Map(); }
  add(material, geometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, mirror = false) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    if (mirror) { g.scale(-1, 1, 1); flipWinding(g); }
    g.translate(x, y, z);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(g);
  }
  // Same part on both sides of the car (x and -x).
  both(material, geometry, x, y, z, rx = 0, ry = 0, rz = 0) {
    this.add(material, geometry, x, y, z, rx, ry, rz);
    this.add(material, geometry, -x, y, z, rx, ry, rz, true);
  }
  finish() { return [...this.parts].map(([material, geos]) => ({ geometry: mergeGeometries(geos), material })); }
}
function flipWinding(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i += 3) {
    for (const attr of [p, n, g.attributes.uv].filter(Boolean)) {
      const size = attr.itemSize;
      for (let k = 0; k < size; k++) {
        const a = attr.array[(i + 1) * size + k];
        attr.array[(i + 1) * size + k] = attr.array[(i + 2) * size + k];
        attr.array[(i + 2) * size + k] = a;
      }
    }
  }
}

const templates = new Map();

function buildTemplate(kind, front, back, pantograph, sign) {
  const st = RAIL_STYLES[kind];
  const { floor, height: H, len: L, width: W } = st;
  const m = {
    body: paint(st.body), cab: paint(st.cab), dark: paint(0x1d2024, { clearcoat: 0, roughness: 0.8 }), door: paint(new THREE.Color(st.body).multiplyScalar(0.92).getHex()),
    frame: paint(0x2a2d31, { clearcoat: 0, roughness: 0.6 }), glass: paint(st.glass, { clearcoat: 1, clearcoatRoughness: 0.02, metalness: 0.6, roughness: 0.05 }),
    amber: new THREE.MeshBasicMaterial({ color: 0xffa31a }), head: new THREE.MeshBasicMaterial({ color: 0xfff6e0 }), metal: paint(0xa7adb3, { clearcoat: 0, metalness: 0.9, roughness: 0.35 }),
    roof: paint(st.roof, { clearcoat: 0, metalness: 0.5, roughness: 0.5 }), sign: new THREE.MeshBasicMaterial({ map: signTexture(sign || st.sign) }),
    skirt: paint(st.skirt, { clearcoat: 0.2, roughness: 0.6 }), stripe: paint(st.stripe), tail: new THREE.MeshBasicMaterial({ color: 0xe0142e }),
  };
  const b = new Builder();
  const side = W / 2;

  // Skirt, stripe and roof cap wrap the body.
  const top = H + BEVEL;
  b.add(m.skirt, new RoundedBoxGeometry(W + 0.04, 0.78, L + 0.2, 3, 0.22), 0, floor + 0.17, 0);
  b.add(m.stripe, new RoundedBoxGeometry(W + 0.06, 0.12, L - 0.35, 2, 0.05), 0, st.stripeY, 0);
  const roofLen = L - (front ? st.nose : 0.4) - (back ? st.nose : 0.4);
  b.add(m.roof, new RoundedBoxGeometry(W * 0.86, 0.22, roofLen, 3, 0.1), 0, top + 0.02, ((back ? st.nose : 0.4) - (front ? st.nose : 0.4)) / 2);

  // Side windows with frames, and double doors.
  const winTop = H - 0.5, winBottom = st.windowBottom, winH = winTop - winBottom, winY = (winTop + winBottom) / 2;
  const zMin = -L / 2 + inset(st, winTop, back) + 0.5, zMax = L / 2 - inset(st, winTop, front) - 0.5;
  const doors = st.doors.map((f) => f * L).filter((z) => z - st.doorWidth / 2 > zMin && z + st.doorWidth / 2 < zMax);
  const gaps = [zMin, ...doors.flatMap((z) => [z - st.doorWidth / 2 - 0.25, z + st.doorWidth / 2 + 0.25]), zMax];
  for (let i = 0; i < gaps.length; i += 2) {
    const a = gaps[i], c = gaps[i + 1], span = c - a;
    if (span < 0.6) continue;
    const n = Math.max(1, Math.round(span / 1.7)), pane = (span - 0.16 * (n - 1)) / n;
    for (let k = 0; k < n; k++) {
      const z = a + pane / 2 + k * (pane + 0.16);
      b.both(m.frame, plate(pane + 0.14, winH + 0.14, 0.03, 0.14), side, winY, z);
      b.both(m.glass, plate(pane, winH, 0.05, 0.08), side + 0.005, winY, z);
    }
  }
  for (const z of doors) {
    const dh = H - 0.55 - (floor + 0.12), dy = floor + 0.12 + dh / 2;
    b.both(m.frame, plate(st.doorWidth + 0.12, dh + 0.1, 0.03, 0.1), side, dy, z);
    for (const half of [-1, 1]) {
      const leafZ = z + (half * st.doorWidth) / 4;
      b.both(m.door, plate(st.doorWidth / 2 - 0.04, dh, 0.05, 0.08), side + 0.004, dy, leafZ);
      b.both(m.glass, plate(st.doorWidth / 2 - 0.3, dh * 0.5, 0.06, 0.08), side + 0.01, dy + dh * 0.16, leafZ);
    }
    b.both(m.dark, new THREE.BoxGeometry(0.03, dh, 0.04), side + 0.06, dy, z);
    b.both(m.stripe, new THREE.BoxGeometry(0.05, 0.18, 0.18), side + 0.07, floor + 1.2, z + st.doorWidth / 2 + 0.2);
  }

  // Cab end: curved windshield on the nose, destination sign, lamps, wiper and coupler.
  // Outer skin of the cab at height y: the bevel pushes it out along the slope normal.
  const skinZ = (y, extra) => {
    const slope = (inset(st, y + 0.01, true) - inset(st, y - 0.01, true)) / 0.02;
    return L / 2 - inset(st, y, true) + BEVEL * Math.sqrt(1 + slope * slope) + extra;
  };
  const cabEnd = (dir, isFront) => {
    const ya = st.windowBottom - 0.1, yb = H - 0.05;
    const s = new THREE.Shape();
    const samples = 10;
    for (let i = 0; i <= samples; i++) {
      const y = ya + ((yb - ya) * i) / samples;
      const z = skinZ(y, 0.03);
      i ? s.lineTo(z, y) : s.moveTo(z, y);
    }
    for (let i = samples; i >= 0; i--) {
      const y = ya + ((yb - ya) * i) / samples;
      s.lineTo(skinZ(y, -0.2), y);
    }
    const shield = new THREE.ExtrudeGeometry(s, { bevelEnabled: false, depth: W * 0.84 });
    shield.rotateY(-Math.PI / 2);
    shield.translate((W * 0.84) / 2, 0, 0);
    if (dir < 0) { shield.rotateY(Math.PI); }
    b.add(m.glass, shield);
    // Sign sits in the top of the windshield, tilted to its slope.
    const ySign = yb - 0.4, slope = Math.atan((inset(st, ySign + 0.1, true) - inset(st, ySign - 0.1, true)) / 0.2);
    const zSign = skinZ(ySign, 0.07) * dir;
    b.add(m.sign, new THREE.PlaneGeometry(W * 0.62, 0.34), 0, ySign, zSign, -slope * dir, dir < 0 ? Math.PI : 0, 0);
    const zFace = (L / 2 + BEVEL) * dir;
    // Slim LED lamp clusters set into a dark housing.
    for (const x of [-W * 0.34, W * 0.34]) {
      b.add(m.frame, new RoundedBoxGeometry(0.62, 0.2, 0.06, 2, 0.04), x, floor + 0.78, zFace + 0.01 * dir);
      b.add(isFront ? m.head : m.tail, new THREE.PlaneGeometry(0.22, 0.1), x - 0.14, floor + 0.78, zFace + 0.05 * dir, 0, dir < 0 ? Math.PI : 0, 0);
      b.add(isFront ? m.amber : m.tail, new THREE.PlaneGeometry(0.12, 0.08), x + 0.17, floor + 0.78, zFace + 0.05 * dir, 0, dir < 0 ? Math.PI : 0, 0);
    }
    b.add(m.dark, new RoundedBoxGeometry(W * 0.5, 0.3, 0.35, 2, 0.1), 0, floor + 0.15, zFace + 0.1 * dir);
    const yw = ya + 0.25;
    b.add(m.dark, new THREE.BoxGeometry(0.06, 1.0, 0.04), W * 0.15, yw + 0.4, skinZ(yw + 0.4, 0.06) * dir, -slope * dir, 0, 0.7);
    if (kind === 'tram') {
      // Rear-view mirrors on stalks.
      const zm = (L / 2 - inset(st, ya + 0.6, true) - 0.3) * dir;
      b.both(m.dark, new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), side + 0.2, ya + 0.75, zm, 0, 0, Math.PI / 2);
      b.both(m.cab, new RoundedBoxGeometry(0.1, 0.42, 0.24, 2, 0.05), side + 0.45, ya + 0.65, zm);
    }
  };
  if (front) cabEnd(1, true);
  if (back) cabEnd(-1, false);

  // Roof gear: cooling units, and a jointed pantograph on the powered car.
  for (const z of [-L * 0.22, L * 0.22]) if (Math.abs(z) < roofLen / 2 - 0.8) b.add(m.roof, new RoundedBoxGeometry(W * 0.55, 0.35, 1.5, 3, 0.14), 0, top + 0.2, z);
  if (pantograph) {
    const base = top + 0.1;
    b.add(m.dark, new THREE.BoxGeometry(1.2, 0.12, 1.2), 0, base, 0);
    for (const x of [-0.45, 0.45]) {
      b.add(m.metal, new THREE.CylinderGeometry(0.04, 0.04, 1.3, 6), x, base + 0.45, -0.45, 0.95, 0, 0);
      b.add(m.metal, new THREE.CylinderGeometry(0.035, 0.035, 1.2, 6), x, base + 1.0, -0.2, -1.15, 0, 0);
    }
    b.add(m.dark, new THREE.BoxGeometry(1.6, 0.06, 0.18), 0, base + 1.25, 0.05);
    b.add(m.metal, new THREE.TorusGeometry(0.12, 0.03, 6, 10, Math.PI), 0.86, base + 1.2, 0.05, 0, Math.PI / 2, -Math.PI / 2);
    b.add(m.metal, new THREE.TorusGeometry(0.12, 0.03, 6, 10, Math.PI), -0.86, base + 1.2, 0.05, 0, Math.PI / 2, Math.PI / 2);
  }

  // Bogie frames (the wheelsets are separate meshes so they can spin).
  const bogieZ = [-L * st.wheelBase, L * st.wheelBase];
  for (const z of bogieZ) {
    b.add(m.dark, new RoundedBoxGeometry(W * 0.82, 0.42, 2.6, 2, 0.12), 0, 0.42, z);
    b.both(m.metal, new THREE.CylinderGeometry(0.12, 0.12, 0.25, 10), W * 0.43, 0.4, z, 0, 0, Math.PI / 2);
  }

  const parts = b.finish();
  const bodyParts = [{ geometry: bodyGeometry(st, front, back), material: m.body }];
  const wheelGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.36, 0.36, 0.14, 16).rotateZ(Math.PI / 2).translate(0.72, 0, 0),
    new THREE.CylinderGeometry(0.36, 0.36, 0.14, 16).rotateZ(Math.PI / 2).translate(-0.72, 0, 0),
    new THREE.CylinderGeometry(0.07, 0.07, 1.44, 8).rotateZ(Math.PI / 2),
  ].map((g) => g.toNonIndexed()));
  const hubGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.2, 0.2, 0.16, 12).rotateZ(Math.PI / 2).translate(0.72, 0, 0),
    new THREE.CylinderGeometry(0.2, 0.2, 0.16, 12).rotateZ(Math.PI / 2).translate(-0.72, 0, 0),
  ].map((g) => g.toNonIndexed()));
  const axles = bogieZ.flatMap((z) => [z - 0.75, z + 0.75]);
  return { axles, bodyParts, hubGeo, materials: m, parts, wheelGeo };
}

// One car of a consist. `sign` is [line, destination] for the cab displays.
// Returns { group, wheels } where wheels spin with the speed.
export function buildRailCar(kind, { back = false, front = false, pantograph = false, sign = null } = {}) {
  const key = `${kind}|${front}|${back}|${pantograph}|${sign}`;
  if (!templates.has(key)) templates.set(key, buildTemplate(kind, front, back, pantograph, sign));
  const t = templates.get(key);
  const group = new THREE.Group();
  for (const { geometry, material } of t.bodyParts) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    group.add(mesh);
  }
  for (const { geometry, material } of t.parts) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = !(material instanceof THREE.MeshBasicMaterial);
    group.add(mesh);
  }
  const wheels = t.axles.map((z) => {
    const w = new THREE.Mesh(t.wheelGeo, t.materials.dark);
    w.add(new THREE.Mesh(t.hubGeo, t.materials.metal));
    w.position.set(0, 0.36, z);
    group.add(w);
    return w;
  });
  return { group, wheels };
}

// Accordion bellows that cover the gap between two cars.
export function buildBellows(kind) {
  const st = RAIL_STYLES[kind];
  const h = st.height - st.floor - 0.5;
  const folds = [];
  for (let i = 0; i < 5; i++) folds.push(new RoundedBoxGeometry(st.width * 0.86, h, 0.12, 2, 0.05).toNonIndexed().translate(0, st.floor + 0.25 + h / 2, -0.3 + i * 0.15));
  const mesh = new THREE.Mesh(mergeGeometries(folds), paint(0x1d2024, { clearcoat: 0, roughness: 0.9 }));
  mesh.castShadow = true;
  return mesh;
}
