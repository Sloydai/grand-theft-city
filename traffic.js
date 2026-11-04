// Traffic control from OpenStreetMap: signal heads at every signalled junction approach
// and signalled crossing (with real red/yellow/green cycles that AI traffic obeys), and
// Norwegian road signs (speed limits, crossings, give way, priority road, one-way).
import * as THREE from 'three';

const angleDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

// Junction cycle (seconds): axis A green, yellow, all red, axis B green, yellow, all red.
const JUNCTION_CYCLE = [14, 3, 1.5, 13, 3, 1.5];
// Signalled pedestrian crossing: cars green, yellow, red.
const CROSSING_CYCLE = [18, 3, 8];

// Faces are drawn on a 128-unit grid, rendered at 256 px for crisp edges and text.
function signFace(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.scale(2, 2);
  draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return new THREE.MeshLambertMaterial({ alphaTest: 0.5, map: tex, transparent: false });
}
const circle = (g, r, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(64, 64, r, 0, Math.PI * 2); g.fill(); };
const SIGN_FACES = {
  crossing: () => signFace((g) => {
    g.fillStyle = '#1f5fbf'; g.fillRect(6, 6, 116, 116);
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(64, 18); g.lineTo(112, 106); g.lineTo(16, 106); g.closePath(); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.arc(66, 46, 6, 0, Math.PI * 2); g.fillStyle = '#111'; g.fill();
    g.beginPath(); g.moveTo(64, 56); g.lineTo(60, 78); g.lineTo(50, 96); g.moveTo(60, 78); g.lineTo(72, 96); g.moveTo(63, 62); g.lineTo(52, 72); g.moveTo(63, 62); g.lineTo(76, 70); g.stroke();
  }),
  giveway: () => signFace((g) => {
    g.fillStyle = '#c8102e'; g.beginPath(); g.moveTo(8, 14); g.lineTo(120, 14); g.lineTo(64, 116); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(30, 27); g.lineTo(98, 27); g.lineTo(64, 90); g.closePath(); g.fill();
  }),
  noentry: () => signFace((g) => { circle(g, 58, '#c8102e'); g.fillStyle = '#fff'; g.fillRect(24, 54, 80, 20); }),
  oneway: () => signFace((g) => {
    g.fillStyle = '#1f5fbf'; g.fillRect(14, 6, 100, 116);
    g.fillStyle = '#fff'; g.fillRect(56, 50, 16, 60); g.beginPath(); g.moveTo(64, 16); g.lineTo(94, 54); g.lineTo(34, 54); g.closePath(); g.fill();
  }),
  priority: () => signFace((g) => {
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(64, 4); g.lineTo(124, 64); g.lineTo(64, 124); g.lineTo(4, 64); g.closePath(); g.fill();
    g.fillStyle = '#f2c400'; g.beginPath(); g.moveTo(64, 22); g.lineTo(106, 64); g.lineTo(64, 106); g.lineTo(22, 64); g.closePath(); g.fill();
  }),
  // 552 Parkering: white P on blue.
  parking: () => signFace((g) => {
    g.fillStyle = '#1f5fbf'; g.fillRect(6, 6, 116, 116);
    g.fillStyle = '#fff'; g.font = 'bold 92px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('P', 64, 70);
  }),
  // 548 Gågate: adult and child walking, on blue.
  pedestrian: () => signFace((g) => {
    g.fillStyle = '#1f5fbf'; g.fillRect(6, 6, 116, 116);
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round';
    for (const [x, k] of [[48, 1], [84, 0.72]]) {
      const top = 104 - 74 * k;
      g.beginPath(); g.arc(x, top + 8 * k, 8 * k, 0, Math.PI * 2); g.fill();
      g.lineWidth = 9 * k;
      g.beginPath(); g.moveTo(x, top + 18 * k); g.lineTo(x - 2 * k, top + 44 * k); g.lineTo(x - 12 * k, top + 68 * k);
      g.moveTo(x - 2 * k, top + 44 * k); g.lineTo(x + 10 * k, top + 68 * k);
      g.moveTo(x, top + 24 * k); g.lineTo(x - 12 * k, top + 40 * k); g.moveTo(x, top + 24 * k); g.lineTo(x + 12 * k, top + 36 * k); g.stroke();
    }
  }),
  speed: (limit) => signFace((g) => {
    circle(g, 60, '#c8102e'); circle(g, 46, '#fff');
    g.fillStyle = '#111'; g.font = 'bold 46px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(limit), 64, 68);
  }),
};

