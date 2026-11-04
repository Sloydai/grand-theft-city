// World streaming: the city is cut into square tiles, and the heavy geometry (roads,
// markings, kerbs, detailed buildings, fine terrain) is built only for tiles near the
// camera, a few milliseconds per frame, nearest first, and freed again once far behind.
// A layer is (tile) => Mesh | Mesh[] | null, where tile = { key, x0, z0, x1, z1 }; a layer
// with a lot of work may return an iterator instead, stepped within the budget until done
// (its final value is the meshes); an iterator yielding WAIT (e.g. for a file to arrive) gives
// its tile back (the streamer moves on to other tiles) and is resumed on a later frame. A layer added with { near } is shown only while its tile
// is within `near` metres of the camera (small details: markings, kerbs, gutters).
export const WAIT = Symbol('wait');
export function createStreamer({ budget = 5, keep = 850, range = 600, scene, size = 300 }) {
  const layers = [], live = new Map(), building = new Map();
  const tileOf = (ix, iz) => ({ key: `${ix}|${iz}`, x0: ix * size, x1: (ix + 1) * size, z0: iz * size, z1: (iz + 1) * size });
  const dispose = (meshes) => { for (const m of meshes) { scene.remove(m); m.geometry.dispose(); } };
  const freeze = (m) => { m.updateMatrixWorld(true); m.matrixAutoUpdate = false; m.matrixWorldAutoUpdate = false; };
  return {
    size,
    addLayer(layer, { near = Infinity } = {}) { layers.push({ build: layer, near }); },
    isLive: (key) => live.has(key),
    // For each tile, the pieces of the lines that cross it (runs of consecutive segments
    // touching the tile, padded by half the width), keeping each line's other properties.
    bucket(lines, pad = 0) {
      const buckets = new Map();
      for (const line of lines) {
        const w = (line.w || 0) / 2 + pad + 1, runs = new Map();
        for (let i = 0; i + 1 < line.p.length; i++) {
          const [ax, az] = line.p[i], [bx, bz] = line.p[i + 1];
          for (let ix = Math.floor((Math.min(ax, bx) - w) / size); ix <= Math.floor((Math.max(ax, bx) + w) / size); ix++) {
            for (let iz = Math.floor((Math.min(az, bz) - w) / size); iz <= Math.floor((Math.max(az, bz) + w) / size); iz++) {
              const key = `${ix}|${iz}`;
              if (!runs.has(key)) runs.set(key, []);
              const list = runs.get(key), last = list[list.length - 1];
              // Continue the current run if this segment follows the previous one.
              if (last && last.end === i) { last.p.push(line.p[i + 1]); last.end = i + 1; } else list.push({ end: i + 1, p: [line.p[i], line.p[i + 1]] });
            }
          }
        }
        for (const [key, list] of runs) {
          if (!buckets.has(key)) buckets.set(key, []);
          for (const run of list) buckets.get(key).push({ ...line, p: run.p });
        }
      }
      return buckets;
    },
    // Keeps tiles within range of (x, z) built; spends at most `ms` milliseconds.
    update(x, z, ms = budget) {
      const deadline = performance.now() + ms, want = [];
      const r = Math.ceil(range / size);
      for (let ix = Math.floor(x / size) - r; ix <= Math.floor(x / size) + r; ix++) {
        for (let iz = Math.floor(z / size) - r; iz <= Math.floor(z / size) + r; iz++) {
          const d = Math.hypot((ix + 0.5) * size - x, (iz + 0.5) * size - z);
          if (d < range + size * 0.71) want.push([d, ix, iz]);
        }
      }
      for (const [key, meshes] of live) {
        const [ix, iz] = key.split('|').map(Number);
        if (Math.hypot((ix + 0.5) * size - x, (iz + 0.5) * size - z) > keep) { dispose(meshes); live.delete(key); }
      }
      for (const [key, meshes] of live) {
        const [ix, iz] = key.split('|').map(Number);
        const dx = Math.max(ix * size - x, 0, x - (ix + 1) * size), dz = Math.max(iz * size - z, 0, z - (iz + 1) * size), d = Math.hypot(dx, dz);
        for (const m of meshes) if (m.userData.near) m.visible = d < m.userData.near;
      }
      want.sort((a, b) => a[0] - b[0]);
      for (const [, ix, iz] of want) {
        const tile = tileOf(ix, iz);
        if (live.has(tile.key)) continue;
        const job = building.get(tile.key) || { layer: 0, meshes: [] };
        building.set(tile.key, job);
        let waiting = false;
        while (job.layer < layers.length) {
          if (performance.now() > deadline) return;
          let result;
          if (job.steps) {
            const step = job.steps.next();
            if (step.value === WAIT) { waiting = true; break; }
            if (!step.done) continue;
            result = step.value;
            job.steps = null;
          } else {
            result = layers[job.layer].build(tile);
            if (result && typeof result.next === 'function') { job.steps = result; continue; }
          }
          const { near } = layers[job.layer++];
          for (const m of [].concat(result || [])) { freeze(m); if (near < Infinity) m.userData.near = near; scene.add(m); job.meshes.push(m); }
        }
        // A tile waiting for a file is left for a later frame; the others carry on.
        if (waiting) continue;
        live.set(tile.key, job.meshes);
        building.delete(tile.key);
      }
    },
  };
}

// Keeps only the triangles of a non-indexed geometry whose centre lies in the tile.
export function clipToTile(geometry, { x0, x1, z0, z1 }) {
  const pos = geometry.attributes.position.array, keep = [];
  for (let t = 0; t < pos.length / 9; t++) {
    const cx = (pos[t * 9] + pos[t * 9 + 3] + pos[t * 9 + 6]) / 3, cz = (pos[t * 9 + 2] + pos[t * 9 + 5] + pos[t * 9 + 8]) / 3;
    if (cx >= x0 && cx < x1 && cz >= z0 && cz < z1) keep.push(t);
  }
  if (keep.length * 9 === pos.length) return geometry;
  const out = geometry.clone();
  for (const [name, a] of Object.entries(geometry.attributes)) {
    const n = a.itemSize * 3, arr = new Float32Array(keep.length * n);
    keep.forEach((t, i) => arr.set(a.array.subarray(t * n, (t + 1) * n), i * n));
    out.setAttribute(name, new a.constructor(arr, a.itemSize));
  }
  geometry.dispose();
  return out;
}
