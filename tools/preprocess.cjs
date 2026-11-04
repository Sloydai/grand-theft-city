// Converts raw Overpass JSON into compact local-meter game data (data/<city>/world.json).
// Origin is the city's "origin" (in Oslo near Stortinget); +x = east, -z = north (three.js
// ground plane).
const fs = require('fs');
const path = require('path');
const CITY = require('./city.cjs');

const dir = CITY.DATA;
const raw = JSON.parse(fs.readFileSync(path.join(dir, 'base-raw.json'), 'utf8'));
const coast = JSON.parse(fs.readFileSync(path.join(dir, 'coast-raw.json'), 'utf8'));
const rail = JSON.parse(fs.readFileSync(path.join(dir, 'rail-raw.json'), 'utf8'));
const extra = JSON.parse(fs.readFileSync(path.join(dir, 'extra-raw.json'), 'utf8'));
const signalData = JSON.parse(fs.readFileSync(path.join(dir, 'signals-raw.json'), 'utf8'));
const treeData = JSON.parse(fs.readFileSync(path.join(dir, 'trees-raw.json'), 'utf8'));
const routeData = JSON.parse(fs.readFileSync(path.join(dir, 'routes-raw.json'), 'utf8'));

const { BOX, KX, KZ, LAT0, LON0 } = CITY;

