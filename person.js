// Pedestrians as skinned meshes: one draw call each. A 17-bone skeleton carries a lofted
// torso (male and female shapes), tapered limbs, a head with face, ears and hair styles,
// hands, shoes with soles, and coats, scarves, hats and backpacks, coloured per outfit.
// The walk is procedural: knee and elbow bends, arm swing and hip bob.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulderL', 'upperArmL', 'forearmL', 'handL', 'shoulderR', 'upperArmR', 'forearmR', 'handR', 'thighL', 'shinL', 'thighR', 'shinR'];
const PARENT = { chest: 'spine', forearmL: 'upperArmL', forearmR: 'upperArmR', handL: 'forearmL', handR: 'forearmR', head: 'neck', neck: 'chest', shinL: 'thighL', shinR: 'thighR', shoulderL: 'chest', shoulderR: 'chest', spine: 'hips', thighL: 'hips', thighR: 'hips', upperArmL: 'shoulderL', upperArmR: 'shoulderR' };

const SKIN = [0xf1c8a5, 0xe0b08a, 0xc68e64, 0x8d5a3b, 0x5c3a26, 0xf6d5bd];
const HAIR = [0x2b1d0e, 0x5a3a1c, 0xb58a4c, 0xd9c08a, 0x111111, 0x8e8e8e, 0x7a2e12];
// Oslo street wear: dark and muted jackets and coats, jeans, some colour in scarves and hats.
const TOPS = [0x1f2a44, 0x2c3e50, 0x7a1f2b, 0x3d5a3d, 0x8a6e4b, 0x111111, 0xc9b79c, 0x5b6770, 0x2e5f8a, 0xb94a2c, 0xe6e1d6, 0x1a1a1a, 0x3b3b3b];
const BOTTOMS = [0x1b2431, 0x2a2a2a, 0x3b4d66, 0x4a3b2e, 0x6b6b6b, 0x1c2a3d, 0x26324a];
const SHOES = [0x111111, 0x3a2a1c, 0xe8e8e8, 0x5a4636];
const ACCENTS = [0xc0392b, 0xd4a017, 0x2e86c1, 0x6c3483, 0xe8e2d0, 0x1e8449, 0x9a9a9a];

const pick = (list, r) => list[Math.floor(r() * list.length)];

// Bone rest positions relative to their parent, scaled by height. Proportions for a
// 1.75 m adult: hip joint 0.90 m, knee 0.47 m, shoulder 1.42 m, wrist 0.84 m, crown 1.75 m.
function restPose(h, build) {
  const k = h / 1.75, w = build;
  return {
    chest: [0, 0.2 * k, 0], forearmL: [0, -0.3 * k, 0], forearmR: [0, -0.3 * k, 0], handL: [0, -0.26 * k, 0], handR: [0, -0.26 * k, 0],
    head: [0, 0.09 * k, 0.01 * k], hips: [0, 0.94 * k, 0], neck: [0, 0.25 * k, -0.01 * k], shinL: [0, -0.43 * k, 0], shinR: [0, -0.43 * k, 0],
    shoulderL: [0.15 * k * w, 0.18 * k, -0.01 * k], shoulderR: [-0.15 * k * w, 0.18 * k, -0.01 * k], spine: [0, 0.1 * k, 0],
    thighL: [0.09 * k * w, -0.04 * k, 0], thighR: [-0.09 * k * w, -0.04 * k, 0], upperArmL: [0.025 * k * w, 0, 0], upperArmR: [-0.025 * k * w, 0, 0],
  };
}

// Tapered limb hanging down from its joint: radius r0 at the top, r1 at the bottom.
function limb(len, r0, r1) {
  const pts = [];
  for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * (i / 5); pts.push(new THREE.Vector2(Math.max(1e-4, r1 * Math.cos(a)), -len + r1 + r1 * Math.sin(a))); }
  for (let i = 0; i <= 5; i++) { const a = (Math.PI / 2) * (i / 5); pts.push(new THREE.Vector2(Math.max(1e-4, r0 * Math.cos(a)), -r0 + r0 * Math.sin(a) + r0 * 0.6)); }
  return new THREE.LatheGeometry(pts, 9);
}

