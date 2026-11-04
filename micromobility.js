// Parked micromobility, after Worldhood (github.com/worldhood/worldhood, MIT):
//  - Oslo Bysykkel stations from the open GBFS feed (tools/fetch-bysykkel.mjs): a row of
//    grey dock posts along the station's mapped dock area, with the blue city bikes that were
//    docked when the feed was read standing in them.
//  - Shared e-scooters (Voi, Dott, Ryde and Bolt colours, no branding) in small clusters on
//    the sidewalk near tram and bus stops and bike stations. Spots are interpreted: no
//    operator publishes parking positions.
// Bikes and scooters are instanced, one mesh per model and colour.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// One geometry from [geometry, colour] parts, coloured per vertex.
function coloured(parts) {
  return mergeGeometries(parts.map(([g, hex]) => {
    const geometry = g.index ? g.toNonIndexed() : g, c = new THREE.Color(hex), n = geometry.attributes.position.count, colours = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colours.set([c.r, c.g, c.b], i * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.deleteAttribute('uv');
    return geometry;
  }));
}
// A tube between two points.
function rod(a, b, r) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  return g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
}
const wheel = (z, r, w) => new THREE.TorusGeometry(r - 0.025, 0.025, 6, 16).rotateY(Math.PI / 2).translate(0, r, z);
const hub = (z, r) => new THREE.CylinderGeometry(r * 0.75, r * 0.75, 0.02, 12).rotateZ(Math.PI / 2).translate(0, r, z);

// Oslo city bike, +z forward, 1.8 m long: blue frame, white mudguards, black basket.
export function cityBike() {
  const r = 0.33, blue = '#1d4f9a', dark = '#1a1c1e', light = '#d8dde2';
  return coloured([
    [wheel(0.55, r), dark], [wheel(-0.55, r), dark], [hub(0.55, r), '#9aa0a6'], [hub(-0.55, r), '#9aa0a6'],
    // Step-through frame: down tube, seat tube, chain stays, fork, head tube.
    [rod([0, 0.36, -0.12], [0, 0.85, 0.42], 0.03), blue], [rod([0, 0.36, -0.12], [0, 0.92, -0.2], 0.028), blue],
    [rod([0, 0.36, -0.12], [0, r, -0.55], 0.02), blue], [rod([0, 0.92, -0.2], [0, r, -0.55], 0.018), blue],
    [rod([0, 0.85, 0.42], [0, r, 0.55], 0.022), blue], [rod([0, 0.82, 0.42], [0, 1.05, 0.38], 0.03), blue],
    [rod([-0.28, 1.06, 0.36], [0.28, 1.06, 0.36], 0.014), dark],
    [new THREE.BoxGeometry(0.14, 0.05, 0.26).translate(0, 0.96, -0.22), dark],
    [new THREE.BoxGeometry(0.36, 0.2, 0.3).translate(0, 0.86, 0.66), dark],
    [new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.1, 10, 1, true, -Math.PI / 2, Math.PI * 0.75).rotateZ(Math.PI / 2).translate(0, r, -0.55), light],
    [new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.1, 10, 1, true, Math.PI * 0.25, Math.PI * 0.6).rotateZ(Math.PI / 2).translate(0, r, 0.55), light],
  ]);
}
// Shared e-scooter, +z forward, 1.1 m long, standing straight (tilted when placed).
export function scooter(accent) {
  const r = 0.11, dark = '#1d1f22';
  return coloured([
    [wheel(0.42, r), dark], [wheel(-0.45, r), dark],
    [new THREE.BoxGeometry(0.17, 0.06, 0.82).translate(0, 0.13, -0.03), dark],
    [new THREE.BoxGeometry(0.18, 0.02, 0.8).translate(0, 0.17, -0.03), accent],
    [rod([0, 0.15, 0.4], [0, 1.08, 0.46], 0.025), accent],
    [rod([-0.24, 1.1, 0.46], [0.24, 1.1, 0.46], 0.016), dark],
    [new THREE.BoxGeometry(0.1, 0.08, 0.06).translate(0, 1.0, 0.49), accent],
    [new THREE.BoxGeometry(0.17, 0.05, 0.12).translate(0, 0.2, -0.47), accent],
  ]);
}
const dockPost = () => coloured([
  [new THREE.BoxGeometry(0.1, 0.85, 0.12).translate(0, 0.425, 0), '#8d9399'],
  [new THREE.BoxGeometry(0.12, 0.12, 0.16).translate(0, 0.78, 0.05), '#2e5fa8'],
]);
export const SCOOTER_COLOURS = ['#f26d5b', '#1b9c8c', '#2fbf5b', '#34d07f'];