const project = (lat, lon) => [round((lon - LON0) * KX), round(-(lat - LAT0) * KZ)];
const round = (v) => Math.round(v * 10) / 10;
const inBox = (g) => {
  const lat = g.reduce((s, p) => s + p.lat, 0) / g.length;
  const lon = g.reduce((s, p) => s + p.lon, 0) / g.length;
  return lat > BOX.minLat && lat < BOX.maxLat && lon > BOX.minLon && lon < BOX.maxLon;
};
const hash = (n) => {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const ROAD_WIDTHS = {
  busway: 7, living_street: 6, pedestrian: 7, primary: 13, residential: 8, road: 8, secondary: 11,
  service: 5, street: 8, tertiary: 10, trunk: 15, trunk_link: 8, unclassified: 8,
};
const WALK_WIDTHS = { cycleway: 2.5, footway: 2.5, path: 2, platform: 3, steps: 3 };
const DRIVABLE = new Set([
  'busway', 'living_street', 'primary', 'residential', 'road', 'secondary', 'service', 'street',
  'tertiary', 'trunk', 'trunk_link', 'unclassified',
]);

const buildings = [];

// Wall height, roof height and roof shape from the OSM 3D building tags.
const ROOF_SHAPES = new Set(['dome', 'gabled', 'gambrel', 'half-hipped', 'hipped', 'mansard', 'pyramidal', 'round', 'saltbox', 'skillion']);
const COLOURS = { beige: '#d8c8a8', black: '#2b2b2b', brown: '#7a5236', gray: '#9a9a9a', green: '#4e7a5a', grey: '#9a9a9a', orange: '#d9894a', red: '#a3402f', white: '#efece4', yellow: '#e2c46a' };
const colour = (v) => (v ? COLOURS[v.toLowerCase()] || (/^#[0-9a-f]{6}$/i.test(v) ? v : undefined) : undefined);
// Sidewalks a road carries itself (not mapped as separate ways): 'b' both, 'l' left, 'r'
// right, 'n' none or mapped separately, undefined when the road says nothing.
function sidewalkSides(tags) {
  const both = tags['sidewalk:both'], left = tags['sidewalk:left'], right = tags['sidewalk:right'], sw = tags.sidewalk;
  const has = (v) => v && v !== 'no' && v !== 'none' && v !== 'separate';
  if (sw === 'both' || sw === 'yes' || has(both)) return 'b';
  if (has(left) && has(right)) return 'b';
  if (sw === 'left' || has(left)) return 'l';
  if (sw === 'right' || has(right)) return 'r';
  if (sw || both || left || right) return 'n';
  return undefined;
}
// Facade colours sampled from geotagged street photos (tools/facade-colours.mjs).
const FACADE_COLOURS = fs.existsSync(path.join(dir, 'facade-colours.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'facade-colours.json'))) : {};
function shapeOf(tags, id) {
  const levels = parseFloat(tags['building:levels']) || 0;
  const roofLevels = parseFloat(tags['roof:levels']) || 0;
  const shape = ROOF_SHAPES.has(tags['roof:shape']) ? tags['roof:shape'] : 'flat';
  let roof = parseFloat(tags['roof:height']) || (roofLevels ? roofLevels * 2.8 : shape === 'flat' ? 0 : 3.5);
  let total = parseFloat(tags.height);
  if (!total) total = levels ? levels * 3.1 + 0.8 + roof : 9 + hash(id) * 12 + roof;
  total = Math.min(total, 120);
  roof = Math.min(roof, total * 0.6);
  const min = parseFloat(tags.min_height) || (parseFloat(tags['building:min_level']) || 0) * 3.1;
  // Some parts give height relative to their own base (height < min_height): make it absolute.
  if (min > 0 && total <= min + 0.1) total = Math.min(120, total + min);
  return {
    bt: tags.building && tags.building !== 'yes' ? tags.building : tags['building:part'] && tags['building:part'] !== 'yes' ? tags['building:part'] : undefined,
    c: colour(tags['building:colour']) || FACADE_COLOURS[id], h: round(total - roof), m: tags['building:material'] || undefined, rm: tags['roof:material'] || undefined, l: levels || Math.max(1, Math.round((total - roof) / 3.2)), mh: round(min) || undefined,
    o: tags['roof:orientation'] === 'across' ? 1 : undefined, r: shape === 'flat' ? undefined : shape, rc: colour(tags['roof:colour']), rh: roof ? round(roof) : undefined,
  };
}
const roads = [];
const walks = [];
const parks = [];
const water = [];
const nodes = {};
const edges = [];
const walkEdges = [];

const addNode = (id, p) => { nodes[id] = p; };

for (const e of raw.elements) {
  const tags = e.tags || {};
  if (e.type === 'relation') {
    if (tags.natural === 'water') {
      for (const m of e.members) {
        if (m.role === 'outer' && m.geometry && inBox(m.geometry)) {
          water.push(m.geometry.map((g) => project(g.lat, g.lon)));
        }
      }
    }
    continue;
  }
  const g = e.geometry;
  if (!g || g.length < 2) continue;
  const p = g.map((n) => project(n.lat, n.lon));

  if (tags.building) {
    if (!inBox(g) || g.length < 4) continue;
    if (tags.layer && +tags.layer < 0) continue;
    if (tags.building === 'roof') continue;
    buildings.push({ ...shapeOf(tags, e.id), id: e.id, n: tags.name || undefined, p: p.slice(0, -1), s: Math.floor(hash(e.id + 7) * 1000) });
  } else if (tags.highway) {
    if (tags.tunnel || (tags.layer && +tags.layer < 0) || tags.indoor) continue;
    if (!inBox(g)) continue;
    const kind = tags.highway;
    if (ROAD_WIDTHS[kind]) {
      const oneway = tags.oneway === 'yes' || tags.junction === 'roundabout';
      // Width from the lane count when mapped (3.2 m lanes), else a default per road class.
      const lanes = parseInt(tags.lanes, 10) || 0;
      const width = lanes ? Math.max(ROAD_WIDTHS[kind] * 0.7, lanes * 3.2 + 1) : ROAD_WIDTHS[kind];
      // Lane details for markings: lanes per direction, turn arrows, painted cycle lanes,
      // and whether the road has markings at all.
      const cyc = (side) => ['lane', 'shoulder'].includes(tags[`cycleway:${side}`]) || ['lane', 'shoulder'].includes(tags['cycleway:both']) || (side === 'right' && tags.cycleway === 'lane') || (side === 'left' && tags.cycleway === 'lane' && !oneway);
      const tagWidth = parseFloat(tags.width) || 0;
      // Signed destinations (destination, destination:lanes), for direction signs.
      const dest = [...new Set(['destination', 'destination:lanes', 'destination:forward'].flatMap((k) => (tags[k] || '').split(/[;|]/)).map((v) => v.trim()).filter(Boolean))].slice(0, 3);
      roads.push({
        br: tags.bridge && tags.bridge !== 'no' ? 1 : undefined, ly: parseInt(tags.layer, 10) || undefined, sw: sidewalkSides(tags), cl: cyc('left') ? 1 : undefined, cr: cyc('right') ? 1 : undefined, d: dest.length ? dest : undefined, k: kind, l: lanes || undefined,
        lb: parseInt(tags['lanes:backward'], 10) || undefined, lf: parseInt(tags['lanes:forward'], 10) || undefined,
        m: tags.lane_markings === 'no' ? 0 : undefined, n: tags.name || undefined, o: oneway ? 1 : 0, p,
        v: parseInt(tags.maxspeed, 10) || undefined,
        t: tags['turn:lanes'] || undefined, tb: tags['turn:lanes:backward'] || undefined, tf: tags['turn:lanes:forward'] || undefined,
        w: round(tagWidth > 3 ? tagWidth : width),
      });
      if (DRIVABLE.has(kind) && kind !== 'service') {
        e.nodes.forEach((id, i) => addNode(id, p[i]));
        for (let i = 0; i + 1 < e.nodes.length; i++) edges.push([e.nodes[i], e.nodes[i + 1], oneway ? 1 : 0, ROAD_WIDTHS[kind]]);
      }
      if (kind === 'pedestrian' || kind === 'living_street' || kind === 'residential') {
        e.nodes.forEach((id, i) => addNode(id, p[i]));
        for (let i = 0; i + 1 < e.nodes.length; i++) walkEdges.push([e.nodes[i], e.nodes[i + 1]]);
      }
    } else if (WALK_WIDTHS[kind]) {
      // Sidewalks, crossings and traffic islands keep their footway type for street detail.
      const sub = ['crossing', 'sidewalk', 'traffic_island'].includes(tags.footway) ? tags.footway : kind;
      // Steps keep their count and direction (incline up/down from the first node), and
      // every walk its surface, for real stairs and paving.
      const steps = kind === 'steps' ? { inc: /^(up|down)$/.test(tags.incline || '') ? tags.incline : undefined, sc: parseInt(tags.step_count, 10) || undefined } : {};
      walks.push({ ...steps, br: tags.bridge && tags.bridge !== 'no' ? 1 : undefined, k: sub, ly: parseInt(tags.layer, 10) || undefined, p, sf: tags.surface, w: parseFloat(tags.width) || (sub === 'sidewalk' ? 3 : sub === 'crossing' ? 3.2 : WALK_WIDTHS[kind]) });
      if (kind === 'footway' || kind === 'pedestrian' || kind === 'path') {
        e.nodes.forEach((id, i) => addNode(id, p[i]));
        for (let i = 0; i + 1 < e.nodes.length; i++) walkEdges.push([e.nodes[i], e.nodes[i + 1]]);
      }
    }
  } else if (tags.leisure === 'park') {
    if (inBox(g)) parks.push(p);
  } else if (tags.natural === 'water') {
    if (inBox(g)) water.push(p);
  }
}

// Join coastline ways (land on the left) into chains; open chains become sea polygons
// closed along the south, closed loops are islands drawn as land on top of the sea.
const chains = coast.elements.map((e) => ({ first: e.nodes[0], last: e.nodes[e.nodes.length - 1], pts: e.geometry.map((g) => [g.lat, g.lon]) }));
let merged = true;
while (merged) {
  merged = false;
  for (const a of chains) {
    if (a.first === a.last) continue;
    const b = chains.find((c) => c !== a && c.first === a.last);
    if (b) {
      a.pts = a.pts.concat(b.pts.slice(1));
      a.last = b.last;
      chains.splice(chains.indexOf(b), 1);
      merged = true;
      break;
    }
  }
}
const islands = [];
const sea = [];
for (const c of chains) {
  if (c.first === c.last) {
    islands.push(c.pts.map(([lat, lon]) => project(lat, lon)));
  } else if (c.pts.length > 50) {
    const start = c.pts[0];
    const end = c.pts[c.pts.length - 1];
    const southLat = BOX.minLat - 0.012;
    const loop = c.pts.concat([[southLat, end[1]], [southLat, start[1]]]);
    sea.push(loop.map(([lat, lon]) => project(lat, lon)));
  }
}

// Building parts, ground cover and piers.
const parts = [];
const ground = {};
const GROUND = (t) => {
  if (t['building:part']) return null;
  if (t.man_made === 'pier' || t.man_made === 'breakwater' || t.man_made === 'bridge') return 'pier';
  if (t.natural === 'wood' || t.natural === 'scrub') return 'wood';
  if (t.natural === 'beach' || t.natural === 'sand') return 'sand';
  if (t.natural === 'bare_rock') return 'rock';
  if (t.leisure === 'pitch') return 'pitch';
  if (t.leisure === 'playground') return 'playground';
  if (t.landuse === 'flowerbed') return 'flowers';
  if (t.leisure === 'garden' || t.leisure === 'park' || ['grass', 'village_green', 'recreation_ground', 'cemetery', 'allotments', 'meadow'].includes(t.landuse) || t.natural === 'grassland') return 'grass';
  if (t.amenity === 'parking' || (t['area:highway'] && !['pedestrian', 'footway', 'steps', 'cycleway', 'traffic_island', 'platform'].includes(t['area:highway']))) return 'asphalt';
  if (t['area:highway'] || (t.highway && t.area === 'yes') || t.place === 'square' || t.amenity === 'marketplace') return 'paving';
  if (['residential', 'commercial', 'retail', 'industrial', 'railway', 'construction', 'brownfield'].includes(t.landuse)) return 'urban';
  if (t.waterway) return null;
  return null;
};
for (const e of extra.elements) {
  const t = e.tags || {};
  const g = e.geometry;
  if (!g || g.length < 3) continue;
  const closed = e.nodes && e.nodes[0] === e.nodes[e.nodes.length - 1];
  if (t['building:part']) {
    // Free-standing canopies (building:part=roof) have no columns in OSM, so they would float.
    if (!closed || !inBox(g) || (t.layer && +t.layer < 0) || t['building:part'] === 'roof') continue;
    parts.push({ ...shapeOf(t, e.id), p: g.slice(0, -1).map((n) => project(n.lat, n.lon)), s: Math.floor(hash(e.id + 7) * 1000) });
    continue;
  }
  const kind = GROUND(t);
  if (!kind || !closed) continue;
  (ground[kind] ||= []).push(g.slice(0, -1).map((n) => project(n.lat, n.lon)));
}
// Multipolygon buildings and parts (city blocks, often with courtyards): member ways are
// joined into closed rings; inner rings become courtyard holes of the outer ring they sit in.
const relations = fs.existsSync(path.join(dir, 'building-rel-raw.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'building-rel-raw.json'), 'utf8')).elements : [];
function joinRings(ways) {
  const key = (n) => `${n.lat.toFixed(7)},${n.lon.toFixed(7)}`;
  const open = ways.filter((w) => w && w.length >= 2).map((w) => w.slice());
  const rings = [];
  while (open.length) {
    let ring = open.shift();
    for (let guard = 0; key(ring[0]) !== key(ring[ring.length - 1]) && guard < 500; guard++) {
      const end = key(ring[ring.length - 1]);
      const i = open.findIndex((w) => key(w[0]) === end || key(w[w.length - 1]) === end);
      if (i < 0) break;
      const [w] = open.splice(i, 1);
      ring = ring.concat((key(w[0]) === end ? w : w.slice().reverse()).slice(1));
    }
    if (ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}
const insideRing = (x, z, p) => {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
  }
  return inside;
};
// Ways that are the outline of a multipolygon building are drawn from the relation instead.
const relationOutlines = new Set(relations.flatMap((r) => r.members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => m.ref)));
for (let i = buildings.length - 1; i >= 0; i--) if (relationOutlines.has(buildings[i].id)) buildings.splice(i, 1);
let relationBuildings = 0;
for (const r of relations) {
  const t = r.tags || {};
  if (t.layer && +t.layer < 0) continue;
  const ringsOf = (role) => joinRings(r.members.filter((m) => m.type === 'way' && (m.role || 'outer') === role).map((m) => m.geometry));
  const inners = ringsOf('inner').map((g) => g.slice(0, -1).map((n) => project(n.lat, n.lon)));
  for (const outer of ringsOf('outer')) {
    if (!inBox(outer)) continue;
    const p = outer.slice(0, -1).map((n) => project(n.lat, n.lon));
    const holes = inners.filter((h) => insideRing(h[0][0], h[0][1], p));
    const shape = { ...shapeOf(t, r.id), holes: holes.length ? holes : undefined, p, s: Math.floor(hash(r.id + 7) * 1000) };
    if (t['building:part']) { if (t['building:part'] !== 'roof') parts.push(shape); }
    else if (t.building !== 'roof') { buildings.push({ ...shape, n: t.name || undefined }); relationBuildings++; }
  }
}
console.log('multipolygon buildings', relationBuildings);
// A building drawn as parts is rendered from its parts only (its outline stays the collider).
const insidePoly = (x, z, p) => {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
  }
  return inside;
};
for (const part of parts) {
  const cx = part.p.reduce((s, q) => s + q[0], 0) / part.p.length, cz = part.p.reduce((s, q) => s + q[1], 0) / part.p.length;
  const owner = buildings.find((b) => insidePoly(cx, cz, b.p));
  if (owner) owner.parts = 1;
}

// Above-ground tram and train tracks, with node ids so vehicles can follow the network.
const trams = [];
const rails = [];
const railNodes = {};
const RAIL_BOX = { maxLat: BOX.maxLat + 0.0015, maxLon: BOX.maxLon + 0.005, minLat: BOX.minLat - 0.002, minLon: BOX.minLon - 0.005 };
for (const e of rail.elements) {
  const t = e.tags || {};
  if (t.tunnel || (t.layer && +t.layer < 0) || !e.geometry) continue;
  const lat = e.geometry.reduce((sum, g) => sum + g.lat, 0) / e.geometry.length;
  const lon = e.geometry.reduce((sum, g) => sum + g.lon, 0) / e.geometry.length;
  if (lat < RAIL_BOX.minLat || lat > RAIL_BOX.maxLat || lon < RAIL_BOX.minLon || lon > RAIL_BOX.maxLon) continue;
  const list = t.railway === 'tram' ? trams : t.railway === 'rail' ? rails : null;
  if (!list) continue;
  const p = e.geometry.map((g) => project(g.lat, g.lon));
  e.nodes.forEach((id, i) => { railNodes[id] = p[i]; });
  // s = 1 for crossovers, sidings, spurs and yards: drawn, but not used for routing.
  list.push({ n: e.nodes, p, s: t.service ? 1 : 0 });
}

// Public transport routes: chain each relation's ways into one path, keep the longest
// stretch inside the map, and place its stops (with real names) along that stretch.
const [areaMinX, areaMaxZ] = project(BOX.minLat, BOX.minLon), [areaMaxX, areaMinZ] = project(BOX.maxLat, BOX.maxLon);
const AREA = { maxX: areaMaxX, maxZ: areaMaxZ, minX: areaMinX, minZ: areaMinZ };
// Points of a route farther than this from any surface road/track are in a tunnel.
const SURFACE_RANGE = 9;
function surfaceIndex(lines) {
  const cells = new Map(), C = 25;
  for (const l of lines) for (const [x, z] of l.p) {
    const k = `${Math.floor(x / C)}|${Math.floor(z / C)}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(l);
  }
  return (x, z) => {
    for (let ix = Math.floor(x / C) - 1; ix <= Math.floor(x / C) + 1; ix++) {
      for (let iz = Math.floor(z / C) - 1; iz <= Math.floor(z / C) + 1; iz++) {
        for (const l of cells.get(`${ix}|${iz}`) || []) {
          for (let i = 0; i + 1 < l.p.length; i++) {
            const [ax, az] = l.p[i], [bx, bz] = l.p[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
            if (Math.hypot(ax + dx * t - x, az + dz * t - z) < SURFACE_RANGE) return true;
          }
        }
      }
    }
    return false;
  };
}
const onSurface = { bus: surfaceIndex(roads), tram: surfaceIndex(trams) };
const stopNames = new Map(routeData.elements.filter((e) => e.type === 'node').map((e) => [e.id, e.tags?.name]));
const routes = [];
for (const r of routeData.elements.filter((e) => e.type === 'relation')) {
  const ways = r.members.filter((m) => m.type === 'way' && !m.role.startsWith('platform') && m.geometry?.length > 1)
    .map((m) => m.geometry.map((g) => project(g.lat, g.lon)));
  if (!ways.length) continue;
  const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 2;
  let chain = ways[0].slice();
  if (ways[1] && (same(chain[0], ways[1][0]) || same(chain[0], ways[1][ways[1].length - 1]))) chain.reverse();
  for (const w of ways.slice(1)) {
    const end = chain[chain.length - 1];
    if (same(end, w[0])) chain.push(...w.slice(1));
    else if (same(end, w[w.length - 1])) chain.push(...w.slice(0, -1).reverse());
    else if (same(chain[0], w[w.length - 1]) || same(chain[0], w[0])) continue;
    else chain.push(null, ...w);
  }
  // Longest gap-free run inside the map.
  let best = [], run = [];
  const flush = () => {
    let len = 0;
    for (let i = 1; i < run.length; i++) len += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
    if (len > (best.len || 0)) { best = run; best.len = len; }
    run = [];
  };
  for (const q of chain) {
    if (!q || q[0] < AREA.minX || q[0] > AREA.maxX || q[1] < AREA.minZ || q[1] > AREA.maxZ || !onSurface[r.tags.route](q[0], q[1])) { flush(); continue; }
    if (!run.length || Math.hypot(q[0] - run[run.length - 1][0], q[1] - run[run.length - 1][1]) > 0.5) run.push(q);
  }
  flush();
  const minLength = r.tags.route === 'tram' ? 400 : 500;
  if (!best.len || best.len < minLength) continue;
  const cum = [0];
  for (let i = 1; i < best.length; i++) cum.push(cum[i - 1] + Math.hypot(best[i][0] - best[i - 1][0], best[i][1] - best[i - 1][1]));
  const stops = [];
  for (const m of r.members.filter((x) => x.type === 'node' && x.role.startsWith('stop'))) {
    const [x, z] = project(m.lat, m.lon);
    let bestD = 30, at = null;
    for (let i = 0; i + 1 < best.length; i++) {
      const [ax, az] = best[i], [bx, bz] = best[i + 1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (d < bestD) { bestD = d; at = cum[i] + t * Math.sqrt(l2); }
    }
    if (at !== null) stops.push({ n: stopNames.get(m.ref) || '', s: round(at), x, z });
  }
  stops.sort((a, b) => a.s - b.s);
  routes.push({ c: r.tags.colour || '', m: r.tags.route, p: best, ref: r.tags.ref || '', stops, to: r.tags.to || r.tags.name || '' });
}

// Stops: every bus and tram platform of the routes, where riders actually wait. A platform
// takes the name of the stop it follows in the route, and lists the routes calling there.
//   k: 'bus' | 'tram', n: name, p: outline (platform areas) or null, x/z: centre,
//   r: route refs, sh: shelter, b: bench.
const wayTags = new Map(routeData.elements.filter((e) => e.type === 'way').map((e) => [e.id, e.tags || {}]));
const nodeTags = new Map(routeData.elements.filter((e) => e.type === 'node').map((e) => [e.id, e.tags || {}]));
const stopsById = new Map();
for (const r of routeData.elements.filter((e) => e.type === 'relation')) {
  let name = '';
  for (const m of r.members) {
    if (m.type === 'node' && m.role.startsWith('stop')) name = stopNames.get(m.ref) || name;
    if (!m.role.startsWith('platform')) continue;
    const t = (m.type === 'way' ? wayTags : nodeTags).get(m.ref) || {};
    const key = `${m.type}${m.ref}`;
    let stop = stopsById.get(key);
    if (!stop) {
      const pts = m.type === 'way' ? (m.geometry || []).map((g) => project(g.lat, g.lon)) : m.lat ? [project(m.lat, m.lon)] : [];
      if (!pts.length) continue;
      const ring = pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.5 ? pts.slice(0, -1) : null;
      const x = pts.reduce((a, q) => a + q[0], 0) / pts.length, z = pts.reduce((a, q) => a + q[1], 0) / pts.length;
      if (x < AREA.minX || x > AREA.maxX || z < AREA.minZ || z > AREA.maxZ) continue;
      stop = { b: t.bench === 'yes' ? 1 : 0, k: r.tags.route === 'tram' || t.tram === 'yes' ? 'tram' : 'bus', n: t.name || name, p: ring && ring.map((q) => q.map(round)), r: [], sh: /^(yes|basic_hut)$/.test(t.shelter || '') ? 1 : 0, x: round(x), z: round(z) };
      stopsById.set(key, stop);
    }
    if (r.tags.route === 'tram') stop.k = 'tram';
    if (r.tags.ref && !stop.r.includes(r.tags.ref)) stop.r.push(r.tags.ref);
  }
}
const stops = [...stopsById.values()];
for (const st of stops) st.r.sort((a, b) => (parseInt(a, 10) || 999) - (parseInt(b, 10) || 999) || a.localeCompare(b));

// Individual trees: [x, z, needle (0/1), height or 0]. Tree rows become a tree every 8 m.
const trees = [];
for (const e of treeData.elements) {
  const t = e.tags || {};
  const needle = t.leaf_type === 'needleleaved' ? 1 : 0;
  const height = parseFloat(t.height) || 0;
  if (e.type === 'node') trees.push([...project(e.lat, e.lon), needle, height]);
  else if (e.geometry) {
    const p = e.geometry.map((g) => project(g.lat, g.lon));
    for (let i = 0; i + 1 < p.length; i++) {
      const len = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
      for (let d = 0; d < len; d += 8) trees.push([round(p[i][0] + ((p[i + 1][0] - p[i][0]) * d) / len), round(p[i][1] + ((p[i + 1][1] - p[i][1]) * d) / len), needle, height]);
    }
  }
}

// Traffic control nodes: signalled junction approaches (j), signalled crossings (c),
// zebra crossings (z), give-way (g). The id ties them to the road graph.
const signals = [];
for (const e of signalData.elements) {
  const t = e.tags || {};
  let k = null;
  if (t.highway === 'traffic_signals') k = 'j';
  else if (t.highway === 'crossing' && (t.crossing === 'traffic_signals' || t['crossing:signals'] === 'yes')) k = 'c';
  else if (t.highway === 'crossing' && (t.crossing === 'uncontrolled' || t.crossing === 'zebra' || t.crossing_ref === 'zebra' || t.crossing === 'marked')) k = 'z';
  else if (t.highway === 'give_way') k = 'g';
  if (!k || !nodes[e.id]) continue;
  signals.push({ id: e.id, k, p: project(e.lat, e.lon) });
}

const landmarks = [
  ['Akershus festning', 59.9071, 10.7363],
  ['Aker Brygge', 59.9100, 10.7275],
  ['Domkirken', 59.9123, 10.7465],
  ['Nationaltheatret', 59.9146, 10.7347],
  ['Operahuset', 59.9075, 10.7531],
  ['Oslo Rådhus', 59.9119, 10.7337],
  ['Oslo S', 59.9110, 10.7503],
  ['Slottet', 59.9169, 10.7275],
  ['Stortinget', 59.9132, 10.7404],
  ['Youngstorget', 59.9152, 10.7488],
].map(([n, lat, lon]) => ({ n, p: project(lat, lon) }));

// Street detail (tools/fetch-street-detail.mjs): barriers along ways, bollards, artworks,
// and named shops and cafés for shop signs.
const barriers = [], bollards = [], artworks = [], pois = [];
if (fs.existsSync(path.join(dir, 'street-raw.json'))) {
  const POI_KIND = (t) => t.shop ? 'shop' : t.amenity || (t.tourism === 'hotel' ? 'hotel' : t.office ? 'office' : 'shop');
  for (const e of JSON.parse(fs.readFileSync(path.join(dir, 'street-raw.json'), 'utf8')).elements) {
    const t = e.tags || {};
    if (e.type === 'way' && t.barrier && e.geometry && e.geometry.some((n) => inBox([n]))) {
      barriers.push({ h: parseFloat(t.height) || undefined, k: t.barrier, p: e.geometry.map((n) => project(n.lat, n.lon)) });
    } else if (e.type === 'node' && inBox([e])) {
      const [x, z] = project(e.lat, e.lon);
      if (t.barrier === 'bollard' || t.barrier === 'block') bollards.push([x, z, t.barrier === 'block' ? 1 : 0]);
      else if (t.tourism === 'artwork' || t.historic) artworks.push({ k: t.artwork_type || t.historic, l: parseFloat(t.length) || undefined, m: t.material || undefined, n: t.name || undefined, x, z });
      else if (t.name && t.office === undefined) pois.push({ b: t.brand || undefined, k: POI_KIND(t), n: t.name, x, z });
    }
  }
}
console.log('barriers', barriers.length, 'bollards', bollards.length, 'artworks', artworks.length, 'pois', pois.length);
// Measured heights (tools/elevation.mjs: Kartverket surface minus terrain, 90th percentile
// over the roof) replace OSM's estimates; the roof shape and its share are kept.
if (fs.existsSync(path.join(dir, 'building-heights.json'))) {
  const measured = JSON.parse(fs.readFileSync(path.join(dir, 'building-heights.json'), 'utf8'));
  let used = 0;
  for (const b of buildings) {
    const m = measured[`${Math.round(b.p[0][0] * 10)},${Math.round(b.p[0][1] * 10)}`];
    if (!m || m[1] < 2.5 || m[1] > 130) continue;
    const roof = Math.min(b.rh || 0, m[1] * 0.4), wall = Math.max(2, m[1] - roof);
    if (Math.abs(wall - b.h) > 3) b.l = Math.max(1, Math.round(wall / 3.2));
    b.h = round(wall);
    if (b.rh) b.rh = round(roof);
    used++;
  }
  console.log('measured building heights', used);
}
for (const b of buildings) delete b.id;
const facades = [...new Set(Object.values(FACADE_COLOURS))].sort();
// Mapped fountains (amenity=fountain areas): [x, z, radius], one per place.
const fountains = [];
for (const src of [raw, extra]) for (const e of src.elements) {
  if (e.tags?.amenity !== 'fountain' || e.type !== 'way' || !e.geometry) continue;
  const p = e.geometry.map((g) => project(g.lat, g.lon)), cx = p.reduce((a, q) => a + q[0], 0) / p.length, cz = p.reduce((a, q) => a + q[1], 0) / p.length;
  const r = Math.max(...p.map((q) => Math.hypot(q[0] - cx, q[1] - cz)));
  if (r >= 1.2 && !fountains.some((f) => Math.hypot(f[0] - cx, f[1] - cz) < 3)) fountains.push([round(cx), round(cz), round(r)]);
}
const out = { artworks, fountains, barriers, bollards, buildings, edges, facades, ground, signals, trees, islands, landmarks, nodes, parks, parts, pois, rails, railNodes, roads, routes, sea, stops, trams, walkEdges, walks, water };
// The city's name and its points of interest for the game, in game coordinates.
const at = (p) => (p ? project(p.lat, p.lon) : null);
const cfg = CITY.city;
out.city = { centre: at(cfg.centre) || [0, 0], name: cfg.name, title: cfg.title, spawn: cfg.spawn ? { face: at(cfg.spawn.face), p: at(cfg.spawn) } : null, station: at(cfg.station) };
fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify(out));
console.log({
  buildings: buildings.length, edges: edges.length, islands: islands.length, nodes: Object.keys(nodes).length,
  parks: parks.length, parts: parts.length, ground: Object.fromEntries(Object.entries(ground).map(([k, v]) => [k, v.length])), rails: rails.length, roads: roads.length, routes: routes.length, trams: trams.length, sea: sea.length, walkEdges: walkEdges.length, walks: walks.length, water: water.length,
  chainsOpen: chains.filter((c) => c.first !== c.last).map((c) => c.pts.length),
});