// Torso lofted through elliptical sections [height above the hip bone, half width,
// half depth], split onto hips / spine / chest by height and coloured trousers / top.
function torso(sections, k, w) {
  const SEG = 14, pos = [], index = [], rows = sections.length;
  for (const [y, hw, hd] of sections) {
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const e = (v) => Math.sign(v) * Math.pow(Math.abs(v), 0.8);
      pos.push(e(c) * hw * k * w, y * k, e(s) * hd * k);
    }
  }
  for (let i = 0; i + 1 < rows; i++) for (let j = 0; j < SEG; j++) {
    const a = i * SEG + j, b = i * SEG + ((j + 1) % SEG), c = a + SEG, d = b + SEG;
    index.push(a, c, b, b, c, d);
  }
  // Caps.
  const bottom = pos.length / 3; pos.push(0, sections[0][0] * k, 0);
  const top = pos.length / 3; pos.push(0, sections[rows - 1][0] * k, 0);
  for (let j = 0; j < SEG; j++) {
    index.push(bottom, j, (j + 1) % SEG);
    index.push(top, (rows - 1) * SEG + ((j + 1) % SEG), (rows - 1) * SEG + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

const geometryCache = new Map();
// Geometry for one body + outfit, in bind pose, with skin indices and vertex colours.
function bodyGeometry(look) {
  const key = JSON.stringify(look);
  if (geometryCache.has(key)) return geometryCache.get(key);
  const { accent, backpack, beard, bottom, build, coat, female, h, hair, hairStyle, hat, scarf, shoes, skin, top } = look;
  const rest = restPose(h, build);
  const world = {};
  for (const b of BONES) {
    const r = rest[b], p = PARENT[b] ? world[PARENT[b]] : [0, 0, 0];
    world[b] = [p[0] + r[0], p[1] + r[1], p[2] + r[2]];
  }
  const k = h / 1.75, w = build;
  const parts = [];
  // Adds geometry in bone-local rest coordinates; colourAt(y) may vary the colour by height.
  const part = (geometry, bone, color, x = 0, y = 0, z = 0, boneAt = null, colourAt = null) => {
    // Smooth normals come from each part's own (indexed) shape.
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const g = (geometry.index ? geometry.toNonIndexed() : geometry).translate(world[bone][0] + x, world[bone][1] + y, world[bone][2] + z);
    g.deleteAttribute('uv');
    const n = g.attributes.position.count, colors = [], skinIndex = [], c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const vy = g.attributes.position.getY(i) - world.hips[1];
      c.set(colourAt ? colourAt(vy) : color);
      colors.push(c.r, c.g, c.b);
      skinIndex.push(BONES.indexOf(boneAt ? boneAt(vy) : bone), 0, 0, 0);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [1, 0, 0, 0]), 4));
    parts.push(g);
  };
  const sphere = (r, sx = 1, sy = 1, sz = 1, ws = 10, hs = 8) => new THREE.SphereGeometry(r * k, ws, hs).scale(sx, sy, sz);
  // Torso: wider hips and narrower waist for women, broader shoulders for men.
  const sections = female
    ? [[-0.1, 0.12, 0.09], [-0.02, 0.175, 0.11], [0.08, 0.15, 0.1], [0.17, 0.13, 0.09], [0.27, 0.15, 0.11], [0.36, 0.16, 0.115], [0.44, 0.165, 0.095], [0.5, 0.15, 0.08], [0.545, 0.09, 0.06], [0.56, 0.055, 0.05]]
    : [[-0.1, 0.12, 0.09], [-0.02, 0.165, 0.105], [0.08, 0.155, 0.1], [0.17, 0.15, 0.1], [0.27, 0.17, 0.11], [0.36, 0.185, 0.115], [0.44, 0.19, 0.1], [0.5, 0.17, 0.085], [0.545, 0.1, 0.065], [0.56, 0.06, 0.05]];
  const waist = coat ? -0.3 : 0.06;
  part(torso(sections, k, w), 'hips', top, 0, 0, 0, (y) => (y < 0.07 * k ? 'hips' : y < 0.28 * k ? 'spine' : 'chest'), (y) => (y < waist * k ? bottom : top));
  if (coat) part(new THREE.CylinderGeometry(0.17 * k * w, 0.21 * k * w, 0.42 * k, 16, 1, true).scale(1, 1, 0.72), 'hips', top, 0, -0.2 * k, 0);
  if (scarf) part(new THREE.TorusGeometry(0.062 * k, 0.025 * k, 6, 14).rotateX(Math.PI / 2), 'neck', accent, 0, 0.02 * k, 0.005);
  if (backpack) part(new RoundedBoxGeometry(0.28 * k, 0.38 * k, 0.13 * k, 2, 0.03 * k), 'chest', accent, 0, 0.1 * k, -0.17 * k);
  part(new THREE.CylinderGeometry(0.045 * k, 0.055 * k, 0.12 * k, 10), 'neck', skin, 0, 0.03 * k, 0);
  // Head: cranium, jaw, nose, ears, eyes, brows, mouth.
  part(sphere(0.1, 0.78, 1, 0.96, 18, 12), 'head', skin, 0, 0.08 * k, -0.005 * k);
  part(sphere(0.072, 0.85, 0.85, 0.95), 'head', skin, 0, 0.025 * k, 0.018 * k);
  part(new THREE.ConeGeometry(0.016 * k, 0.04 * k, 4).rotateX(Math.PI / 2 + 0.5), 'head', skin, 0, 0.06 * k, 0.098 * k);
  for (const s of [-1, 1]) {
    part(sphere(0.022, 0.45, 1, 0.75, 8, 6), 'head', skin, s * 0.079 * k, 0.065 * k, -0.005 * k);
    part(sphere(0.011, 1, 0.8, 0.6, 8, 6), 'head', 0xf4f1ea, s * 0.031 * k, 0.088 * k, 0.083 * k);
    part(sphere(0.006, 1, 1, 0.6, 6, 4), 'head', 0x2a1e14, s * 0.031 * k, 0.088 * k, 0.09 * k);
    part(new THREE.BoxGeometry(0.03 * k, 0.006 * k, 0.01 * k), 'head', hair, s * 0.032 * k, 0.105 * k, 0.086 * k);
  }
  part(new THREE.BoxGeometry(0.03 * k, 0.005 * k, 0.01 * k), 'head', 0x7a3b33, 0, 0.026 * k, 0.083 * k);
  // Hair and hats.
  const cap = (r, sy) => new THREE.SphereGeometry(r * k, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateX(-0.45).scale(0.82, sy, 1);
  if (hat) part(cap(0.108, 1.15), 'head', accent, 0, 0.085 * k, -0.008 * k);
  else if (hairStyle !== 'bald') part(cap(0.105, 1.05), 'head', hair, 0, 0.088 * k, -0.012 * k);
  if (hairStyle === 'long') part(new THREE.CapsuleGeometry(0.075 * k, 0.15 * k, 4, 10).scale(1.05, 1, 0.55), 'head', hair, 0, 0.02 * k, -0.06 * k);
  if (hairStyle === 'bun' && !hat) part(sphere(0.04), 'head', hair, 0, 0.16 * k, -0.07 * k);
  if (beard) part(new THREE.SphereGeometry(0.074 * k, 14, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.5).scale(0.86, 0.9, 0.95), 'head', hair, 0, 0.03 * k, 0.02 * k);
  for (const s of ['L', 'R']) {
    // Shoulder cap, tapered sleeves, hand with thumb.
    part(sphere(0.054 * w), `upperArm${s}`, top, 0, -0.01 * k, 0);
    part(limb(0.3 * k, 0.055 * k * w, 0.044 * k * w), `upperArm${s}`, top);
    part(limb(0.26 * k, 0.045 * k * w, 0.034 * k * w), `forearm${s}`, top);
    part(new RoundedBoxGeometry(0.075 * k, 0.1 * k, 0.03 * k, 2, 0.012 * k), `hand${s}`, skin, 0, -0.06 * k, 0);
    part(new THREE.CapsuleGeometry(0.011 * k, 0.03 * k, 2, 6).rotateZ(s === 'L' ? 0.5 : -0.5), `hand${s}`, skin, (s === 'L' ? 0.03 : -0.03) * k, -0.04 * k, 0.012 * k);
    // Legs and shoes with a lighter sole.
    part(limb(0.44 * k, 0.085 * k * w, 0.06 * k * w), `thigh${s}`, bottom);
    part(limb(0.42 * k, 0.06 * k * w, 0.045 * k * w), `shin${s}`, bottom);
    part(new RoundedBoxGeometry(0.1 * k, 0.07 * k, 0.26 * k, 2, 0.03 * k), `shin${s}`, shoes, 0, -0.41 * k, 0.05 * k);
    part(new THREE.BoxGeometry(0.1 * k, 0.018 * k, 0.26 * k), `shin${s}`, shoes === 0xe8e8e8 ? 0xb8b8b8 : 0xd8d2c4, 0, -0.44 * k, 0.05 * k);
  }
  const geometry = mergeGeometries(parts);
  const result = { geometry, rest };
  geometryCache.set(key, result);
  return result;
}

