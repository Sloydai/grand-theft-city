// Building meshes from OSM footprints: real roof shapes, facades aligned to the floor count,
// ground-floor shopfronts, a cornice, and darker walls near the ground.
import * as THREE from 'three';

// Smallest rotated rectangle around a footprint: { cx, cz, w (along angle), d, angle }.
export function footprintRect(p) {
  let best = null;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const ux = Math.cos(angle), uz = Math.sin(angle);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of p) {
      const u = x * ux + z * uz, v = -x * uz + z * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      best = { angle, area, cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, d: v1 - v0, w: u1 - u0 };
    }
  }
  return best;
}

// Roof planes as linear functions f(x, z) = ax * x + az * z + c (height above the eaves).
// The roof surface is min over the planes, so each plane owns a convex slice of the footprint.
function roofPlanes(b, rect) {
  if (!b.r || !b.rh) return [];
  const across = b.o === 1;
  const long = (rect.w >= rect.d) !== across;
  const angle = long ? rect.angle : rect.angle + Math.PI / 2;
  const ux = Math.cos(angle), uz = Math.sin(angle);
  const hl = (long ? rect.w : rect.d) / 2, hw = (long ? rect.d : rect.w) / 2;
  // u runs along the ridge, v across it; both relative to the rectangle centre.
  const plane = (ku, kv, c) => ({ ax: ku * ux - kv * uz, az: ku * uz + kv * ux, c: c - (ku * ux - kv * uz) * rect.cx - (ku * uz + kv * ux) * rect.cz });
  const h = b.rh;
  const sides = [plane(0, -h / hw, h), plane(0, h / hw, h)];
  switch (b.r) {
    case 'skillion': return [plane(0, -h / (2 * hw), h / 2)];
    case 'hipped': case 'mansard': case 'half-hipped':
      return [...sides, plane(-h / hw, 0, (h * hl) / hw), plane(h / hw, 0, (h * hl) / hw)];
    case 'pyramidal': case 'dome': case 'round':
      return [...sides, plane(-h / hl, 0, h), plane(h / hl, 0, h)];
    default: return sides; // gabled, saltbox, gambrel
  }
}
const evalPlane = (pl, x, z) => pl.ax * x + pl.az * z + pl.c;
const roofAt = (planes, x, z) => (planes.length ? Math.max(0, Math.min(...planes.map((pl) => evalPlane(pl, x, z)))) : 0);

