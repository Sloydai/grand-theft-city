// Street surfaces as non-overlapping polygons per 300 m tile (the game's streaming tiles):
// carriageway, sidewalk, dropped kerbs at crossings, and paths, plus the kerb edges between
// them. Run after tools/preprocess.cjs; writes data/streets.json.
//
// The approach follows Worldhood (github.com/worldhood/worldhood, MIT): buffer every
// centreline into polygons with round joins, union them per tile, then dissolve the layers
// in priority order (each subtracts what is already placed), so junctions come out as one
// clean area and nothing overlaps or z-fights.
//
//   road: carriageways at ground level (bridge decks keep their own strips in the game)
//   walk: sidewalks, from the kerb out to the facades where buildings stand within 7 m
//         (else the usual width), plus mapped sidewalks and traffic islands
//   drop: the sidewalk lowered to the street where a crossing meets it (3 m wide)
//   path: footways, paths and pedestrian streets that aren't under the layers above
//   kerbs: [ax, az, bx, bz, kind] along walk edges; kind 0 = against the carriageway
//          (granite kerb), 1 = against a dropped kerb (low step), 2 = against other ground
//   zebra: crossing bars (rings), from NVDB crossing outlines
//   lines: NVDB longitudinal markings { p, c (0 white, 1 yellow), k (kind) }
//
// Where NVDB (Statens vegvesen, NLOD 2.0; tools/fetch-nvdb.mjs) maps them, real kerb lines
// set each side of the carriageway, crossing outlines give the zebras and dropped kerbs,
// lowered-kerb points give driveway drops, and the painted lines are drawn as mapped.
import fs from 'node:fs';
import CITY from './city.cjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ClipperLib = require('clipper-lib');

const { DATA } = CITY;
const data = JSON.parse(fs.readFileSync(`${DATA}world.json`, 'utf8'));
const TILE = 300, MARGIN = 12;
const PAVED = new Set(['living_street', 'pedestrian']);
const NO_WALKS = new Set(['service', 'trunk', 'motorway', 'track', 'busway']);
const round = (v) => Math.round(v * 50) / 50;
// Same projection as tools/preprocess.cjs.
const { project } = CITY;
// NVDB WKT in EPSG:4326 lists latitude first; Z (if any) is dropped.
const wktPoints = (wkt) => (wkt.match(/\(+([^()]+)\)/)?.[1] || '').split(',').map((s) => s.trim().split(/\s+/).map(Number)).filter((q) => q.length >= 2).map(([lat, lon]) => project(lat, lon));
const nvdb = (name) => { try { return JSON.parse(fs.readFileSync(`${DATA}nvdb-${name}.json`, 'utf8')); } catch { return []; } };

