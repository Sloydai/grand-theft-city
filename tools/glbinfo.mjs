// Prints bounds, triangle count, and materials of GLB files.
import { readFileSync } from 'node:fs';
for (const file of process.argv.slice(2)) {
  const buf = readFileSync(file);
  const len = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.slice(20, 20 + len).toString());
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], tris = 0;
  for (const mesh of gltf.meshes || []) for (const p of mesh.primitives) {
    const acc = gltf.accessors[p.attributes.POSITION];
    acc.min.forEach((v, i) => (min[i] = Math.min(min[i], v)));
    acc.max.forEach((v, i) => (max[i] = Math.max(max[i], v)));
    tris += p.indices !== undefined ? gltf.accessors[p.indices].count / 3 : acc.count / 3;
  }
  const size = max.map((v, i) => (v - min[i]).toFixed(2));
  const mats = (gltf.materials || []).map((m) => `${m.name}:${(m.pbrMetallicRoughness?.baseColorFactor || []).map((c) => c.toFixed(2)).join(',')}`);
  console.log(file.split('/').pop(), 'size', size.join('x'), 'min', min.map((v) => v.toFixed(2)).join(','), 'tris', tris, 'nodes', (gltf.nodes || []).length, 'scale?', JSON.stringify(gltf.nodes?.[0]?.scale || null), '\n  mats', mats.join(' | '));
}
