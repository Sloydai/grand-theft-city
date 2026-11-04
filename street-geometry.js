// Street surface geometry, built ahead of time by tools/street-meshes.mjs (the game only loads
// the result): street polygons triangulated and laid on the terrain, and the kerbs along the
// sidewalk edges. Shared so the build and any debugging use the same code.
import * as THREE from 'three';
import { drape } from './terrain.js';

// Heights of the street surfaces above the ground (metres).
export const ROAD_Y = 0.1, KERB_TOP = ROAD_Y + 0.15;

const insideRing = (x, z, p) => { let r = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) r = !r; return r; };
const inPolys = (x, z, polys) => polys.some((poly) => insideRing(x, z, poly[0]) && !poly.slice(1).some((h) => insideRing(x, z, h)));

// Positions (Float32Array, x y z per vertex, triangles) of polygons ([[outer, ...holes]], rings
// closed) at height y above the ground given by height(x, z). Triangles are up to 6 m (12 m
// where the ground is flat enough); they split only where the drive terrain bends more than
// 4 cm, well under the 7–25 cm the surfaces lie above it.
export function polygonPositions(polys, y, height) {
  const pos = [];
  for (const poly of polys) {
    const v2 = (ring) => ring.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z));
    const outer = v2(poly[0]), holes = poly.slice(1).map(v2), all = [...outer, ...holes.flat()];
    if (outer.length < 3) continue;
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(outer, holes)) {
      let A = all[i], B = all[j], C = all[k];
      if ((B.y - A.y) * (C.x - A.x) - (B.x - A.x) * (C.y - A.y) < 0) [B, C] = [C, B];
      pos.push(A.x, y, A.y, B.x, y, B.y, C.x, y, C.y);
    }
  }
  return laid(pos, height).position;
}
// Kerbs along sidewalk edges ([ax, az, bx, bz, kind]; kind 0 against the carriageway, 1 a
// dropped kerb, 2 other ground), after Worldhood's granite kerbstones (MIT): against the street
// a 17 cm granite stone (its top and its face down to the street); elsewhere a plain face down to
// what lies beyond; and two rows of gutter setts in front of the stones. Each kerb vertex carries
// `along`, the running distance along the kerb line, so the shader can draw the 1.25 m stones'
// joints and tones (it wraps every 250 m, a whole number of stones, to fit the file's Int16).
// Returns { curb, curbAlong, gutter }.
export const KERB_STONE = 1.25;
export function kerbPositions(kerbs, walk, height) {
  const curb = [], along = [], gutter = [];
  const quad = (out, a, b, c, d, ya, yb, yc, yd) => out.push(a[0], ya, a[1], b[0], yb, b[1], c[0], yc, c[1], a[0], ya, a[1], c[0], yc, c[1], d[0], yd, d[1]);
  // Along values for a quad's six vertices: s0 at a (and d), s1 at b (and c).
  const quadAlong = (s0, s1) => along.push(s0, s1, s1, s0, s1, s0);
  let run = 0, last = null;
  for (const [ax, az, bx, bz, kind] of kerbs) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    // The stone count carries on along touching edges and starts afresh elsewhere.
    if (!last || Math.hypot(last[0] - ax, last[1] - az) > 0.05) run = (Math.abs(ax * 7.1 + az * 3.7) % 1) * KERB_STONE;
    const s0 = run % 250, s1 = s0 + len;
    run += len;
    last = [bx, bz];
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    // o points out of the walk.
    const out = inPolys((ax + bx) / 2 + nx * 0.05, (az + bz) / 2 + nz * 0.05, walk) ? -1 : 1, ox = nx * out, oz = nz * out;
    const a = [ax, az], b = [bx, bz], low = kind === 1 ? ROAD_Y + 0.02 : kind === 0 ? ROAD_Y : 0.03;
    quad(curb, a, b, b, a, KERB_TOP, KERB_TOP, low, low);
    quadAlong(s0, s1);
    if (kind !== 0) continue;
    // The stone's top: 17 cm wide, a few millimetres proud of the sidewalk.
    const ia = [ax - ox * 0.17, az - oz * 0.17], ib = [bx - ox * 0.17, bz - oz * 0.17], top = KERB_TOP + 0.006;
    quad(curb, a, b, ib, ia, top, top, top, top);
    quadAlong(s0, s1);
    const g1 = [ax + ox * 0.55, az + oz * 0.55], g2 = [bx + ox * 0.55, bz + oz * 0.55], y = ROAD_Y + 0.006;
    quad(gutter, a, b, g2, g1, y, y, y, y);
  }
  const kerb = laid(curb, height, along);
  return { curb: kerb.position, curbAlong: kerb.along, gutter: laid(gutter, height).position };
}
// Lays positions on the ground (splitting where it bends), carrying an optional per-vertex
// attribute through the splits. Returns { position, along }.
function laid(pos, height, along = null) {
  if (!pos.length) return { along: new Float32Array(0), position: new Float32Array(0) };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (along) g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  const out = drape(g, height, 6, undefined, false, 0.04);
  return { along: out.attributes.along?.array ?? new Float32Array(0), position: out.attributes.position.array };
}
