// Ground elevation from Kartverket's national laser terrain model (© Kartverket, CC BY 4.0),
// as a 2 m grid of heights in cm above NN2000 (tools/elevation.mjs), plus the surface model
// on the same grid (roofs, bridges). Heights are returned relative to DATUM, so the quays
// sit just above the game's water level.
import * as THREE from 'three';

export const DATUM = 1.0;

export async function loadTerrain(base = 'data/') {
  const [meta, ground, surface] = await Promise.all([
    fetch(`${base}terrain.json`).then((r) => r.json()),
    fetch(`${base}terrain.bin`).then((r) => r.arrayBuffer()),
    fetch(`${base}surface.bin`).then((r) => r.arrayBuffer()),
  ]);
  // Bilinear lookup in a grid; outside it the edge value continues.
  const sampler = (cm, { cell, minX, minZ, nx, nz }) => {
    const at = (i, j) => cm[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))] / 100 - DATUM;
    return (x, z) => {
      const fx = (x - minX) / cell, fz = (z - minZ) / cell, i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
      return (1 - tx) * (1 - tz) * at(i, j) + tx * (1 - tz) * at(i + 1, j) + (1 - tx) * tz * at(i, j + 1) + tx * tz * at(i + 1, j + 1);
    };
  };
  // The ground is the drive terrain (tools/drive-terrain.mjs): one smooth height field for
  // streets, kerbs, vehicles and people.
  return { heightAt: sampler(new Int16Array(ground), meta), meta, surfaceAt: sampler(new Int16Array(surface), meta) };
}

// Splits triangles of a non-indexed geometry until no edge is longer than maxEdge
// (interpolating every attribute), then adds height(x, z) to y for vertices where
// affect(y) holds. Geometry must be in world coordinates. Ground-hugging surfaces
// (groundNormals) take their normals from the slope itself, so overlapping layers shade
// identically whatever their triangulation.
//
// With `tolerance` (metres), an edge longer than maxEdge is only split where the ground at its
// middle bends more than that from the straight line between its ends, or the ground at a
// triangle's centre leaves its plane (or it is over 2 × maxEdge), as Worldhood does: flat streets keep big triangles, slopes and steps get small ones.
export function drape(geometry, height, maxEdge = 6, affect = () => true, groundNormals = false, tolerance = 0) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const names = Object.keys(g.attributes), sizes = names.map((n) => g.attributes[n].itemSize), src = names.map((n) => g.attributes[n].array);
  const count = g.attributes.position.count, max2 = maxEdge * maxEdge;
  // Vertices live in one flat pool (all attributes interleaved, `stride` numbers each), so
  // splitting allocates nothing per vertex; triangles are triples of pool indices.
  const stride = sizes.reduce((a, b) => a + b, 0), at = names.indexOf('position'), posAt = sizes.slice(0, at).reduce((a, b) => a + b, 0);
  let pool = new Float64Array(Math.max(16, count * 2) * stride), used = 0;
  const add = (from) => {
    if ((used + 1) * stride > pool.length) { const grown = new Float64Array(pool.length * 2); grown.set(pool); pool = grown; }
    if (from !== undefined) for (let a = 0, o = 0; a < names.length; o += sizes[a], a++) for (let c = 0; c < sizes[a]; c++) pool[used * stride + o + c] = src[a][from * sizes[a] + c];
    return used++;
  };
  const mid = (u, v) => {
    const k = add();
    for (let c = 0; c < stride; c++) pool[k * stride + c] = (pool[u * stride + c] + pool[v * stride + c]) / 2;
    return k;
  };
  const len2 = (u, v) => {
    const a = u * stride + posAt, b = v * stride + posAt;
    return (pool[a] - pool[b]) ** 2 + (pool[a + 1] - pool[b + 1]) ** 2 + (pool[a + 2] - pool[b + 2]) ** 2;
  };
  const hardMax2 = max2 * 4;
  // Whether the ground along the edge u–v stays within tolerance of a straight line (checked
  // at a quarter, the middle and three quarters).
  const flatEdge = (u, v) => {
    const a = u * stride + posAt, b = v * stride + posAt, ax = pool[a], az = pool[a + 2], bx = pool[b], bz = pool[b + 2], ha = height(ax, az), hb = height(bx, bz);
    for (const t of [0.25, 0.5, 0.75]) if (Math.abs(height(ax + (bx - ax) * t, az + (bz - az) * t) - (ha + (hb - ha) * t)) > tolerance) return false;
    return true;
  };
  // And at the triangle's centre (a bump inside it would poke through).
  const flatInside = (u, v, w) => {
    const a = u * stride + posAt, b = v * stride + posAt, c = w * stride + posAt;
    const cx = (pool[a] + pool[b] + pool[c]) / 3, cz = (pool[a + 2] + pool[b + 2] + pool[c + 2]) / 3;
    const mean = (height(pool[a], pool[a + 2]) + height(pool[b], pool[b + 2]) + height(pool[c], pool[c + 2])) / 3;
    return Math.abs(height(cx, cz) - mean) <= tolerance;
  };
  for (let k = 0; k < count; k++) add(k);
  // A NaN vertex would never pass the edge test and split forever (eating all memory):
  // fail loudly instead.
  for (let k = 0; k < count; k++) for (let c = 0; c < 3; c++) if (!Number.isFinite(pool[k * stride + posAt + c])) throw new Error(`drape: non-finite vertex ${k}`);
  const out = [], stack = [];
  for (let t = 0; t < count; t += 3) {
    stack.push(t, t + 1, t + 2);
    while (stack.length) {
      const r = stack.pop(), q = stack.pop(), p = stack.pop();
      const e0 = len2(p, q), e1 = len2(q, r), e2 = len2(r, p), m = Math.max(e0, e1, e2);
      if (m <= max2 || (tolerance && m <= hardMax2 && flatEdge(p, q) && flatEdge(q, r) && flatEdge(r, p) && flatInside(p, q, r))) { out.push(p, q, r); continue; }
      // Bisect the longest edge.
      if (m === e0) { const s = mid(p, q); stack.push(p, s, r, s, q, r); }
      else if (m === e1) { const s = mid(q, r); stack.push(p, q, s, p, s, r); }
      else { const s = mid(r, p); stack.push(p, q, s, s, q, r); }
    }
  }
  const result = new THREE.BufferGeometry();
  for (let a = 0, o = 0; a < names.length; o += sizes[a], a++) {
    const size = sizes[a], array = new Float32Array(out.length * size);
    for (let i = 0; i < out.length; i++) for (let c = 0; c < size; c++) array[i * size + c] = pool[out[i] * stride + o + c];
    result.setAttribute(names[a], new THREE.BufferAttribute(array, size));
  }
  const p = result.attributes.position, xyz = p.array;
  for (let i = 0; i < xyz.length; i += 3) if (affect(xyz[i + 1])) xyz[i + 1] += height(xyz[i], xyz[i + 2]);
  if (!count) return result;
  if (!groundNormals) { result.computeVertexNormals(); return result; }
  const normals = new Float32Array(p.count * 3);
  for (let i = 0; i < xyz.length; i += 3) {
    const x = xyz[i], z = xyz[i + 2], nx = height(x - 1, z) - height(x + 1, z), nz = height(x, z - 1) - height(x, z + 1), l = Math.hypot(nx, 2, nz);
    normals[i] = nx / l; normals[i + 1] = 2 / l; normals[i + 2] = nz / l;
  }
  result.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return result;
}

