// Life on the fjord: motor boats and sailing boats moored along the piers and swinging at
// anchor, passenger ferries running loops across the harbour, and red and green channel
// buoys. Everything rides the waves (waveAt) and is instanced: one draw call per material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const strip = (g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['normal', 'position'].includes(k)) n.deleteAttribute(k); return n; };
// Coloured parts merged into one geometry with vertex colours; `paint` parts are white so
// the per-instance colour tints them (instanceColor multiplies vertex colour).
function assemble(parts) {
  return mergeGeometries(parts.map(([g, color]) => {
    const n = strip(g), c = new THREE.Color(color), colors = new Float32Array(n.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    n.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return n;
  }));
}

// A planing hull lofted from V sections: keel, chine, gunwale; the bow narrows to a point.
function hull(len, beam, depth, paint) {
  const S = 16, pos = [], index = [], ring = [[0, -depth], [0.82, -depth * 0.35], [1, depth * 0.55]];
  for (let i = 0; i <= S; i++) {
    const t = i / S, z = -len / 2 + t * len, w = (beam / 2) * (t < 0.62 ? 1 - 0.1 * (1 - t / 0.62) : Math.sqrt(Math.max(0, 1 - ((t - 0.62) / 0.38) ** 1.6)));
    const sheer = 0.12 * Math.max(0, t - 0.6) * 3;
    const pts = [...ring.map(([x, y]) => [-x * w, y + (y > 0 ? sheer : 0)]).reverse(), ...ring.slice(1).map(([x, y]) => [x * w, y + (y > 0 ? sheer : 0)])];
    for (const [x, y] of pts) pos.push(x, y, z);
  }
  const R = 5;
  for (let i = 0; i < S; i++) for (let j = 0; j < R - 1; j++) { const a = i * R + j, b = a + 1, c = a + R, d = c + 1; index.push(a, c, b, b, c, d); }
  // Deck (top) and transom (stern).
  for (let i = 0; i < S; i++) { const a = i * R, c = (i + 1) * R; index.push(a, a + R - 1, c, c, a + R - 1, c + R - 1); }
  index.push(0, 1, 2, 0, 2, 4, 2, 3, 4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return [g, paint];
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// Kinds: geometry (vertex coloured, +z is the bow, waterline at y = 0) and hull colours.
const KINDS = {
  motor: { colors: [0xffffff, 0x1d3557, 0xb22222, 0xf1faee, 0x2a2a2a], geometry: () => assemble([
    hull(7.5, 2.5, 0.55, 0xffffff), [box(1.6, 0.9, 2.2, 0, 0.95, 0.4), 0xf4f4f0], [box(1.62, 0.4, 1.4, 0, 1.05, 0.9), 0x223344],
    [box(2.3, 0.08, 7.0, 0, 0.62, -0.1), 0xb08a5a], [new THREE.CylinderGeometry(0.02, 0.02, 1.2, 4).translate(0, 1.8, -0.4), 0xcccccc],
  ]) },
  sail: { colors: [0xffffff, 0xe9e4d8, 0x16324f, 0x7a1f2b], geometry: () => assemble([
    hull(9.5, 3.1, 0.8, 0xffffff), [box(1.8, 0.5, 3.2, 0, 0.85, 0.2), 0xf2f0ea], [box(1.82, 0.16, 2.6, 0, 0.92, 0.3), 0x1f2a33],
    [box(2.9, 0.06, 8.8, 0, 0.62, -0.1), 0xb08a5a], [new THREE.CylinderGeometry(0.07, 0.09, 13, 8).translate(0, 7, 1.0), 0xd8dde2],
    [new THREE.CylinderGeometry(0.06, 0.06, 4, 6).rotateX(Math.PI / 2).translate(0, 1.9, -0.9), 0xd8dde2],
    [new THREE.CylinderGeometry(0.16, 0.13, 3.8, 8).rotateX(Math.PI / 2).translate(0, 2.08, -0.9), 0x1f4f7a],
  ]) },
  ferry: { colors: [0xffffff], geometry: () => assemble([
    hull(36, 9, 2.2, 0xffffff), [box(8.4, 0.5, 34, 0, 0.3, 0), 0x1b3a5c],
    [box(7.6, 2.4, 24, 0, 2.6, -1), 0xf4f4f2], [box(7.65, 1.0, 23, 0, 2.7, -1), 0x22313d],
    [box(6.2, 2.2, 13, 0, 4.9, 1), 0xf4f4f2], [box(6.25, 0.9, 12.4, 0, 5.0, 1), 0x22313d],
    [box(4.6, 1.6, 3.2, 0, 6.8, 5.2), 0xf4f4f2], [box(4.65, 0.7, 3.25, 0, 6.9, 5.2), 0x1a242c],
    [new THREE.CylinderGeometry(0.7, 0.8, 2.6, 12).translate(0, 7.3, -3), 0xc8102e],
  ]) },
  buoy: { colors: [0xc8102e, 0x1e8449], geometry: () => assemble([
    [new THREE.CylinderGeometry(0.45, 0.6, 1.2, 12).translate(0, 0.3, 0), 0xffffff], [new THREE.ConeGeometry(0.3, 0.9, 12).translate(0, 1.3, 0), 0xffffff],
    [new THREE.CylinderGeometry(0.62, 0.62, 0.12, 12).translate(0, -0.1, 0), 0x2a2a2a],
  ]) },
};

// isWater(x, z), waterLevel, waveAt(x, z) -> { h, sx, sz }; piers: polygons of the decks.
export function createHarbour({ isWater, piers, scene, waterLevel, waveAt }) {
  let seed = 7;
  const rand = (a = 0, b = 1) => { seed = (seed * 16807) % 2147483647; return a + ((seed - 1) / 2147483646) * (b - a); };
  const open = (x, z, r) => [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dz]) => isWater(x + dx, z + dz));
  const boats = [];
  // Moored along the outer edges of the piers, bow along the edge.
  for (const p of piers) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 8) continue;
      const ex = (b[0] - a[0]) / len, ez = (b[1] - a[1]) / len;
      for (let d = 5; d < len - 4; d += rand(7, 12)) {
        for (const side of [-1, 1]) {
          const x = a[0] + ex * d - ez * side * 2.6, z = a[1] + ez * d + ex * side * 2.6;
          if (!isWater(x, z) || !isWater(x - ez * side * 3, z + ex * side * 3) || rand() < 0.35) continue;
          boats.push({ heading: Math.atan2(ex, ez) + (rand() < 0.5 ? Math.PI : 0), kind: rand() < 0.4 ? 'sail' : 'motor', moored: true, x, z });
        }
      }
    }
  }
  // Swinging at anchor in open water, and channel buoys.
  for (let tries = 0, anchored = 0; tries < 4000 && anchored < 26; tries++) {
    const x = rand(-1100, 1100), z = rand(-200, 760);
    if (!open(x, z, 30)) continue;
    boats.push({ heading: rand(0, Math.PI * 2), kind: rand() < 0.6 ? 'sail' : 'motor', x, z });
    anchored++;
  }
  for (let tries = 0, n = 0; tries < 3000 && n < 16; tries++) {
    const x = rand(-1100, 1100), z = rand(-200, 760);
    if (!open(x, z, 20)) continue;
    boats.push({ color: n % 2, heading: 0, kind: 'buoy', x, z });
    n++;
  }
  // Ferries on loops through open water: an ellipse around a clear centre.
  const ferries = [];
  for (let tries = 0; tries < 4000 && ferries.length < 2; tries++) {
    const cx = rand(-900, 900), cz = rand(100, 760), rx = rand(120, 220), rz = rand(70, 120);
    let clear = true;
    for (let a = 0; a < Math.PI * 2 && clear; a += Math.PI / 16) clear = open(cx + Math.cos(a) * rx, cz + Math.sin(a) * rz, 25);
    if (!clear) continue;
    const ferry = { cx, cz, heading: 0, kind: 'ferry', phase: rand(0, Math.PI * 2), rx, rz, speed: 5.5 / Math.max(rx, rz), x: cx, z: cz };
    ferries.push(ferry);
    boats.push(ferry);
  }
  // One InstancedMesh per kind, hull colour per instance.
  const material = new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.5, side: THREE.DoubleSide, vertexColors: true });
  const meshes = {};
  for (const [kind, spec] of Object.entries(KINDS)) {
    const list = boats.filter((b) => b.kind === kind);
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(spec.geometry(), material, list.length);
    list.forEach((b, i) => { b.index = i; mesh.setColorAt(i, new THREE.Color(spec.colors[b.color ?? Math.floor(rand() * spec.colors.length)])); });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    meshes[kind] = mesh;
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  return {
    boats,
    update(dt, time) {
      for (const f of ferries) {
        f.phase += f.speed * dt;
        const x = f.cx + Math.cos(f.phase) * f.rx, z = f.cz + Math.sin(f.phase) * f.rz;
        f.heading = Math.atan2(x - f.x, z - f.z);
        f.x = x; f.z = z;
      }
      for (const b of boats) {
        // Ride the swell: moored boats in the calm by the piers move less; a slow yaw at anchor.
        const w = waveAt(b.x, b.z, time), k = b.kind === 'ferry' ? 0.25 : b.moored ? 0.35 : 1;
        const yaw = b.heading + (b.moored || b.kind === 'ferry' ? 0 : Math.sin(time * 0.05 + b.x) * 0.4);
        e.set(Math.atan(w.sz * k) * Math.cos(yaw) + Math.atan(w.sx * k) * Math.sin(yaw), yaw, Math.atan(w.sx * k) * Math.cos(yaw) - Math.atan(w.sz * k) * Math.sin(yaw));
        m.compose(p.set(b.x, waterLevel + w.h * k, b.z), q.setFromEuler(e), one);
        meshes[b.kind].setMatrixAt(b.index, m);
      }
      for (const mesh of Object.values(meshes)) mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