const material = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.85, vertexColors: true });

// Pedestrians come in a fixed set of looks, so their geometry is built once and shared
// (building a body on every spawn caused frame hitches).
export const PERSON_VARIANTS = 24;
const variantSeed = (i) => 1000 + i * 7919;
export function warmPeople() { for (let i = 0; i < PERSON_VARIANTS; i++) buildPerson({}, variantSeed(i)); }

// Builds a person. opts may fix skin / top / bottom colours (the player); without a seed,
// one of the shared looks is picked.
export function buildPerson(opts = {}, seed = variantSeed(Math.floor(Math.random() * PERSON_VARIANTS))) {
  let s = Math.floor(seed) % 2147483647 || 1;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const female = r() < 0.5;
  // Norwegian adult heights: women ~1.67 m, men ~1.80 m (mean), with spread.
  const look = {
    accent: pick(ACCENTS, r),
    backpack: r() < 0.25,
    beard: !female && r() < 0.3,
    bottom: opts.bottom ?? pick(BOTTOMS, r),
    build: female ? 0.9 + r() * 0.1 : 1 + r() * 0.12,
    coat: female ? r() < 0.35 : r() < 0.15,
    female,
    h: Math.round((female ? 1.6 + r() * 0.14 : 1.72 + r() * 0.16) * 50) / 50,
    hair: pick(HAIR, r),
    hairStyle: female ? pick(['long', 'long', 'bun', 'short'], r) : pick(['short', 'short', 'short', 'bald'], r),
    hat: r() < 0.15,
    scarf: r() < 0.25,
    shoes: pick(SHOES, r),
    skin: opts.skin ?? pick(SKIN, r),
    top: opts.top ?? pick(TOPS, r),
  };
  const { geometry, rest } = bodyGeometry(look);
  const bones = {};
  for (const name of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.fromArray(rest[name]);
    bones[name] = b;
  }
  for (const name of BONES) if (PARENT[name]) bones[PARENT[name]].add(bones[name]);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(bones.hips);
  // Bind in the rest pose: world matrices must be current before the skeleton is made.
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(BONES.map((n) => bones[n])));
  mesh.castShadow = true;
  return { bones, hipsY: rest.hips[1], mesh };
}

