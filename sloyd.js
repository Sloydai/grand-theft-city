// Loads the Sloyd-generated GLBs in models/ and bakes them into game-ready parts.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export async function loadModels(onProgress) {
  // (tools/serve.mjs sends no-store, so regenerated models load fresh while developing.)
  const names = await (await fetch('models/manifest.json')).json();
  const loader = new GLTFLoader();
  let done = 0;
  const entries = await Promise.all(names.map(async (name) => {
    const gltf = await loader.loadAsync(`models/${name}.glb`);
    onProgress?.(++done, names.length);
    return [name, gltf.scene];
  }));
  return Object.fromEntries(entries);
}

// Sloyd exports PBR materials tuned for its own viewer; Lambert keeps them bright and cheap here.
const materialCache = new Map();
function gameMaterial(source) {
  const key = `${source.color.getHexString()}|${source.opacity}|${source.emissiveIntensity > 0 ? source.emissive.getHexString() : ''}`;
  if (!materialCache.has(key)) {
    materialCache.set(key, new THREE.MeshLambertMaterial({
      color: source.color.clone().multiplyScalar(1.15),
      emissive: source.emissiveIntensity > 0 ? source.emissive.clone() : new THREE.Color(0),
      opacity: source.opacity,
      side: THREE.DoubleSide,
      transparent: source.opacity < 1,
    }));
  }
  return materialCache.get(key);
}

function cleanGeometry(mesh, matrix) {
  const g = mesh.geometry.clone().applyMatrix4(matrix);
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g.index ? g.toNonIndexed() : g;
}

// Sloyd names materials _mat_<slot>_..., where slot 0 is the main body (the paint on vehicles).
const slotOf = (material) => material.name.split('_')[2] || '0';

// Merges every mesh into one geometry per material slot, with the footprint centered on
// the origin and the base at y = 0. Returns { parts: [{ geometry, material, slot }], size }.
export function bake(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const key = `${slotOf(o.material)}|${o.material.uuid}`;
    if (!groups.has(key)) groups.set(key, { geos: [], material: gameMaterial(o.material), slot: slotOf(o.material) });
    groups.get(key).geos.push(cleanGeometry(o, o.matrixWorld));
  });
  const parts = [...groups.values()].map(({ geos, material, slot }) => ({ geometry: mergeGeometries(geos), material, slot }));
  const box = new THREE.Box3();
  for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
  const center = box.getCenter(new THREE.Vector3());
  for (const p of parts) {
    p.geometry.translate(-center.x, -box.min.y, -center.z);
    p.geometry.computeBoundingSphere();
  }
  return { parts, size: box.getSize(new THREE.Vector3()) };
}