// Outline of each sign's aluminium blank, in face units (the face is 1 x 1).
const ring = (r, n = 32) => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r]);
const SHAPES = {
  diamond: [[0, 0.47], [-0.47, 0], [0, -0.47], [0.47, 0]],
  rect: [[-0.39, -0.453], [0.39, -0.453], [0.39, 0.453], [-0.39, 0.453]],
  round: ring(0.47, 20),
  square: [[-0.453, -0.453], [0.453, -0.453], [0.453, 0.453], [-0.453, 0.453]],
  triangle: [[-0.44, 0.39], [0, -0.41], [0.44, 0.39]],
};
const SIGN_SHAPE = { crossing: 'square', giveway: 'triangle', noentry: 'round', oneway: 'rect', parking: 'square', pedestrian: 'square', priority: 'diamond', speed: 'round' };

// Text plates drawn into one atlas and merged into one mesh: Oslo street name plates
// (white on navy) and direction signs (black on yellow for places, as in Norway).
function createPlates(ground) {
  const atlas = document.createElement('canvas');
  atlas.width = 2048;
  atlas.height = 4096;
  const g = atlas.getContext('2d');
  const front = { pos: [], uv: [] }, back = { pos: [] };
  let nameCell = 0, signY = 2560, signX = 0;
  // Quad centred at c, spanning w along a (unit [x, z]) and h up, facing n = (-a.z, a.x).
  const quad = (target, cx, cy, cz, a, w, h, uv) => {
    const [ax, az] = a, corner = (su, sv) => [cx + ax * su * w / 2, cy + sv * h / 2, cz + az * su * w / 2];
    const v = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, -1), corner(1, 1), corner(-1, 1)];
    for (const p of v) target.pos.push(...p);
    if (uv) { const [u0, v0, u1, v1] = uv; target.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1); }
  };
  const uvOf = (x, y, w, h) => [x / 2048, 1 - (y + h) / 4096, (x + w) / 2048, 1 - y / 4096];
  return {
    streetName(name, x, z, roadHeading) {
      const col = nameCell % 4, row = Math.floor(nameCell / 4);
      if (row >= 45) return;
      nameCell++;
      const cx = col * 512, cy = row * 56;
      g.font = 'bold 34px Arial';
      const w = Math.min(512, Math.ceil(g.measureText(name).width) + 36);
      g.fillStyle = '#1d2d57'; g.fillRect(cx, cy, w, 56);
      g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(cx + 5, cy + 5, w - 10, 46);
      g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(name, cx + 18, cy + 30, w - 36);
      const pw = (w / 56) * 0.22, dx = Math.sin(roadHeading), dz = Math.cos(roadHeading), uv = uvOf(cx, cy, w, 56);
      // Readable from both sides: the back copy runs the other way.
      const y = ground(x, z) + 2.85;
      quad(front, x - dz * 0.012, y, z + dx * 0.012, [dx, dz], pw, 0.22, uv);
      quad(front, x + dz * 0.012, y, z - dx * 0.012, [-dx, -dz], pw, 0.22, uv);
    },
    direction(dests, x, z, travelHeading, post) {
      const h = 16 + dests.length * 60;
      if (signX + 512 > 2048) { signX = 0; signY += 208; }
      if (signY + h > 4096) return;
      const cx = signX, cy = signY;
      signX += 512;
      g.fillStyle = '#111'; g.fillRect(cx, cy, 512, h);
      g.fillStyle = '#f6c500'; g.fillRect(cx + 4, cy + 4, 504, h - 8);
      g.fillStyle = '#111'; g.font = 'bold 40px Arial'; g.textBaseline = 'middle';
      dests.forEach((d, i) => {
        const y = cy + 38 + i * 60;
        g.beginPath(); g.moveTo(cx + 34, y - 20); g.lineTo(cx + 50, y); g.lineTo(cx + 40, y); g.lineTo(cx + 40, y + 20); g.lineTo(cx + 28, y + 20); g.lineTo(cx + 28, y); g.lineTo(cx + 18, y); g.closePath(); g.fill();
        g.fillText(d, cx + 66, y + 2, 430);
      });
      const ph = 0.12 + dests.length * 0.42, pw = (512 / h) * ph, y = ground(x, z) + 2.2 + ph / 2;
      const nx = -Math.sin(travelHeading), nz = -Math.cos(travelHeading), a = [nz, -nx];
      quad(front, x, y, z, a, pw, ph, uvOf(cx, cy, 512, h));
      quad(back, x - nx * 0.02, y, z - nz * 0.02, [-a[0], -a[1]], pw, ph);
      for (const s of [-0.35, 0.35]) post(x - nx * 0.04 + a[0] * pw * s, z - nz * 0.04 + a[1] * pw * s, 2.25 + ph);
    },
    build(scene) {
      const tex = new THREE.CanvasTexture(atlas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const mesh = (target, material) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(target.pos, 3));
        if (target.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(target.uv, 2));
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, material);
        m.castShadow = true;
        scene.add(m);
      };
      mesh(front, new THREE.MeshLambertMaterial({ map: tex }));
      mesh(back, new THREE.MeshStandardMaterial({ color: 0x9aa0a5, metalness: 0.7, roughness: 0.45 }));
    },
  };
}