// Keeps the part of polygon p where L(x, z) <= 0 (Sutherland-Hodgman).
function clip(p, L) {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], la = L(a), lb = L(b);
    if (la <= 0) out.push(a);
    if ((la < 0 && lb > 0) || (la > 0 && lb < 0)) {
      const t = la / (la - lb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

// Colours and facade style from the OSM tags, in the tones of central Oslo (light stucco,
// zinc and slate roofs, stone and glass offices) when a building has no colour of its own.
// facades: real wall colours sampled from street photos (data.facades), else STUCCO.
const STUCCO = ['#ece5d6', '#e6d8bd', '#dccaa7', '#e9dfcf', '#d4c5ad', '#efe8dc', '#d8cfc3', '#cdbfa9', '#e1c9a4', '#c9b9a1', '#e4d3b8', '#c7a184', '#b9a48a'];
const BRICK = ['#9a5a45', '#8a4b3a', '#a9654c', '#7f4636'];
const STONE = ['#d7d2c8', '#cbc4b8', '#bdb6aa', '#a9a49b'];
const OFFICE = ['#d9d6d0', '#c8c4bd', '#b4b2ad', '#9ea2a5', '#8c8378'];
const ROOF_MATERIAL = { concrete: '#8d8f91', copper: '#6f9a85', glass: '#8fa6b3', metal: '#9aa0a5', roof_tiles: '#7d4636', tar_paper: '#3f4245' };
const GRANITE = new THREE.Color('#6f6b65');
const BALCONY_SLAB = new THREE.Color('#cfc8bb'), BALCONY_RAIL = new THREE.Color('#25292c'), CHIMNEY = new THREE.Color('#8a4a3a');
const insideRing = (x, z, p) => { let r = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) r = !r; return r; };
const AWNINGS = ['#1f3d2b', '#5a1a1f', '#1c2a44', '#151515', '#d9d0bd', '#2f4f4f'];
const OFFICE_TYPES = new Set(['commercial', 'government', 'hospital', 'hotel', 'office']);
const SHED_TYPES = new Set(['garage', 'garages', 'industrial', 'roof', 'service', 'shed', 'warehouse']);
export function buildingLook(b, pitched, facades = STUCCO) {
  const pick = (list) => list[b.s % list.length];
  const tall = b.l >= 7 || b.h >= 24;
  let style = 'classic';
  if (b.facade) style = b.facade;
  else if (b.plain) style = 'masonry';
  else if (b.m === 'glass' || b.m === 'mirror') style = 'glass';
  else if (b.m === 'metal' || b.m === 'concrete' || b.l >= 10 || (OFFICE_TYPES.has(b.bt) && tall)) style = b.s % 4 === 0 && b.l >= 8 ? 'glass' : 'modern';
  else if (SHED_TYPES.has(b.bt)) style = 'masonry';
  const wall = b.c
    || (b.m === 'brick' ? pick(BRICK) : b.m === 'stone' || b.m === 'limestone' ? pick(STONE)
      : style === 'glass' ? '#ffffff' : style === 'modern' ? pick(OFFICE) : SHED_TYPES.has(b.bt) ? '#a9a49a' : pick(facades));
  const roof = b.rc || ROOF_MATERIAL[b.rm] || (pitched ? ((b.s >> 3) % 10 < 7 ? '#8f959a' : '#55595e') : '#7d8083');
  return { roof: new THREE.Color(roof), style, wall: new THREE.Color(wall) };
}

// Returns geometries per facade: walls (classic windows), modern (ribbon windows), glass
// (curtain wall), masonry (no windows), shops (shopfronts), trim and roofs.
export function buildingGeometries(list, facades) {
  const bucket = (uv = true) => (uv ? { color: [], pos: [], uv: [] } : { color: [], pos: [] });
  const out = { arched: bucket(), awnings: bucket(false), glass: bucket(), masonry: bucket(), modern: bucket(), radhus: bucket(), roofs: bucket(false), shops: bucket(), trim: bucket(false), walls: bucket() };
  // A quad between two rows of [x, y, z] points; faces the side the wall quads face when
  // the rows run (low, high) the way a wall's do.
  const strip = (target, a0, b0, a1, b1, color) => {
    for (const v of [a0, b0, b1, a0, b1, a1]) { target.pos.push(...v); target.color.push(color.r, color.g, color.b); }
  };
  // A box centred at (x, y, z): w along (ax, az), h up, d along (nx, nz); no bottom face.
  const box = (target, x, y, z, ax, az, nx, nz, w, h, d, color) => {
    const c = (su, sv, sn) => [x + ax * su * w / 2 + nx * sn * d / 2, y + sv * h / 2, z + az * su * w / 2 + nz * sn * d / 2];
    const faces = [[[-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]], [[1, -1, -1], [-1, -1, -1], [1, 1, -1], [-1, 1, -1]], [[1, -1, 1], [1, -1, -1], [1, 1, 1], [1, 1, -1]], [[-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1]], [[-1, 1, 1], [1, 1, 1], [-1, 1, -1], [1, 1, -1]]];
    for (const [a0, b0, a1, b1] of faces) strip(target, c(...a0), c(...b0), c(...a1), c(...b1), color);
  };
  const quad = (target, a, b, y0a, y0b, y1a, y1b, color, uv, ao) => {
    const verts = [[a, y0a], [b, y0b], [b, y1b], [a, y0a], [b, y1b], [a, y1a]];
    for (const [[x, z], y] of verts) {
      target.pos.push(x, y, z);
      const k = ao(y);
      target.color.push(color.r * k, color.g * k, color.b * k);
    }
    if (uv) target.uv.push(...uv);
  };
  for (const b of list) {
    let p = b.p;
    let area = 0;
    for (let i = 0; i < p.length; i++) { const a = p[i], c = p[(i + 1) % p.length]; area += a[0] * c[1] - c[0] * a[1]; }
    if (Math.abs(area) < 8) continue;
    if (area > 0) p = p.slice().reverse();
    // ground: terrain level under the footprint; heights in the data are above it.
    const lift = b.ground || 0, base = (b.mh || 0) + lift, top = Math.max(b.h, b.mh || 0) + lift;
    // Roof-only parts (spire stages, canopies) have no wall height but still a roof.
    if (top <= base + 0.5 && !(b.rh > 0.3)) continue;
    // Courtyards: holes wound opposite to the outer ring, so their walls face the yard.
    const holes = (b.holes || []).map((h) => {
      let a2 = 0;
      for (let i = 0; i < h.length; i++) { const q = h[i], c = h[(i + 1) % h.length]; a2 += q[0] * c[1] - c[0] * q[1]; }
      return a2 < 0 ? h.slice().reverse() : h;
    });
    const rect = footprintRect(p);
    const planes = holes.length ? [] : roofPlanes(b, rect);
    const look = buildingLook(b, planes.length > 0, facades);
    const wall = look.wall;
    const cornice = wall.clone().lerp(new THREE.Color(0xf4efe6), 0.35);
    const levels = Math.max(1, b.l || Math.round((top - base) / 3.2));
    const floorH = (top - base) / levels;
    const hasShop = !b.mh && levels >= 3 && !b.noShops && ['classic', 'glass', 'modern'].includes(look.style);
    const facade = look.style === 'classic' ? out.walls : look.style === 'masonry' ? null : out[look.style];
    const shopTop = hasShop ? base + Math.min(4.4, floorH * 1.3) : base;
    const corniceH = levels >= 2 ? 0.45 : 0;
    const ao = (y) => 0.8 + 0.2 * Math.min(1, (y - base) / 7);
    const flat = () => 1;
    if (b.roofAt) {
      surveyed(b, p, holes, { base, facade, floorH, hasShop, look, shopTop, wall, cornice });
      continue;
    }
    const outer = p;
    for (const p of [outer, ...holes]) {
    // Outward offsets: mitred at the corners, so cornices and plinths wrap round them.
    const normalOf = (i) => { const a = p[i], c = p[(i + 1) % p.length], l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1; return [-(c[1] - a[1]) / l, (c[0] - a[0]) / l]; };
    const mitre = p.map((_, i) => {
      const n1 = normalOf((i - 1 + p.length) % p.length), n2 = normalOf(i), mx = n1[0] + n2[0], mz = n1[1] + n2[1], ml = Math.hypot(mx, mz) || 1;
      const k = Math.min(3, 1 / Math.max(0.33, (mx / ml) * n2[0] + (mz / ml) * n2[1]));
      return [(mx / ml) * k, (mz / ml) * k];
    });
    const plinth = !hasShop && look.style === 'classic' && levels >= 2;
    const awnings = hasShop && look.style === 'classic' && b.s % 3 !== 0;
    const awningColor = new THREE.Color(AWNINGS[b.s % AWNINGS.length]);
    const balconies = look.style === 'classic' && !hasShop && !b.noShops && levels >= 4 && (!b.bt || b.bt === 'apartments' || b.bt === 'residential') && b.s % 4 === 0;

    // Walls, split where the roof surface changes plane so gable tops stay straight.
    let u = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], c = p[(i + 1) % p.length];
      const ts = [0, 1];
      for (let m = 0; m < planes.length; m++) {
        for (let n = m + 1; n < planes.length; n++) {
          const da = evalPlane(planes[m], a[0], a[1]) - evalPlane(planes[n], a[0], a[1]);
          const dc = evalPlane(planes[m], c[0], c[1]) - evalPlane(planes[n], c[0], c[1]);
          if (da * dc < 0) ts.push(da / (da - dc));
        }
      }
      ts.sort((x, y) => x - y);
      const pts = ts.map((t) => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]);
      const edgeLen = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const n = normalOf(i), off = pts.map((_, k) => (ts[k] === 0 ? mitre[i] : ts[k] === 1 ? mitre[(i + 1) % p.length] : n));
      for (let k = 0; k + 1 < pts.length; k++) {
        const q0 = pts[k], q1 = pts[k + 1];
        const at = (q, o, d, y) => [q[0] + o[0] * d, y, q[1] + o[1] * d];
        const o0 = off[k], o1 = off[k + 1];
        const segLen = edgeLen * (ts[k + 1] - ts[k]);
        const u0 = u, u1 = u + segLen / 3;
        u = u1;
        if (hasShop) {
          quad(out.shops, q0, q1, base, base, shopTop, shopTop, wall, [u0 / 2, 0, u1 / 2, 0, u1 / 2, 1, u0 / 2, 0, u1 / 2, 1, u0 / 2, 1], ao);
        }
        const wTop = top - corniceH;
        const v0 = (shopTop - base) / floorH, v1 = (wTop - base) / floorH;
        if (!facade) {
          const m0 = (shopTop - base) / 4, m1 = (wTop - base) / 4;
          quad(out.masonry, q0, q1, shopTop, shopTop, wTop, wTop, wall, [u0 * 0.75, m0, u1 * 0.75, m0, u1 * 0.75, m1, u0 * 0.75, m0, u1 * 0.75, m1, u0 * 0.75, m1], ao);
        } else quad(facade, q0, q1, shopTop, shopTop, wTop, wTop, wall, [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1], ao);
        if (corniceH) {
          // Projecting cornice: soffit, front and top, 0.35 m out from the wall.
          quad(out.trim, q0, q1, wTop, wTop, top, top, cornice, null, flat);
          const shade = cornice.clone().multiplyScalar(0.72);
          strip(out.trim, at(q0, o0, 0, wTop), at(q1, o1, 0, wTop), at(q0, o0, 0.35, wTop + 0.15), at(q1, o1, 0.35, wTop + 0.15), shade);
          strip(out.trim, at(q0, o0, 0.35, wTop + 0.15), at(q1, o1, 0.35, wTop + 0.15), at(q0, o0, 0.35, top + 0.05), at(q1, o1, 0.35, top + 0.05), cornice);
          strip(out.trim, at(q0, o0, 0.35, top + 0.05), at(q1, o1, 0.35, top + 0.05), at(q0, o0, 0, top + 0.05), at(q1, o1, 0, top + 0.05), cornice);
        }
        if (plinth) {
          // Granite base course.
          strip(out.trim, at(q0, o0, 0.06, base), at(q1, o1, 0.06, base), at(q0, o0, 0.06, base + 0.8), at(q1, o1, 0.06, base + 0.8), GRANITE);
          strip(out.trim, at(q0, o0, 0.06, base + 0.8), at(q1, o1, 0.06, base + 0.8), at(q0, o0, 0, base + 0.8), at(q1, o1, 0, base + 0.8), GRANITE);
        }
        if (balconies && p === outer && segLen > 9) {
          // Balconies on the window axes (every second 3 m bay), stone slab and iron railing.
          const ex = (q1[0] - q0[0]) / segLen, ez = (q1[1] - q0[1]) / segLen;
          for (let d = 3; d < segLen - 2; d += 6) {
            const x = q0[0] + ex * d + n[0] * 0.45, z = q0[1] + ez * d + n[1] * 0.45;
            for (let f = 2; f < Math.min(levels, 6); f++) {
              const y = base + f * floorH + 0.06;
              box(out.trim, x, y, z, ex, ez, n[0], n[1], 1.7, 0.14, 0.9, BALCONY_SLAB);
              box(out.trim, x + n[0] * 0.43, y + 0.55, z + n[1] * 0.43, ex, ez, n[0], n[1], 1.7, 0.95, 0.04, BALCONY_RAIL);
            }
          }
        }
        if (awnings && p === outer && segLen > 4) {
          // Canvas awnings over the shop bays: sloped cover and a valance.
          const bays = Math.floor(segLen / 5);
          for (let j = 0; j < bays; j++) {
            const t0 = (j + 0.5) / bays - 1.8 / segLen, t1 = (j + 0.5) / bays + 1.8 / segLen;
            const e0 = [q0[0] + (q1[0] - q0[0]) * t0, q0[1] + (q1[1] - q0[1]) * t0], e1 = [q0[0] + (q1[0] - q0[0]) * t1, q0[1] + (q1[1] - q0[1]) * t1];
            const y = shopTop - 0.85;
            strip(out.awnings, at(e0, n, 1.3, y - 0.6), at(e1, n, 1.3, y - 0.6), at(e0, n, 0, y), at(e1, n, 0, y), awningColor);
            strip(out.awnings, at(e0, n, 1.3, y - 0.82), at(e1, n, 1.3, y - 0.82), at(e0, n, 1.3, y - 0.6), at(e1, n, 1.3, y - 0.6), awningColor.clone().multiplyScalar(0.85));
          }
        }
        // Gable ends: plain wall up to the roof surface.
        const r0 = roofAt(planes, q0[0], q0[1]), r1 = roofAt(planes, q1[0], q1[1]);
        // Gable ends: render on masonry, the roof's metal over glass.
        if (r0 > 0.01 || r1 > 0.01) quad(out.trim, q0, q1, top, top, top + r0, top + r1, look.style === 'glass' ? look.roof : wall, null, flat);
      }
    }

    }

    // Roof: one polygon slice per plane, triangulated and lifted onto that plane.
    const roofColor = look.roof;
    const slices = planes.length
      ? planes.map((pl, i) => ({ pl, poly: planes.reduce((poly, other, j) => (j === i || poly.length < 3 ? poly : clip(poly, (q) => evalPlane(pl, q[0], q[1]) - evalPlane(other, q[0], q[1]))), p) }))
      : [{ holes, pl: null, poly: p }];
    // Brick chimneys on the pitched roofs of older buildings, standing above the ridge.
    if (planes.length && look.style === 'classic' && (b.rh || 0) >= 1.5) {
      const ux = Math.cos(rect.angle), uz = Math.sin(rect.angle), count = 1 + (b.s % 3);
      for (let k = 0; k < count; k++) {
        const u = ((k + 0.5) / count - 0.5) * rect.w * 0.7, v = (((b.s >> (k + 1)) % 3) - 1) * rect.d * 0.15;
        const x = rect.cx + ux * u - uz * v, z = rect.cz + uz * u + ux * v;
        if (!insideRing(x, z, p)) continue;
        const y0 = top + roofAt(planes, x, z) - 0.3, y1 = top + b.rh + 0.9;
        box(out.trim, x, (y0 + y1) / 2, z, ux, uz, -uz, ux, 0.6, y1 - y0, 0.8, CHIMNEY);
        box(out.trim, x, y1 + 0.05, z, ux, uz, -uz, ux, 0.72, 0.1, 0.92, BALCONY_SLAB);
      }
    }
    for (const { holes: yards = [], pl, poly } of slices) {
      if (poly.length < 3) continue;
      const v2 = (ring) => ring.map(([x, z]) => new THREE.Vector2(x, z));
      const tris = THREE.ShapeUtils.triangulateShape(v2(poly), yards.map(v2));
      const all = poly.concat(...yards);
      for (const [i0, i1, i2] of tris) {
        let A = all[i0], B = all[i1], C = all[i2];
        if ((B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]) < 0) [B, C] = [C, B];
        for (const [x, z] of [A, B, C]) {
          out.roofs.pos.push(x, top + (pl ? Math.max(0, evalPlane(pl, x, z)) : 0), z);
          out.roofs.color.push(roofColor.r, roofColor.g, roofColor.b);
        }
      }
    }
  }
  // A building shaped by the laser surface model (b.roofAt(x, z)): walls in 3 m pieces whose
  // tops follow the surface just inside the wall (so gables, setbacks and towers are real),
  // and a roof that is the surface itself over the footprint, coloured by its slope.
  // The surface model is noisy (trees, cars, antennas, 25 cm steps): 3×3 median, then
  // flood-fill into roof faces (neighbours under 1.6 m apart) and replace each face that
  // fits a plane with that plane, so flat roofs are flat, ramps straight, and steps clean.
  function smoothRoof(cells, raw) {
    const key = (i, j) => i * 100003 + j, rawH = new Map(), med = new Map();
    for (const [k, c] of cells) rawH.set(k, raw(c.i, c.j));
    for (const [k, c] of cells) {
      const near = [];
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const v = rawH.get(key(c.i + di, c.j + dj)); if (v !== undefined) near.push(v); }
      near.sort((a, b) => a - b);
      med.set(k, near[near.length >> 1]);
    }
    const face = new Map(), faces = [];
    for (const [k, c] of cells) {
      if (face.has(k)) continue;
      const members = [c], id = faces.length;
      face.set(k, id);
      for (let q = 0; q < members.length; q++) {
        const m = members[q], h = med.get(key(m.i, m.j));
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nk = key(m.i + di, m.j + dj);
          if (face.has(nk) || !cells.has(nk) || Math.abs(med.get(nk) - h) >= 1.6) continue;
          face.set(nk, id);
          members.push(cells.get(nk));
        }
      }
      faces.push(fitPlane(members, (m) => med.get(key(m.i, m.j))));
    }
    const out = new Map();
    for (const [k, c] of cells) {
      let f = faces[face.get(k)];
      // Specks (a chimney, a tree over the eaves) join the bordering face nearest in height.
      if (f.n < 6) {
        let best = null;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const g = faces[face.get(key(c.i + di, c.j + dj))];
          if (g && g.n >= 6 && g.plane && (!best || Math.abs(g.at(c.i, c.j) - med.get(k)) < Math.abs(best.at(c.i, c.j) - med.get(k)))) best = g;
        }
        if (best) f = best;
      }
      out.set(k, f.plane ? f.at(c.i, c.j) : med.get(k));
    }
    out.nearest = (i, j) => {
      let best = null, d = Infinity;
      for (const c of cells.values()) { const e = (c.i - i) ** 2 + (c.j - j) ** 2; if (e < d) { d = e; best = c; } }
      return best ? out.get(key(best.i, best.j)) : 0;
    };
    return out;
  }
  // Least-squares h = a + b·i + c·j over the members; `plane` when it fits within 0.6 m RMS.
  function fitPlane(members, h) {
    const n = members.length;
    let si = 0, sj = 0, sh = 0;
    for (const m of members) { si += m.i; sj += m.j; sh += h(m); }
    const mi = si / n, mj = sj / n, mh = sh / n;
    let ii = 0, jj = 0, ij = 0, ih = 0, jh = 0;
    for (const m of members) { const di = m.i - mi, dj = m.j - mj, dh = h(m) - mh; ii += di * di; jj += dj * dj; ij += di * dj; ih += di * dh; jh += dj * dh; }
    const det = ii * jj - ij * ij;
    let gi = det > 1e-6 ? (ih * jj - jh * ij) / det : 0, gj = det > 1e-6 ? (jh * ii - ih * ij) / det : 0;
    // Under 1:13 is a flat roof on a scan that drifts (or a wide face spanning a gentle slope).
    if (Math.hypot(gi, gj) < 0.15) gi = gj = 0;
    const at = (i, j) => mh + gi * (i - mi) + gj * (j - mj);
    let err = 0;
    for (const m of members) err += (h(m) - at(m.i, m.j)) ** 2;
    return { at, n, plane: Math.sqrt(err / n) < 0.6 };
  }
  function surveyed(b, p, holes, { base, facade: wallFacade, floorH, hasShop, look, shopTop, wall: wallColor, cornice }) {
    // maxH caps the scan where a taller neighbour overhangs the outline (the Opera's stage tower).
    const ceiling = base + (b.maxH ?? 130), rings = [p, ...holes];
    const nearEdge = (x, z) => {
      let best = null;
      for (const r of rings) for (let i = 0; i < r.length; i++) {
        const a = r[i], c = r[(i + 1) % r.length], dx = c[0] - a[0], dz = c[1] - a[1], l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)), d = Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
        if (!best || d < best.d) best = { d, nx: -dz / Math.sqrt(l2), nz: dx / Math.sqrt(l2) };
      }
      return best;
    };
    // Roof height at (x, z): sampled 0.8 m inside when close to a wall (footprints are a
    // little off, and the surface just outside is the street).
    // Roof cells: 2 m squares centred on the surface grid's samples, each at its sample's
    // height (cached). Walls take the height of the cell just inside them.
    // CLIFF: height steps above this between neighbouring cells are vertical faces (a storey
    // or more); smaller ones are slopes (a 45° roof rises 2 m per cell).
    const CELL = 2, CLIFF = 2.6;
    const xs = p.map((q) => q[0]), zs = p.map((q) => q[1]);
    const i0 = Math.round(Math.min(...xs) / CELL), i1 = Math.round(Math.max(...xs) / CELL), j0 = Math.round(Math.min(...zs) / CELL), j1 = Math.round(Math.max(...zs) / CELL);
    const inside = (x, z) => insideRing(x, z, p) && !holes.some((h) => insideRing(x, z, h));
    const half = CELL / 2, cells = new Map();
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const x = i * CELL, z = j * CELL, corners = [[x - half, z - half], [x + half, z - half], [x + half, z + half], [x - half, z + half]];
      const inCount = corners.filter(([cx, cz]) => inside(cx, cz)).length;
      if (!inCount && !inside(x, z) && !p.some(([px, pz]) => Math.abs(px - x) <= half && Math.abs(pz - z) <= half)) continue;
      cells.set(i * 100003 + j, { full: inCount === 4 && !holes.length, i, j });
    }
    const cellH = smoothRoof(cells, (i, j) => Math.min(ceiling, Math.max(base + 2.5, b.roofAt(i * CELL, j * CELL))));
    const cell = (i, j) => cellH.get(i * 100003 + j) ?? cellH.nearest(i, j);
    const height = (x, z, inX = 0, inZ = 0) => cell(Math.round((x + inX * 0.8) / CELL), Math.round((z + inZ * 0.8) / CELL));
    const inward = (x, z) => {
      const e = nearEdge(x, z);
      if (!e || e.d > 1) return [0, 0];
      // The ring's winding puts the inside on one side; test which.
      const sx = x + e.nx * 0.5, sz = z + e.nz * 0.5;
      return insideRing(sx, sz, p) && !holes.some((h) => insideRing(sx, sz, h)) ? [e.nx, e.nz] : [-e.nx, -e.nz];
    };
    let u = 0;
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (len < 0.05) continue;
        const n = Math.max(1, Math.ceil(len / 2));
        // Each 2 m piece takes the roof height inside its middle; ends meet the neighbouring
        // piece halfway along a sloping roof, and step where the roof face changes.
        const mids = Array.from({ length: n }, (_, k) => {
          const t = (k + 0.5) / n, x = a[0] + (c[0] - a[0]) * t, z = a[1] + (c[1] - a[1]) * t;
          return height(x, z, ...inward(x, z));
        });
        const join = (h, other) => (other !== undefined && Math.abs(other - h) < 0.6 ? (h + other) / 2 : h);
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n;
          const q0 = [a[0] + (c[0] - a[0]) * t0, a[1] + (c[1] - a[1]) * t0], q1 = [a[0] + (c[0] - a[0]) * t1, a[1] + (c[1] - a[1]) * t1];
          const top0 = join(mids[k], mids[k - 1]), top1 = join(mids[k], mids[k + 1]);
          const u0 = u, u1 = u + (len / n) / 3;
          u = u1;
          const bottom = hasShop && ring === p ? shopTop : base;
          if (hasShop && ring === p) quad(out.shops, q0, q1, base, base, shopTop, shopTop, wallColor, [u0 / 2, 0, u1 / 2, 0, u1 / 2, 1, u0 / 2, 0, u1 / 2, 1, u0 / 2, 1], (y) => 0.8 + 0.2 * Math.min(1, (y - base) / 7));
          const w0 = Math.max(bottom + 0.5, top0 - 0.45), w1 = Math.max(bottom + 0.5, top1 - 0.45), v0 = (bottom - base) / floorH;
          const ao = (y) => 0.8 + 0.2 * Math.min(1, (y - base) / 7);
          // Some landmarks pick the facade by wall height (glass halls under a hotel tower...).
          const own = b.facadeFor?.((top0 + top1) / 2 - base), facade = own ? (own.style === 'masonry' ? null : out[own.style]) : wallFacade, wall = own?.color ? new THREE.Color(own.color) : wallColor;
          if (!facade) quad(out.masonry, q0, q1, bottom, bottom, w0, w1, wall, [u0 * 0.75, (bottom - base) / 4, u1 * 0.75, (bottom - base) / 4, u1 * 0.75, (w1 - base) / 4, u0 * 0.75, (bottom - base) / 4, u1 * 0.75, (w1 - base) / 4, u0 * 0.75, (w0 - base) / 4], ao);
          else quad(facade, q0, q1, bottom, bottom, w0, w1, wall, [u0, v0, u1, v0, u1, (w1 - base) / floorH, u0, v0, u1, (w1 - base) / floorH, u0, (w0 - base) / floorH], ao);
          quad(out.trim, q0, q1, w0, w1, top0, top1, cornice, null, () => 1);
        }
      }
    }
    // Roof: the cells inside the footprint (clipped to its outline at the edges). A cell's
    // corners average the neighbouring cells within CLIFF of its own height, so pitched
    // roofs stay smooth; bigger jumps (towers, setbacks, terraces) get vertical faces.
    const corner = (c, di, dj) => {
      // Corner between the cell and its neighbours in direction (di, dj).
      const h = cell(c.i, c.j);
      let sum = 0, n = 0;
      for (const [ni, nj] of [[c.i, c.j], [c.i + di, c.j], [c.i, c.j + dj], [c.i + di, c.j + dj]]) {
        if (!cells.has(ni * 100003 + nj)) continue;
        const v = cell(ni, nj);
        if (Math.abs(v - h) < CLIFF) { sum += v; n++; }
      }
      return sum / n;
    };
    const flatRoof = new THREE.Color(b.roofTint || '#6b6e72'), slope = b.roofTint ? flatRoof : look.roof;
    const push = (pts, color) => { for (const q of pts) { out.roofs.pos.push(...q); out.roofs.color.push(color.r, color.g, color.b); } };
    const tops = new Map();
    for (const c of cells.values()) {
      const x = c.i * CELL, z = c.j * CELL;
      const h00 = corner(c, -1, -1), h10 = corner(c, 1, -1), h11 = corner(c, 1, 1), h01 = corner(c, -1, 1);
      tops.set(c.i * 100003 + c.j, { h00, h01, h10, h11 });
      const color = Math.max(h00, h10, h11, h01) - Math.min(h00, h10, h11, h01) < 0.35 ? flatRoof : slope;
      // Height inside the cell: bilinear between its corners.
      const at = (px, pz) => {
        const u = (px - (x - half)) / CELL, v = (pz - (z - half)) / CELL;
        return h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h11 * u * v + h01 * (1 - u) * v;
      };
      let poly = [[x - half, z - half], [x + half, z - half], [x + half, z + half], [x - half, z + half]];
      if (!c.full) {
        poly = clip(clip(clip(clip(p, (q) => x - half - q[0]), (q) => q[0] - (x + half)), (q) => z - half - q[1]), (q) => q[1] - (z + half));
        if (poly.length < 3) continue;
      }
      const tris = THREE.ShapeUtils.triangulateShape(poly.map(([px, pz]) => new THREE.Vector2(px, pz)), []);
      for (const [a0, a1, a2] of tris) {
        let A = poly[a0], B = poly[a1], C = poly[a2];
        if ((B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]) < 0) [B, C] = [C, B];
        push([[A[0], at(...A), A[1]], [B[0], at(...B), B[1]], [C[0], at(...C), C[1]]], color);
      }
    }
    // Vertical faces where neighbouring cells' shared edge doesn't meet.
    const side = flatRoof.clone().multiplyScalar(0.85);
    for (const c of cells.values()) {
      const t = tops.get(c.i * 100003 + c.j), x = c.i * CELL, z = c.j * CELL;
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        const n = tops.get((c.i + di) * 100003 + c.j + dj);
        if (!n) continue;
        // Shared edge endpoints, from this cell's and the neighbour's corners.
        const [a1, a2, b1, b2] = di ? [t.h10, t.h11, n.h00, n.h01] : [t.h01, t.h11, n.h00, n.h10];
        if (Math.abs(a1 - b1) < 0.05 && Math.abs(a2 - b2) < 0.05) continue;
        const e1 = di ? [x + half, z - half] : [x - half, z + half], e2 = [x + half, z + half];
        const lo = Math.min(a1, a2, b1, b2), hi = Math.max(a1, a2, b1, b2);
        if (hi - lo > 2.5 && Math.abs(a1 - b1) > 2 && Math.abs(a2 - b2) > 2) {
          // A storey or more: a wall with windows (both faces, so either side reads).
          const own = b.facadeFor?.(hi - base), target = own ? (own.style === 'masonry' ? out.masonry : out[own.style]) : wallFacade || out.masonry;
          const color = own?.color ? new THREE.Color(own.color) : wallColor, low = Math.min(a1, b1), high = Math.max(a2, b2, a1, b1);
          const v = (y) => (y - base) / floorH, u0 = (x + z) / 3, u1 = u0 + CELL / 3;
          for (const [p0, p1] of [[e1, e2], [e2, e1]]) quad(target, p0, p1, Math.min(a1, b1), Math.min(a2, b2), Math.max(a1, b1), Math.max(a2, b2), color, [u0, v(low), u1, v(low), u1, v(high), u0, v(low), u1, v(high), u0, v(high)], () => 1);
        } else push([[e1[0], a1, e1[1]], [e2[0], a2, e2[1]], [e2[0], b2, e2[1]], [e1[0], a1, e1[1]], [e2[0], b2, e2[1]], [e1[0], b1, e1[1]]], side);
      }
    }
  }
  const geo = ({ color, pos, uv }) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, geo(v)]));
}