// ---- Spatial grids ---------------------------------------------------------------------
function grid(items, boxOf, C = 50) {
  const cells = new Map();
  for (const item of items) {
    const [x0, z0, x1, z1] = boxOf(item);
    for (let ix = Math.floor(x0 / C); ix <= Math.floor(x1 / C); ix++) for (let iz = Math.floor(z0 / C); iz <= Math.floor(z1 / C); iz++) {
      const k = `${ix}|${iz}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(item);
    }
  }
  return {
    near(x0, z0, x1, z1) {
      const out = new Set();
      for (let ix = Math.floor(x0 / C); ix <= Math.floor(x1 / C); ix++) for (let iz = Math.floor(z0 / C); iz <= Math.floor(z1 / C); iz++) for (const it of cells.get(`${ix}|${iz}`) || []) out.add(it);
      return [...out];
    },
  };
}
const boxOfPoints = (p, pad = 0) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of p) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
};
const inRing = (x, z, p) => { let r = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) r = !r; return r; };

const buildings = data.buildings.map((b) => ({ box: boxOfPoints(b.p), p: b.p }));
const buildingGrid = grid(buildings, (b) => b.box);
const inBuilding = (x, z) => buildingGrid.near(x, z, x, z).some((b) => x >= b.box[0] && x <= b.box[2] && z >= b.box[1] && z <= b.box[3] && inRing(x, z, b.p));

// ---- Polygon operations (Clipper: integer centimetres, so unions never fail) -------------
// Internally a shape is a list of Clipper paths ({ X, Y } in cm); outputs are converted to
// [[outer ring, ...holes], ...] in metres with closed rings.
const S = 100;
const { Clipper, ClipperOffset, ClipType, EndType, JoinType, PolyFillType, PolyType } = ClipperLib;
const path = (pts) => pts.map(([x, z]) => ({ X: Math.round(x * S), Y: Math.round(z * S) }));
function op(kind, subject, clip = []) {
  const c = new Clipper();
  c.AddPaths(subject, PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, PolyType.ptClip, true);
  const out = [];
  c.Execute(kind, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return out;
}
const union = (shapes) => op(ClipType.ctUnion, shapes.flat());
const minus = (a, ...b) => (a.length ? op(ClipType.ctDifference, a, b.flat()) : a);
const and = (a, b) => (a.length && b.length ? op(ClipType.ctIntersection, a, b) : []);
// A polyline (or point) buffered by r with round joins and caps.
function buffer(pts, r, ends = EndType.etOpenRound) {
  const co = new ClipperOffset(2, 0.08 * S), out = [];
  co.AddPath(path(pts), JoinType.jtRound, ends);
  co.Execute(out, r * S);
  return out;
}
// A ribbon along a polyline whose half widths change smoothly: points every 3 m or less, each
// pushed out along the bisector of its two segments (scaled so the band keeps its width round
// bends, at most ×2) by its own left (-n side) and right (+n side) width. One continuous
// outline, so bends are round and width changes are gradual (no notched square ends).
function ribbon(pts, left, right) {
  const L = [], R = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], p = pts[i];
    const d1 = i > 0 ? norm(p[0] - a[0], p[1] - a[1]) : null, d2 = i + 1 < pts.length ? norm(b[0] - p[0], b[1] - p[1]) : null;
    const d = d1 && d2 ? norm(d1[0] + d2[0], d1[1] + d2[1]) || d2 : d1 || d2;
    if (!d) continue;
    // The bisector normal, lengthened by 1 / cos(half the turn) so the width holds round bends.
    const scale = d1 && d2 ? Math.min(2, 1 / Math.max(0.5, d1[0] * d[0] + d1[1] * d[1])) : 1, nx = -d[1] * scale, nz = d[0] * scale;
    L.push([p[0] - nx * left[i], p[1] - nz * left[i]]);
    R.push([p[0] + nx * right[i], p[1] + nz * right[i]]);
  }
  return L.length > 1 ? [path([...L, ...R.reverse()])] : [];
}
const norm = (x, z) => { const l = Math.hypot(x, z); return l > 1e-9 ? [x / l, z / l] : null; };
// Points every `step` metres or less along a polyline, each with its segment's index.
function densify(pts, step = 3) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) out.push({ p: [ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n], seg: i });
  }
  out.push({ p: pts[pts.length - 1], seg: pts.length - 2 });
  return out;
}
// Mean over ±k neighbours (widths change over a few metres, not at a vertex).
const smoothList = (v, k) => v.map((_, i) => { const w = v.slice(Math.max(0, i - k), i + k + 1); return w.reduce((a, b) => a + b, 0) / w.length; });
const maxList = (v, k) => v.map((_, i) => Math.max(...v.slice(Math.max(0, i - k), i + k + 1)));
// A shape grown outward by r (round corners).
function grow(paths, r) {
  if (!paths.length) return [];
  const co = new ClipperOffset(2, 0.08 * S), out = [];
  co.AddPaths(paths, JoinType.jtRound, EndType.etClosedPolygon);
  co.Execute(out, r * S);
  return out;
}
const square = (x0, z0, x1, z1) => [path([[x0, z0], [x1, z0], [x1, z1], [x0, z1]])];
// Clipper paths -> [[outer, ...holes]] in metres (closed rings).
function toMulti(paths) {
  if (!paths.length) return [];
  const c = new Clipper(), tree = new ClipperLib.PolyTree();
  c.AddPaths(paths, PolyType.ptSubject, true);
  c.Execute(ClipType.ctUnion, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  const ring = (p) => { const r = p.map(({ X, Y }) => [X / S, Y / S]); return r.length ? [...r, r[0]] : r; };
  return ClipperLib.JS.PolyTreeToExPolygons(tree).filter((e) => e.outer.length >= 3).map((e) => [ring(e.outer), ...e.holes.filter((h) => h.length >= 3).map(ring)]);
}
const within = (x, z, paths) => {
  // Nonzero winding over all paths (outers and holes wind oppositely after a union).
  let w = 0;
  const pt = { X: Math.round(x * S), Y: Math.round(z * S) };
  for (const p of paths) if (Clipper.PointInPolygon(pt, p) !== 0) w += Clipper.Orientation(p) ? 1 : -1;
  return w !== 0;
};

// ---- NVDB --------------------------------------------------------------------------------
// The focus area's full OSM (tools/fetch-focus.mjs): kerb lines, carriageway and island
// areas, squares and pedestrian areas with their surfaces.
const focusWays = (() => { try { return JSON.parse(fs.readFileSync(`${DATA}focus-raw.json`, 'utf8')).elements.filter((e) => e.type === 'way' && e.tags && e.geometry?.length > 1); } catch { return []; } })();
const wayPoints = (e) => e.geometry.map((g) => project(g.lat, g.lon));
const kerbLines = [
  ...nvdb('kerbs').filter((o) => /^LINESTRING/.test(o.wkt || '')).map((o) => wktPoints(o.wkt)),
  ...focusWays.filter((e) => e.tags.barrier === 'kerb').map(wayPoints),
].filter((p) => p.length > 1);
const kerbSegs = [];
for (const p of kerbLines) for (let i = 0; i + 1 < p.length; i++) {
  const [ax, az] = p[i], [bx, bz] = p[i + 1], len = Math.hypot(bx - ax, bz - az);
  if (len > 0.05) kerbSegs.push({ ax, az, bx, bz, dx: (bx - ax) / len, dz: (bz - az) / len, len });
}
const kerbGrid = grid(kerbSegs, (k) => [Math.min(k.ax, k.bx), Math.min(k.az, k.bz), Math.max(k.ax, k.bx), Math.max(k.az, k.bz)], 25);
// Distance along the ray from (x, z) in direction (nx, nz) to the first kerb running roughly
// parallel to (dx, dz), between `from` and `to` metres; Infinity if none.
function kerbAlong(x, z, nx, nz, dx, dz, from, to) {
  let best = Infinity;
  const ex = x + nx * to, ez = z + nz * to;
  for (const k of kerbGrid.near(Math.min(x, ex), Math.min(z, ez), Math.max(x, ex), Math.max(z, ez))) {
    if (Math.abs(k.dx * dx + k.dz * dz) < 0.85) continue;
    // Ray/segment intersection.
    const den = nx * (k.bz - k.az) - nz * (k.bx - k.ax);
    if (Math.abs(den) < 1e-9) continue;
    const t = ((k.ax - x) * (k.bz - k.az) - (k.az - z) * (k.bx - k.ax)) / den, u = ((k.ax - x) * nz - (k.az - z) * nx) / den;
    if (u >= 0 && u <= 1 && t >= from && t <= to && t < best) best = t;
  }
  return best;
}
// Crossing outlines (polygons) and lowered-kerb points.
const crossings = nvdb('crossings').filter((o) => /^POLYGON/.test(o.wkt || '')).map((o) => wktPoints(o.wkt)).filter((p) => p.length >= 4);
const crossingCentres = crossings.map((p) => p.reduce((a, q) => [a[0] + q[0] / p.length, a[1] + q[1] / p.length], [0, 0]));
const crossingGrid = grid(crossings.map((p, i) => ({ c: crossingCentres[i], p })), (c) => boxOfPoints(c.p), 50);
const lowered = nvdb('lowered-kerbs').filter((o) => /^POINT/.test(o.wkt || '')).map((o) => wktPoints(o.wkt)[0]).filter(Boolean);
const loweredGrid = grid(lowered, ([x, z]) => [x, z, x, z], 50);
// Longitudinal markings: colour and kind from the NVDB type.
const LINE_KINDS = [[/Kantlinje, heltrukket/, 'edge'], [/Kantlinje, stiplet/, 'edgeDash'], [/Skillelinje/, 'divider'], [/Varsellinje/, 'warning'], [/Sperrelinje/, 'barrier'], [/Kjørefeltlinje/, 'lane'], [/Sperreområde/, 'hatch']];
const markLines = nvdb('lines').filter((o) => /^LINESTRING/.test(o.wkt || '')).map((o) => {
  const type = o.props.Type || '', kind = LINE_KINDS.find(([re]) => re.test(type))?.[1];
  return kind && { c: o.props.Farge === 'Gul' ? 1 : 0, k: kind, p: wktPoints(o.wkt) };
}).filter((l) => l && l.p.length > 1);
const markGrid = grid(markLines, (l) => boxOfPoints(l.p), 60);
console.log(`NVDB: ${kerbSegs.length} kerb segments, ${crossings.length} crossings, ${lowered.length} lowered kerbs, ${markLines.length} marking lines`);

// Zebra bars inside a crossing outline: 0.5 m bars every 1 m across the street (the walking
// direction), each running along the traffic. The traffic direction is that of the nearest
// carriageway (an outline's longest side is not reliable: wide crossings are wider than the
// street is across).
let carSegGrid = null;
function trafficDirection(x, z) {
  if (!carSegGrid) {
    const segs = [];
    for (const r of cars) for (let i = 0; i + 1 < r.p.length; i++) {
      const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1], len = Math.hypot(bx - ax, bz - az);
      if (len > 0.1) segs.push({ ax, az, bx, bz, dx: (bx - ax) / len, dz: (bz - az) / len });
    }
    carSegGrid = grid(segs, (s) => [Math.min(s.ax, s.bx), Math.min(s.az, s.bz), Math.max(s.ax, s.bx), Math.max(s.az, s.bz)], 25);
  }
  let best = null, bestD = Infinity;
  for (const s of carSegGrid.near(x - 25, z - 25, x + 25, z + 25)) {
    const vx = s.bx - s.ax, vz = s.bz - s.az, t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (z - s.az) * vz) / (vx * vx + vz * vz))), d = Math.hypot(s.ax + vx * t - x, s.az + vz * t - z);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best && [best.dx, best.dz];
}
function zebraBars(p) {
  const cx = p.reduce((a, q) => a + q[0], 0) / p.length, cz = p.reduce((a, q) => a + q[1], 0) / p.length;
  const traffic = trafficDirection(cx, cz);
  if (!traffic) return [];
  // (dx, dz): the walking direction, across the street.
  const dx = -traffic[1], dz = traffic[0], along = p.map(([x, z]) => x * dx + z * dz), across = p.map(([x, z]) => -x * dz + z * dx);
  const a0 = Math.min(...along), a1 = Math.max(...along), c0 = Math.min(...across) - 1, c1 = Math.max(...across) + 1;
  const bars = [], outline = [path(p)];
  for (let a = a0 + 0.25; a + 0.5 <= a1 - 0.1; a += 1.0) {
    const corner = (u, v) => [u * dx - v * dz, u * dz + v * dx];
    bars.push(...and([path([corner(a, c0), corner(a + 0.5, c0), corner(a + 0.5, c1), corner(a, c1)])], outline));
  }
  return bars;
}

// ---- Inputs ----------------------------------------------------------------------------
// Surfaces: setts and cobbles, wooden decks, or paving (the default).
const surfaceOf = (sf) => (/sett|cobble|pebble/.test(sf || '') ? 'sett' : /wood/.test(sf || '') ? 'wood' : 'path');
const cars = data.roads.filter((r) => !PAVED.has(r.k) && !r.height && r.w > 0);
const items = [];
for (const r of cars) items.push({ kind: 'road', p: r.p, r, box: boxOfPoints(r.p, r.w / 2 + 8) });
for (const w of data.walks) {
  if (w.height || w.br) continue;
  const kind = w.k === 'sidewalk' ? 'sidewalk' : w.k === 'traffic_island' ? 'island' : w.k === 'crossing' ? 'crossing' : 'path';
  // NVDB outlines replace mapped crossings wherever both exist.
  if (kind === 'crossing') {
    const [cx, cz] = w.p[Math.floor(w.p.length / 2)];
    if (crossingGrid.near(cx - 8, cz - 8, cx + 8, cz + 8).some((c) => Math.hypot(c.c[0] - cx, c.c[1] - cz) < 8)) continue;
  }
  if (w.k === 'steps') continue;
  items.push({ kind, p: w.p, sf: surfaceOf(w.sf), w, box: boxOfPoints(w.p, w.w / 2 + 2) });
}
for (const r of data.roads.filter((q) => PAVED.has(q.k) && !q.height)) items.push({ kind: 'paved', p: r.p, r, box: boxOfPoints(r.p, r.w / 2 + 2) });
for (const s of data.sea || []) items.push({ kind: 'sea', p: s, box: boxOfPoints(s) });
// Bus and tram platforms are drawn by the game (raised, with their own kerbs): cut them out.
for (const st of data.stops || []) if (st.p) items.push({ kind: 'platform', p: st.p, box: boxOfPoints(st.p) });
const CARRIAGEWAY_AREAS = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'trunk', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'bus_stop']);
for (const e of focusWays) {
  const t = e.tags, p = wayPoints(e), closed = Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.3;
  if (!closed || p.length < 4) continue;
  const ring = p.slice(0, -1), ah = t['area:highway'];
  let kind = null;
  if (CARRIAGEWAY_AREAS.has(ah)) kind = 'roadArea';
  else if (ah === 'traffic_island') kind = 'islandArea';
  else if (['footway', 'pedestrian', 'cycleway', 'platform'].includes(ah) || (['pedestrian', 'footway'].includes(t.highway) && t.area === 'yes') || t.place === 'square') kind = 'pathArea';
  if (kind) items.push({ kind, p: ring, sf: surfaceOf(t.surface), box: boxOfPoints(ring) });
}
const itemGrid = grid(items, (it) => it.box, 60);

// Sidewalk width on each side of a road segment: to the facade where a building stands
// within 7 m of the kerb (median of three probes), else the usual width; none for roads
// that carry none or on the side the tags exclude.
// Half width of the carriageway on each side of a segment: to the NVDB kerb where one runs
// alongside (median of three probes, at least two hits), else half the estimated width.
function halfWidths(r, a, b) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len, dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
  return [-1, 1].map((side) => {
    const hits = [0.2, 0.5, 0.8].map((t) => kerbAlong(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, nx * side, nz * side, dx, dz, 1.4, r.w / 2 + 4)).filter((d) => d < Infinity).sort((p, q) => p - q);
    return hits.length >= 2 ? hits[hits.length >> 1] : r.w / 2;
  });
}
function sideWidths(r, a, b, halves) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
  const usual = ['primary', 'secondary', 'tertiary'].includes(r.k) ? 3.2 : 2.6;
  const excluded = NO_WALKS.has(r.k) || r.k.endsWith('_link');
  return [-1, 1].map((side) => {
    if (excluded || (r.sw === 'l' && side > 0) || (r.sw === 'r' && side < 0)) return 0;
    const found = [];
    for (const t of [0.2, 0.5, 0.8]) {
      const half = halves[side < 0 ? 0 : 1], x = a[0] + (b[0] - a[0]) * t + nx * side * half, z = a[1] + (b[1] - a[1]) * t + nz * side * half;
      let hit = Infinity;
      for (let d = 0.5; d <= 7; d += 0.5) if (inBuilding(x + nx * side * d, z + nz * side * d)) { hit = d; break; }
      found.push(hit);
    }
    found.sort((p, q) => p - q);
    const facade = found[1];
    // Untagged/"no" streets with a facade close by still get a walk (city streets are paved
    // wall to kerb); without one they get the usual width only where tags say so.
    if (facade < Infinity) return facade >= 1.2 ? facade + 0.3 : 0;
    return r.sw === 'n' ? 0 : usual;
  });
}

// ---- Per tile ----------------------------------------------------------------------------
const xs = [], zs = [];
for (const r of cars) for (const [x, z] of r.p) { xs.push(x); zs.push(z); }
const ix0 = Math.floor(Math.min(...xs) / TILE), ix1 = Math.floor(Math.max(...xs) / TILE), iz0 = Math.floor(Math.min(...zs) / TILE), iz1 = Math.floor(Math.max(...zs) / TILE);
const tiles = {};
let done = 0, failed = 0;
const total = (ix1 - ix0 + 1) * (iz1 - iz0 + 1), started = Date.now();
for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
  const x0 = ix * TILE, z0 = iz * TILE, x1 = x0 + TILE, z1 = z0 + TILE;
  const cell = square(x0, z0, x1, z1), wide = square(x0 - MARGIN, z0 - MARGIN, x1 + MARGIN, z1 + MARGIN);
  const near = itemGrid.near(x0 - MARGIN, z0 - MARGIN, x1 + MARGIN, z1 + MARGIN);
  done++;
  if (!near.length) continue;
  try {
    const roadPieces = [], walkPieces = [], islandPieces = [], crossPieces = [], seaPieces = [], areaRoads = [], platformPieces = [];
    const pathPieces = { path: [], sett: [], wood: [] };
    for (const it of near) {
      if (it.kind === 'road') {
        const r = it.r;
        // Widths per segment (kerbs from NVDB, walks to the facades), then per point along a
        // densified line, smoothed: the carriageway by a mean over ±6 m, the walks by the widest
        // within ±3 m then a mean (buildings are cut out afterwards, so erring wide is safe).
        const segs = [];
        for (let i = 0; i + 1 < it.p.length; i++) { const halves = halfWidths(r, it.p[i], it.p[i + 1]); segs.push({ halves, walks: sideWidths(r, it.p[i], it.p[i + 1], halves) }); }
        if (!segs.length) continue;
        const pts = densify(it.p), at = (k, side) => pts.map((q) => segs[Math.min(segs.length - 1, q.seg)][k][side]);
        const hl = smoothList(at('halves', 0), 2), hr = smoothList(at('halves', 1), 2);
        const wl = smoothList(maxList(at('walks', 0), 1), 1), wr = smoothList(maxList(at('walks', 1), 1), 1);
        const line = pts.map((q) => q.p);
        roadPieces.push(ribbon(line, hl, hr));
        if (wl.some((w) => w > 0) || wr.some((w) => w > 0)) walkPieces.push(ribbon(line, hl.map((h, i) => h + wl[i]), hr.map((h, i) => h + wr[i])));
        // Round ends and junction corners with the narrowest half width.
        const narrowRoad = Math.min(...hl, ...hr), narrowest = Math.min(...wl, ...wr);
        roadPieces.push(buffer(it.p, narrowRoad));
        if (narrowest > 0) walkPieces.push(buffer(it.p, narrowRoad + narrowest));
      } else if (it.kind === 'sidewalk') walkPieces.push(buffer(it.p, it.w.w / 2));
      else if (it.kind === 'island') islandPieces.push(buffer(it.p, it.w.w / 2));
      else if (it.kind === 'crossing') crossPieces.push(buffer(it.p, 1.5, EndType.etOpenButt));
      else if (it.kind === 'path') pathPieces[it.sf].push(buffer(it.p, it.w.w / 2));
      else if (it.kind === 'paved') pathPieces.path.push(buffer(it.p, it.r.w / 2));
      else if (it.kind === 'roadArea') areaRoads.push([path(it.p)]);
      else if (it.kind === 'platform') platformPieces.push([path(it.p)]);
      else if (it.kind === 'islandArea') islandPieces.push([path(it.p)]);
      else if (it.kind === 'pathArea') pathPieces[it.sf].push([path(it.p)]);
      else if (it.kind === 'sea') seaPieces.push([path(it.p)]);
    }
    const zebraPieces = [];
    for (const c of crossingGrid.near(x0 - MARGIN, z0 - MARGIN, x1 + MARGIN, z1 + MARGIN)) {
      crossPieces.push(grow([path(c.p)], 0.4));
      if (c.c[0] >= x0 && c.c[0] < x1 && c.c[1] >= z0 && c.c[1] < z1) zebraPieces.push(zebraBars(c.p));
    }
    for (const [x, z] of loweredGrid.near(x0 - MARGIN, z0 - MARGIN, x1 + MARGIN, z1 + MARGIN)) crossPieces.push(buffer([[x, z], [x + 0.01, z]], 1.4));
    const built = union(buildingGrid.near(x0 - MARGIN, z0 - MARGIN, x1 + MARGIN, z1 + MARGIN).map((b) => [path(b.p)]));
    const sea = and(union(seaPieces), wide), islands = and(union(islandPieces), wide);
    // Work on a slightly larger square so edges at the tile border are real, then cut.
    // Mapped carriageway areas join the buffered roads.
    const platforms = union(platformPieces);
    const roadWide = minus(and(union([...roadPieces, ...areaRoads]), wide), islands, platforms);
    const walkWide = minus(and(union([...walkPieces, ...islandPieces]), wide), roadWide, built, sea, platforms);
    // Dropped kerbs: crossing outlines and lowered-kerb points, only where they meet the
    // sidewalk within 2.5 m of the carriageway.
    const nearRoad = grow(roadWide, 2.5);
    const dropWide = and(and(union(crossPieces), walkWide), nearRoad);
    const walkOnly = minus(walkWide, dropWide);
    const road = and(roadWide, cell), walk = and(walkOnly, cell), drop = and(dropWide, cell);
    // Paths and squares by surface; setts and wood win over plain paving where they overlap.
    let placed = [...roadWide, ...walkWide, ...platforms];
    const surfaces = {};
    for (const sf of ['sett', 'wood', 'path']) {
      surfaces[sf] = minus(and(union(pathPieces[sf]), cell), placed, built, sea);
      placed = [...placed, ...surfaces[sf]];
    }
    // Kerb edges: each walk edge inside the tile, by what lies just outside it.
    const kerbs = [];
    const walkRings = toMulti(walk);
    for (const poly of walkRings) for (const ring of poly) for (let i = 0; i + 1 < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[i + 1], len = Math.hypot(bx - ax, bz - az);
      if (len < 0.02) continue;
      const onBorder = (ax === bx && (ax === x0 || ax === x1)) || (az === bz && (az === z0 || az === z1));
      if (onBorder) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, nx = -(bz - az) / len, nz = (bx - ax) / len;
      // The side of the edge that is outside the walk.
      const s = within(mx + nx * 0.05, mz + nz * 0.05, walkOnly) ? -1 : 1, ox = mx + nx * s * 0.25, oz = mz + nz * s * 0.25;
      if (within(ox, oz, built)) continue;
      const kind = within(ox, oz, roadWide) ? 0 : within(ox, oz, dropWide) ? 1 : 2;
      const edge = [round(ax), round(az), round(bx), round(bz), kind];
      // Edges that collapse once rounded to 2 cm would have no direction.
      if (edge[0] !== edge[2] || edge[1] !== edge[3]) kerbs.push(edge);
    }
    const out = {};
    for (const [name, multi] of Object.entries({ drop: toMulti(drop), path: toMulti(surfaces.path), road: toMulti(road), sett: toMulti(surfaces.sett), walk: walkRings, wood: toMulti(surfaces.wood), zebra: toMulti(and(union(zebraPieces), roadWide)) })) if (multi.length) out[name] = multi;
    // Markings: NVDB lines whose middle point falls in this tile.
    const lines = markGrid.near(x0, z0, x1, z1).filter((l) => { const [mx, mz] = l.p[l.p.length >> 1]; return mx >= x0 && mx < x1 && mz >= z0 && mz < z1; });
    if (lines.length) out.lines = lines.map((l) => ({ c: l.c, k: l.k, p: l.p.map(([x, z]) => [round(x), round(z)]) }));
    if (kerbs.length) out.kerbs = kerbs;
    if (Object.keys(out).length) tiles[`${ix}|${iz}`] = out;
  } catch (err) {
    failed++;
    console.warn(`tile ${ix}|${iz} failed: ${err.stack.split("\n").slice(0, 4).join(" <- ")}`);
  }
  if (done % 20 === 0) console.log(`${done}/${total} tiles, ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
fs.writeFileSync(`${DATA}streets.json`, JSON.stringify({ crossings: crossings.map((p) => p.map(([x, z]) => [round(x), round(z)])), tile: TILE, tiles }));
console.log(`streets: ${Object.keys(tiles).length} tiles, ${failed} failed, ${((Date.now() - started) / 1000).toFixed(0)} s`);