// Walk/run cycle. amount: 0 standing, ~0.6 walking, 1 running.
export function posePerson(p, phase, amount, aiming = false, time = 0) {
  const b = p.bones, a = amount, sw = Math.sin(phase), cw = Math.cos(phase);
  b.thighL.rotation.x = -sw * 0.5 * a;
  b.thighR.rotation.x = sw * 0.5 * a;
  b.shinL.rotation.x = (0.08 + Math.max(0, Math.sin(phase + 1.3)) * 0.9) * a;
  b.shinR.rotation.x = (0.08 + Math.max(0, Math.sin(phase + 1.3 + Math.PI)) * 0.9) * a;
  b.upperArmL.rotation.set(sw * 0.45 * a, 0, 0.08);
  b.upperArmR.rotation.set(aiming ? -Math.PI / 2 : -sw * 0.45 * a, 0, -0.08);
  b.forearmL.rotation.x = -0.25 - Math.max(0, sw) * 0.35 * a;
  b.forearmR.rotation.x = aiming ? 0 : -0.25 - Math.max(0, -sw) * 0.35 * a;
  b.chest.rotation.set(0.04 * a + Math.sin(time * 1.6) * 0.015 * (1 - Math.min(1, a)), sw * 0.08 * a, 0);
  b.hips.rotation.y = -sw * 0.06 * a;
  b.hips.position.y = p.hipsY + Math.abs(cw) * 0.035 * a - 0.02 * a;
  b.head.rotation.y = aiming ? 0 : -sw * 0.04 * a;
}