// Instanced batch helper: collects matrices and builds one InstancedMesh.
function batch(geometry, material) {
  const matrices = [];
  return {
    add(m) { matrices.push(m.clone()); },
    build(scene, castShadow = true) {
      if (!matrices.length) return null;
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
      return mesh;
    },
  };
}

// edges: [a, b, oneway, width]; nodes: id -> [x, z]; free(x, z): spot is clear for a post;
// ground(x, z): height of the surface there (heights below are above it).
export function createTrafficControl({ data, edges, free, ground = () => 0, nodes, scene }) {
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  const place = (x, y, z, heading, scale = one) => m.compose(new THREE.Vector3(x, y + ground(x, z), z), q.setFromAxisAngle(up, heading), scale);

  // Approaches into each controlled node: from every neighbour that may drive towards it.
  const incoming = new Map();
  for (const [a, b, oneway, w] of edges) {
    if (!nodes[a] || !nodes[b]) continue;
    const link = (from, to) => { if (!incoming.has(to)) incoming.set(to, []); incoming.get(to).push({ from, w }); };
    link(a, b);
    if (!oneway) link(b, a);
  }

  // Signal heads.
  const heads = [];
  const pole = batch(new THREE.CylinderGeometry(0.07, 0.09, 3.3, 8).translate(0, 1.65, 0), new THREE.MeshStandardMaterial({ color: 0x2b2f33, metalness: 0.6, roughness: 0.5 }));
  const housing = batch(new THREE.BoxGeometry(0.34, 1.0, 0.24), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 }));
  const visor = batch(new THREE.BoxGeometry(0.3, 0.04, 0.16), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 }));
  const lampSpots = [];
  const junctionNodes = data.signals.filter((s) => s.k === 'j');
  // Junction clusters: signal nodes within 35 m of each other share one cycle.
  const clusterOf = new Map();
  for (const s of junctionNodes) {
    if (clusterOf.has(s.id)) continue;
    const cluster = { axis: null, offset: Math.random() * 30 };
    const stack = [s];
    while (stack.length) {
      const c = stack.pop();
      if (clusterOf.has(c.id)) continue;
      clusterOf.set(c.id, cluster);
      for (const o of junctionNodes) if (!clusterOf.has(o.id) && Math.hypot(o.p[0] - c.p[0], o.p[1] - c.p[1]) < 35) stack.push(o);
    }
  }
  for (const s of data.signals) {
    if (s.k !== 'j' && s.k !== 'c') continue;
    const [sx, sz] = nodes[s.id] || s.p;
    const cluster = s.k === 'j' ? clusterOf.get(s.id) : { axis: 0, offset: Math.random() * 25 };
    for (const { from, w } of incoming.get(s.id) || []) {
      const [fx, fz] = nodes[from];
      const len = Math.hypot(sx - fx, sz - fz);
      if (len < 4) continue;
      const dx = (sx - fx) / len, dz = (sz - fz) / len, heading = Math.atan2(dx, dz);
      if (cluster.axis === null) cluster.axis = heading;
      const back = s.k === 'j' ? 2.5 : 4.5, side = w / 2 + 0.9;
      const x = sx - dx * back - dz * side, z = sz - dz * back + dx * side;
      if (!free(x, z)) continue;
      const axisA = Math.abs(Math.sin(angleDiff(cluster.axis, heading))) < 0.7;
      const head = { axisA, cluster, crossing: s.k === 'c', h: heading, lamps: [], state: 'g', stopX: sx - dx * (back + 1.5), stopZ: sz - dz * (back + 1.5), w, x, z };
      heads.push(head);
      // The lamps face the oncoming cars (towards -direction).
      const faceX = x - dx * 0.13, faceZ = z - dz * 0.13;
      pole.add(place(x, 0, z, heading));
      housing.add(place(x, 2.75, z, heading));
      for (const [i, y] of [3.08, 2.75, 2.42].entries()) {
        visor.add(place(faceX - dx * 0.06, y + 0.12, faceZ - dz * 0.06, heading));
        head.lamps.push(lampSpots.length);
        lampSpots.push({ i, x: faceX, y, z: faceZ });
      }
    }
  }
  // Static instanced meshes, handed back so the caller can split them for distance culling.
  const staticMeshes = [pole.build(scene), housing.build(scene), visor.build(scene, false)];
  const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, lampSpots.length));
  lampSpots.forEach((l, i) => lamps.setMatrixAt(i, place(l.x, l.y, l.z, 0)));
  lamps.count = lampSpots.length;
  scene.add(lamps);
  const LAMP_ON = [new THREE.Color(0xff2a1a), new THREE.Color(0xffb000), new THREE.Color(0x2bff6a)];
  const LAMP_OFF = [new THREE.Color(0x3a0d0a), new THREE.Color(0x3a2a06), new THREE.Color(0x0a2a14)];

  // Signs on posts, at Norwegian sizes: 600 mm in town, 800 mm on main roads, mounted with
  // the centre 2.3 m up (clear of pedestrians). Each face sits on an aluminium blank of
  // its own shape, clamped to a galvanised post with a cap.
  const signGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0, 0.009);
  const blankMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a5, metalness: 0.7, roughness: 0.45 });
  const blanks = Object.fromEntries(Object.entries(SHAPES).map(([shape, pts]) => {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { bevelEnabled: false, depth: 0.012 });
    return [shape, batch(g.translate(0, 0, -0.004), blankMat)];
  }));
  const steel = new THREE.MeshStandardMaterial({ color: 0xa3a9ae, metalness: 0.8, roughness: 0.35 });
  const signPost = batch(new THREE.CylinderGeometry(0.03, 0.03, 1, 8).translate(0, 0.5, 0), steel);
  const postCap = batch(new THREE.SphereGeometry(0.034, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), steel);
  const clamp = batch(new THREE.BoxGeometry(0.09, 0.035, 0.05), steel);
  const faces = new Map();
  const post = (x, z, top) => { signPost.add(place(x, 0, z, 0, new THREE.Vector3(1, top, 1))); postCap.add(place(x, top, z, 0)); };
  const sign = (kind, x, z, travelHeading, arg, size = 0.6) => {
    if (!free(x, z)) return;
    const key = arg ? `${kind}-${arg}` : kind;
    if (!faces.has(key)) faces.set(key, batch(signGeo, SIGN_FACES[kind](arg)));
    // Face the people it is meant for: they travel along travelHeading.
    const faceHeading = travelHeading + Math.PI, scale = new THREE.Vector3(size, size, 1), y = 2.3;
    faces.get(key).add(place(x, y, z, faceHeading, scale));
    blanks[SIGN_SHAPE[kind]].add(place(x, y, z, faceHeading, scale));
    const bx = x - Math.sin(faceHeading) * 0.035, bz = z - Math.cos(faceHeading) * 0.035;
    for (const dy of [-0.3, 0.3]) clamp.add(place(bx, y + dy * size, bz, faceHeading));
    post(bx, bz, y + size / 2 + 0.05);
  };
  const along = (p, dist, fromEnd) => {
    const pts = fromEnd ? p.slice().reverse() : p;
    let need = dist;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az);
      if (len >= need) return { dx: (bx - ax) / len, dz: (bz - az) / len, x: ax + ((bx - ax) * need) / len, z: az + ((bz - az) * need) / len };
      need -= len;
    }
    return null;
  };
  const roadLength = (p) => p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
  const right = (at, off) => [at.x - at.dz * off, at.z + at.dx * off];
  const plates = createPlates(ground);
  const named = [];
  for (const r of data.roads) {
    const len = roadLength(r.p), main = ['primary', 'trunk', 'secondary'].includes(r.k), size = main || r.v >= 60 ? 0.8 : 0.6;
    // Street name plates near both ends, parallel to the street, as on Oslo's corners.
    if (r.n && r.k !== 'service' && len > 30) {
      for (const fromEnd of [false, true]) {
        const a = along(r.p, 7, fromEnd);
        if (!a || named.some((o) => o.n === r.n && Math.hypot(o.x - a.x, o.z - a.z) < 70)) continue;
        const [x, z] = right(a, r.w / 2 + 0.9);
        if (!free(x, z)) continue;
        named.push({ n: r.n, x: a.x, z: a.z });
        plates.streetName(r.n, x, z, Math.atan2(a.dx, a.dz));
        post(x, z, 3.05);
      }
    }
    if (r.k === 'pedestrian') {
      // Gågate signs where the pedestrian street begins.
      if (len > 40) for (const fromEnd of [false, true]) { const a = along(r.p, 2, fromEnd); if (a) { const [x, z] = right(a, r.w / 2 - 0.6); sign('pedestrian', x, z, Math.atan2(a.dx, a.dz)); } }
      continue;
    }
    if (['living_street', 'service'].includes(r.k)) continue;
    // Direction sign with the mapped destinations, 25 m before the way's end.
    if (r.d && len > 50) {
      const a = along(r.p, Math.min(25, len / 2), true);
      if (a) {
        const [x, z] = right({ ...a, dx: -a.dx, dz: -a.dz }, r.w / 2 + 1.1);
        if (free(x, z)) plates.direction(r.d, x, z, Math.atan2(-a.dx, -a.dz), post);
      }
    }
    // Speed limit at the start of each longer street, for each direction of travel.
    if (r.v >= 30 && len > 110) {
      const a = along(r.p, 14, false);
      if (a) { const [x, z] = right(a, r.w / 2 + 0.7); sign('speed', x, z, Math.atan2(a.dx, a.dz), r.v, size); }
      if (!r.o) { const b = along(r.p, 14, true); if (b) { const [x, z] = right(b, r.w / 2 + 0.7); sign('speed', x, z, Math.atan2(b.dx, b.dz), r.v, size); } }
    }
    // Priority road along the main roads.
    if (main) {
      for (let d = 60; d < len - 30; d += 350) { const a = along(r.p, d, false); if (a) { const [x, z] = right(a, r.w / 2 + 0.7); sign('priority', x, z, Math.atan2(a.dx, a.dz), null, size); } }
    }
    // Parking on the quieter streets.
    if (['residential', 'unclassified'].includes(r.k) && len > 90) {
      for (let d = 45; d < len - 30; d += 160) { const a = along(r.p, d, false); if (a) { const [x, z] = right(a, r.w / 2 + 0.7); sign('parking', x, z, Math.atan2(a.dx, a.dz)); } }
    }
    // One-way: arrow at the entry, no entry facing wrong-way traffic at the exit.
    if (r.o && len > 25) {
      const a = along(r.p, 5, false);
      if (a) { const [x, z] = right(a, r.w / 2 + 0.7); sign('oneway', x, z, Math.atan2(a.dx, a.dz), null, size); }
      const b = along(r.p, 3, true);
      if (b) { const [x, z] = right(b, r.w / 2 + 0.7); sign('noentry', x, z, Math.atan2(b.dx, b.dz), null, size); }
    }
  }
  // Crossing signs on both sides, and give-way signs, at the mapped nodes.
  for (const s of data.signals) {
    if (s.k !== 'z' && s.k !== 'g') continue;
    const [sx, sz] = nodes[s.id] || s.p;
    for (const { from, w } of incoming.get(s.id) || []) {
      const [fx, fz] = nodes[from];
      const len = Math.hypot(sx - fx, sz - fz);
      if (len < 3) continue;
      const dx = (sx - fx) / len, dz = (sz - fz) / len;
      const back = s.k === 'z' ? 1.5 : 3, side = w / 2 + 0.8;
      sign(s.k === 'z' ? 'crossing' : 'giveway', sx - dx * back - dz * side, sz - dz * back + dx * side, Math.atan2(dx, dz));
    }
  }
  for (const b of [signPost, postCap, clamp, ...Object.values(blanks), ...faces.values()]) staticMeshes.push(b.build(scene));
  plates.build(scene);

  const stateOf = (head, t) => {
    const c = head.crossing ? CROSSING_CYCLE : JUNCTION_CYCLE;
    const total = c.reduce((s, v) => s + v, 0);
    let p = (t + head.cluster.offset) % total;
    if (head.crossing) return p < c[0] ? 'g' : p < c[0] + c[1] ? 'y' : 'r';
    const phases = head.axisA ? ['g', 'y', 'r', 'r', 'r', 'r'] : ['r', 'r', 'r', 'g', 'y', 'r'];
    for (let i = 0; i < c.length; i++) { if (p < c[i]) return phases[i]; p -= c[i]; }
    return 'r';
  };
  let lastUpdate = -1;
  return {
    heads,
    staticMeshes: staticMeshes.filter(Boolean),
    update(seconds) {
      if (seconds - lastUpdate < 0.2) return;
      lastUpdate = seconds;
      for (const head of heads) {
        head.state = stateOf(head, seconds);
        head.lamps.forEach((li, i) => lamps.setColorAt(li, ['r', 'y', 'g'][i] === head.state ? LAMP_ON[i] : LAMP_OFF[i]));
      }
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    },
    // Distance to the stop point of a red (or late yellow) light ahead of a vehicle at
    // (x, z) heading h, or Infinity.
    stopAhead(x, z, h, range = 34) {
      const fx = Math.sin(h), fz = Math.cos(h);
      let best = Infinity;
      for (const head of heads) {
        const rx = head.stopX - x, rz = head.stopZ - z;
        if (Math.abs(rx) > range || Math.abs(rz) > range) continue;
        const ahead = rx * fx + rz * fz;
        if (ahead < 0.5 || ahead > range || Math.abs(-rx * fz + rz * fx) > 7 || Math.abs(angleDiff(h, head.h)) > 0.5) continue;
        if (head.state === 'g' || (head.state === 'y' && ahead < 9)) continue;
        best = Math.min(best, ahead);
      }
      return best;
    },
  };
}