// places({ stations, anchors, groundHeight, onSidewalk, kerbDirection, blocked }):
//  stations: data/bysykkel.json; anchors: [x, z] spots for scooter clusters;
//  onSidewalk(x, z): true on a raised sidewalk or platform; kerbDirection(x, z): unit
//  [dx, dz] of the nearest street; blocked(x, z): a building or water.
// Returns { meshes, docks: [{ x, z, rot, w, d }], items }: docks for colliders; items are the
// bikes and scooters ({ mesh: index into meshes, index, x, z, r }) for knocking over.
export function buildMicromobility({ anchors, blocked, groundHeight, kerbDirection, onSidewalk, stations }) {
  const bikes = [], posts = [], docks = [], scooters = SCOOTER_COLOURS.map(() => []), found = [];
  // r: radius of the thing for collisions (0 for dock posts, which the dock collider covers).
  const pose = (list, x, z, yaw, tilt = 0, r = 0) => {
    if (r) found.push({ index: list.length, list, r, x, z });
    list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, groundHeight(x, z), z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, tilt, 'YXZ')), new THREE.Vector3(1, 1, 1)));
  };
  for (const s of stations) {
    // The dock row: along the dock area's longest side, through its centre; else along the
    // street at the station point.
    let cx = s.x, cz = s.z, [dx, dz] = kerbDirection(s.x, s.z), length = s.cap * 0.75;
    if (s.area?.length >= 3) {
      cx = s.area.reduce((a, q) => a + q[0], 0) / s.area.length;
      cz = s.area.reduce((a, q) => a + q[1], 0) / s.area.length;
      let best = 0;
      for (let i = 0; i < s.area.length; i++) {
        const a = s.area[i], b = s.area[(i + 1) % s.area.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l > best) { best = l; dx = (b[0] - a[0]) / l; dz = (b[1] - a[1]) / l; }
      }
      length = Math.min(length, best);
    }
    if (blocked(cx, cz)) continue;
    const count = Math.max(2, Math.min(s.cap, Math.floor(length / 0.75))), rowYaw = Math.atan2(dx, dz);
    docks.push({ d: 0.3, rot: rowYaw, w: count * 0.75, x: cx, z: cz });
    // Bikes stand across the row, front wheel in the dock; the docked ones spread along it.
    const docked = Math.min(count, s.bikes);
    for (let k = 0; k < count; k++) {
      const t = (k - (count - 1) / 2) * 0.75, x = cx + dx * t, z = cz + dz * t;
      pose(posts, x, z, rowYaw);
      if (docked && k % Math.max(1, Math.round(count / docked)) === 0 && bikes.length < 4000) pose(bikes, x + dz * 0.95, z - dx * 0.95, rowYaw - Math.PI / 2, 0, 0.45);
    }
  }
  // Scooter clusters: 2–5 side by side on the sidewalk within 8 m of each anchor.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const [ax, az] of anchors) {
    if (rand() > 0.55) continue;
    let spot = null;
    for (let tries = 0; tries < 12 && !spot; tries++) {
      const a = rand() * Math.PI * 2, d = 2 + rand() * 6, x = ax + Math.cos(a) * d, z = az + Math.sin(a) * d;
      if (onSidewalk(x, z) && !blocked(x, z)) spot = [x, z];
    }
    if (!spot) continue;
    const [dx, dz] = kerbDirection(...spot), n = 2 + Math.floor(rand() * 4), operator = Math.floor(rand() * SCOOTER_COLOURS.length);
    for (let k = 0; k < n; k++) {
      const x = spot[0] + dx * (k - (n - 1) / 2) * 0.62, z = spot[1] + dz * (k - (n - 1) / 2) * 0.62;
      if (!onSidewalk(x, z)) continue;
      // Across the walk, leaning on the kickstand; now and then one of another operator.
      pose(scooters[rand() < 0.8 ? operator : Math.floor(rand() * SCOOTER_COLOURS.length)], x, z, Math.atan2(dx, dz) + Math.PI / 2 + (rand() - 0.5) * 0.4, 0.12, 0.3);
    }
  }
  const material = new THREE.MeshStandardMaterial({ metalness: 0.3, roughness: 0.6, vertexColors: true });
  const instanced = (geometry, list) => {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  };
  const lists = [[cityBike(), bikes], [dockPost(), posts], ...SCOOTER_COLOURS.map((c, i) => [scooter(c), scooters[i]])].filter(([, list]) => list.length);
  const meshes = lists.map(([geometry, list]) => instanced(geometry, list));
  const items = found.map(({ index, list, r, x, z }) => ({ index, mesh: lists.findIndex(([, l]) => l === list), r, x, z }));
  return { docks, items, meshes };
}
