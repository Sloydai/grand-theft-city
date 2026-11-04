// Tall grass and flowers that grow around the camera on the real grass and flowerbed
// areas, swaying in the wind. Tufts sit on a fixed jittered grid, so they never pop
// around as the camera moves; the field is only rebuilt every few metres.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const RADIUS = 32;
const SPACING = 0.32;
const MAX_TUFTS = 30000;

// A tuft: nine thin blades spread around the centre, darker at the root.
function tuftGeometry(height, tip) {
  const pos = [], col = [];
  const root = new THREE.Color(0x3a5a24), top = new THREE.Color(tip);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996, spread = 0.03 + (i % 3) * 0.04, lean = spread + 0.03 + (i % 2) * 0.04;
    const ox = Math.cos(a) * spread, oz = Math.sin(a) * spread, w = 0.012;
    const tx = Math.cos(a) * lean, tz = Math.sin(a) * lean, h = height * (0.7 + (i % 4) * 0.12);
    pos.push(ox - Math.sin(a) * w, 0, oz + Math.cos(a) * w, ox + Math.sin(a) * w, 0, oz - Math.cos(a) * w, tx, h, tz);
    col.push(root.r, root.g, root.b, root.r, root.g, root.b, top.r, top.g, top.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function swayMaterial(time) {
  const m = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = time;
    shader.vertexShader = 'uniform float windTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 tuftOrigin = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float bend = position.y * position.y * 1.4;
      transformed.x += sin(windTime * 1.7 + tuftOrigin.x * 0.35 + tuftOrigin.z * 0.2) * bend;
      transformed.z += cos(windTime * 1.3 + tuftOrigin.z * 0.3) * bend * 0.6;`);
  };
  return m;
}

// sample(x, z) -> 0 nothing, 1 grass, 2 flowerbed; heightAt(x, z): ground height.
export function createGrassField(scene, sample, heightAt = () => 0) {
  const time = { value: 0 };
  const material = swayMaterial(time);
  const layers = [
    { colors: [0x7aa64a, 0x88b355, 0x6b9840], count: MAX_TUFTS, height: 0.24, kind: 1 },
    { colors: [0xd8384a, 0xf2c94c, 0xe88bd0, 0xffffff, 0xf07c2c], count: 4000, height: 0.3, kind: 2 },
  ].map((layer) => {
    const meshes = layer.colors.map((c) => {
      const mesh = new THREE.InstancedMesh(tuftGeometry(layer.height, c), material, Math.ceil(layer.count / layer.colors.length));
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    });
    return { ...layer, meshes };
  });
  const hash = (ix, iz, k) => {
    let h = (ix * 374761393 + iz * 668265263 + k * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
  let centre = null, job = null;
  // Rebuilds into scratch buffers a slice at a time (about 2 ms per frame), then swaps them
  // in, so walking or driving never stalls on a whole-field rebuild.
  function* rebuild(cx, cz) {
    const all = layers.flatMap((l) => l.meshes);
    const scratch = new Map(all.map((mesh) => [mesh, { array: new Float32Array(mesh.instanceMatrix.count * 16), count: 0 }]));
    const r2 = RADIUS * RADIUS;
    let budget = performance.now() + 2;
    for (let ix = Math.floor((cx - RADIUS) / SPACING); ix <= Math.ceil((cx + RADIUS) / SPACING); ix++) {
      if (performance.now() > budget) { yield; budget = performance.now() + 2; }
      for (let iz = Math.floor((cz - RADIUS) / SPACING); iz <= Math.ceil((cz + RADIUS) / SPACING); iz++) {
        const x = (ix + hash(ix, iz, 1)) * SPACING, z = (iz + hash(ix, iz, 2)) * SPACING;
        if ((x - cx) ** 2 + (z - cz) ** 2 > r2) continue;
        const kind = sample(x, z);
        const layer = layers.find((l) => l.kind === kind);
        if (!layer) continue;
        const out = scratch.get(layer.meshes[Math.floor(hash(ix, iz, 3) * layer.meshes.length)]);
        if (out.count * 16 >= out.array.length) continue;
        q.setFromAxisAngle(up, hash(ix, iz, 4) * Math.PI * 2);
        const s = 0.7 + hash(ix, iz, 5) * 0.7;
        m.compose(p.set(x, heightAt(x, z) + 0.09, z), q, sc.set(s, s, s));
        m.toArray(out.array, out.count++ * 16);
      }
    }
    for (const [mesh, { array, count }] of scratch) {
      mesh.instanceMatrix.array.set(array.subarray(0, count * 16));
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
  return {
    update(camera, seconds) {
      time.value = seconds;
      const x = camera.position.x, z = camera.position.z;
      if (!job && (!centre || Math.hypot(x - centre[0], z - centre[1]) > 8)) {
        centre = [x, z];
        job = rebuild(x, z);
      }
      if (job && job.next().done) job = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Trees and shrubs as instanced props (baked-model shape: { parts, size }).
// A tapered trunk with main branches carries a canopy of crossed leaf cards (alpha-cut leaf
// clusters) whose normals point out of the canopy, so it shades like a soft volume.

function leafTexture(colors, seed, needles = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < (needles ? 420 : 260); i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 112, x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.save();
    g.translate(x, y);
    g.rotate(r() * Math.PI);
    g.beginPath();
    if (needles) g.ellipse(0, 0, 11, 1.6, 0, 0, Math.PI * 2);
    else g.ellipse(0, 0, 9 + r() * 5, 5 + r() * 3, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
const bark = new THREE.MeshStandardMaterial({ color: 0x4a3b2e, roughness: 0.95 });
const foliage = (colors, seed, needles) => new THREE.MeshStandardMaterial({ alphaTest: 0.45, map: leafTexture(colors, seed, needles), roughness: 0.8, side: THREE.DoubleSide });
const BROADLEAF = foliage(['#3f6b2a', '#4f7d31', '#5d8c3a', '#365e25', '#6b9a44'], 7);
const LIME = foliage(['#557f2e', '#6a9638', '#7aa646', '#4a7128', '#86b052'], 19);
const SPRUCE = foliage(['#1f3d26', '#284a2d', '#2f5634', '#1a3321'], 31, true);

// Crossed cards scattered through an ellipsoid; normals radiate from its centre.
function canopy(count, centre, radii, size, seed) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pos = [], nrm = [], uv = [];
  for (let i = 0; i < count; i++) {
    const u = r() * 2 - 1, a = r() * Math.PI * 2, k = Math.cbrt(0.35 + r() * 0.65), w = Math.sqrt(1 - u * u);
    const ox = Math.cos(a) * w * k, oy = u * k, oz = Math.sin(a) * w * k;
    const cx = centre[0] + ox * radii[0], cy = centre[1] + oy * radii[1], cz = centre[2] + oz * radii[2];
    const n = new THREE.Vector3(ox, oy + 0.35, oz).normalize(), sz = size * (0.8 + r() * 0.4), spin = r() * Math.PI;
    for (const plane of [0, Math.PI / 2]) {
      const dx = Math.cos(spin + plane) * sz / 2, dz = Math.sin(spin + plane) * sz / 2, h = sz / 2;
      const quad = [[-dx, -h, -dz, 0, 0], [dx, -h, dz, 1, 0], [dx, h, dz, 1, 1], [-dx, -h, -dz, 0, 0], [dx, h, dz, 1, 1], [-dx, h, -dz, 0, 1]];
      for (const [x, y, z, U, V] of quad) { pos.push(cx + x, cy + y, cz + z); nrm.push(n.x, n.y, n.z); uv.push(U, V); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
// A limb from a to b, tapering from r0 to r1.
function limbBetween(a, b, r0, r1) {
  const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 7, 1).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  return g.translate(a.x, a.y, a.z);
}
// Solid low-poly stand-in drawn only into the shadow map (alpha-cut leaf cards are costly there).
const shadowShape = (geos) => mergeGeometries(geos.map((g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k); return n; }));
const strip = (g) => { const n = g.toNonIndexed(); for (const k of Object.keys(n.attributes)) if (!['normal', 'position', 'uv'].includes(k)) n.deleteAttribute(k); return n; };

// Broadleaf street tree (lime or maple), 10 m: trunk to 3.2 m, five limbs, round or tall crown.
export function broadleafTree(tall = false, seed = 3) {
  const H = 10, trunkTop = 3.2, crown = tall ? [2.6, 3.9, 2.6] : [3.6, 3.2, 3.6], cy = H - crown[1];
  const wood = [new THREE.CylinderGeometry(0.17, 0.26, trunkTop + 0.4, 9).translate(0, (trunkTop + 0.4) / 2, 0)];
  for (let i = 0; i < 5; i++) {
    const a = i * 2.4 + 0.3, top = new THREE.Vector3(Math.cos(a) * crown[0] * 0.55, cy + 0.6 + (i % 2) * 0.8, Math.sin(a) * crown[2] * 0.55);
    wood.push(limbBetween(new THREE.Vector3(0, trunkTop, 0), top, 0.13, 0.05));
  }
  const leaves = canopy(tall ? 70 : 80, [0, cy, 0], crown, 2.1, seed);
  const shadow = shadowShape([new THREE.CylinderGeometry(0.2, 0.25, trunkTop + 0.4, 6).translate(0, (trunkTop + 0.4) / 2, 0), new THREE.IcosahedronGeometry(1, 1).scale(crown[0] * 0.9, crown[1] * 0.9, crown[2] * 0.9).translate(0, cy, 0)]);
  return { parts: [{ geometry: mergeGeometries(wood.map(strip)), material: bark, slot: '0' }, { geometry: leaves, material: tall ? LIME : BROADLEAF, slot: '1' }], shadow, size: new THREE.Vector3(crown[0] * 2, H, crown[2] * 2) };
}

// Norway spruce, 10 m: straight trunk and drooping tiers of needle cards narrowing upwards.
export function spruceTree(seed = 11) {
  const H = 10, wood = [new THREE.CylinderGeometry(0.06, 0.24, H * 0.95, 8).translate(0, H * 0.475, 0)];
  const tiers = [];
  for (let i = 0; i < 9; i++) {
    const t = i / 8, y = 1.6 + t * (H - 2.2), r = 2.6 * (1 - t) + 0.35;
    tiers.push(canopy(14 - i, [0, y, 0], [r, 0.55, r], 1.5 - t * 0.6, seed + i * 7));
  }
  const shadow = shadowShape([new THREE.ConeGeometry(2.7, H - 1.2, 8).translate(0, 1.2 + (H - 1.2) / 2, 0), new THREE.CylinderGeometry(0.2, 0.24, 1.6, 6).translate(0, 0.8, 0)]);
  return { parts: [{ geometry: mergeGeometries(wood.map(strip)), material: bark, slot: '0' }, { geometry: mergeGeometries(tiers), material: SPRUCE, slot: '1' }], shadow, size: new THREE.Vector3(5.2, H, 5.2) };
}

// Shrub about 1.4 m tall and 2 m across.
export function shrub() {
  return { parts: [{ geometry: canopy(26, [0, 0.7, 0], [1, 0.65, 1], 1.1, 5), material: BROADLEAF, slot: '0' }], shadow: shadowShape([new THREE.IcosahedronGeometry(1, 0).scale(0.9, 0.6, 0.9).translate(0, 0.65, 0)]), size: new THREE.Vector3(2, 1.4, 2) };
}
