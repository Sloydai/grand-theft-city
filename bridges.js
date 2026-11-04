// Bridges (OSM bridge=yes on roads and paths). Each gets a deck profile: it meets the ground
// at both ends (Kartverket's terrain keeps the approach embankments) and rises to clear what
// is underneath (4.6 m over roads and rails, 2.5 m more per extra layer, 1.6 m over water), with ramps of at
// most 25 % on the bridge itself. The deck is built with its slab, parapets and piers, and
// deckAt() gives the deck height for people and cars that are on it (not those passing under).
import * as THREE from 'three';

// Smooths a measured profile: rolling median (drops railings, lamp posts, gaps), then mean.
function smoothProfile(values) {
  const med = values.map((_, i) => {
    const win = values.slice(Math.max(0, i - 3), i + 4).filter((v) => v !== null).sort((a, b) => a - b);
    return win.length ? win[win.length >> 1] : null;
  });
  return med.map((_, i) => {
    const win = med.slice(Math.max(0, i - 2), i + 3).filter((v) => v !== null);
    return win.length ? win.reduce((a, b) => a + b, 0) / win.length : null;
  });
}

// lines: road/walk objects with br, ly, p (polyline) and w (width); each gets .height(x, z).
// measured: deck heights sampled every 2 m along each line (key: first point), already in
// game heights; used where plausible, else the clearance profile below.
export function createBridges({ lines, measured = {}, scene, terrainAt, waterAt, waterLevel }) {
  const lamps = [];
  const bridges = [];
  for (const line of lines) {
    const samples = [];
    let s = 0;
    for (let i = 0; i + 1 < line.p.length; i++) {
      const [ax, az] = line.p[i], [bx, bz] = line.p[i + 1], len = Math.hypot(bx - ax, bz - az);
      for (let d = 0; d < len; d += 2) samples.push({ s: s + d, x: ax + ((bx - ax) * d) / len, z: az + ((bz - az) * d) / len });
      s += len;
    }
    const [ex, ez] = line.p[line.p.length - 1];
    samples.push({ s, x: ex, z: ez });
    const total = s, hA = terrainAt(...line.p[0]), hB = terrainAt(ex, ez), ramp = 0.25, layer = Math.max(1, line.ly || 1);
    // Clearance over what lies below, as an envelope with the ramp grade towards the ends.
    for (const q of samples) {
      const wet = waterAt(q.x, q.z), under = wet ? Math.max(terrainAt(q.x, q.z), waterLevel) : terrainAt(q.x, q.z);
      q.need = under + (wet ? 1.6 : 4.6 + 2.5 * (layer - 1)) + 0.7;
    }
    for (const q of samples) {
      const base = hA + ((hB - hA) * q.s) / (total || 1);
      let env = -Infinity;
      for (const o of samples) env = Math.max(env, o.need - 0.08 * Math.abs(o.s - q.s));
      q.h = Math.max(base, Math.min(env, hA + ramp * q.s, hB + ramp * (total - q.s)));
    }
    // Measured deck (laser surface model): eased into the ground over the last 6 m at each
    // end, never below the ground, and only trusted when it clears water.
    const meas = measured[`${Math.round(line.p[0][0] * 10)},${Math.round(line.p[0][1] * 10)}`];
    if (meas && meas.filter((v) => v !== null).length >= 2) {
      const sm = smoothProfile(meas);
      for (const q of samples) {
        const i = Math.min(sm.length - 1, q.s / 2), lo = sm[Math.floor(i)], hi = sm[Math.ceil(i)];
        const m = lo === null ? hi : hi === null ? lo : lo + (hi - lo) * (i - Math.floor(i));
        const ground = terrainAt(q.x, q.z);
        if (m === null || (waterAt(q.x, q.z) && m < waterLevel + 1)) continue;
        const ease = Math.min(1, q.s / 6, (total - q.s) / 6);
        q.h = Math.max(ground, ground + (m - ground) * ease);
      }
    }
    // Height anywhere on the deck: by the nearest point of the centre line.
    const segs = [];
    for (let i = 0; i + 1 < samples.length; i++) segs.push([samples[i], samples[i + 1]]);
    const project = (x, z) => {
      let best = null;
      for (const [a, b] of segs) {
        const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
        const d2 = (a.x + dx * t - x) ** 2 + (a.z + dz * t - z) ** 2;
        if (!best || d2 < best.d2) best = { d2, h: a.h + (b.h - a.h) * t };
      }
      return best;
    };
    line.height = (x, z) => project(x, z).h;
    const rise = Math.max(...samples.map((q) => q.h - terrainAt(q.x, q.z)));
    bridges.push({ line, project, rise, samples, w: line.w || 3 });
  }

  // Structure. Low decks sit on embankment walls down to the ground; higher ones are open,
  // with a deep edge beam, piers with caps every ~24 m, and expansion joints every 30 m.
  // Road bridges get concrete parapets with a lighter coping and street lamps; footbridges
  // steel posts, a handrail and glass infill.
  const concrete = [], coping = [], steel = [], glass = [], joints = [];
  const quad = (out, a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (const { line, rise, samples, w } of bridges) {
    if (rise < 0.6) continue;
    const road = !['footway', 'cycleway', 'path', 'steps', 'pedestrian', 'crossing', 'sidewalk'].includes(line.k);
    const beam = road ? 1.1 : 0.6;
    let nextJoint = 15, nextLamp = 10, lampSide = 1;
    for (let i = 0; i + 1 < samples.length; i++) {
      const a = samples[i], b = samples[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
      const ga = terrainAt(a.x, a.z), gb = terrainAt(b.x, b.z), low = Math.min(a.h - ga, b.h - gb) < 3;
      for (const side of [-1, 1]) {
        const ax = a.x + nx * side * w / 2, az = a.z + nz * side * w / 2, bx = b.x + nx * side * w / 2, bz = b.z + nz * side * w / 2;
        // Edge: down to the ground on low stretches (embankment wall), else the edge beam.
        quad(concrete, [ax, a.h + 0.1, az], [bx, b.h + 0.1, bz], [bx, low ? gb - 0.3 : b.h - beam, bz], [ax, low ? ga - 0.3 : a.h - beam, az]);
        if (road) {
          const ix = ax - nx * side * 0.3, iz = az - nz * side * 0.3, jx = bx - nx * side * 0.3, jz = bz - nz * side * 0.3;
          quad(concrete, [ax, a.h + 1.0, az], [bx, b.h + 1.0, bz], [bx, b.h + 0.1, bz], [ax, a.h + 0.1, az]);
          quad(concrete, [ix, a.h + 1.0, iz], [jx, b.h + 1.0, jz], [jx, b.h + 0.1, jz], [ix, a.h + 0.1, iz]);
          quad(coping, [ax + nx * side * 0.05, a.h + 1.06, az + nz * side * 0.05], [bx + nx * side * 0.05, b.h + 1.06, bz + nz * side * 0.05], [jx, b.h + 1.06, jz], [ix, a.h + 1.06, iz]);
        } else {
          quad(steel, [ax, a.h + 1.1, az], [bx, b.h + 1.1, bz], [bx, b.h + 1.03, bz], [ax, a.h + 1.03, az]);
          quad(glass, [ax, a.h + 1.0, az], [bx, b.h + 1.0, bz], [bx, b.h + 0.15, bz], [ax, a.h + 0.15, az]);
          steel.push(...boxTris(ax, a.h + 0.55, az, 0.06, 1.1, 0.06));
        }
      }
      if (!low) {
        const l = [a.x - nx * w / 2, a.z - nz * w / 2], r = [a.x + nx * w / 2, a.z + nz * w / 2], l2 = [b.x - nx * w / 2, b.z - nz * w / 2], r2 = [b.x + nx * w / 2, b.z + nz * w / 2];
        quad(concrete, [l[0], a.h - beam, l[1]], [r[0], a.h - beam, r[1]], [r2[0], b.h - beam, r2[1]], [l2[0], b.h - beam, l2[1]]);
        if (i % 12 === 6) {
          // Pier: columns from the ground to a cap across the deck.
          const capY = a.h - beam - 0.35;
          concrete.push(...boxTris(a.x, capY, a.z, 0.7, 0.7, w * 0.85, Math.atan2(nx, nz)));
          for (const k of road ? [-1, 1] : [0]) concrete.push(...boxTris(a.x + nx * k * w / 4, (capY - 0.35 + ga - 0.5) / 2, a.z + nz * k * w / 4, 0.9, capY - 0.35 - ga + 0.5, 0.9));
        }
      }
      // Expansion joints across the deck, and lamps along road bridges.
      if (a.s >= nextJoint) {
        nextJoint += 30;
        quad(joints, [a.x - nx * w / 2, a.h + 0.125, a.z - nz * w / 2], [a.x + nx * w / 2, a.h + 0.125, a.z + nz * w / 2], [a.x + nx * w / 2 + (b.x - a.x) / len * 0.3, a.h + 0.125, a.z + nz * w / 2 + (b.z - a.z) / len * 0.3], [a.x - nx * w / 2 + (b.x - a.x) / len * 0.3, a.h + 0.125, a.z - nz * w / 2 + (b.z - a.z) / len * 0.3]);
      }
      if (road && a.s >= nextLamp) {
        nextLamp += 30;
        lamps.push({ h: Math.atan2(nx * lampSide, nz * lampSide), x: a.x + nx * lampSide * (w / 2 - 0.5), y: a.h + 0.1, z: a.z + nz * lampSide * (w / 2 - 0.5) });
        lampSide = -lampSide;
      }
    }
  }
  const mesh = (pos, material) => {
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  };
  mesh(concrete, new THREE.MeshStandardMaterial({ color: 0xa9a59d, roughness: 0.85, side: THREE.DoubleSide }));
  mesh(coping, new THREE.MeshStandardMaterial({ color: 0xc9c5bd, roughness: 0.7, side: THREE.DoubleSide }));
  mesh(steel, new THREE.MeshStandardMaterial({ color: 0x3a3d40, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide }));
  mesh(glass, new THREE.MeshStandardMaterial({ color: 0xbcd3dc, depthWrite: false, metalness: 0.1, opacity: 0.3, roughness: 0.05, side: THREE.DoubleSide, transparent: true }));
  mesh(joints, new THREE.MeshStandardMaterial({ color: 0x2a2b2d, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }));

  // Deck lookup on a 20 m grid of the bridges' extents.
  const cells = new Map(), C = 20;
  for (const b of bridges) {
    const xs = b.samples.map((q) => q.x), zs = b.samples.map((q) => q.z);
    for (let x = Math.floor((Math.min(...xs) - b.w) / C); x <= Math.floor((Math.max(...xs) + b.w) / C); x++) {
      for (let z = Math.floor((Math.min(...zs) - b.w) / C); z <= Math.floor((Math.max(...zs) + b.w) / C); z++) {
        const k = `${x}|${z}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(b);
      }
    }
  }
  return {
    // Street lamp spots on road bridges: { x, y, z, h }.
    lamps,
    // Deck height under (x, z) for something now at nearY (undefined: always), or null.
    deckAt(x, z, nearY) {
      let found = null;
      for (const b of cells.get(`${Math.floor(x / C)}|${Math.floor(z / C)}`) || []) {
        const hit = b.project(x, z);
        if (hit.d2 > (b.w / 2 + 0.4) ** 2) continue;
        if (nearY !== undefined && (hit.h - nearY > 1.2 || nearY - hit.h > 3)) continue;
        if (found === null || hit.h > found) found = hit.h;
      }
      return found;
    },
  };
}

function boxTris(x, y, z, sx, sy, sz, rotY = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz).rotateY(rotY).translate(x, y, z).toNonIndexed();
  return Array.from(g.attributes.position.array);
}