// The ground itself, in square tiles (aligned to multiples of `tile`) with two levels of
// detail: a coarse mesh (8 m) built now, and buildFine() for the full 2 m mesh, which the
// caller streams in near the camera. override(x, z) may return a height to use instead
// (e.g. under the sea), or null. Returns [{ key, coarse, buildFine }].
export function terrainTiles({ meta, heightAt }, material, override = () => null, tile = 300) {
  const { cell, minX, minZ, nx, nz } = meta, maxX = minX + (nx - 1) * cell, maxZ = minZ + (nz - 1) * cell, tiles = [];
  const build = (x0, z0, x1, z1, step) => {
    const sx = Math.max(1, Math.round((x1 - x0) / step)), sz = Math.max(1, Math.round((z1 - z0) / step));
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, sx, sz).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, override(x, z) ?? heightAt(x, z));
      uv.setXY(i, x, -z);
    }
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, material);
    mesh.receiveShadow = true;
    return mesh;
  };
  for (let ix = Math.floor(minX / tile); ix * tile < maxX; ix++) for (let iz = Math.floor(minZ / tile); iz * tile < maxZ; iz++) {
    const x0 = Math.max(minX, ix * tile), z0 = Math.max(minZ, iz * tile), x1 = Math.min(maxX, (ix + 1) * tile), z1 = Math.min(maxZ, (iz + 1) * tile);
    if (x1 - x0 < cell || z1 - z0 < cell) continue;
    tiles.push({ buildFine: () => build(x0, z0, x1, z1, cell), coarse: build(x0, z0, x1, z1, cell * 4), key: `${ix}|${iz}` });
  }
  return tiles;
}
