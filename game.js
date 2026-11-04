import * as THREE from 'three';

import { BODY_STYLES, buildCar, loadSloydCars } from './cars.js';
import { buildRoadster, createRoadsterCrowd, createVapor, ROADSTER, roadsterPaint, setRoadsterLight } from './roadster.js';
import { buildBellows, buildRailCar, RAIL_STYLES } from './railcars.js';
import { buildPerson, posePerson, warmPeople } from './person.js';
import { bake, loadModels } from './sloyd.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { buildingGeometries, buildingLook } from './buildings.js';
import * as textures from './textures.js';
import { buildShopSigns, facadeLettering } from './signage.js';
import { buildBarriers, buildBollards, busShelter, clockTower, postbox, streetBin, streetLight } from './street.js';
import { buildMicromobility, scooter, SCOOTER_COLOURS } from './micromobility.js';
import { KERB_TOP, ROAD_Y } from './street-geometry.js';
import { createBirds } from './birds.js';
import { createBridges } from './bridges.js';
import { createHarbour } from './boats.js';
import { groundMaterial } from './ground.js';
import { clipToTile, createStreamer, WAIT } from './streaming.js';
import { DATUM, drape, loadTerrain, terrainTiles } from './terrain.js';
import { tigerStatue } from './tiger.js';
import { createTrafficControl } from './traffic.js';
import { broadleafTree, createGrassField, shrub, spruceTree } from './vegetation.js';

// ============================================================================
// Helpers
// ============================================================================
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angleDiff = (a, b) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

function pointInPoly(x, z, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function nearestOnSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-6;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  return [ax + dx * t, az + dz * t];
}

let queryStamp = 1;
class Grid {
  constructor(cell) { this.cell = cell; this.cells = new Map(); }
  key(ix, iz) { return (ix + 10000) * 20000 + (iz + 10000); }
  insert(item, minX, minZ, maxX, maxZ) {
    const c = this.cell;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const k = this.key(ix, iz);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(item);
      }
    }
  }
  query(minX, minZ, maxX, maxZ, visit) {
    const c = this.cell;
    const stamp = queryStamp++;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const items = this.cells.get(this.key(ix, iz));
        if (!items) continue;
        for (const item of items) {
          if (item.q === stamp) continue;
          item.q = stamp;
          visit(item);
        }
      }
    }
  }
}

// ============================================================================
// Load
// ============================================================================
// The city comes from the address (?city=<id>), else index.html's default-city (tools/package.sh
// sets it to the packaged city). Its data is in data/<id>/, built by tools/build-city.sh from
// cities/<id>/city.json.
const askedCity = new URLSearchParams(location.search).get('city');
const CITY_ID = /^[a-z0-9-]+$/i.test(askedCity || '') ? askedCity : document.querySelector('meta[name="default-city"]').content;
const DATA = `data/${CITY_ID}/`;
const worldResponse = await fetch(`${DATA}world.json`);
if (!worldResponse.ok) {
  $('loading').textContent = `No data for "${CITY_ID}": run bash tools/build-city.sh ${CITY_ID} (see README).`;
  throw new Error(`${DATA}world.json: HTTP ${worldResponse.status}`);
}
const data = await worldResponse.json();
// The game's name: the city's "title", else Grand Theft <city>; its last word in colour.
const title = data.city.title || `Grand Theft ${data.city.name}`, titleWords = title.toUpperCase().split(' ');
document.title = title;
document.querySelector('#start h1').innerHTML = `${titleWords.slice(0, -1).join(' ')}<br /><span></span>`;
document.querySelector('#start h1 span').textContent = titleWords.at(-1);
document.querySelector('#start .sub').textContent = `Real streets and buildings of ${data.city.name} from OpenStreetMap`;
// The city's hills (terrain.js).
const terrain = await loadTerrain(DATA);
const terrainAt = terrain.heightAt;
// Public transport routes: cumulative distance along each path, for point lookups.
for (const r of data.routes) {
  r.cum = [0];
  for (let i = 1; i < r.p.length; i++) r.cum.push(r.cum[i - 1] + Math.hypot(r.p[i][0] - r.p[i - 1][0], r.p[i][1] - r.p[i - 1][1]));
  r.len = r.cum[r.cum.length - 1];
}
const tramRoutes = data.routes.filter((r) => r.m === 'tram');
const busRoutes = data.routes.filter((r) => r.m === 'bus');
function routePoint(r, s) {
  s = Math.max(0, Math.min(r.len, s));
  let lo = 0, hi = r.cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (r.cum[mid] < s) lo = mid; else hi = mid; }
  const f = (s - r.cum[lo]) / (r.cum[hi] - r.cum[lo] || 1);
  return [r.p[lo][0] + (r.p[hi][0] - r.p[lo][0]) * f, r.p[lo][1] + (r.p[hi][1] - r.p[lo][1]) * f];
}
function routeTangent(r, s) {
  const a = routePoint(r, s - 2), b = routePoint(r, s + 2), len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
}

// Car bodies made with the Sloyd API (models/cars/).
// Off by default: the game's own lofted cars look cleaner than the AI bodies (?sloyd to compare).
const sloydCars = location.search.includes('sloyd') && !location.search.includes('nosloyd') ? await loadSloydCars() : {};
const models = await loadModels((done, total) => ($('loading').textContent = `Loading Sloyd models ${done}/${total}…`));
const baked = Object.fromEntries(Object.keys(models).map((n) => [n, bake(models[n])]));

// ============================================================================
// Renderer / scene
// ============================================================================
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
const MAX_PIXEL_RATIO = Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(MAX_PIXEL_RATIO);
// Adaptive resolution: drop the render scale while frames run slow (large Retina windows
// are fill-bound), raise it again once there is headroom.
const quality = { frameMs: 16, ratio: MAX_PIXEL_RATIO, slowT: 0, fastT: 0 };
function adaptResolution(frameMs, dt) {
  quality.frameMs += (frameMs - quality.frameMs) * 0.05;
  quality.slowT = quality.frameMs > 18 ? quality.slowT + dt : 0;
  quality.fastT = quality.frameMs < 11 ? quality.fastT + dt : 0;
  const step = quality.slowT > 2 ? -0.25 : quality.fastT > 5 ? 0.25 : 0;
  const ratio = Math.min(MAX_PIXEL_RATIO, Math.max(0.75, quality.ratio + step));
  if (step && ratio !== quality.ratio) {
    quality.ratio = ratio;
    renderer.setPixelRatio(ratio);
    quality.slowT = quality.fastT = 0;
  }
}
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// Shadows are redrawn every other frame (see frame()); at 60 fps the lag is invisible.
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
// Fog matches the sky near the horizon so the far edge of the map blends in.
const HORIZON = 0xdfe7ee;
scene.fog = new THREE.Fog(HORIZON, 350, 1400);
const SUN_OFFSET = new THREE.Vector3(-90, 160, 60);

// Gradient sky dome with a soft sun glow; its PMREM copy gives paint, glass and the fjord
// outdoor reflections.
function makeSky() {
  const material = new THREE.ShaderMaterial({
    depthWrite: false,
    fragmentShader: `
      uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float up = max(d.y, 0.0);
        // Smooth haze into the horizon, which matches the fog colour exactly.
        vec3 sky = mix(horizon, zenith, smoothstep(0.0, 0.5, up));
        float sun = max(dot(d, sunDir), 0.0);
        sky += vec3(1.0, 0.92, 0.75) * (pow(sun, 600.0) * 2.0 + pow(sun, 12.0) * 0.18);
        gl_FragColor = vec4(sky, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    uniforms: {
      horizon: { value: new THREE.Color(HORIZON) },
      sunDir: { value: SUN_OFFSET.clone().normalize() },
      zenith: { value: new THREE.Color(0x4f86c6) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w;
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  dome.scale.setScalar(2500);
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  return dome;
}
// Materials that glow at night (windows, shops, lamps): emissive scaled by darkness.
const nightMaterials = [];
function nightLit(material, emissiveMap, strength) {
  material.emissive = new THREE.Color(0xffffff);
  material.emissiveMap = emissiveMap;
  material.emissiveIntensity = 0;
  nightMaterials.push({ material, strength });
  return material;
}
const skyDome = makeSky();
scene.add(skyDome);
{
  const skyScene = new THREE.Scene();
  skyScene.add(makeSky());
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(skyScene).texture;
  scene.environmentIntensity = 0.8;
}

// Near plane 0.4 m: depth precision at a few hundred metres stays well under the 7–25 cm the
// street surfaces lie above the ground (at 0.2 m, distant streets flickered into it).
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.4, 3000);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight(0xdfefff, 0x6b6250, 1.4));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { bottom: -90, far: 400, left: -90, near: 1, right: 90, top: 90 });
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);
// Shadow proxies live on their own layer, drawn only into the shadow map. Detailed
// buildings, leafy trees and cars are drawn normally but cast through proxies.
const SHADOW_LAYER = 1;
// three.js tests shadow casters against the main camera's layers, so the proxy layer is
// switched on for the shadow pass only.
{
  const renderShadows = renderer.shadowMap.render.bind(renderer.shadowMap);
  renderer.shadowMap.render = (lights, sceneToRender, viewCamera) => {
    viewCamera.layers.enable(SHADOW_LAYER);
    renderShadows(lights, sceneToRender, viewCamera);
    viewCamera.layers.disable(SHADOW_LAYER);
  };
}
const proxyMaterial = new THREE.MeshBasicMaterial();
function shadowProxy(mesh) {
  mesh.castShadow = true;
  mesh.layers.set(SHADOW_LAYER);
  scene.add(mesh);
  return mesh;
}

// ============================================================================
// City geometry
// ============================================================================
const toShape = (pts) => new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));

// Roads, markings, kerbs, detailed buildings and the fine terrain stream in 300 m tiles
// around the camera (streaming.js); the rest of the city is built once, below.
const streamer = createStreamer({ scene, size: 300 });

// Small things placed citywide (manhole covers, posts, sign blanks...) are split into
// 400 m chunks of instances that are hidden past `range`, instead of one city-sized batch
// the renderer can never cull.
const instanceChunks = [];
// Returns, for each original instance, where it went: { mesh, index }.
function splitInstanced(mesh, range = 320) {
  const chunks = new Map(), m = new THREE.Matrix4(), moved = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    const key = `${Math.floor(m.elements[12] / 400)}|${Math.floor(m.elements[14] / 400)}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push([i, m.clone()]);
  }
  scene.remove(mesh);
  for (const [key, list] of chunks) {
    const part = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
    list.forEach(([i, mm], j) => { part.setMatrixAt(j, mm); moved[i] = { index: j, mesh: part }; });
    part.castShadow = mesh.castShadow;
    part.receiveShadow = mesh.receiveShadow;
    part.computeBoundingSphere();
    scene.add(part);
    const [ix, iz] = key.split('|').map(Number);
    instanceChunks.push({ mesh: part, range, x: (ix + 0.5) * 400, z: (iz + 0.5) * 400 });
  }
  return moved;
}

// Ground meshes (terrain, cover, roads) are cut into 400 m tiles: the camera culls them by
// frustum, and tiles beyond GROUND_RANGE (into the fog) are hidden (see cullProps).
const groundTiles = [], GROUND_TILE = 400, GROUND_RANGE = 650;
// Coarse (8 m) terrain tiles, shown where the streamed 2 m tile isn't loaded.
const terrainLod = [];
function addTiled(geometry, material, setup = () => {}) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry, pos = g.attributes.position.array, buckets = new Map();
  for (let t = 0; t < pos.length / 9; t++) {
    const key = `${Math.floor((pos[t * 9] + pos[t * 9 + 3] + pos[t * 9 + 6]) / 3 / GROUND_TILE)}|${Math.floor((pos[t * 9 + 2] + pos[t * 9 + 5] + pos[t * 9 + 8]) / 3 / GROUND_TILE)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  for (const [key, tris] of buckets) {
    const geo = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(g.attributes)) {
      const n = a.itemSize * 3, out = new Float32Array(tris.length * n);
      tris.forEach((t, i) => out.set(a.array.subarray(t * n, (t + 1) * n), i * n));
      geo.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
    }
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    setup(mesh);
    scene.add(mesh);
    const [ix, iz] = key.split('|').map(Number);
    groundTiles.push({ mesh, x: (ix + 0.5) * GROUND_TILE, z: (iz + 0.5) * GROUND_TILE });
  }
}

// Ground polygons laid over the terrain, y above it; UVs are world metres, so textures
// tile by their real size. level: keep each polygon flat at its lowest corner (ponds).
function flatMesh(polys, y, material, receive = true, level = false) {
  const geos = polys.filter((p) => p.length > 2).map((p) => {
    const g = new THREE.ShapeGeometry(toShape(p)).toNonIndexed().rotateX(-Math.PI / 2);
    return level ? g.translate(0, y + Math.min(...p.map(([x, z]) => terrainAt(x, z))), 0) : g.translate(0, y, 0);
  });
  if (!geos.length) return null;
  const merged = mergeGeometries(geos);
  // Fine enough (4 m, the terrain grid) to follow the terrain mesh, and drawn over it.
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -4 * (material.userData.groundRank || 1);
  addTiled(level ? merged : drape(merged, terrainAt, 4, undefined, true), material, (mesh) => { mesh.receiveShadow = receive; });
}
const textured = (map, tint = 0xffffff) => new THREE.MeshLambertMaterial({ color: tint, map });

// The fjord sits below quay level: land is a big plane with the sea cut out of it,
// stone quay walls line the shore, and the water surface moves with scrolling normals.
const WATER_LEVEL = -0.9;
const SEABED = -7;
// Distance from the shore, as a blurred sea mask: 0.5 at the quay, 1 out in open water.
// The water shader turns it into colour and clarity (turquoise and clear near the quays,
// deep blue further out).
// Covers the terrain model with a 400 m margin.
const SEA_DEPTH = (() => {
  const { cell, minX, minZ, nx, nz } = terrain.meta;
  return { metres: 4, origin: [minX - 400, minZ - 400], size: [(nx - 1) * cell + 800, (nz - 1) * cell + 800] };
})();
let seaAt = () => false;
const seaDepth = (() => {
  const [w, h] = SEA_DEPTH.size.map((v) => Math.ceil(v / SEA_DEPTH.metres));
  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  const g = mask.getContext('2d');
  const toPx = ([x, z]) => [(x - SEA_DEPTH.origin[0]) / SEA_DEPTH.metres, (z - SEA_DEPTH.origin[1]) / SEA_DEPTH.metres];
  const fill = (polys, color) => {
    g.fillStyle = color;
    for (const p of polys) { g.beginPath(); p.forEach((q, i) => { const [x, y] = toPx(q); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill(); }
  };
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  fill(data.sea, '#fff');
  fill(data.islands, '#000');
  fill(data.ground.pier || [], '#000');
  // Sharp sea mask for the terrain: the ground under the fjord is pushed below the water.
  const sharp = g.getImageData(0, 0, w, h).data;
  seaAt = (x, z) => {
    const px = Math.floor((x - SEA_DEPTH.origin[0]) / SEA_DEPTH.metres), pz = Math.floor((z - SEA_DEPTH.origin[1]) / SEA_DEPTH.metres);
    return px >= 0 && pz >= 0 && px < w && pz < h && sharp[(pz * w + px) * 4] > 128;
  };
  const blurred = document.createElement('canvas');
  blurred.width = w;
  blurred.height = h;
  const b = blurred.getContext('2d');
  b.filter = 'blur(14px)';
  b.drawImage(mask, 0, 0);
  const tex = new THREE.CanvasTexture(blurred);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  // Canvas rows run with +z, the same way as the lookup, so no vertical flip.
  tex.flipY = false;
  return tex;
})();
const waterNormals = textures.waterNormals();
waterNormals.repeat.set(700, 700);
const swellNormals = waterNormals.clone();
swellNormals.repeat.set(230, 230);
// Waves: four directional swells (direction, wavelength m, amplitude m) summed, calmer
// near the quays and fading out with distance; the same function moves boats.
const WAVES = [[[1, 0.3], 9, 0.1], [[0.6, 1], 14, 0.16], [[-0.4, 1], 6, 0.05], [[0.9, -0.5], 23, 0.2]].map(([d, len, a]) => {
  const l = Math.hypot(d[0], d[1]), k = (2 * Math.PI) / len;
  return { a, dx: d[0] / l, dz: d[1] / l, k, w: Math.sqrt(9.81 * k) };
});
const waveTime = { value: 0 };
// Height and slope of the waves at (x, z) (before the shore/distance fade).
function waveAt(x, z, t = waveTime.value) {
  let h = 0, sx = 0, sz = 0;
  for (const { a, dx, dz, k, w } of WAVES) {
    const ph = k * (dx * x + dz * z) - w * t;
    h += a * Math.sin(ph);
    sx += a * k * dx * Math.cos(ph);
    sz += a * k * dz * Math.cos(ph);
  }
  return { h, sx, sz };
}
const waveGlsl = `uniform float waveTime;
  vec3 waves(vec2 p) {
    vec3 r = vec3(0.0);
    ${WAVES.map(({ a, dx, dz, k, w }) => `{ float ph = ${k.toFixed(5)} * dot(vec2(${dx.toFixed(4)}, ${dz.toFixed(4)}), p) - ${w.toFixed(5)} * waveTime;
      r += vec3(${a.toFixed(3)} * sin(ph), ${(a * k * dx).toFixed(5)} * cos(ph), ${(a * k * dz).toFixed(5)} * cos(ph)); }`).join('\n    ')}
    return r;
  }`;
function makeWaterMaterial(withWaves) {
  const material = new THREE.MeshPhysicalMaterial({
    clearcoat: 0.55, clearcoatNormalMap: swellNormals, clearcoatNormalScale: new THREE.Vector2(0.35, 0.35), clearcoatRoughness: 0.05,
    color: 0x1d4b66, metalness: 0, normalMap: waterNormals, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.12, transparent: true,
  });
  material.customProgramCacheKey = () => (withWaves ? 'sea-waves' : 'sea-flat');
  material.onBeforeCompile = (shader) => {
    shader.uniforms.seaDepth = { value: seaDepth };
    shader.uniforms.depthOrigin = { value: new THREE.Vector2(...SEA_DEPTH.origin) };
    shader.uniforms.depthSize = { value: new THREE.Vector2(...SEA_DEPTH.size) };
    shader.uniforms.waveTime = waveTime;
    const openAt = `float openAt(vec2 p) { vec2 uv = (p - depthOrigin) / depthSize; return uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ? 1.0 : texture2D(seaDepth, uv).r; }`;
    shader.vertexShader = `uniform sampler2D seaDepth; uniform vec2 depthOrigin; uniform vec2 depthSize; varying vec3 vSeaPos; varying float vCrest;\n${openAt}\n${waveGlsl}\n` + shader.vertexShader
      .replace('#include <beginnormal_vertex>', withWaves ? `vec3 objectNormal = vec3(0.0, 1.0, 0.0);
        vec4 wavePos = modelMatrix * vec4(position, 1.0);
        float waveFade = smoothstep(0.5, 0.72, openAt(wavePos.xz)) * (1.0 - smoothstep(120.0, 190.0, distance(wavePos.xz, cameraPosition.xz)));
        vec3 wave = waves(wavePos.xz) * waveFade;
        objectNormal = normalize(vec3(-wave.y, 1.0, -wave.z));
        vCrest = wave.x;` : '#include <beginnormal_vertex>\nvCrest = 0.0;')
      .replace('#include <begin_vertex>', withWaves ? '#include <begin_vertex>\ntransformed.y += wave.x;' : '#include <begin_vertex>')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSeaPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = `uniform sampler2D seaDepth; uniform vec2 depthOrigin; uniform vec2 depthSize; varying vec3 vSeaPos; varying float vCrest;\n` + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 depthUv = (vSeaPos.xz - depthOrigin) / depthSize;
      float open = depthUv.x < 0.0 || depthUv.y < 0.0 || depthUv.x > 1.0 || depthUv.y > 1.0 ? 1.0 : texture2D(seaDepth, depthUv).r;
      float deep = smoothstep(0.5, 0.95, open);
      diffuseColor.rgb = mix(vec3(0.13, 0.38, 0.4), vec3(0.02, 0.1, 0.19), deep);
      // White water on the crests.
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.92, 0.94), smoothstep(0.22, 0.38, vCrest) * 0.55);
      diffuseColor.a = mix(0.72, 0.97, deep);`);
  };
  return material;
}
const waterMaterial = makeWaterMaterial(false);
let seaSurface = null;
const pondMaterial = new THREE.MeshStandardMaterial({ color: 0x2c5a63, normalMap: waterNormals.clone(), normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.1 });
pondMaterial.normalMap.repeat.set(1 / 6, 1 / 6);
{
  const water = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_LEVEL - 0.03;
  water.renderOrder = 1;
  scene.add(water);
  // The wavy sea near the camera: a fine grid that follows it (snapped to its cells).
  seaSurface = new THREE.Mesh(new THREE.PlaneGeometry(400, 400, 260, 260).rotateX(-Math.PI / 2), makeWaterMaterial(true));
  seaSurface.position.y = WATER_LEVEL;
  seaSurface.renderOrder = 1;
  seaSurface.frustumCulled = false;
  scene.add(seaSurface);
  // The fjord floor, seen through clear water near the quays.
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshLambertMaterial({ color: 0x3e4a3c }));
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = SEABED;
  scene.add(bed);
  const land = new THREE.Shape([new THREE.Vector2(-4000, -4000), new THREE.Vector2(4000, -4000), new THREE.Vector2(4000, 4000), new THREE.Vector2(-4000, 4000)]);
  for (const sea of data.sea) land.holes.push(new THREE.Path(sea.map(([x, z]) => new THREE.Vector2(x, -z))));
  const farGround = textured(textures.urbanGroundTexture(), new THREE.Color(1.45, 1.44, 1.4));
  farGround.map.repeat.set(1 / 8, 1 / 8);
  farGround.map.anisotropy = 8;
  // Beyond the terrain model the land continues as a plane just under it.
  const ground = new THREE.Mesh(new THREE.ShapeGeometry(land), farGround);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.6;
  ground.receiveShadow = true;
  scene.add(ground);
  // The terrain, painted with the map's ground cover (ground.js) in the order a map draws it.
  const G0 = data.ground, { cell, minX, minZ, nx, nz } = terrain.meta;
  const tex = (map, metres = 1, tint = 0xffffff) => ({ map, metres, tint: new THREE.Color(tint) });
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.needsUpdate = true;
  const painted = groundMaterial({
    base: { map: farGround.map, tint: new THREE.Color(1.45, 1.44, 1.4) },
    bounds: { maxX: minX + (nx - 1) * cell, maxZ: minZ + (nz - 1) * cell, minX, minZ },
    layers: [
      { polys: [...(G0.grass || []), ...data.parks], ...tex(textures.grassTexture()) },
      { polys: G0.wood || [], ...tex(textures.woodTexture()) },
      { polys: [...(G0.sand || []), ...(G0.rock || [])], ...tex(textures.sandTexture()) },
      { polys: G0.pitch || [], ...tex(textures.pitchTexture()) },
      { polys: G0.playground || [], ...tex(white, 1, 0xb5603f) },
      { polys: G0.flowers || [], ...tex(textures.flowersTexture()) },
      { polys: G0.paving || [], ...tex(textures.paverTexture()) },
      { polys: G0.asphalt || [], ...tex(textures.asphaltTexture()) },
    ],
  });
  // The ground itself is pushed back a little in depth, so the street surfaces just above it
  // always win (without biasing the street layers against each other).
  Object.assign(painted, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });
  const fine = new Map();
  for (const t of terrainTiles(terrain, painted, (x, z) => (seaAt(x, z) ? -3.5 : null), streamer.size)) {
    t.coarse.geometry.computeBoundingSphere();
    scene.add(t.coarse);
    terrainLod.push(t);
    fine.set(t.key, t.buildFine);
  }
  streamer.addLayer((tile) => fine.get(tile.key)?.() ?? null);
}
// Vertical faces along polygon edges, from `top` down to `bottom` (quay walls, pier sides).
function edgeWalls(polys, top, bottom, material, skip = () => false) {
  const pos = [], uv = [];
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      if (skip(a, b)) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      pos.push(a[0], top, a[1], b[0], top, b[1], b[0], bottom, b[1], a[0], top, a[1], b[0], bottom, b[1], a[0], bottom, a[1]);
      uv.push(0, 1, len / 4, 1, len / 4, 0, 0, 1, len / 4, 0, 0, 0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // The top edge follows the ground; the foot stays on the seabed.
  const mesh = new THREE.Mesh(drape(geo, terrainAt, 8, (y) => y > bottom + 0.5), material);
  mesh.receiveShadow = true;
  scene.add(mesh);
}
const quayStone = new THREE.MeshLambertMaterial({ map: textures.stoneTexture(), side: THREE.DoubleSide });
// Skip the straight closing edges far out in the fjord.
const farEdge = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 400;
edgeWalls(data.sea, 0, SEABED, quayStone, farEdge);
flatMesh(data.islands, 0.01, textured(textures.grassTexture()));
edgeWalls(data.islands, 0.01, SEABED, quayStone);
// A faint line of foam where the water meets the quays.
const foamMaterial = new THREE.MeshBasicMaterial({ color: 0xe8f1f2, depthWrite: false, opacity: 0.35, transparent: true });
{
  const lines = [];
  for (const p of [...data.sea, ...data.islands]) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      if (!farEdge(a, b)) lines.push({ p: [a, b], w: 0.9 });
    }
  }
  const foam = new THREE.Mesh(stripGeometry(lines, WATER_LEVEL + 0.02, false, false), foamMaterial);
  foam.renderOrder = 2;
  scene.add(foam);
}
// Ponds and rivers stay level, at their lowest bank.
flatMesh(data.water, 0.04, pondMaterial, false, true);
// Bridge decks: profiles for every bridged road and path (their strips follow them), the
// structure, and deck heights for anything travelling on them.
// Deck heights measured from Kartverket's surface model (tools/elevation.mjs), in game heights.
const measuredDecks = await fetch(`${DATA}bridge-heights.json`).then((r) => (r.ok ? r.json() : {}));
for (const k of Object.keys(measuredDecks)) measuredDecks[k] = measuredDecks[k].map((v) => (v === null ? null : v - DATUM));
const bridgeDecks = createBridges({
  lines: [...data.roads.filter((r) => r.br), ...data.walks.filter((w) => w.br)], measured: measuredDecks, scene, terrainAt,
  waterAt: (x, z) => seaAt(x, z) || data.water.some((p) => pointInPoly(x, z, p)), waterLevel: WATER_LEVEL,
});

// Ground cover is painted onto the terrain itself (see ground.js above).
const G = data.ground;
// Piers and bridges are wooden decks over the water.
const planks = textured(textures.planksTexture());
flatMesh(G.pier || [], 0.06, planks);
edgeWalls(G.pier || [], 0.06, SEABED, new THREE.MeshLambertMaterial({ color: 0x4b3a2a, side: THREE.DoubleSide }));

// Road strips: one merged mesh per surface.
function pushUpTri(out, a, b, c, y) {
  const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
  if (ny < 0) [b, c] = [c, b];
  out.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
}

// Strips along polylines (roads, paths, markings), y above the ground. UVs are world
// metres. Bridges (br) run straight between the ground at their two ends.
function stripGeometry(lines, y, extend = true, onGround = true) {
  if (onGround) {
    // Lines on a bridge carry its deck profile (height); the rest lie on the terrain.
    const parts = [drape(stripGeometry(lines.filter((l) => !l.height), y, extend, false), terrainAt, 2.5, undefined, true)];
    for (const l of lines.filter((q) => q.height)) parts.push(drape(stripGeometry([l], y, extend, false), l.height, 4));
    return parts.length > 1 ? mergeGeometries(parts.filter((g) => g.attributes.position.count)) : parts[0];
  }
  const pos = [], uv = [];
  for (const line of lines) {
    const p = line.p, hw = line.w / 2;
    for (let i = 0; i + 1 < p.length; i++) {
      let [ax, az] = p[i], [bx, bz] = p[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      if (extend) { ax -= dx * hw * 0.7; az -= dz * hw * 0.7; bx += dx * hw * 0.7; bz += dz * hw * 0.7; }
      const nx = -dz * hw, nz = dx * hw;
      const q = [[ax - nx, az - nz], [ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz]];
      for (const tri of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
        const before = pos.length;
        pushUpTri(pos, tri[0], tri[1], tri[2], y);
        for (let k = before; k < pos.length; k += 3) uv.push(pos[k], pos[k + 2]);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}
function stripMesh(lines, y, material, extend = true, near = Infinity) {
  if (typeof material === 'number') material = new THREE.MeshLambertMaterial({ color: material });
  // Paths, roads and markings draw over every ground-cover layer (whose bias is up to -32).
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -4;
  const buckets = streamer.bucket(lines);
  streamer.addLayer((tile) => {
    const list = buckets.get(tile.key);
    if (!list) return null;
    const g = clipToTile(stripGeometry(list, y, extend), tile);
    if (!g.attributes.position.count) return null;
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.receiveShadow = true;
    return mesh;
  }, { near });
}
// Plain-coloured strips share one vertex-coloured mesh per tile and paint layer: `near`
// paint (markings, stop lines, rails) only within 350 m, `far` paint (track beds) always.
function paintLayer(near) {
  const entries = [];
  const material = new THREE.MeshLambertMaterial({ polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -8, vertexColors: true });
  streamer.addLayer((tile) => {
    const parts = [];
    for (const entry of entries) {
      entry.buckets ??= streamer.bucket(entry.lines);
      const list = entry.buckets.get(tile.key);
      if (!list) continue;
      const g = clipToTile(stripGeometry(list, entry.y, entry.extend), tile);
      const n = g.attributes.position.count;
      if (!n) continue;
      g.deleteAttribute('uv');
      const colors = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) colors.set([entry.color.r, entry.color.g, entry.color.b], k * 3);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      parts.push(g);
    }
    if (!parts.length) return null;
    const mesh = new THREE.Mesh(mergeGeometries(parts), material);
    mesh.geometry.computeBoundingSphere();
    mesh.receiveShadow = true;
    return mesh;
  }, { near });
  return (lines, y, color, extend = true) => entries.push({ color: new THREE.Color(color), extend, lines, y });
}
const paintNear = paintLayer(350), paintFar = paintLayer(Infinity);
// A strip raised above the street (sidewalk, island) with granite curb faces on both edges.
function raisedStrip(lines, top, material, curb) {
  stripMesh(lines, top, material);
  const buckets = streamer.bucket(lines.filter((l) => !l.height));
  streamer.addLayer((tile) => {
    const list = buckets.get(tile.key);
    if (!list) return null;
    const g = clipToTile(kerbFaces(list, top), tile);
    if (!g.attributes.position.count) return null;
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, curb);
    mesh.receiveShadow = true;
    return mesh;
  }, { near: 300 });
  // Granite kerbstones: a 0.3 m light band along both top edges.
  const kerbs = lines.filter((l) => l.w > 1).flatMap((l) => [-1, 1].map((side) => ({ height: l.height, p: offsetPolyline(l.p, side * (l.w / 2 - 0.15)), w: 0.3 })));
  stripMesh(kerbs, top + 0.004, curb, false, 350);
}
// Kerb faces from the ground up to the sidewalk along both edges and across both ends of each line.
// (On bridges the deck edge needs no kerb face down to the ground.)
function kerbFaces(lines, top) {
  const pos = [];
  const face = ([ax, az], [bx, bz]) => pos.push(ax, top, az, bx, top, bz, bx, 0, bz, ax, top, az, bx, 0, bz, ax, 0, az);
  for (const line of lines) {
    for (const side of [-1, 1]) {
      const edge = offsetPolyline(line.p, (side * line.w) / 2);
      for (let i = 0; i + 1 < edge.length; i++) face(edge[i], edge[i + 1]);
    }
    // End caps, where stripGeometry's overlap past the end stops.
    const p = line.p, hw = line.w / 2;
    for (const [q, o] of [[p[0], p[1]], [p[p.length - 1], p[p.length - 2]]]) {
      const len = Math.hypot(q[0] - o[0], q[1] - o[1]) || 1, dx = (q[0] - o[0]) / len, dz = (q[1] - o[1]) / len;
      const cx = q[0] + dx * hw * 0.7, cz = q[1] + dz * hw * 0.7;
      face([cx - dz * hw, cz + dx * hw], [cx + dz * hw, cz - dx * hw]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return drape(geo, terrainAt, 2.5);
}
function offsetPolyline(p, off) {
  return p.map((q, i) => {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [q[0] - ((b[1] - a[1]) / len) * off, q[1] + ((b[0] - a[0]) / len) * off];
  });
}

const PAVED = new Set(['living_street', 'pedestrian']);
const textureAt = (texture, metres) => { texture.repeat.set(1 / metres, 1 / metres); return texture; };
// Street surfaces are drawn by shaders rather than tiled pictures, after Worldhood's ground and
// kerb shaders (github.com/worldhood/worldhood, MIT): asphalt, slabs, pavers and granite kerb
// stones come from world-space patterns whose detail fades to its mean colour as it shrinks
// towards a pixel, so nothing repeats visibly and nothing sparkles in motion. PBR (roughness).
const STREET_GLSL = `
varying vec3 vStreet;
float streetHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float streetNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(streetHash(i), streetHash(i + vec2(1, 0)), f.x), mix(streetHash(i + vec2(0, 1)), streetHash(i + vec2(1, 1)), f.x), f.y); }`;
// A street material: `body` is GLSL that adjusts diffuseColor.rgb, with vStreet (world
// position), footprint (metres per pixel) and grain (fine noise, already faded) to hand.
function streetSurface(color, body, roughness = 0.95, extra = {}) {
  const material = new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vStreet;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvStreet = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>${STREET_GLSL}`).replace('#include <color_fragment>', `#include <color_fragment>
{
  float footprint = max(length(dFdx(vStreet.xz)), length(dFdy(vStreet.xz)));
  float detail = 1.0 - smoothstep(0.07, 0.4, footprint);
  float grain = (streetHash(floor(vStreet.xz * 18.0)) - 0.5) * (1.0 - smoothstep(0.02, 0.08, footprint));
  ${body}
}`);
  };
  material.customProgramCacheKey = () => body;
  return material;
}
// Slabs or pavers of size (w, d) metres in running bond: each its own tone, thin soft joints.
const unitGlsl = (w, d, joint, toneSpread) => `
  vec2 cellSize = vec2(${w.toFixed(2)}, ${d.toFixed(2)});
  vec2 q = vStreet.xz / cellSize;
  q.x += 0.5 * mod(floor(q.y), 2.0);
  vec2 id = floor(q), f = abs(fract(q) - 0.5) * cellSize;
  float edge = min(cellSize.x * 0.5 - f.x, cellSize.y * 0.5 - f.y);
  float seam = (1.0 - smoothstep(${joint.toFixed(3)}, ${joint.toFixed(3)} + 0.01 + footprint, edge)) * detail;
  float tone = 1.0 + (streetHash(id + 3.1) - 0.5) * ${toneSpread.toFixed(2)} * detail + (streetNoise(vStreet.xz / 7.0) - 0.5) * 0.14;
  diffuseColor.rgb *= tone * (1.0 - seam * 0.22) * (1.0 + grain * 0.1);`;
// Dark asphalt with a slow tone drift and fine grain.
const asphalt = streetSurface('#3d3a37', `
  diffuseColor.rgb *= (1.0 + (streetNoise(vStreet.xz / 9.0) - 0.5) * 0.36) * (1.0 + grain * 0.14);`, 0.95);
// Sidewalks: light granite slabs, 0.7 × 0.48 m (Worldhood's pavement grid), in running bond.
const sidewalkPaving = streetSurface('#b3ab9e', unitGlsl(0.7, 0.48, 0.004, 0.1), 0.92);
// Granite kerb stones, 1.25 m long (Worldhood's kerbstone shader): joints and a tone per stone
// from the kerb's running `along`, speckle, faces a shade darker than tops.
const curbStone = streetSurface('#a39c92', `
  float alongFw = fwidth(vAlong), near = 1.0 - smoothstep(0.03, 0.14, alongFw);
  float stone = floor(vAlong / ${1.25.toFixed(2)}), kh = streetHash(vec2(stone, 0.37)), kh2 = streetHash(vec2(stone, 9.1));
  vec3 tint = (kh < 0.4 ? vec3(1.03, 0.98, 0.96) : kh < 0.75 ? vec3(0.97, 0.98, 1.0) : vec3(1.02, 1.0, 0.95)) * (0.9 + 0.2 * kh2);
  float j = abs(fract(vAlong / ${1.25.toFixed(2)}) - 0.5) * ${1.25.toFixed(2)};
  float joint = (1.0 - smoothstep(0.006, 0.016 + alongFw, j)) * near;
  float speck = (streetHash(floor(vStreet.xz * 40.0) + floor(vStreet.y * 40.0)) - 0.5) * (1.0 - smoothstep(0.015, 0.05, footprint));
  diffuseColor.rgb *= mix(vec3(1.0), tint, near) * (1.0 - joint * 0.5) * (1.0 + speck * 0.16) * mix(0.84, 1.0, smoothstep(0.3, 0.9, vUpright));`, 0.88, { side: THREE.DoubleSide });
{
  // The kerb shader also needs the running length and whether the face is a top or a side.
  const base = curbStone.onBeforeCompile;
  curbStone.onBeforeCompile = (shader) => {
    base(shader);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float along;\nvarying float vAlong;\nvarying float vUpright;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlong = along;\nvUpright = objectNormal.y;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAlong;\nvarying float vUpright;');
  };
}
// Carriageways by 20 m cell, to stop gutters, markings and zebras where another street
// crosses. Ground-level roads only; a road meeting at under ~25° (the same street continuing
// in its next way) doesn't count.
const roadIndex = (() => {
  const C = 20, cells = new Map();
  for (const line of data.roads.filter((r) => !PAVED.has(r.k) && !r.height)) for (let i = 0; i + 1 < line.p.length; i++) {
    const [ax, az] = line.p[i], [bx, bz] = line.p[i + 1], len = Math.hypot(bx - ax, bz - az), r = line.w / 2;
    if (len < 0.01) continue;
    const seg = { ax, az, bx, bz, dx: (bx - ax) / len, dz: (bz - az) / len, len, line, r };
    for (let ix = Math.floor((Math.min(ax, bx) - r) / C); ix <= Math.floor((Math.max(ax, bx) + r) / C); ix++) for (let iz = Math.floor((Math.min(az, bz) - r) / C); iz <= Math.floor((Math.max(az, bz) + r) / C); iz++) {
      const k = `${ix}|${iz}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(seg);
    }
  }
  const near = (x, z, visit) => { for (const seg of cells.get(`${Math.floor(x / C)}|${Math.floor(z / C)}`) || []) { const t = Math.max(0, Math.min(seg.len, (x - seg.ax) * seg.dx + (z - seg.az) * seg.dz)); if (visit(seg, Math.hypot(seg.ax + seg.dx * t - x, seg.az + seg.dz * t - z))) return true; } return false; };
  return {
    // On any carriageway (with `margin` metres to spare), or any but `self`'s.
    on: (x, z, margin = 0) => near(x, z, (seg, d) => d < seg.r + margin),
    onOther: (x, z, self, margin = 0) => near(x, z, (seg, d) => seg.line !== self && d < seg.r + margin),
    // On the carriageway of a street crossing the direction (dx, dz).
    crossing: (x, z, dx, dz, self, margin = 0) => near(x, z, (seg, d) => seg.line !== self && Math.abs(seg.dx * dx + seg.dz * dz) < 0.9 && d < seg.r + margin),
    // Direction [dx, dz] of the nearest carriageway, or [1, 0] with none within 20 m.
    direction(x, z) { let best = null; near(x, z, (seg, d) => { if (!best || d < best.d) best = { d, seg }; return false; }); return best ? [best.seg.dx, best.seg.dz] : [1, 0]; },
    // The nearest carriageway running along (dx, dz): { d (to its centre line), seg }.
    nearestAlong(x, z, dx, dz) { let best = null; near(x, z, (seg, d) => { if (Math.abs(seg.dx * dx + seg.dz * dz) > 0.85 && (!best || d - seg.r < best.d - best.seg.r)) best = { d, seg }; return false; }); return best; },
  };
})();
// Street surfaces from tools/streets.mjs: per 300 m tile, non-overlapping polygons for the
// carriageway, sidewalks (kerb to facade), dropped kerbs at crossings and paths, and the
// kerb edges between them. Each layer is one draped mesh per tile at its own height, so
// junctions are clean single areas and nothing z-fights. Bridge decks keep their strips.
const streets = await (await fetch(`${DATA}streets.json`)).json();
// Paths and squares: warm concrete pavers, 0.28 × 0.2 m.
const pathPaving = streetSurface('#b0a493', unitGlsl(0.28, 0.2, 0.003, 0.14), 0.93);
const tactile = new THREE.MeshLambertMaterial({ map: textureAt(textures.tactileTexture(), 0.6) });
// Gutter setts: two rows of grey granite cubes, a little darker than the asphalt's mean.
const setts = new THREE.MeshLambertMaterial({ color: 0xc4c1ba, map: textureAt(textures.settsTexture(), 0.6) });
const settPaving = new THREE.MeshLambertMaterial({ color: 0xb0aaa0, map: textureAt(textures.settsTexture(), 0.8) });
const woodDeck = new THREE.MeshLambertMaterial({ color: 0x9a7a58, map: textureAt(textures.planksTexture(), 2) });
// Depth bias: surfaces just enough to beat the terrain they lie 7–25 cm above; what lies on
// the carriageway (gutters, shadow, paint) a little more. Kept small, so nothing under a
// raised sidewalk or platform (gutter, shadow) can show through it.
for (const m of [asphalt, sidewalkPaving, pathPaving, tactile, settPaving, woodDeck]) Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
for (const m of [setts]) Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -8 });
// Street surfaces, built ahead of time on the drive terrain (tools/street-meshes.mjs): per
// tile, one mesh per surface. The game only decodes them (Int16 centimetres from the tile's
// origin) and lights them.
const zebraPaint = new THREE.MeshLambertMaterial({ color: 0xf2f2ea, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -10 });
const STREET_MATERIALS = { curb: curbStone, drop: tactile, gutter: setts, path: pathPaving, road: asphalt, sett: settPaving, walk: sidewalkPaving, wood: woodDeck, zebra: zebraPaint };
function streetTileMeshes(buffer) {
  const headerLength = new Uint32Array(buffer, 0, 1)[0], header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)));
  const start = 4 + headerLength + ((4 - ((4 + headerLength) % 4)) % 4), ints = new Int16Array(buffer, start), [ox, oz, oy] = header.origin, meshes = [];
  const alongLayer = header.layers.curbAlong;
  for (const [name, [offset, count]] of Object.entries(header.layers)) {
    if (name === 'curbAlong') continue;
    const pos = new Float32Array(count);
    for (let i = 0; i < count; i += 3) { pos[i] = ox + ints[offset + i] / 100; pos[i + 1] = oy + ints[offset + i + 1] / 100; pos[i + 2] = oz + ints[offset + i + 2] / 100; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    // Flat surfaces map from the ground plan; kerb faces along the edge and up.
    const nrm = g.attributes.normal.array, uv = new Float32Array((count / 3) * 2);
    for (let i = 0, k = 0; i < count; i += 3, k += 2) {
      const upright = Math.abs(nrm[i + 1]) < 0.5;
      uv[k] = upright && Math.abs(nrm[i]) > Math.abs(nrm[i + 2]) ? pos[i + 2] : pos[i];
      uv[k + 1] = upright ? pos[i + 1] : pos[i + 2];
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (name === 'curb' && alongLayer) g.setAttribute('along', new THREE.BufferAttribute(Float32Array.from(ints.subarray(alongLayer[0], alongLayer[0] + alongLayer[1]), (v) => v / 100), 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, STREET_MATERIALS[name]);
    mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  return meshes;
}
// Fetched when the tile streams in: the layer waits (yielding) until the file arrives.
streamer.addLayer(function* (tile) {
  if (!streets.tiles[tile.key]) return null;
  let result = null;
  fetch(`${DATA}street-mesh/${tile.key.replace('|', '_')}.bin`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => { result = b ? streetTileMeshes(b) : []; });
  while (!result) yield WAIT;
  return result;
});
// Bridge decks: carriageway, footways and sidewalks as strips that follow the deck profile.
stripMesh(data.roads.filter((r) => r.height), ROAD_Y, asphalt);
stripMesh(data.walks.filter((w) => w.height && !['crossing', 'traffic_island'].includes(w.k)), 0.07, pathPaving);
const bridgeWalks = data.roads.filter((r) => r.height && !PAVED.has(r.k) && r.sw !== 'n' && !['service', 'trunk', 'motorway', 'track', 'busway'].includes(r.k) && !r.k.endsWith('_link'))
  .flatMap((r) => [-1, 1].map((side) => ({ height: r.height, p: offsetPolyline(r.p, side * (r.w / 2 + 1.3)), w: 2.6 })));
raisedStrip(bridgeWalks, KERB_TOP, sidewalkPaving, curbStone);

// Outdoor stairs (OSM steps). Heights come from the terrain just beyond each end (the 0.5 m
// grid round Oslo S and Bjørvika); the count from step_count where mapped, else risers of
// about 16 cm; the direction from incline when the terrain is too flat to tell.
//  - Lines: treads along the way, as wide as mapped, with steel handrails on narrow flights.
//  - Areas (closed ways, e.g. the steps up to Oslo S): the climb direction is fitted to the
//    terrain inside, and the outline is cut into level treads across it.
{
  const treads = [], rails = [];
  // Keeps the part of a polygon where a·x + b·z <= c (Sutherland–Hodgman, one half-plane).
  const clipHalf = (poly, a, b, c) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], dp = a * p[0] + b * p[1] - c, dq = a * q[0] + b * q[1] - c;
      if (dp <= 0) out.push(p);
      if ((dp < 0) !== (dq < 0) && dp !== dq) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    return out;
  };
  // A level slab over a polygon from `bottom` up to `top`: top face and walls.
  const prism = (poly, bottom, top) => {
    if (poly.length < 3) return;
    const pos = [], v2 = poly.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(v2, [])) {
      let A = poly[i], B = poly[j], C = poly[k];
      if ((B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]) < 0) [B, C] = [C, B];
      pos.push(A[0], top, A[1], B[0], top, B[1], C[0], top, C[1]);
    }
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      pos.push(a[0], top, a[1], b[0], top, b[1], b[0], bottom, b[1], a[0], top, a[1], b[0], bottom, b[1], a[0], bottom, a[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    treads.push(g);
  };
  const steps = (rise, count) => Math.max(2, count || Math.round(Math.abs(rise) / 0.165));
  for (const w of data.walks.filter((q) => q.k === 'steps' && !q.br)) {
    const first = w.p[0], last = w.p[w.p.length - 1], closed = w.p.length > 3 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.5;
    if (closed) {
      const poly = w.p.slice(0, -1);
      // Climb direction: least-squares plane through the terrain inside the outline.
      const xs = poly.map((q) => q[0]), zs = poly.map((q) => q[1]), pts = [];
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.5) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.5) if (pointInPoly(x, z, poly)) pts.push([x, z, terrainAt(x, z)]);
      if (pts.length < 6) continue;
      const mx = pts.reduce((a, q) => a + q[0], 0) / pts.length, mz = pts.reduce((a, q) => a + q[1], 0) / pts.length, mh = pts.reduce((a, q) => a + q[2], 0) / pts.length;
      let xx = 0, zz = 0, xz = 0, xh = 0, zh = 0;
      for (const [x, z, h] of pts) { const dx = x - mx, dz = z - mz; xx += dx * dx; zz += dz * dz; xz += dx * dz; xh += dx * (h - mh); zh += dz * (h - mh); }
      const det = xx * zz - xz * xz;
      if (Math.abs(det) < 1e-6) continue;
      const gx = (xh * zz - zh * xz) / det, gz = (zh * xx - xh * xz) / det, gl = Math.hypot(gx, gz);
      if (gl < 0.02) continue;
      const ux = gx / gl, uz = gz / gl, proj = poly.map(([x, z]) => x * ux + z * uz), s0 = Math.min(...proj), s1 = Math.max(...proj);
      const hLow = mh + gl * (s0 - (mx * ux + mz * uz)), hHigh = mh + gl * (s1 - (mx * ux + mz * uz)), n = steps(hHigh - hLow, w.sc), ds = (s1 - s0) / n;
      for (let k = 0; k < n; k++) prism(clipHalf(clipHalf(poly, ux, uz, s0 + (k + 1) * ds), -ux, -uz, -(s0 + k * ds)), hLow - 0.3, hLow + ((hHigh - hLow) * (k + 1)) / n + 0.02);
      continue;
    }
    let len = 0;
    for (let i = 0; i + 1 < w.p.length; i++) len += Math.hypot(w.p[i + 1][0] - w.p[i][0], w.p[i + 1][1] - w.p[i][1]);
    if (len < 1) continue;
    // Ground just beyond each end, along the way.
    const beyond = ([ax, az], [bx, bz]) => { const l = Math.hypot(ax - bx, az - bz) || 1; return terrainAt(ax + ((ax - bx) / l) * 0.6, az + ((az - bz) / l) * 0.6); };
    const h0 = beyond(first, w.p[1]), h1 = beyond(last, w.p[w.p.length - 2]);
    let rise = h1 - h0;
    if (Math.abs(rise) < 0.3) {
      if (!w.inc || !w.sc) continue;
      rise = (w.inc === 'up' ? 1 : -1) * w.sc * 0.16;
    }
    const n = steps(rise, w.sc), width = Math.max(1.2, w.w || 2.5), depth = len / n, bottom = Math.min(h0, h0 + rise) - 0.2;
    let seg = 0, segStart = 0;
    for (let k = 0; k < n; k++) {
      const d = ((k + 0.5) / n) * len;
      while (seg < w.p.length - 2 && d > segStart + Math.hypot(w.p[seg + 1][0] - w.p[seg][0], w.p[seg + 1][1] - w.p[seg][1])) { segStart += Math.hypot(w.p[seg + 1][0] - w.p[seg][0], w.p[seg + 1][1] - w.p[seg][1]); seg++; }
      const [ax, az] = w.p[seg], [bx, bz] = w.p[seg + 1], sl = Math.hypot(bx - ax, bz - az) || 1, t = (d - segStart) / sl;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t, angle = Math.atan2(bx - ax, bz - az);
      // Each tread is a block from its level down below the lower landing.
      const top = h0 + rise * ((rise > 0 ? k + 1 : k) / n) + 0.02;
      treads.push(new THREE.BoxGeometry(width, top - bottom, depth + 0.02).translate(0, (top + bottom) / 2, 0).rotateY(angle).translate(x, 0, z).toNonIndexed());
      // Handrails on flights narrower than 6 m: posts every few treads, a rail at 0.9 m.
      if (width >= 6) continue;
      if (k % 4 === 0) for (const side of [-1, 1]) rails.push(new THREE.BoxGeometry(0.05, 0.9, 0.05).translate(side * (width / 2 - 0.1), top + 0.45, 0).rotateY(angle).translate(x, 0, z));
      for (const side of [-1, 1]) rails.push(new THREE.BoxGeometry(0.05, 0.05, depth + 0.02).translate(side * (width / 2 - 0.1), top + 0.9, 0).rotateY(angle).translate(x, 0, z));
    }
  }
  if (treads.length) {
    const geometry = mergeGeometries(treads.map((g) => { g.deleteAttribute('uv'); g.deleteAttribute('normal'); return g; }));
    geometry.computeVertexNormals();
    const p = geometry.attributes.position.array, nrm = geometry.attributes.normal.array, uv = new Float32Array((p.length / 3) * 2);
    // Treads map from above; risers along their face.
    for (let i = 0, k = 0; i < p.length; i += 3, k += 2) {
      const flat = Math.abs(nrm[i + 1]) > 0.5;
      uv[k] = flat || Math.abs(nrm[i + 2]) > Math.abs(nrm[i]) ? p[i] : p[i + 2];
      uv[k + 1] = flat ? p[i + 2] : p[i + 1];
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const stairs = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb8b5ad, map: textureAt(textures.graniteTexture(), 0.6), roughness: 0.85 }));
    stairs.castShadow = stairs.receiveShadow = true;
    scene.add(stairs);
    if (rails.length) {
      const handrails = new THREE.Mesh(mergeGeometries(rails), new THREE.MeshStandardMaterial({ color: 0x3a3d40, metalness: 0.7, roughness: 0.4 }));
      scene.add(handrails);
    }
  }
}
// Manhole covers in the lanes (every 40 m) and gully gratings along the kerbs (every 25 m).
{
  const covers = [], gullies = [];
  const along = (p, spacing, start, place) => {
    let next = start;
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1], len = Math.hypot(bx - ax, bz - az);
      for (; next < len; next += spacing) place(ax + ((bx - ax) * next) / len, az + ((bz - az) * next) / len, Math.atan2(bx - ax, bz - az));
      next -= len;
    }
  };
  for (const r of data.roads) {
    if (PAVED.has(r.k) || r.w < 5) continue;
    along(offsetPolyline(r.p, r.w / 4), 40, 11, (x, z) => covers.push([x, z, 0]));
    for (const side of [-1, 1]) along(offsetPolyline(r.p, side * (r.w / 2 - 0.3)), 25, 7, (x, z, h) => gullies.push([x, z, h]));
  }
  const place = (geometry, material, list) => {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    const m = new THREE.Matrix4();
    list.forEach(([x, z, h], i) => mesh.setMatrixAt(i, m.makeRotationY(h).setPosition(x, terrainAt(x, z) + ROAD_Y + 0.004, z)));
    mesh.receiveShadow = true;
    scene.add(mesh);
    splitInstanced(mesh, 200);
  };
  place(new THREE.CylinderGeometry(0.32, 0.32, 0.02, 12), new THREE.MeshLambertMaterial({ color: 0x3d3b38 }), covers);
  place(new THREE.BoxGeometry(0.32, 0.02, 0.55), new THREE.MeshLambertMaterial({ color: 0x2a2928 }), gullies);
}

// Road markings (Norwegian style): yellow centre line between opposing traffic, white
// dashed lines between lanes, zebra crossings. Markings stop short of junctions.
const junctions = new Grid(30);
{
  const degree = new Map();
  for (const [a, b] of data.edges) for (const id of [a, b]) degree.set(id, (degree.get(id) || 0) + 1);
  for (const [id, n] of degree) if (n >= 3 && data.nodes[id]) { const [x, z] = data.nodes[id]; junctions.insert({ q: 0, x, z }, x, z, x, z); }
}
const nearJunction = (x, z, r) => {
  let hit = false;
  junctions.query(x - r, z - r, x + r, z + r, (j) => { if (!hit && Math.hypot(j.x - x, j.z - z) < r) hit = true; });
  return hit;
};
const yellowMarks = [], whiteMarks = [], cycleLanes = [], arrowShapes = [];
// The road being marked (null for NVDB lines, which are drawn as mapped), and its deck
// profile (bridges), carried by its paint.
let markHeight, markRoad;
// Paints a line along a polyline at a lateral offset (+ is right of the drawing direction).
// The dash pattern runs continuously along the whole road; pieces near junctions are left out.
function paintLine(p, off, dash, gap, width, out, clearance) {
  const line = off ? offsetPolyline(p, off) : p;
  const period = dash + gap;
  let s = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    let t = 0;
    while (t < len - 1e-3) {
      const phase = (s + t) % period;
      const inDash = gap === 0 || phase < dash;
      const step = Math.min(len - t, gap === 0 ? 2 : inDash ? dash - phase : period - phase);
      if (inDash && step > 0.05) {
        const t1 = t + step, mx = ax + ((bx - ax) * (t + t1)) / 2 / len, mz = az + ((bz - az) * (t + t1)) / 2 / len;
        if (!nearJunction(mx, mz, clearance) && (markHeight || !markRoad || !roadIndex.crossing(mx, mz, (bx - ax) / len, (bz - az) / len, markRoad, 0.5))) out.push({ height: markHeight, p: [[ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len], [ax + ((bx - ax) * t1) / len, az + ((bz - az) * t1) / len]], w: width });
      }
      t += step;
    }
    s += len;
  }
}
// A polyline cut into the runs that don't lie on a crossing street's carriageway (1 m steps).
function clipAtCrossings(p, self) {
  if (self.height) return [p];
  const runs = [];
  let run = [];
  for (let i = 0; i + 1 < p.length; i++) {
    const [ax, az] = p[i], [bx, bz] = p[i + 1], len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len));
    if (len < 0.01) continue;
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
      if (roadIndex.crossing(x, z, (bx - ax) / len, (bz - az) / len, self, 0.2)) { if (run.length > 1) runs.push(run); run = []; }
      else if (!run.length || Math.hypot(x - run[run.length - 1][0], z - run[run.length - 1][1]) > 0.05) run.push([x, z]);
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}
// Point and forward direction a distance `back` before the end of a polyline (or after the
// start when back < 0, facing the other way).
function alongEnd(p, back) {
  const pts = back >= 0 ? p : p.slice().reverse();
  let need = Math.abs(back);
  for (let i = pts.length - 1; i > 0; i--) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len >= need || i === 1) {
      const f = Math.max(0, 1 - need / len);
      return { dx: (bx - ax) / len, dz: (bz - az) / len, x: ax + (bx - ax) * f, z: az + (bz - az) * f };
    }
    need -= len;
  }
  return null;
}
// Turn arrow glyphs (shapes in metres, pointing +y): straight, left, right, combined.
function arrowGlyph(turns) {
  const shapes = [];
  const shaft = (x0, y0, x1, y1, w = 0.15) => {
    const len = Math.hypot(x1 - x0, y1 - y0), nx = (-(y1 - y0) / len) * w, ny = ((x1 - x0) / len) * w;
    shapes.push(new THREE.Shape([new THREE.Vector2(x0 - nx, y0 - ny), new THREE.Vector2(x1 - nx, y1 - ny), new THREE.Vector2(x1 + nx, y1 + ny), new THREE.Vector2(x0 + nx, y0 + ny)]));
  };
  const head = (x, y, dx, dy) => {
    const nx = -dy, ny = dx;
    shapes.push(new THREE.Shape([new THREE.Vector2(x + dx * 0.9, y + dy * 0.9), new THREE.Vector2(x + nx * 0.45, y + ny * 0.45), new THREE.Vector2(x - nx * 0.45, y - ny * 0.45)]));
  };
  shaft(0, 0, 0, 2.2);
  if (turns.includes('through')) { shaft(0, 2.2, 0, 3.6); head(0, 3.6, 0, 1); }
  if (turns.includes('left')) { shaft(0, 2.2, -1.0, 3.2); head(-1.0, 3.2, -0.71, 0.71); }
  if (turns.includes('right')) { shaft(0, 2.2, 1.0, 3.2); head(1.0, 3.2, 0.71, 0.71); }
  return shapes;
}
// NVDB's painted lines (Statens vegvesen, NLOD) where mapped, in the Norwegian patterns
// (dash, gap in metres); streets they cover get no generated lane lines.
const NVDB_LINES = { barrier: [1, 0, 0.1], divider: [3, 9, 0.1], edge: [1, 0, 0.12], edgeDash: [3, 3, 0.12], hatch: [1, 0, 0.15], lane: [3, 9, 0.1], warning: [9, 3, 0.1] };
const nvdbLinePoints = new Grid(20);
for (const t of Object.values(streets.tiles)) for (const l of t.lines || []) {
  const [dash, gap, width] = NVDB_LINES[l.k];
  const [mx, mz] = l.p[l.p.length >> 1];
  if (bridgeDecks.deckAt(mx, mz) !== null) continue;
  // NVDB maps some lines twice (per direction or per contract): skip a line when most of it
  // lies within 30 cm of one already drawn.
  let shared = 0;
  for (const [x, z] of l.p) { let close = false; nvdbLinePoints.query(x - 0.3, z - 0.3, x + 0.3, z + 0.3, (q) => { if (Math.hypot(q.x - x, q.z - z) < 0.3) close = true; }); if (close) shared++; }
  if (shared > l.p.length * 0.6) continue;
  markHeight = undefined;
  markRoad = null;
  paintLine(l.p, 0, dash, gap, width, l.c ? yellowMarks : whiteMarks, 0);
  for (const [x, z] of l.p) nvdbLinePoints.insert({ x, z }, x, z, x, z);
}
const nvdbMarked = (r) => {
  const [mx, mz] = r.p[r.p.length >> 1], reach = r.w / 2 + 1.5;
  let hit = false;
  nvdbLinePoints.query(mx - reach, mz - reach, mx + reach, mz + reach, (q) => { if (Math.hypot(q.x - mx, q.z - mz) < reach) hit = true; });
  return hit;
};
for (const r of data.roads) {
  if (PAVED.has(r.k) || r.w < 5 || r.m === 0) continue;
  markHeight = r.height;
  markRoad = r;
  const clearance = r.w / 2 + 4, generated = !nvdbMarked(r);
  // Lanes per direction; Norway drives on the right, so oncoming lanes are on the left.
  const total = r.l || (r.o ? Math.max(1, Math.round(r.w / 3.3)) : r.w >= 11 ? 4 : 2);
  const fwd = r.o ? total : r.lf || Math.ceil(total / 2);
  const back = r.o ? 0 : r.lb || total - fwd;
  const cycleL = r.cl ? 1.6 : 0, cycleR = r.cr ? 1.6 : 0;
  const laneW = (r.w - cycleL - cycleR) / Math.max(1, fwd + back);
  const left = -r.w / 2 + cycleL;
  const divider = left + back * laneW;
  if (back > 0 && generated) {
    if (fwd + back >= 4) { paintLine(r.p, divider - 0.12, 1, 0, 0.1, yellowMarks, clearance); paintLine(r.p, divider + 0.12, 1, 0, 0.1, yellowMarks, clearance); }
    else paintLine(r.p, divider, 3, 9, 0.12, yellowMarks, clearance);
  }
  for (let k = 1; generated && k < back; k++) paintLine(r.p, left + k * laneW, 3, 9, 0.1, whiteMarks, clearance);
  for (let k = 1; generated && k < fwd; k++) paintLine(r.p, divider + k * laneW, 3, 9, 0.1, whiteMarks, clearance);
  if (cycleR) { cycleLanes.push(...clipAtCrossings(offsetPolyline(r.p, r.w / 2 - cycleR / 2), r).map((p) => ({ height: r.height, p, w: cycleR }))); if (generated) paintLine(r.p, r.w / 2 - cycleR, 1, 0, 0.15, whiteMarks, 2); }
  if (cycleL) { cycleLanes.push(...clipAtCrossings(offsetPolyline(r.p, -r.w / 2 + cycleL / 2), r).map((p) => ({ height: r.height, p, w: cycleL }))); if (generated) paintLine(r.p, -r.w / 2 + cycleL, 1, 0, 0.15, whiteMarks, 2); }
  // Turn arrows 12 m before the end of the forward lanes (and of the oncoming lanes).
  const arrows = (spec, laneCount, firstLane, atEnd) => {
    if (!spec) return;
    const lanes = spec.split('|');
    if (lanes.length !== laneCount) return;
    const at = alongEnd(r.p, atEnd ? 12 : -12);
    if (!at) return;
    lanes.forEach((turns, i) => {
      const glyph = arrowGlyph(turns || 'through');
      // Offsets are in the frame of the lane's own travel direction.
      const offset = firstLane + (i + 0.5) * laneW;
      const cx = at.x - at.dz * offset, cz = at.z + at.dx * offset;
      arrowShapes.push({ angle: Math.atan2(at.dx, at.dz), glyph, x: cx, z: cz });
    });
  };
  arrows(r.o ? r.t : r.tf, fwd, divider, true);
  if (!r.o) arrows(r.tb, back, -divider, false);
}
// Zebra crossings: NVDB's mapped outlines (drawn per tile, see the street layers); elsewhere
// from OSM crossing ways, white bars parallel to the traffic stepped along the crossing,
// only on the carriageway (not on the kerb, the dropped kerb or an island).
const nvdbCrossings = new Grid(20);
for (const p of streets.crossings) {
  const xs = p.map((q) => q[0]), zs = p.map((q) => q[1]);
  nvdbCrossings.insert({ p }, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs));
}
// Within 3 m of a mapped NVDB crossing outline (inside it, or near its edge).
const nearNvdbCrossing = (x, z) => {
  let hit = false;
  nvdbCrossings.query(x - 3, z - 3, x + 3, z + 3, ({ p }) => {
    if (hit || pointInPoly(x, z, p)) { hit = true; return; }
    for (let i = 0; i < p.length && !hit; i++) { const [nx, nz] = nearestOnSegment(x, z, ...p[i], ...p[(i + 1) % p.length]); if (Math.hypot(nx - x, nz - z) < 3) hit = true; }
  });
  return hit;
};
for (const c of data.walks.filter((w) => w.k === 'crossing')) {
  for (let i = 0; i + 1 < c.p.length; i++) {
    const [ax, az] = c.p[i], [bx, bz] = c.p[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    for (let t = 0.4; t < len; t += 1.0) {
      const x = ax + dx * t, z = az + dz * t;
      if (!roadIndex.on(x, z, -0.3) || nearNvdbCrossing(x, z)) continue;
      whiteMarks.push({ p: [[x - dz * 1.5, z + dx * 1.5], [x + dz * 1.5, z - dx * 1.5]], w: 0.5 });
    }
  }
}
paintNear(cycleLanes, 0.108, 0xa0483c, false);
paintNear(yellowMarks, 0.115, 0xe8b923, false);
paintNear(whiteMarks, 0.115, 0xf2f2ea, false);
{
  const geos = [];
  for (const { angle, glyph, x, z } of arrowShapes) {
    for (const shape of glyph) {
      const g = new THREE.ShapeGeometry(shape).toNonIndexed();
      g.rotateX(-Math.PI / 2);
      g.rotateY(angle + Math.PI);
      g.translate(x, 0.116, z);
      geos.push(g);
    }
  }
  if (geos.length) {
    const arrows = new THREE.Mesh(drape(mergeGeometries(geos), terrainAt, 2), new THREE.MeshLambertMaterial({ color: 0xf2f2ea, side: THREE.DoubleSide }));
    arrows.receiveShadow = true;
    scene.add(arrows);
  }
}

// Landmarks are drawn from their OSM building parts (real tower heights and roof shapes),
// in their real colours.
// `plain` landmarks get masonry walls instead of rows of apartment windows.
const COPPER = '#4d6f62';
const LANDMARK_COLOURS = {
  'Nationaltheatret': { roof: COPPER, wall: '#e3d8c0' },
  'Operahuset i Oslo': { plain: true, roof: '#f4f3ee', wall: '#f4f3ee' },
  // The cathedral tower turns to green copper above the brick (29 m).
  'Oslo domkirke': { plain: true, roof: COPPER, upper: { from: 28, plain: true, roof: COPPER, wall: COPPER }, wall: '#a8553a' },
  'Oslo rådhus': { facade: 'radhus', roof: COPPER, wall: '#8e3b2c' },
  'Akershus slott': { roof: '#55605c', wall: '#e6e0d2' },
  // Østbanehallen (the old east station): cream render, round-arched windows, slate roof.
  'Oslo Østbanestasjon (Oslo Ø)': { facade: 'arched', roof: '#6e7377', wall: '#ece4d0' },
  // The Royal Palace: pale yellow stucco, slate hipped roof (height measured).
  'Det kongelige slott': { roof: '#5f6468', shape: { r: 'hipped', rh: 5 }, wall: '#ecdcae' },
  'Domus academica': { roof: '#a3a9ae', wall: '#ece6d8' },
  'Nasjonalmuseet': { plain: true, roof: '#d9d6cc', wall: '#5a5f63' },
  'Norges Bank': { roof: COPPER, wall: '#d9cdb5' },
  'Stortinget': { roof: '#4d5156', wall: '#c49a5a' },
  'Trefoldighetskirken': { plain: true, roof: COPPER, wall: '#9e4a36' },
  // The university buildings on Karl Johan: white neoclassical with zinc roofs.
  'Domus bibliotheca': { roof: '#a3a9ae', wall: '#ece6d8' },
  'Domus media': { roof: '#a3a9ae', wall: '#ece6d8' },
  'Historisk museum': { roof: '#8f959a', wall: '#ddd3c2' },
  'Nasjonalgalleriet': { roof: '#8f959a', wall: '#e3d6bd' },
};
const centroid = (p) => [p.reduce((sum, q) => sum + q[0], 0) / p.length, p.reduce((sum, q) => sum + q[1], 0) / p.length];
// Landmarks drawn from their mapped 3D parts, each part with its own look; `survey` parts
// take their roof from the laser surface model instead (the Opera's sloping marble roof).
const MARBLE = '#eceae4';
const LANDMARK_PARTS = {
  // The Jernbanetorget entrance: glass between brown granite piers under maroon gabled metal
  // roofs, the glass station hall behind, the hotel towers above; platform canopies as mapped.
  'Oslo sentralstasjon (Oslo S)': (part) => (part.rm === 'metal' ? null
    : part.bt === 'hotel' ? { facade: 'modern', roof: '#7d8083', wall: '#d6d0c4' }
    : part.h <= 8 ? { facade: 'glass', roof: '#6e3a35', shape: { r: 'gabled', rh: 3 }, wall: '#b8aca2' }
    : { facade: 'glass', roof: '#6e3a35', wall: '#c2bab2' }),
  // Glass foyer walls up to the sloping marble roof and the marble roof running down into
  // the fjord (both shaped by the surface model), the windowless white aluminium stage
  // towers, and aluminium-clad workshops and offices.
  'Operahuset i Oslo': (part) => (part.m === 'glass' ? { survey: { facadeFor: () => ({ color: '#c8dbe3', style: 'glass' }), maxH: part.h + (part.rh || 0) + 1, roofTint: MARBLE } }
    : part.m === 'concrete' ? { plain: true, roof: '#d9d9d6', wall: '#e9e9e5' }
    : part.h <= 15.1 && !part.rm ? { survey: { facadeFor: () => ({ color: MARBLE, style: 'masonry' }), roofTint: MARBLE } }
    : { facade: 'modern', roof: '#d9d9d6', wall: '#dcdedb' }),
};
// Applies a landmark's colours, facade and shape (no shopfronts); mapped glass parts (the Opera's glass walls) stay glass.
const landmarkLook = (b, colours) => (b.m === 'glass' ? b : { ...b, ...colours.shape, c: colours.wall, facade: colours.facade, noShops: true, plain: colours.plain, rc: colours.roof });
const buildings = [];
const buildingGrid = new Grid(40);
// Fences, railings, walls and hedges block people and vehicles like thin walls.
const barrierGrid = new Grid(20);
const poleGrid = new Grid(20);
const cityMeshes = [];
// Plain blocks per streaming tile, shown while that tile's detailed buildings aren't loaded.
const farBlocks = [];
{
  const drawn = [];
  // Every building and part stands on the lowest ground under its footprint.
  for (const b of [...data.buildings, ...data.parts]) b.ground = Math.min(...b.p.map(([x, z]) => terrainAt(x, z)));
  for (const b of data.buildings) {
    addCollider(b.p, b.ground + b.h + (b.rh || 0));
    const colours = LANDMARK_COLOURS[b.n];
    // Shaped by the laser surface model (real roofs, setbacks, towers), unless the building is
    // drawn from its mapped 3D parts.
    if (!b.parts) drawn.push({ ...(colours ? landmarkLook(b, colours) : b), roofAt: terrain.surfaceAt });
  }
  // Parts take the colours of the landmark they belong to.
  const landmarks = data.buildings.filter((b) => LANDMARK_COLOURS[b.n] || LANDMARK_PARTS[b.n]);
  for (const part of data.parts) {
    const [cx, cz] = centroid(part.p);
    const owner = landmarks.find((b) => pointInPoly(cx, cz, b.p));
    const look = owner && LANDMARK_PARTS[owner.n]?.(part), colours = owner && LANDMARK_COLOURS[owner.n];
    if (look?.survey) drawn.push({ ...part, ...look.survey, noShops: true, roofAt: terrain.surfaceAt });
    else if (look) drawn.push(landmarkLook(part, look));
    else drawn.push(colours ? landmarkLook(part, colours.upper && (part.mh || 0) >= colours.upper.from ? colours.upper : colours) : part);
  }
  const facade = textures.facadeTexture(), shop = textures.shopTexture();
  const bays = (t) => { t.repeat.set(0.25, 0.25); return t; };
  // Facades are PBR: the surface map makes render matt and window glass glossy, so windows
  // pick up the sky; the colour map doubles as a bump map for sills, surrounds and courses.
  const facadeMaterial = (map, surface, bump = 0.6) => new THREE.MeshStandardMaterial({ bumpMap: map, bumpScale: bump, map, metalness: 1, metalnessMap: surface, roughness: 1, roughnessMap: surface, vertexColors: true });
  const materials = {
    arched: nightLit(facadeMaterial(textures.archedTexture(), textures.archedSurface()), bays(textures.facadeNight()), 1),
    awnings: new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, vertexColors: true }),
    glass: nightLit(new THREE.MeshStandardMaterial({ map: textures.glassTexture(), metalness: 0.7, roughness: 0.08, vertexColors: true }), bays(textures.modernNight()), 0.7),
    masonry: new THREE.MeshStandardMaterial({ bumpMap: textures.masonryTexture(), bumpScale: 0.8, map: textures.masonryTexture(), roughness: 0.9, vertexColors: true }),
    modern: nightLit(facadeMaterial(textures.modernTexture(), textures.modernSurface()), bays(textures.modernNight()), 0.9),
    radhus: nightLit(facadeMaterial(textures.radhusTexture(), textures.radhusSurface(), 1), textures.radhusNight(), 0.8),
    roofs: new THREE.MeshStandardMaterial({ metalness: 0.25, roughness: 0.6, side: THREE.DoubleSide, vertexColors: true }),
    shops: nightLit(facadeMaterial(shop, textures.shopSurface(), 0.4), textures.shopNight(), 1.1),
    trim: new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true }),
    walls: nightLit(facadeMaterial(facade, textures.facadeSurface()), bays(textures.facadeNight()), 1),
  };
  // Detailed buildings stream in with their tile; until then (and far away) each building
  // is a plain block in its colours. The blocks also cast the shadows and stop bullets.
  const tiles = new Map(), blocks = new Map();
  for (const b of drawn) {
    const [cx, cz] = centroid(b.p), key = `${Math.floor(cx / streamer.size)}|${Math.floor(cz / streamer.size)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(b);
    const base = (b.mh || 0) + (b.ground || 0), top = Math.max(b.h, b.mh || 0) + (b.ground || 0) + (b.rh || 0) * 0.6;
    if (top - base < 0.5) continue;
    const shape = new THREE.Shape(b.p.map(([x, z]) => new THREE.Vector2(x, -z)));
    for (const h of b.holes || []) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
    const g = new THREE.ExtrudeGeometry(shape, { bevelEnabled: false, depth: top - base }).rotateX(-Math.PI / 2).translate(0, base, 0).toNonIndexed();
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    const look = buildingLook(b, !!b.r), n = g.attributes.normal, colors = new Float32Array(n.count * 3);
    for (let i = 0; i < n.count; i++) colors.set((n.getY(i) > 0.5 ? look.roof : look.wall).toArray(), i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key).push(g);
  }
  const blockMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  for (const [key, geos] of blocks) {
    const geometry = mergeGeometries(geos), mesh = new THREE.Mesh(geometry, blockMaterial);
    geometry.computeBoundingSphere();
    mesh.receiveShadow = true;
    scene.add(mesh);
    cityMeshes.push(mesh);
    farBlocks.push({ key, mesh });
    shadowProxy(new THREE.Mesh(geometry, proxyMaterial));
  }
  // A tile's buildings are built a dozen at a time across frames, then merged per material.
  streamer.addLayer(function* (tile) {
    const list = tiles.get(tile.key);
    if (!list) return null;
    const parts = {};
    for (let i = 0; i < list.length; i += 12) {
      for (const [kind, geo] of Object.entries(buildingGeometries(list.slice(i, i + 12), data.facades?.length ? data.facades : undefined))) {
        if (geo.attributes.position.count) (parts[kind] ||= []).push(geo);
      }
      yield;
    }
    const meshes = [];
    for (const [kind, geos] of Object.entries(parts)) {
      const geo = geos.length > 1 ? mergeGeometries(geos) : geos[0];
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, materials[kind]);
      mesh.receiveShadow = true;
      meshes.push(mesh);
    }
    return meshes;
  });
}

// City Hall clock: gilded faces on every side of the east tower, 7 m below its top.
{
  const hall = data.buildings.find((b) => b.n === 'Oslo rådhus');
  const towers = hall ? data.parts.filter((q) => q.h > 55 && pointInPoly(...centroid(q.p), hall.p)) : [];
  const east = towers.sort((a, b) => centroid(b.p)[0] - centroid(a.p)[0])[0];
  if (east) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#c9a548'; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1d2a33'; g.beginPath(); g.arc(128, 128, 110, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e2c46a';
    for (let i = 0; i < 12; i++) { g.save(); g.translate(128, 128); g.rotate((i * Math.PI) / 6); g.fillRect(-5, -102, 10, i % 3 ? 16 : 28); g.restore(); }
    g.strokeStyle = '#e2c46a'; g.lineCap = 'round';
    g.lineWidth = 10; g.beginPath(); g.moveTo(128, 128); g.lineTo(128, 62); g.stroke();
    g.lineWidth = 7; g.beginPath(); g.moveTo(128, 128); g.lineTo(186, 150); g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.5, roughness: 0.35 });
    const [cx, cz] = centroid(east.p);
    for (let i = 0; i < east.p.length; i++) {
      const a = east.p[i], b = east.p[(i + 1) % east.p.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 6) continue;
      let nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if (nx * (mx - cx) + nz * (mz - cz) < 0) { nx = -nx; nz = -nz; }
      const clock = new THREE.Mesh(new THREE.CircleGeometry(Math.min(3.2, len * 0.3), 40), face);
      clock.position.set(mx + nx * 0.08, (east.ground || 0) + east.h - 7, mz + nz * 0.08);
      clock.rotation.y = Math.atan2(nx, nz);
      scene.add(clock);
    }
  }
}

function addCollider(p, h) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of p) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const rec = { h, maxX, maxZ, minX, minZ, p, q: 0 };
  buildings.push(rec);
  buildingGrid.insert(rec, minX, minZ, maxX, maxZ);
  return rec;
}

function buildingAt(x, z) {
  let found = null;
  buildingGrid.query(x, z, x, z, (b) => {
    if (!found && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && pointInPoly(x, z, b.p)) found = b;
  });
  return found;
}

// Pushes a circle out of buildings. Mutates o.x/o.z and returns the strongest contact normal.
// Above a height (a flying car's underside), only buildings taller than that count.
function collideCircle(o, r, above = -Infinity) {
  let hit = null;
  buildingGrid.query(o.x - r, o.z - r, o.x + r, o.z + r, (b) => {
    if (b.h <= above) return;
    if (o.x + r < b.minX || o.x - r > b.maxX || o.z + r < b.minZ || o.z - r > b.maxZ) return;
    const p = b.p;
    let best = Infinity, qx = 0, qz = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], c = p[(i + 1) % p.length];
      const [x, z] = nearestOnSegment(o.x, o.z, a[0], a[1], c[0], c[1]);
      const d = (x - o.x) ** 2 + (z - o.z) ** 2;
      if (d < best) { best = d; qx = x; qz = z; }
    }
    const d = Math.sqrt(best) || 1e-4;
    const inside = pointInPoly(o.x, o.z, p);
    if (!inside && d >= r) return;
    let nx = (o.x - qx) / d, nz = (o.z - qz) / d;
    if (inside) { nx = -nx; nz = -nz; }
    const depth = inside ? d + r : r - d;
    o.x = qx + nx * r;
    o.z = qz + nz * r;
    if (!hit || depth > hit.depth) hit = { depth, nx, nz };
  });
  if (above > -Infinity) return hit;
  barrierGrid.query(o.x - r, o.z - r, o.x + r, o.z + r, (seg) => {
    const [x, z] = nearestOnSegment(o.x, o.z, seg.ax, seg.az, seg.bx, seg.bz), dx = o.x - x, dz = o.z - z, d = Math.hypot(dx, dz), reach = r + seg.r;
    if (d >= reach || d < 1e-4) return;
    o.x = x + (dx / d) * reach;
    o.z = z + (dz / d) * reach;
    if (!hit || reach - d > hit.depth) hit = { depth: reach - d, nx: dx / d, nz: dz / d };
  });
  poleGrid.query(o.x - r, o.z - r, o.x + r, o.z + r, (pole) => {
    if (pole.down) return;
    const dx = o.x - pole.x, dz = o.z - pole.z, d = Math.hypot(dx, dz), reach = r + pole.r;
    if (d >= reach || d < 1e-4) return;
    o.x = pole.x + (dx / d) * reach;
    o.z = pole.z + (dz / d) * reach;
    if (!hit || reach - d > hit.depth) hit = { depth: reach - d, nx: dx / d, nz: dz / d };
  });
  return hit;
}

// ============================================================================
// World bounds, minimap, water mask
// ============================================================================
let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
for (const r of data.roads) for (const [x, z] of r.p) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
const WORLD = { maxX: maxX + 60, maxZ: maxZ + 60, minX: minX - 60, minZ: minZ - 60 };
const MAP_SCALE = 0.5;
const mapCanvas = document.createElement('canvas');
mapCanvas.width = Math.ceil((WORLD.maxX - WORLD.minX) * MAP_SCALE);
mapCanvas.height = Math.ceil((WORLD.maxZ - WORLD.minZ) * MAP_SCALE);
const toMap = ([x, z]) => [(x - WORLD.minX) * MAP_SCALE, (z - WORLD.minZ) * MAP_SCALE];

function drawPolys(g, polys, fill) {
  g.fillStyle = fill;
  for (const p of polys) {
    g.beginPath();
    p.forEach((pt, i) => { const [x, y] = toMap(pt); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.closePath();
    g.fill();
  }
}
function drawLines(g, lines, color, scale = 1) {
  g.strokeStyle = color;
  g.lineCap = g.lineJoin = 'round';
  for (const l of lines) {
    g.lineWidth = l.w * MAP_SCALE * scale;
    g.beginPath();
    l.p.forEach((pt, i) => { const [x, y] = toMap(pt); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  }
}
{
  const g = mapCanvas.getContext('2d');
  g.fillStyle = '#e8e5df';
  g.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
  drawPolys(g, data.sea, '#9cc3e4');
  drawPolys(g, data.islands, '#c9e3b8');
  drawPolys(g, data.ground.urban || [], '#e2dfd8');
  drawPolys(g, [...(data.ground.grass || []), ...data.parks, ...(data.ground.pitch || []), ...(data.ground.flowers || [])], '#bfe1a8');
  drawPolys(g, data.ground.wood || [], '#a6d08f');
  drawPolys(g, data.ground.paving || [], '#f1eee8');
  drawPolys(g, data.ground.pier || [], '#d8cbb8');
  drawPolys(g, data.water, '#9cc3e4');
  drawPolys(g, buildings.map((b) => b.p), '#d3cec5');
  drawLines(g, data.walks, '#d9d4cc', 0.8);
  drawLines(g, data.roads.filter((r) => PAVED.has(r.k)), '#f7f5f1');
  drawLines(g, data.roads.filter((r) => !PAVED.has(r.k)), '#ffffff', 1.1);
  drawLines(g, data.roads.filter((r) => !PAVED.has(r.k) && r.w >= 11), '#fbe3a3', 0.9);
}

// Surface mask: red = drivable road, green = walkway/plaza, blue = water.
const MASK_SCALE = 0.5;
const surfaceMask = (() => {
  const c = document.createElement('canvas');
  c.width = Math.ceil((WORLD.maxX - WORLD.minX) * MASK_SCALE);
  c.height = Math.ceil((WORLD.maxZ - WORLD.minZ) * MASK_SCALE);
  const g = c.getContext('2d');
  g.setTransform(MASK_SCALE / MAP_SCALE, 0, 0, MASK_SCALE / MAP_SCALE, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
  drawPolys(g, data.sea, '#00f');
  drawPolys(g, data.islands, '#000');
  drawPolys(g, data.water.filter((p) => p.length > 15), '#00f');
  drawPolys(g, data.ground.pier || [], '#000');
  drawLines(g, data.roads.filter((r) => !PAVED.has(r.k)), '#f00');
  drawLines(g, data.roads.filter((r) => PAVED.has(r.k)), '#0f0');
  drawLines(g, data.walks, '#0f0');
  return { data: g.getImageData(0, 0, c.width, c.height).data, h: c.height, w: c.width };
})();
function surfaceAt(x, z, channel) {
  const px = Math.floor((x - WORLD.minX) * MASK_SCALE), pz = Math.floor((z - WORLD.minZ) * MASK_SCALE);
  if (px < 0 || pz < 0 || px >= surfaceMask.w || pz >= surfaceMask.h) return false;
  return surfaceMask.data[(pz * surfaceMask.w + px) * 4 + channel] > 128;
}
const isRoad = (x, z) => surfaceAt(x, z, 0);
// Bus and tram platforms (mapped areas) stand on the kerb too.
const platforms = data.stops.filter((st) => st.p);
// Where the ground is raised onto the kerb (sidewalks, traffic islands and platforms).
const kerbMask = (() => {
  const c = document.createElement('canvas');
  c.width = surfaceMask.w;
  c.height = surfaceMask.h;
  const g = c.getContext('2d');
  g.setTransform(MASK_SCALE / MAP_SCALE, 0, 0, MASK_SCALE / MAP_SCALE, 0, 0);
  // Sidewalks and islands (with their holes), bridge sidewalks.
  g.fillStyle = '#fff';
  for (const t of Object.values(streets.tiles)) for (const poly of t.walk || []) {
    g.beginPath();
    for (const ring of poly) ring.forEach((pt, i) => { const [x, y] = toMap(pt); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.fill('evenodd');
  }
  drawLines(g, bridgeWalks, '#fff');
  drawPolys(g, platforms.map((st) => st.p), '#fff');
  return g.getImageData(0, 0, c.width, c.height).data;
})();
// Height of the walkable surface: on the kerb, on the carriageway, or plain ground.
// Where something at height nearY stands: a bridge deck if it is on one (at deck level,
// not passing underneath), otherwise the ground.
function surfaceHeight(x, z, nearY) {
  const deck = bridgeDecks.deckAt(x, z, nearY);
  return deck === null ? groundHeight(x, z) : deck + ROAD_Y;
}
const onBridge = (x, z, nearY) => bridgeDecks.deckAt(x, z, nearY) !== null;
function groundHeight(x, z) {
  const px = Math.floor((x - WORLD.minX) * MASK_SCALE), pz = Math.floor((z - WORLD.minZ) * MASK_SCALE), g = terrainAt(x, z);
  if (px < 0 || pz < 0 || px >= surfaceMask.w || pz >= surfaceMask.h) return g;
  const i = (pz * surfaceMask.w + px) * 4;
  return g + (kerbMask[i] > 128 ? KERB_TOP : surfaceMask.data[i] > 128 ? ROAD_Y : 0.03);
}

// Where tall grass (red) and flowers (green) grow: lawns and flowerbeds, minus paths,
// roads and buildings.
const vegetationMask = (() => {
  const c = document.createElement('canvas');
  c.width = mapCanvas.width;
  c.height = mapCanvas.height;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  drawPolys(g, [...(data.ground.grass || []), ...data.parks, ...(data.ground.wood || [])], '#f00');
  drawPolys(g, data.ground.flowers || [], '#0f0');
  drawPolys(g, [...(data.ground.paving || []), ...(data.ground.asphalt || []), ...(data.ground.pitch || []), ...(data.ground.playground || [])], '#000');
  drawPolys(g, buildings.map((b) => b.p), '#000');
  drawLines(g, data.walks, '#000', 1.3);
  drawLines(g, data.roads, '#000', 1.1);
  return { data: g.getImageData(0, 0, c.width, c.height).data, w: c.width };
})();
function vegetationAt(x, z) {
  const px = Math.floor((x - WORLD.minX) * MAP_SCALE), pz = Math.floor((z - WORLD.minZ) * MAP_SCALE);
  if (px < 0 || pz < 0 || px >= vegetationMask.w) return 0;
  const i = (pz * vegetationMask.w + px) * 4;
  return vegetationMask.data[i + 1] > 128 ? 2 : vegetationMask.data[i] > 128 ? 1 : 0;
}
const grassField = createGrassField(scene, vegetationAt, terrainAt);
const isWater = (x, z) => surfaceAt(x, z, 2);

// Named road segments for the street-name HUD.
const streetGrid = new Grid(40);
for (const r of data.roads) {
  if (!r.n) continue;
  for (let i = 0; i + 1 < r.p.length; i++) {
    const a = r.p[i], b = r.p[i + 1];
    streetGrid.insert({ a, b, n: r.n, q: 0 }, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]));
  }
}
function streetAt(x, z) {
  let best = 18 * 18, name = null;
  streetGrid.query(x - 18, z - 18, x + 18, z + 18, (s) => {
    const [qx, qz] = nearestOnSegment(x, z, s.a[0], s.a[1], s.b[0], s.b[1]);
    const d = (qx - x) ** 2 + (qz - z) ** 2;
    if (d < best) { best = d; name = s.n; }
  });
  return name;
}

// ============================================================================
// Sloyd landmarks and street props
// ============================================================================
// Smallest rotated rectangle around a footprint: { cx, cz, w (along u), d, angle of u }.
// Places one static Sloyd model. rotY follows three.js (local +x maps to (cos, -sin)).
function placeModel(name, x, z, rotY, sx, sy = sx, sz = sx, y = terrainAt(x, z)) {
  const group = new THREE.Group();
  for (const { geometry, material } of baked[name].parts) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    cityMeshes.push(mesh);
  }
  group.position.set(x, y, z);
  group.rotation.y = rotY;
  group.scale.set(sx, sy, sz);
  scene.add(group);
  return group;
}

function rectCollider(x, z, rotY, w, d, h) {
  const ux = Math.cos(rotY), uz = -Math.sin(rotY), vx = Math.sin(rotY), vz = Math.cos(rotY);
  const corner = (a, b) => [x + ux * a + vx * b, z + uz * a + vz * b];
  addCollider([corner(-w / 2, -d / 2), corner(w / 2, -d / 2), corner(w / 2, d / 2), corner(-w / 2, d / 2)], h);
}


// Finds a spot near (x, z) with no buildings, roads or water within `clear` meters.
function freeSpot(x, z, clear, maxRadius = 80) {
  const ok = (px, pz) => {
    for (let a = 0; a < 8; a++) {
      const sx = px + Math.cos(a * Math.PI / 4) * clear, sz = pz + Math.sin(a * Math.PI / 4) * clear;
      if (buildingAt(sx, sz) || isRoad(sx, sz) || isWater(sx, sz)) return false;
    }
    return !buildingAt(px, pz) && !isRoad(px, pz) && !isWater(px, pz);
  };
  for (let r = 0; r <= maxRadius; r += 4) {
    for (let a = 0; a < Math.PI * 2; a += r ? 4 / r : 7) {
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (ok(px, pz)) return [px, pz];
    }
  }
  return null;
}

const sites = {};
const lampHeads = [];

// Instanced props, batched per 200 m chunk so off-screen chunks are culled.
const propBatches = new Map();
const propChunks = [];
const batchMeshes = new Map();
const BREAKABLE = new Set(['bench', 'bikestand', 'garbage', 'postbox', 'streetlight']);
const CHUNK = 400;
const PROP_RANGE = 420;
// Trees are the heaviest props and blur into the fog sooner.
const TREE_RANGE = 280;
function addProp(name, x, z, rotY = 0, scale = 1, pole = 0, y = groundHeight(x, z)) {
  const key = `${name}|${Math.floor(x / CHUNK)}|${Math.floor(z / CHUNK)}`;
  if (!propBatches.has(key)) propBatches.set(key, { matrices: [], name });
  const { matrices } = propBatches.get(key);
  matrices.push(new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(scale, scale, scale),
  ));
  const instance = { index: matrices.length - 1, key, name };
  if (pole) poleGrid.insert({ breakable: BREAKABLE.has(name), down: false, instances: [instance], q: 0, r: pole, x, z }, x, z, x, z);
  return instance;
}
// Bus and tram stops where riders really wait (OSM platforms): raised platforms with granite
// kerbs and a pale tactile edge, a shelter where one is mapped (its open side to the street),
// and a Ruter stop sign with the stop's name and routes at the end nearest the street.
function buildStops() {
  const top = [], sides = [], edge = [];
  // Facing the street: the nearest point on a route calling at the stop.
  const streetNear = (st) => {
    let best = null;
    for (const r of data.routes) {
      if (!st.r.includes(r.ref)) continue;
      for (let i = 0; i + 1 < r.p.length; i++) {
        const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((st.x - ax) * dx + (st.z - az) * dz) / (dx * dx + dz * dz || 1)));
        const x = ax + dx * t, z = az + dz * t, d = Math.hypot(x - st.x, z - st.z);
        if (!best || d < best.d) best = { d, x, z };
      }
    }
    return best;
  };
  const signs = [];
  for (const st of data.stops) {
    const street = streetNear(st);
    if (!street || street.d > 40) continue;
    const fx = (street.x - st.x) / (street.d || 1), fz = (street.z - st.z) / (street.d || 1);
    let along = [-fz, fx], halfLength = 2.5, halfWidth = 1.5;
    if (st.p) {
      const ring = st.p, area = ring.reduce((a, q, i) => { const n = ring[(i + 1) % ring.length]; return a + q[0] * n[1] - n[0] * q[1]; }, 0);
      const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
      for (const [a, b, c] of tris) {
        let A = ring[a], B = ring[b], C = ring[c];
        if ((B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]) < 0) [B, C] = [C, B];
        top.push(A[0], KERB_TOP, A[1], B[0], KERB_TOP, B[1], C[0], KERB_TOP, C[1]);
      }
      let longest = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.05) continue;
        // Kerb face outward, and a 0.4 m tactile band inside along the long edges.
        const [ox, oz] = area > 0 ? [(b[1] - a[1]) / len, -(b[0] - a[0]) / len] : [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
        const outA = area > 0 ? [b, a] : [a, b];
        sides.push(outA[0][0], KERB_TOP, outA[0][1], outA[1][0], KERB_TOP, outA[1][1], outA[1][0], 0, outA[1][1], outA[0][0], KERB_TOP, outA[0][1], outA[1][0], 0, outA[1][1], outA[0][0], 0, outA[0][1]);
        if (len > 4) {
          const ia = [a[0] - ox * 0.4, a[1] - oz * 0.4], ib = [b[0] - ox * 0.4, b[1] - oz * 0.4], y = KERB_TOP + 0.006;
          edge.push(a[0], y, a[1], b[0], y, b[1], ib[0], y, ib[1], a[0], y, a[1], ib[0], y, ib[1], ia[0], y, ia[1]);
        }
        if (len > longest) { longest = len; along = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]; }
      }
      // Half extents along and across the platform.
      halfLength = Math.max(...ring.map((q) => Math.abs((q[0] - st.x) * along[0] + (q[1] - st.z) * along[1])));
      halfWidth = Math.max(...ring.map((q) => Math.abs((q[0] - st.x) * -along[1] + (q[1] - st.z) * along[0])));
    }
    // Across the platform, towards the street.
    let [nx, nz] = [-along[1], along[0]];
    if (nx * fx + nz * fz < 0) { nx = -nx; nz = -nz; }
    if (st.sh) {
      // Back to the far edge where the platform is wide enough, else centred.
      const back = Math.max(0, halfWidth - 1.0), x = st.x - nx * back * 0.5, z = st.z - nz * back * 0.5;
      const rot = Math.atan2(nx, nz), size = baked.busstop.size;
      addProp('busstop', x, z, rot, 1);
      rectCollider(x, z, rot, size.x, size.z, size.y);
    }
    // The sign at the platform's end, just in from the street edge.
    const end = Math.max(0, halfLength - 0.8), sx = st.x + along[0] * end + nx * Math.max(0, halfWidth - 0.4), sz = st.z + along[1] * end + nz * Math.max(0, halfWidth - 0.4);
    signs.push({ along, st, x: sx, y: groundHeight(sx, sz), z: sz });
  }
  const meshOf = (pos, material) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const draped = drape(g, terrainAt, 2.5);
    const uv = [], p = draped.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) uv.push(p[i], p[i + 2]);
    draped.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    draped.computeVertexNormals();
    const mesh = new THREE.Mesh(draped, material);
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  // Same depth bias as the street surfaces, so the kerb height decides what shows.
  meshOf(top, new THREE.MeshLambertMaterial({ map: textureAt(textures.slabTexture(), 2.4), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
  meshOf(sides, curbStone);
  meshOf(edge, new THREE.MeshLambertMaterial({ map: textureAt(textures.tactileTexture(), 0.6), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -8, side: THREE.DoubleSide }));
  buildStopSigns(signs);
}
// Ruter stop signs: a galvanised pole with a dark plate: the mode square (bus red, tram
// blue), the stop name and the routes. Names are drawn into one atlas texture.
function buildStopSigns(signs) {
  const COLS = 8, CW = 256, CH = 96, rows = Math.ceil(signs.length / COLS) || 1;
  const canvas = document.createElement('canvas');
  canvas.width = COLS * CW;
  canvas.height = rows * CH;
  const g = canvas.getContext('2d');
  signs.forEach(({ st }, i) => {
    const x0 = (i % COLS) * CW, y0 = Math.floor(i / COLS) * CH;
    g.fillStyle = '#26282b';
    g.fillRect(x0, y0, CW, CH);
    g.fillStyle = st.k === 'tram' ? '#0b91ef' : '#e60000';
    g.fillRect(x0 + 8, y0 + 8, 52, 52);
    // Pictogram: a vehicle front with two lamps; trams get a pantograph.
    g.fillStyle = '#fff';
    g.fillRect(x0 + 18, y0 + 20, 32, 30);
    g.fillStyle = st.k === 'tram' ? '#0b91ef' : '#e60000';
    g.fillRect(x0 + 22, y0 + 24, 24, 12);
    g.fillStyle = '#fff';
    g.fillRect(x0 + 20, y0 + 50, 6, 4);
    g.fillRect(x0 + 42, y0 + 50, 6, 4);
    if (st.k === 'tram') { g.fillRect(x0 + 32, y0 + 11, 4, 9); g.fillRect(x0 + 24, y0 + 11, 20, 3); }
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    let size = 26;
    const name = st.n.replace(/\s*\[.*\]$/, '');
    do { g.font = `bold ${size}px Arial`; size--; } while (g.measureText(name).width > CW - 76 && size > 12);
    g.fillText(name, x0 + 68, y0 + 34);
    g.font = '18px Arial';
    g.fillStyle = '#d8dadc';
    g.fillText(st.r.slice(0, 9).join('  '), x0 + 10, y0 + 80);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const plates = [], poles = [];
  const W = 0.9, H = 0.34, POLE = 2.9;
  signs.forEach(({ along, x, y, z }, i) => {
    const u0 = (i % COLS) / COLS, u1 = u0 + 1 / COLS, v1 = 1 - Math.floor(i / COLS) / rows, v0 = v1 - 1 / rows;
    // Plates face both ways along the platform, so people walking up from either end read them.
    for (const s of [1, -1]) {
      const plane = new THREE.PlaneGeometry(W, H);
      const uv = plane.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) ? u1 : u0, uv.getY(k) ? v1 : v0);
      plane.translate(0, 0, 0.03);
      plane.rotateY(Math.atan2(along[0] * s, along[1] * s));
      plane.translate(x, y + POLE - H / 2, z);
      plates.push(plane);
    }
    poles.push(new THREE.CylinderGeometry(0.04, 0.04, POLE, 8).translate(x, y + POLE / 2, z));
    const back = new THREE.BoxGeometry(W + 0.04, H + 0.04, 0.05);
    back.rotateY(Math.atan2(along[0], along[1]));
    back.translate(x, y + POLE - H / 2, z);
    poles.push(back);
  });
  if (!signs.length) return;
  scene.add(new THREE.Mesh(mergeGeometries(plates), new THREE.MeshBasicMaterial({ map: texture })));
  const pole = new THREE.Mesh(mergeGeometries(poles.map((q) => (q.index ? q.toNonIndexed() : q))), new THREE.MeshLambertMaterial({ color: 0x9a9ea2 }));
  pole.castShadow = true;
  scene.add(pole);
  for (const { x, z } of signs) poleGrid.insert({ breakable: false, down: false, instances: [], q: 0, r: 0.15, x, z }, x, z, x, z);
}
const SHADOW_PROPS = new Set(['bush', 'busstop', 'fountain', 'tree-conifer', 'tree-round', 'tree-tall']);
function finishProps() {
  for (const [key, { matrices, name }] of propBatches) {
    const [, cx, cz] = key.split('|').map(Number);
    const { shadow } = baked[name];
    if (shadow && SHADOW_PROPS.has(name)) {
      const proxy = shadowProxy(new THREE.InstancedMesh(shadow, proxyMaterial, matrices.length));
      matrices.forEach((m, i) => proxy.setMatrixAt(i, m));
      proxy.computeBoundingSphere();
      propChunks.push({ mesh: proxy, range: TREE_RANGE, x: (cx + 0.5) * CHUNK, z: (cz + 0.5) * CHUNK });
      if (!batchMeshes.has(key)) batchMeshes.set(key, []);
      batchMeshes.get(key).push(proxy);
    }
    for (const { geometry, material } of baked[name].parts) {
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = SHADOW_PROPS.has(name) && !shadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
      propChunks.push({ mesh, range: name.startsWith('tree-') ? TREE_RANGE : PROP_RANGE, x: (cx + 0.5) * CHUNK, z: (cz + 0.5) * CHUNK });
      if (!batchMeshes.has(key)) batchMeshes.set(key, []);
      batchMeshes.get(key).push(mesh);
    }
  }
}
// Knocked-over props: hide the instances and drop a falling copy that tips over.
const fallen = [];
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
function knockOver(pole, vx, vz) {
  pole.down = true;
  const group = new THREE.Group();
  group.position.set(pole.x, groundHeight(pole.x, pole.z), pole.z);
  // Instances are props ({ key, index, name }) or a single instanced mesh ({ mesh, index }).
  for (const { glow, index, key, mesh: own, name } of pole.instances) {
    if (glow !== undefined) { lampGlow.setMatrixAt(glow, HIDDEN); lampGlow.instanceMatrix.needsUpdate = true; }
    const meshes = own ? [own] : batchMeshes.get(key) || [];
    const m = new THREE.Matrix4();
    meshes[0]?.getMatrixAt(index, m);
    for (const mesh of meshes) { mesh.setMatrixAt(index, HIDDEN); mesh.instanceMatrix.needsUpdate = true; }
    for (const { geometry, material } of own ? [own] : baked[name].parts) {
      const copy = new THREE.Mesh(geometry, material);
      copy.applyMatrix4(m);
      copy.position.sub(group.position);
      copy.castShadow = true;
      group.add(copy);
    }
  }
  scene.add(group);
  const speed = Math.hypot(vx, vz) || 1;
  // Tip away from the car: rotate about the horizontal axis perpendicular to its motion.
  fallen.push({ age: 0, axis: new THREE.Vector3(vz / speed, 0, -vx / speed), group, rate: 1.5 + speed * 0.08 });
  for (let i = 0; i < 5; i++) spawnPuff(pole.x, 0.5, pole.z, 0x9a9a9a, 0.35, 0.7, 1.2, 1.5);
}
function updateFallen(dt) {
  for (let i = fallen.length - 1; i >= 0; i--) {
    const f = fallen[i];
    f.age += dt;
    const angle = Math.min(Math.PI / 2 - 0.05, f.age * f.rate * (1 + f.age * 2));
    f.group.quaternion.setFromAxisAngle(f.axis, angle);
    if (f.age > 25) { scene.remove(f.group); fallen.splice(i, 1); }
  }
}

// Small props vanish into the fog anyway; skip whole chunks beyond their range.
function cullProps() {
  for (const c of propChunks) c.mesh.visible = (c.x - camera.position.x) ** 2 + (c.z - camera.position.z) ** 2 < (c.range + CHUNK * 0.71) ** 2;
  for (const c of instanceChunks) c.mesh.visible = (c.x - camera.position.x) ** 2 + (c.z - camera.position.z) ** 2 < (c.range + 284) ** 2;
  for (const c of groundTiles) c.mesh.visible = (c.x - camera.position.x) ** 2 + (c.z - camera.position.z) ** 2 < (GROUND_RANGE + GROUND_TILE * 0.71) ** 2;
  // Plain blocks and coarse terrain stand in for unloaded tiles, out to the end of the fog.
  const fogEnd = (x, z) => (x - camera.position.x) ** 2 + (z - camera.position.z) ** 2 < 1500 * 1500;
  for (const t of terrainLod) t.coarse.visible = !streamer.isLive(t.key) && fogEnd(t.coarse.geometry.boundingSphere.center.x, t.coarse.geometry.boundingSphere.center.z);
  for (const b of farBlocks) b.mesh.visible = !streamer.isLive(b.key) && fogEnd(b.mesh.geometry.boundingSphere.center.x, b.mesh.geometry.boundingSphere.center.z);
}
const spotFree = (x, z, r = 1) => !buildingAt(x, z) && !isRoad(x, z) && !isWater(x, z) && !buildingAt(x + r, z) && !buildingAt(x - r, z) && !buildingAt(x, z + r) && !buildingAt(x, z - r);
// Street furniture built at true size (the Sloyd shelter, post box and bin were out of proportion).
Object.assign(baked, { busstop: busShelter(), garbage: streetBin(), postbox: postbox(), streetlight: streetLight() });
// Trees and shrubs with leaf-card crowns (the faceted low-poly ones looked cheap).
Object.assign(baked, { bush: shrub(), 'tree-conifer': spruceTree(), 'tree-round': broadleafTree(false), 'tree-tall': broadleafTree(true) });
const scaleTo = (name, height) => height / baked[name].size.y;

// Walks a polyline, calling visit(x, z, dx, dz) every `spacing` meters.
function alongLine(p, spacing, offset0, visit) {
  let carry = offset0;
  for (let i = 0; i + 1 < p.length; i++) {
    const [ax, az] = p[i], [bx, bz] = p[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    for (let t = carry; t < len; t += spacing) visit(ax + dx * t, az + dz * t, dx, dz);
    carry = (carry - len) % spacing;
    if (carry < 0) carry += spacing;
  }
}

{
  const lampScale = 1;
  // Lamps along road bridges, on the deck (no collider: traffic passes underneath).
  for (const l of bridgeDecks.lamps) addProp('streetlight', l.x, l.z, l.h, lampScale, 0, l.y).glow = lampHeads.push([l.x, l.z, l.y]) - 1;
  const treeScale = (name, height = rand(9, 15)) => height / baked[name].size.y;
  const roadsDrive = data.roads.filter((r) => !PAVED.has(r.k) && r.w >= 7);
  // Street lights on both sides of every street; trees along the wide ones.
  for (const r of roadsDrive) {
    alongLine(r.p, 40, rand(5, 20), (x, z, dx, dz) => {
      for (const side of [-1, 1]) {
        const off = r.w / 2 + 0.9, lx = x - dz * off * side, lz = z + dx * off * side;
        if (spotFree(lx, lz, 0.6) && !bridgeDecks.deckAt(lx, lz)) addProp('streetlight', lx, lz, Math.atan2(dx, dz) + (side > 0 ? 0 : Math.PI), lampScale, 0.2).glow = lampHeads.push([lx, lz, groundHeight(lx, lz)]) - 1;
      }
    });
  }
  buildStops();
  // Pedestrian streets (Karl Johans gate etc.): benches, bins, post boxes, bike racks, trees.
  for (const r of data.roads.filter((q) => PAVED.has(q.k))) {
    let n = 0;
    alongLine(r.p, 22, rand(4, 12), (x, z, dx, dz) => {
      const side = n++ % 2 ? 1 : -1, off = r.w / 2 + 0.6;
      const px = x - dz * off * side, pz = z + dx * off * side;
      // Not where the pedestrian street crosses a carriageway.
      if (buildingAt(px, pz) || isWater(px, pz) || isRoad(px, pz)) return;
      const rot = Math.atan2(dx, dz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      const pickProp = n % 7;
      if (pickProp === 3) addProp('postbox', px, pz, rot, 1, 0.3);
      else if (pickProp === 5) addProp('bikestand', px, pz, rot + Math.PI / 2, scaleTo('bikestand', 0.9), 0.3);
      else {
        addProp('bench', px, pz, rot, scaleTo('bench', 0.95), 0.6);
        const gx = px + dx * 1.6, gz = pz + dz * 1.6;
        if (!buildingAt(gx, gz) && !isRoad(gx, gz)) addProp('garbage', gx, gz, rot, 1, 0.35);
      }
    });
  }
  for (const wood of data.ground.wood || []) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of wood) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const count = Math.min(90, ((maxX - minX) * (maxZ - minZ)) / 220);
    for (let i = 0; i < count; i++) {
      const x = rand(minX, maxX), z = rand(minZ, maxZ);
      if (!pointInPoly(x, z, wood) || !spotFree(x, z, 1.5)) continue;
      const name = pick(['tree-round', 'tree-round', 'tree-tall', 'tree-conifer']);
      addProp(name, x, z, rand(0, 6.3), treeScale(name), 0.35);
    }
  }
  // Every tree mapped in OSM, where it really stands (mostly lindens, maples and elms).
  for (const [x, z, needle, height] of data.trees) {
    // A few mapped trees fall inside the carriageway as drawn; they'd block the road.
    if (buildingAt(x, z) || isWater(x, z) || isRoad(x, z)) continue;
    const name = needle ? 'tree-conifer' : (Math.floor(x * 7 + z * 13) & 3) === 0 ? 'tree-tall' : 'tree-round';
    addProp(name, x, z, ((x * 13.7 + z * 7.3) % 6.28), treeScale(name, height ? clamp(height, 4, 25) : 9 + ((x * 3.1 + z * 1.7) % 6)), 0.35);
  }
  // Shrubs in parks and gardens, kept off the paths.
  for (const poly of [...data.parks, ...(data.ground.grass || [])]) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const count = Math.min(40, ((maxX - minX) * (maxZ - minZ)) / 260);
    for (let i = 0; i < count; i++) {
      const x = rand(minX, maxX), z = rand(minZ, maxZ);
      if (!pointInPoly(x, z, poly) || !spotFree(x, z, 1.2) || surfaceAt(x, z, 1)) continue;
      addProp('bush', x, z, rand(0, 6.3), rand(0.7, 1.4), 0.5);
    }
  }
  // Benches along the park paths.
  for (const w of data.walks.filter((q) => q.k === 'footway')) {
    const mid = w.p[Math.floor(w.p.length / 2)];
    if (!data.parks.some((park) => pointInPoly(mid[0], mid[1], park))) continue;
    alongLine(w.p, 35, rand(5, 30), (x, z, dx, dz) => {
      const bx = x - dz * 2, bz = z + dx * 2;
      if (spotFree(bx, bz, 0.8)) addProp('bench', bx, bz, Math.atan2(dx, dz) - Math.PI / 2, scaleTo('bench', 0.95), 0.6);
    });
  }
  // Fountains where OSM maps them, at their mapped size (not on a carriageway); flags at
  // Slottet and Stortinget.
  for (const [x, z, r] of data.fountains || []) {
    if (isRoad(x, z) || buildingAt(x, z)) continue;
    const s = (2 * r) / baked.fountain.size.x;
    addProp('fountain', x, z, 0, s, r * 0.96);
  }
  for (const [x, z] of [[-925, -580], [-925, -550], [-205, -150]]) {
    const spot = freeSpot(x, z, 1, 30);
    if (spot) addProp('flagpole', spot[0], spot[1], Math.PI / 2, scaleTo('flagpole', 9), 0.2);
  }
  // Akershus festning: a ring of fortress walls on the hill above the harbour.
  const ak = data.landmarks.find((l) => l.n === 'Akershus festning');
  const spot = ak && freeSpot(ak.p[0], ak.p[1], 30, 140);
  sites.akershus = spot;
  if (spot) {
    const size = baked['akershus-wall'].size, s = 1.4, half = (size.x * s) / 2;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const x = spot[0] + Math.cos(a) * half, z = spot[1] - Math.sin(a) * half;
      placeModel('akershus-wall', x, z, a + Math.PI / 2, s);
      rectCollider(x, z, a + Math.PI / 2, size.x * s, size.z * s, size.y * s);
    }
  }
}

// Signal pole: a plain cylinder; the Sloyd signal head is instanced on top of it.
// Tram tracks in the streets and the railway east of Oslo S: two steel rails on a bed.
function offsetLine(p, off) {
  return p.map((q, i) => {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [q[0] - ((b[1] - a[1]) / len) * off, q[1] + ((b[0] - a[0]) / len) * off];
  });
}
const GAUGE = 1.435;
// Rails as grooved tram rails sit in the street: a narrow worn steel head beside a dark groove
// (bright full-width lines read as road markings). Tram beds are barely darker than the
// asphalt around them.
const steelRails = (lines, inset) => lines.flatMap((l) => [-1, 1].map((side) => ({ p: offsetLine(l.p, side * (GAUGE / 2 - inset)), w: inset ? 0.04 : 0.055 })));
paintFar(data.trams.map((t) => ({ p: t.p, w: 2.2 })), 0.105, 0x3f4246);
paintFar(data.rails.map((r) => ({ p: r.p, w: 3.4 })), 0.06, 0x80776b);
paintNear(steelRails([...data.trams, ...data.rails], 0), 0.13, 0x83878c, false);
paintNear(steelRails(data.trams, 0.05), 0.131, 0x1c1e21, false);
// Tram overhead line: a contact wire 5.6 m above each track and, every 30 m, a span wire
// across the street with a dropper, anchored to the facades as in central Oslo.
{
  const wires = [];
  for (const t of data.trams) {
    let next = 15;
    for (let i = 0; i + 1 < t.p.length; i++) {
      const [ax, az] = t.p[i], [bx, bz] = t.p[i + 1], len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      wires.push(ax, terrainAt(ax, az) + 5.6, az, bx, terrainAt(bx, bz) + 5.6, bz);
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (; next < len; next += 30) {
        const x = ax + ((bx - ax) * next) / len, z = az + ((bz - az) * next) / len, g = terrainAt(x, z);
        wires.push(x - nx * 9, g + 6.3, z - nz * 9, x + nx * 9, g + 6.3, z + nz * 9, x, g + 6.3, z, x, g + 5.6, z);
      }
      next -= len;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
  scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x26282b })));
}
baked.sleeper = {
  parts: [{ geometry: new THREE.BoxGeometry(2.6, 0.1, 0.24).translate(0, 0.08, 0), material: new THREE.MeshLambertMaterial({ color: 0x5b4636 }), slot: '0' }],
  size: new THREE.Vector3(2.6, 0.1, 0.24),
};
for (const r of data.rails) alongLine(r.p, 1.4, 0.5, (x, z, dx, dz) => { if (!isRoad(x, z)) addProp('sleeper', x, z, Math.atan2(dx, dz)); });
{
  const g = mapCanvas.getContext('2d');
  drawLines(g, data.rails.map((r) => ({ p: r.p, w: 2.5 })), '#7b6f61');
  drawLines(g, data.trams.map((t) => ({ p: t.p, w: 1.6 })), '#4c6a9c');
}

finishProps();

// ============================================================================
// Road + walk graphs
// ============================================================================
const N = data.nodes;
const driveAdj = new Map(), copAdj = new Map(), walkAdj = new Map();
const addEdge = (m, a, e) => { if (!m.has(a)) m.set(a, []); m.get(a).push(e); };
for (const [a, b, oneway, w] of data.edges) {
  if (!N[a] || !N[b]) continue;
  addEdge(driveAdj, a, { to: b, w, oneway });
  if (!oneway) addEdge(driveAdj, b, { to: a, w, oneway });
  addEdge(copAdj, a, b);
  addEdge(copAdj, b, a);
}
for (const [a, b] of data.walkEdges) {
  if (!N[a] || !N[b]) continue;
  addEdge(walkAdj, a, b);
  addEdge(walkAdj, b, a);
}
const driveGrid = new Grid(50), walkGrid = new Grid(50);
// Signals and signs from OSM; AI traffic stops for red lights (see stopForSignals).
const traffic = createTrafficControl({ data, edges: data.edges, free: (x, z) => !buildingAt(x, z) && !isRoad(x, z) && !isWater(x, z), ground: (x, z) => groundHeight(x, z), nodes: N, scene });
for (const m of traffic.staticMeshes) splitInstanced(m, 320);
// Stop lines across the lanes that approach each signal.
paintNear(traffic.heads.map((h) => {
  const rx = -Math.cos(h.h), rz = Math.sin(h.h);
  return { p: [[h.stopX - rx * 0.2, h.stopZ - rz * 0.2], [h.stopX - rx * (h.w / 2 - 0.2), h.stopZ - rz * (h.w / 2 - 0.2)]], w: 0.4 };
}), 0.116, 0xf2f2ea, false);
const stopForSignals = (v, target) => {
  const stop = traffic.stopAhead(v.x, v.z, v.h);
  return stop === Infinity ? target : Math.min(target, Math.max(0, (stop - 2) * 0.9));
};
for (const id of copAdj.keys()) { const [x, z] = N[id]; driveGrid.insert({ id, q: 0, x, z }, x, z, x, z); }
for (const id of walkAdj.keys()) { const [x, z] = N[id]; walkGrid.insert({ id, q: 0, x, z }, x, z, x, z); }
// Footfall: how many people pass each walk node per hour, from the kind of way it lies on.
// Karl Johans gate: 4,500/h on weekdays (Thon Eiendom); the other values are estimates
// scaled from it. Density on the ground is flow / walking speed.
const FLOW = { crossing: 120, cycleway: 10, footway: 60, path: 30, pedestrian: 500, platform: 250, sidewalk: 120, steps: 30, traffic_island: 40 };
const KARL_JOHAN = 4500, WALK_SPEED = 1.35;
// Share of the daily peak by hour (people out at 03:00 vs 17:00).
const HOURLY = [0.06, 0.04, 0.03, 0.02, 0.02, 0.04, 0.12, 0.35, 0.55, 0.5, 0.6, 0.75, 0.9, 0.9, 0.85, 0.9, 1, 1, 0.8, 0.6, 0.45, 0.35, 0.22, 0.12];
const nodeShare = new Map();
{
  const ways = new Grid(25);
  const addWay = (p, w, flow) => {
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1], r = w / 2 + 2.5;
      ways.insert({ ax, az, bx, bz, flow, q: 0, r }, Math.min(ax, bx) - r, Math.min(az, bz) - r, Math.max(ax, bx) + r, Math.max(az, bz) + r);
    }
  };
  for (const w of data.walks) addWay(w.p, w.w || 2, FLOW[w.k] ?? 100);
  for (const r of data.roads) if (PAVED.has(r.k)) addWay(r.p, r.w, r.n === 'Karl Johans gate' ? KARL_JOHAN : FLOW.pedestrian);
  for (const [id, nbs] of walkAdj) {
    const [x, z] = N[id];
    let flow = 20;
    ways.query(x - 1, z - 1, x + 1, z + 1, (s) => {
      const dx = s.bx - s.ax, dz = s.bz - s.az, t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(s.ax + dx * t - x, s.az + dz * t - z) < s.r) flow = Math.max(flow, s.flow);
    });
    // People standing on this node's half of its edges at peak.
    const reach = nbs.reduce((sum, b) => sum + Math.hypot(N[b][0] - x, N[b][1] - z) / 2, 0);
    nodeShare.set(id, (flow / 3600 / WALK_SPEED) * reach);
  }
}
const PED_RADIUS = 110, MAX_PEDS = 90;
let footfall = { list: [], total: 0, x: Infinity, z: Infinity };
// Walk nodes around the player with their expected head count, refreshed every 10 m.
function footfallAround(x, z) {
  if (Math.hypot(x - footfall.x, z - footfall.z) < 10) return footfall;
  const list = [];
  let total = 0;
  walkGrid.query(x - PED_RADIUS, z - PED_RADIUS, x + PED_RADIUS, z + PED_RADIUS, (n) => {
    if ((n.x - x) ** 2 + (n.z - z) ** 2 > PED_RADIUS * PED_RADIUS) return;
    const share = nodeShare.get(n.id);
    list.push([n.id, share]);
    total += share;
  });
  footfall = { list, total, x, z };
  return footfall;
}

function nearestNode(grid, x, z, r = 120, filter = null) {
  let best = r * r, id = null;
  grid.query(x - r, z - r, x + r, z + r, (n) => {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < best && (!filter || filter(n.id))) { best = d; id = n.id; }
  });
  return id;
}

function nodeInRing(grid, x, z, r0, r1, filter) {
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, r = rand(r0, r1);
    const id = nearestNode(grid, x + Math.sin(a) * r, z + Math.cos(a) * r, 40, filter);
    if (id !== null) {
      const d = Math.hypot(N[id][0] - x, N[id][1] - z);
      if (d >= r0 * 0.8) return id;
    }
  }
  return null;
}

function findPath(start, goal) {
  const [gx, gz] = N[goal];
  const g = new Map([[start, 0]]), came = new Map();
  const heap = [[0, start]];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (let iter = 0; heap.length && iter < 6000; iter++) {
    const [, cur] = pop();
    if (cur === goal) {
      const path = [cur];
      let c = cur;
      while (came.has(c)) { c = came.get(c); path.push(c); }
      return path.reverse();
    }
    const [cx, cz] = N[cur];
    for (const nb of copAdj.get(cur) || []) {
      const [nx, nz] = N[nb];
      const ng = g.get(cur) + Math.hypot(nx - cx, nz - cz);
      if (ng < (g.get(nb) ?? Infinity)) {
        g.set(nb, ng);
        came.set(nb, cur);
        push([ng + Math.hypot(nx - gx, nz - gz), nb]);
      }
    }
  }
  return null;
}

// ============================================================================
// Audio (synthesized)
// ============================================================================
const sound = { ctx: null, muted: false };
function initAudio() {
  if (sound.ctx) return;
  const ctx = new AudioContext();
  sound.ctx = ctx;
  sound.master = ctx.createGain();
  sound.master.gain.value = 0.6;
  sound.master.connect(ctx.destination);
  const engine = ctx.createOscillator();
  engine.type = 'sawtooth';
  const engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 500;
  sound.engineGain = ctx.createGain();
  sound.engineGain.gain.value = 0;
  engine.connect(engineFilter).connect(sound.engineGain).connect(sound.master);
  engine.start();
  sound.engine = engine;
  const siren = ctx.createOscillator();
  siren.type = 'triangle';
  sound.sirenGain = ctx.createGain();
  sound.sirenGain.gain.value = 0;
  siren.connect(sound.sirenGain).connect(sound.master);
  siren.start();
  sound.siren = siren;
  const len = ctx.sampleRate;
  sound.noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = sound.noise.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  // The Roadster's cold-gas thrusters: a looping hiss, loud while they fire.
  const hiss = ctx.createBufferSource();
  hiss.buffer = sound.noise;
  hiss.loop = true;
  const hissFilter = ctx.createBiquadFilter();
  hissFilter.type = 'bandpass';
  hissFilter.frequency.value = 1400;
  hissFilter.Q.value = 0.6;
  sound.thrustGain = ctx.createGain();
  sound.thrustGain.gain.value = 0;
  hiss.connect(hissFilter).connect(sound.thrustGain).connect(sound.master);
  hiss.start();
}
function burst(duration, freq, volume, kind = 'lowpass') {
  if (!sound.ctx || sound.muted) return;
  const ctx = sound.ctx;
  const src = ctx.createBufferSource();
  src.buffer = sound.noise;
  const filter = ctx.createBiquadFilter();
  filter.type = kind;
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  src.connect(filter).connect(gain).connect(sound.master);
  src.start();
  src.stop(ctx.currentTime + duration);
}
function beep(freq, duration, volume = 0.15, wave = 'square') {
  if (!sound.ctx || sound.muted) return;
  const ctx = sound.ctx;
  const osc = ctx.createOscillator();
  osc.type = wave;
  osc.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain).connect(sound.master);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}
const sfx = {
  cash: () => { beep(880, 0.08, 0.12); setTimeout(() => beep(1320, 0.12, 0.12), 70); },
  crash: (v) => burst(0.35, 400, Math.min(0.9, v)),
  explosion: () => { burst(1.4, 300, 1.2); burst(0.5, 1200, 0.6); },
  gun: (volume = 0.7) => burst(0.18, 2500, volume, 'bandpass'),
  horn: () => { beep(392, 0.4, 0.12, 'sawtooth'); beep(494, 0.4, 0.1, 'sawtooth'); },
  pass: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.25, 0.12, 'triangle'), i * 120)),
};

// ============================================================================
// Effects
// ============================================================================
const puffGeo = new THREE.IcosahedronGeometry(1, 0);
const puffs = [];
function spawnPuff(x, y, z, color, size, life, vy = 1.5, spread = 0.6) {
  y += terrainAt(x, z);
  let p = puffs.find((q) => !q.mesh.visible);
  if (!p) {
    if (puffs.length > 220) return;
    p = { mesh: new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ depthWrite: false, transparent: true })) };
    scene.add(p.mesh);
    puffs.push(p);
  }
  p.mesh.visible = true;
  p.mesh.position.set(x, y, z);
  p.mesh.material.color.set(color);
  p.age = 0;
  p.life = life;
  p.size = size;
  p.v = new THREE.Vector3(rand(-spread, spread), vy, rand(-spread, spread));
}
function updatePuffs(dt) {
  for (const p of puffs) {
    if (!p.mesh.visible) continue;
    p.age += dt;
    if (p.age > p.life) { p.mesh.visible = false; continue; }
    const k = p.age / p.life;
    p.mesh.position.addScaledVector(p.v, dt);
    p.mesh.scale.setScalar(p.size * (0.4 + k));
    p.mesh.material.opacity = 0.75 * (1 - k);
  }
}

const tracers = [];
function tracer(from, to, color = 0xffe28a) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true }));
  scene.add(line);
  tracers.push({ line, t: 0.07 });
}
function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].t -= dt;
    if (tracers[i].t <= 0) {
      scene.remove(tracers[i].line);
      tracers[i].line.geometry.dispose();
      tracers.splice(i, 1);
    }
  }
}

// ============================================================================
// People
// ============================================================================
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const materials = new Map();
const mat = (color) => {
  if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color }));
  return materials.get(color);
};
// People are skinned meshes from person.js (one draw call each, walking with bent knees).
function makePerson({ pants, shirt, skin } = {}) {
  const person = buildPerson({ bottom: pants, skin, top: shirt });
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.add(person.mesh);
  root.add(body);
  scene.add(root);
  return { body, person, root };
}
// People beyond 35 m animate every other frame (every fourth beyond 70 m) and cast no shadow.
let poseFrame = 0;
function animatePerson(m, phase, amount, aiming = false) {
  const d2 = (m.root.position.x - camera.position.x) ** 2 + (m.root.position.z - camera.position.z) ** 2, far = d2 > 35 * 35;
  m.person.mesh.castShadow = !far;
  const skip = far && (poseFrame + m.person.mesh.id) % (d2 > 70 * 70 ? 4 : 2) !== 0;
  m.root.matrixWorldAutoUpdate = !skip;
  // On skipped frames also keep last frame's bone texture (marking the skeleton as already
  // updated for this render), instead of re-uploading it.
  if (skip) { m.person.mesh.skeleton.frame = renderer.info.render.frame + 1; return; }
  posePerson(m.person, phase, amount, aiming, performance.now() / 1000);
}
warmPeople();

const peds = [];
// Removed pedestrians' models are kept and reused: creating a skinned body (and its bone
// texture) per spawn caused hitches, and discarded ones leaked GPU memory.
const pedPool = [];
// E-scooter riders (after Worldhood's scooter riders): one walker in four rides a shared
// scooter along the walking network at 15–20 km/h, standing on its deck.
const SCOOTER_MESHES = SCOOTER_COLOURS.map((c) => new THREE.Mesh(scooter(c), new THREE.MeshStandardMaterial({ metalness: 0.3, roughness: 0.6, vertexColors: true })));
class Ped {
  constructor(id, ride = Math.random() < 0.25) {
    this.model = pedPool.pop() || makePerson();
    this.model.body.rotation.set(0, 0, 0);
    this.model.body.position.set(0, 0, 0);
    // (A pooled model may still carry a scooter from its last rider.)
    for (const child of [...this.model.root.children]) if (SCOOTER_MESHES.some((s) => s.geometry === child.geometry)) this.model.root.remove(child);
    this.model.root.matrixWorldAutoUpdate = true;
    if (!this.model.root.parent) scene.add(this.model.root);
    this.model.root.traverse((o) => { o.userData.owner = this; });
    this.from = id;
    const nbs = walkAdj.get(id);
    this.to = pick(nbs);
    this.t = 0;
    this.offset = rand(-1, 1);
    this.speed = ride ? rand(4.2, 5.6) : rand(1.1, 1.6);
    this.ride = ride ? SCOOTER_MESHES[Math.floor(Math.random() * SCOOTER_MESHES.length)].clone() : null;
    if (this.ride) this.model.root.add(this.ride);
    this.state = 'walk';
    this.phase = Math.random() * 10;
    [this.x, this.z] = N[id];
    this.y = 0;
    this.h = 0;
  }
  remove() {
    this.dropScooter();
    scene.remove(this.model.root);
    peds.splice(peds.indexOf(this), 1);
    pedPool.push(this.model);
  }
  // A rider knocked off (or fleeing) leaves the scooter behind.
  dropScooter() {
    if (!this.ride) return;
    this.model.root.remove(this.ride);
    this.model.body.position.y = 0;
    this.ride = null;
    this.speed = Math.min(this.speed, 1.6);
  }
  kill(vx = 0, vz = 0, vy = 2) {
    if (this.state === 'dead' || this.state === 'fly') return;
    this.dropScooter();
    this.state = 'fly';
    this.vx = vx; this.vz = vz; this.vy = vy;
    this.spin = rand(4, 9);
    this.deadT = 0;
    for (let i = 0; i < 4; i++) spawnPuff(this.x, 1.2, this.z, 0x8b0000, 0.25, 0.6, 0.5, 1);
  }
  scare(fx, fz) {
    if (this.state !== 'walk' && this.state !== 'flee') return;
    this.dropScooter();
    this.state = 'flee';
    this.fleeT = rand(5, 9);
    this.fleeFrom = [fx, fz];
  }
  update(dt) {
    const m = this.model;
    if (this.state === 'fly') {
      this.vy -= 18 * dt;
      this.x += this.vx * dt; this.z += this.vz * dt; this.y += this.vy * dt;
      this.vx *= 0.98; this.vz *= 0.98;
      m.body.rotation.x -= this.spin * dt;
      collideCircle(this, 0.4);
      if (this.y <= 0.15 && this.vy < 0) {
        this.state = 'dead';
        this.y = 0.15;
        m.body.rotation.x = -Math.PI / 2;
        m.body.position.z = 0.9;
        if (Math.random() < 0.7) dropCash(this.x, this.z, Math.floor(rand(5, 60)));
      }
    } else if (this.state === 'dead') {
      this.deadT += dt;
      if (this.deadT > 30) return this.remove();
    } else if (this.state === 'wait') {
      // At a stop: standing, now and then shifting weight, facing the street.
      this.phase += dt;
      animatePerson(m, 0, 0);
    } else if (this.state === 'board') {
      // Walking to the open door; gone once aboard.
      const dx = this.boardTarget[0] - this.x, dz = this.boardTarget[1] - this.z, d = Math.hypot(dx, dz);
      if (d < 0.6) return this.remove();
      this.x += (dx / d) * 1.5 * dt;
      this.z += (dz / d) * 1.5 * dt;
      this.h += angleDiff(this.h, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
      this.phase += dt * 7;
      animatePerson(m, this.phase, 0.6);
    } else if (this.state === 'flee') {
      this.fleeT -= dt;
      let dx = this.x - this.fleeFrom[0], dz = this.z - this.fleeFrom[1];
      const d = Math.hypot(dx, dz) || 1;
      this.h = Math.atan2(dx / d, dz / d) + Math.sin(this.phase * 0.3) * 0.3;
      this.x += Math.sin(this.h) * 5 * dt;
      this.z += Math.cos(this.h) * 5 * dt;
      collideCircle(this, 0.35);
      this.phase += dt * 11;
      animatePerson(m, this.phase, 1);
      if (this.fleeT <= 0) {
        const id = nearestNode(walkGrid, this.x, this.z, 40);
        if (id === null) return this.remove();
        this.state = 'walk';
        this.from = id;
        this.to = pick(walkAdj.get(id));
        this.t = 0;
      }
    } else {
      const [ax, az] = N[this.from], [bx, bz] = N[this.to];
      const len = Math.hypot(bx - ax, bz - az) || 0.01;
      this.t += this.speed * dt;
      if (this.t >= len) {
        const nbs = walkAdj.get(this.to);
        const options = nbs.length > 1 ? nbs.filter((n) => n !== this.from) : nbs;
        this.from = this.to;
        this.to = pick(options);
        this.t = 0;
        return;
      }
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      const tx = ax + dx * this.t - dz * this.offset, tz = az + dz * this.t + dx * this.offset;
      this.x += (tx - this.x) * Math.min(1, dt * 4);
      this.z += (tz - this.z) * Math.min(1, dt * 4);
      this.h += angleDiff(this.h, Math.atan2(dx, dz)) * Math.min(1, dt * 6);
      if (this.ride) {
        // Standing on the deck (17 cm up), still, leaning a little into the ride.
        m.body.position.y = 0.17;
        animatePerson(m, 0, 0);
        m.body.rotation.x = 0.06;
        // Both hands on the grips (the bar is 1.1 m up, 0.46 m ahead of the feet, 48 cm wide):
        // arms reaching forward, elbows nearly straight.
        const b = m.person.bones;
        // (Checked in tools/rider-preview.html: the hands close on the grips.)
        b.upperArmL.rotation.set(-0.84, 0, 0.03);
        b.upperArmR.rotation.set(-0.84, 0, -0.03);
        b.forearmL.rotation.x = -0.08;
        b.forearmR.rotation.x = -0.08;
      } else {
        this.phase += dt * this.speed * 5;
        animatePerson(m, this.phase, 0.6);
      }
    }
    this.groundY = surfaceHeight(this.x, this.z, this.groundY);
    m.root.position.set(this.x, isWater(this.x, this.z) && !onBridge(this.x, this.z, this.groundY) ? -0.9 : this.y + this.groundY, this.z);
    m.root.rotation.y = this.h;
  }
}

// ============================================================================
// Vehicles
// ============================================================================
// Every vehicle is built by cars.js in one consistent style (the player's Tesla Roadster by
// roadster.js); wheels spin and steer.
const CAR_KINDS = {
  bus: { accel: 6, colors: [0xd8202a], grip: 6, max: 22 },
  police: { accel: 16, colors: [0xf4f4f4], grip: 8, max: 50 },
  roadster: { accel: 24, boost: 38, colors: [0xe8eae9], flyMax: 70, grip: 10, max: 70 },
  sedan: { accel: 11, colors: [0x1f3a93, 0xa3171e, 0x7f8c8d, 0xecf0f1, 0x2c3e50, 0x16485e, 0x111111, 0xbdc3c7], grip: 7, max: 40 },
  sports: { accel: 19, colors: [0xb8bcc0, 0xc8102e, 0x161616, 0xf2f2f2, 0xf5c518, 0x1d3f8f], grip: 9, max: 62 },
  suv: { accel: 12, colors: [0x2c3e50, 0x7f8c8d, 0xecf0f1, 0x1e3d2f, 0x111111, 0x6b2e2e], grip: 7, max: 42 },
  taxi: { accel: 12, colors: [0x141414], grip: 7, max: 42 },
  van: { accel: 8, colors: [0xecf0f1, 0x95a5a6, 0x2e86c1, 0xd35400], grip: 6, max: 32 },
  wagon: { accel: 11, colors: [0x5d6d7e, 0x922b21, 0x1f618d, 0xd5d8dc, 0x145a32], grip: 7, max: 40 },
};
for (const [kind, k] of Object.entries(CAR_KINDS)) {
  const style = kind === 'roadster' ? ROADSTER : BODY_STYLES[kind];
  Object.assign(k, { height: style.height, len: style.len, width: style.width });
}

function makeCarMesh(kind, color) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const car = kind === 'roadster' ? buildRoadster(color) : buildCar(kind, color);
  body.add(car.group);
  car.shadow.castShadow = true;
  car.shadow.layers.set(SHADOW_LAYER);
  const lights = [];
  if (kind === 'police') {
    for (const [x, c] of [[-0.3, 0x3355ff], [0.3, 0xff2233]]) {
      const flash = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: c }));
      flash.scale.set(0.42, 0.12, 0.26);
      flash.position.set(x, car.top + 0.1, BODY_STYLES.police.len / 2 - BODY_STYLES.police.cabin[1] * BODY_STYLES.police.len - 0.4);
      body.add(flash);
      lights.push(flash);
    }
  }
  scene.add(root);
  return { body, chassis: car.chassis, lights, paint: car.paint, roadster: car.roadster, root, setDistance: car.setDistance, setPaint: car.setPaint, wheels: car.wheels };
}

const vehicles = [];
class Vehicle {
  constructor(kind, x, z, h, mode) {
    const k = CAR_KINDS[kind];
    this.kind = kind;
    this.k = k;
    this.color = pick(k.colors);
    this.mesh = makeCarMesh(kind, this.color);
    this.mesh.root.traverse((o) => { o.userData.owner = this; });
    // air: the underside's height while flying (null on the ground).
    Object.assign(this, { air: null, flyPitch: 0, flyRoll: 0, flying: false, h, health: 100, mode, sink: 0, steer: 0, throttle: 0, vx: 0, vy: 0, vz: 0, x, yawRate: 0, z });
    this.driver = mode === 'ai' || mode === 'police';
    this.siren = mode === 'police';
    this.ai = null;
    this.smokeT = 0;
    this.stunT = 0;
    vehicles.push(this);
    this.sync();
  }
  get speed() { return Math.hypot(this.vx, this.vz); }
  get altitude() { return this.air === null ? 0 : this.air - (this.groundY ?? 0); }
  get forwardSpeed() { return this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h); }
  // Collision circles spaced along the body: two for cars, more for buses.
  circles() {
    const fx = Math.sin(this.h), fz = Math.cos(this.h), n = Math.max(2, Math.round(this.k.len / 2.4));
    const span = this.k.len / 2 - this.k.width * 0.5;
    const out = [];
    for (let i = 0; i < n; i++) {
      const o = -span + (2 * span * i) / (n - 1);
      out.push([this.x + fx * o, this.z + fz * o]);
    }
    return out;
  }
  remove() {
    scene.remove(this.mesh.root);
    vehicles.splice(vehicles.indexOf(this), 1);
  }
  damage(amount) {
    if (this.mode === 'wreck') return;
    this.health -= amount;
    if (this.health <= 0) explode(this);
  }
  sync(dt = 0) {
    const m = this.mesh;
    m.setDistance(Math.hypot(this.x - camera.position.x, this.z - camera.position.z));
    // Ride up and down kerbs smoothly rather than snapping.
    const ground = surfaceHeight(this.x, this.z, this.groundY);
    this.groundY = this.groundY === undefined || !dt ? ground : this.groundY + (ground - this.groundY) * Math.min(1, dt * 14);
    m.root.position.set(this.x, (this.air ?? this.groundY) - this.sink, this.z);
    // Pitch and roll with the slope under the wheels.
    const L = this.k.len * 0.4, W = this.k.width * 0.4, fx = Math.sin(this.h), fz = Math.cos(this.h);
    m.root.rotation.order = 'YXZ';
    const at = (x, z) => surfaceHeight(x, z, this.groundY);
    m.root.rotation.x = Math.atan2(at(this.x - fx * L, this.z - fz * L) - at(this.x + fx * L, this.z + fz * L), 2 * L);
    m.root.rotation.z = Math.atan2(at(this.x + fz * W, this.z - fx * W) - at(this.x - fz * W, this.z + fx * W), 2 * W);
    m.root.rotation.y = this.h;
    if (this.air !== null) {
      // In the air the body banks into turns and pitches with thrust, with a slow hover bob.
      // A stunt (sky traffic) adds its own turn and offset: forward, to the left and up.
      const pose = this.pose;
      m.root.rotation.x = this.flyPitch + (pose?.pitch || 0);
      m.root.rotation.z = this.flyRoll + (pose?.roll || 0);
      if (pose) {
        m.root.rotation.y = this.h + pose.yaw;
        m.root.position.x += fx * pose.forward + fz * pose.side;
        m.root.position.y += pose.up;
        m.root.position.z += fz * pose.forward - fx * pose.side;
      }
      if (this.flying) m.root.position.y += Math.sin(performance.now() / 600 + this.x * 0.1) * 0.05;
    }
    const vf = this.forwardSpeed;
    for (const w of m.wheels) {
      w.spin.rotation.x += ((this.air === null ? vf : 0) * dt) / w.r;
      if (w.steer) w.steer.rotation.y = this.steer * 0.5;
    }
    // Suspension: the body dives under braking, squats under power and leans out of
    // corners, on a spring with a little bounce; small vibration grows with speed.
    if (dt > 0) {
      const s = (this.susp ||= { lastH: this.h, lastVf: vf, pitch: 0, pitchV: 0, roll: 0, rollV: 0 });
      const accel = clamp((vf - s.lastVf) / dt, -25, 25), yawRate = angleDiff(s.lastH, this.h) / dt;
      s.lastVf = vf;
      s.lastH = this.h;
      const targetPitch = clamp(-accel * 0.006, -0.06, 0.06), targetRoll = clamp(yawRate * vf * 0.004, -0.07, 0.07);
      s.pitchV = (s.pitchV + (targetPitch - s.pitch) * 90 * dt) * Math.exp(-9 * dt);
      s.rollV = (s.rollV + (targetRoll - s.roll) * 70 * dt) * Math.exp(-8 * dt);
      s.pitch += s.pitchV * dt;
      s.roll += s.rollV * dt;
      const buzz = Math.min(1, Math.abs(vf) / 20) * 0.004;
      m.chassis.rotation.set(s.pitch + Math.sin(performance.now() * 0.031 + this.x) * buzz, 0, s.roll);
      m.chassis.position.y = Math.sin(performance.now() * 0.023 + this.z) * buzz * 2;
    }
    if (m.roadster) m.roadster.update(dt, this.thrust);
    if (m.lights.length) {
      const on = this.siren && Math.floor(performance.now() / 180) % 2 === 0;
      m.lights[0].visible = !this.siren || on;
      m.lights[1].visible = !this.siren || !on;
    }
    // A car at rest (parked, or settled at a light) keeps its matrices from the last frames,
    // so dozens of parked cars cost the renderer nothing to update.
    const still = Math.abs(vf) < 0.01 && this.x === this.lastX && this.z === this.lastZ && this.h === this.lastH && !m.lights.length && this.mode !== 'player';
    this.restFrames = still ? (this.restFrames || 0) + 1 : 0;
    m.root.matrixWorldAutoUpdate = this.restFrames < 30;
    [this.lastX, this.lastZ, this.lastH] = [this.x, this.z, this.h];
  }
}

// Vehicle physics runs in fixed 1/120 s steps, so handling and collisions behave the same
// at any frame rate.
const PHYSICS_STEP = 1 / 120;
function physicsStep(v, input, dt) {
  const steps = Math.max(1, Math.ceil(dt / PHYSICS_STEP));
  for (let i = 0; i < steps; i++) physicsSubstep(v, input, dt / steps);
}
function physicsSubstep(v, input, dt) {
  const k = v.k;
  let fx = Math.sin(v.h), fz = Math.cos(v.h);
  let vf = v.vx * fx + v.vz * fz;
  let vr = v.vx * -fz + v.vz * fx;
  if (v.mode === 'wreck' || v.sink > 0) input = { hb: true, s: 0, t: 0 };
  // Pedal ramps in over ~0.25 s and releases faster, so launches and lifts are not jerky.
  const pedalRate = Math.abs(input.t) > Math.abs(v.throttle) ? 4 : 7;
  v.throttle += clamp(input.t - v.throttle, -pedalRate * dt, pedalRate * dt);
  const throttle = v.throttle;
  if (throttle > 0.02) {
    if (vf < -0.5) vf += 24 * throttle * dt;
    else vf += k.accel * throttle * Math.max(0.12, 1 - vf / k.max) * dt;
  } else if (throttle < -0.02) {
    if (vf > 0.5) vf += 24 * throttle * dt;
    else vf = Math.max(-13, vf + 8 * throttle * dt);
  } else {
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), 2.5 * dt);
  }
  // The Roadster's rear thrusters (SpaceX package) on top of the motors.
  if (input.boost && k.boost && vf > -1) vf += k.boost * Math.max(0, 1 - vf / (k.max * 1.3)) * dt;
  vf -= vf * Math.abs(vf) * 0.0006 * dt;
  if (input.hb) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 9 * dt);
  // Steering winds in slower at speed and self-centres faster than it turns in.
  const steerRate = (input.s === 0 || Math.sign(input.s) !== Math.sign(v.steer) ? 7 : 4) / (1 + Math.abs(vf) / 30);
  v.steer += clamp(input.s - v.steer, -steerRate * dt, steerRate * dt);
  const maxSteer = 0.6 / (1 + Math.abs(vf) / 18);
  v.h += (vf / 2.7) * Math.tan(v.steer * maxSteer) * dt * (input.hb ? 1.5 : 1);
  vr *= Math.exp(-(input.hb ? 1.1 : k.grip) * dt);
  // Sliding or locking the wheels leaves rubber on the road.
  const slip = Math.abs(vr) + (input.hb && Math.abs(vf) > 4 ? 3 : 0) + (throttle < -0.5 && vf > 9 ? 2.5 : 0);
  if (slip > 2.6 && v.sink === 0) skid(v, slip);
  else v.skidFrom = null;
  fx = Math.sin(v.h); fz = Math.cos(v.h);
  v.vx = fx * vf - fz * vr;
  v.vz = fz * vf + fx * vr;
  v.x += v.vx * dt;
  v.z += v.vz * dt;
  if (isWater(v.x, v.z) && !onBridge(v.x, v.z, v.groundY)) {
    v.sink = Math.min(2.2, v.sink + dt * 0.9);
    v.vx *= Math.exp(-2.5 * dt);
    v.vz *= Math.exp(-2.5 * dt);
    if (v.sink > 0.3 && Math.random() < 0.3) spawnPuff(v.x, 0.1, v.z, 0xdfefff, 0.5, 0.8, 0.8);
  }
  collideVehicleWithCity(v);
  v.x = clamp(v.x, WORLD.minX, WORLD.maxX);
  v.z = clamp(v.z, WORLD.minZ, WORLD.maxZ);
}

// The Roadster flies on its cold-gas thrusters: W/S thrust and air brake, A/D yaw, Space/E
// climb, C/Q sink, Shift boost, holding its height with no key pressed. With flight off (G) it
// sinks gently and lands: on a street it drives on, on a roof it waits there.
const MAX_ALTITUDE = 220;
function flightStep(v, input, dt) {
  const steps = Math.max(1, Math.ceil(dt / PHYSICS_STEP));
  for (let i = 0; i < steps; i++) flightSubstep(v, input, dt / steps);
}
function flightSubstep(v, input, dt) {
  const k = v.k, resting = !v.flying && v.vy === 0;
  let fx = Math.sin(v.h), fz = Math.cos(v.h);
  let vf = v.vx * fx + v.vz * fz, vr = v.vx * -fz + v.vz * fx;
  const t = resting ? 0 : input.t, top = k.flyMax * (input.boost ? 1.35 : 1);
  if (t > 0) vf += (16 + (input.boost ? 30 : 0)) * t * Math.max(0.05, 1 - vf / top) * dt;
  else if (t < 0) vf += (vf > 0 ? 22 : 9) * t * dt;
  else vf -= Math.sign(vf) * Math.min(Math.abs(vf), (resting ? 12 : 1.2) * dt);
  vf = Math.max(-15, vf - vf * Math.abs(vf) * 0.0008 * dt);
  // Yaw from the steering keys, quicker when slow; sideways drift dies away.
  const yawWant = resting ? 0 : input.s * (1.6 - Math.min(0.8, Math.abs(vf) / 70));
  v.yawRate += (yawWant - v.yawRate) * (1 - Math.exp(-5 * dt));
  v.h += v.yawRate * dt;
  vr *= Math.exp(-2.5 * dt);
  const climb = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  if (v.flying) v.vy += (climb * 10 - v.vy) * (1 - Math.exp(-3 * dt));
  else if (!resting) v.vy = Math.max(-6, v.vy - 9.8 * dt);
  fx = Math.sin(v.h);
  fz = Math.cos(v.h);
  v.vx = fx * vf - fz * vr;
  v.vz = fz * vf + fx * vr;
  v.x = clamp(v.x + v.vx * dt, WORLD.minX, WORLD.maxX);
  v.z = clamp(v.z + v.vz * dt, WORLD.minZ, WORLD.maxZ);
  // Walls of buildings that rise above the car's underside.
  for (const [cx, cz] of v.circles()) {
    const c = { x: cx, z: cz }, hit = collideCircle(c, k.width * 0.5, v.air + 0.2);
    if (!hit) continue;
    v.x += c.x - cx;
    v.z += c.z - cz;
    const vn = v.vx * hit.nx + v.vz * hit.nz;
    if (vn >= 0) continue;
    v.vx -= 1.3 * vn * hit.nx;
    v.vz -= 1.3 * vn * hit.nz;
    if (-vn > 8) {
      v.damage((-vn - 8) * 2);
      if (v === player.vehicle) { sfx.crash(-vn / 25); shake = Math.min(0.6, -vn / 30); }
    }
  }
  const ground = surfaceHeight(v.x, v.z, v.groundY), roof = buildingAt(v.x, v.z)?.h ?? -Infinity, floor = Math.max(ground, roof);
  v.air = Math.min(v.air + v.vy * dt, floor + MAX_ALTITUDE);
  if (v.air <= floor) {
    if (v.vy < -9) {
      v.damage((-v.vy - 9) * 6);
      if (v === player.vehicle) { sfx.crash(0.5); shake = 0.4; }
    }
    v.air = floor;
    v.vy = Math.max(0, v.vy);
    if (!v.flying) {
      if (roof > ground) v.vy = 0;
      else Object.assign(v, { air: null, flyPitch: 0, flyRoll: 0, groundY: ground, yawRate: 0 });
    }
  }
  if (v.air === null) return;
  // The nose dips under thrust and lifts braking or climbing; the body banks into turns.
  const pitchWant = resting ? 0 : clamp(t * 0.08 + (input.boost && t > 0 ? 0.05 : 0) - v.vy * 0.008, -0.18, 0.15);
  const rollWant = resting ? 0 : clamp(-v.yawRate * Math.min(1, Math.abs(vf) / 25) * 0.35, -0.45, 0.45);
  v.flyPitch += (pitchWant - v.flyPitch) * (1 - Math.exp(-3 * dt));
  v.flyRoll += (rollWant - v.flyRoll) * (1 - Math.exp(-3 * dt));
}

// Skid marks: a ring buffer of dark quads behind the rear wheels.
const SKID_MAX = 4000;
const skidGeo = new THREE.BufferGeometry();
skidGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SKID_MAX * 18), 3));
const skidMesh = new THREE.Mesh(skidGeo, new THREE.MeshBasicMaterial({ color: 0x0c0c0c, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide, transparent: true }));
skidMesh.frustumCulled = false;
scene.add(skidMesh);
let skidNext = 0;
function skid(v, slip) {
  const fx = Math.sin(v.h), fz = Math.cos(v.h), rx = -fz, rz = fx, back = -v.k.len * 0.3, half = v.k.width / 2 - 0.15;
  const wheels = [-1, 1].map((side) => [v.x + fx * back + rx * half * side, v.z + fz * back + rz * half * side]);
  if (v.skidFrom && Math.hypot(wheels[0][0] - v.skidFrom[0][0], wheels[0][1] - v.skidFrom[0][1]) > 0.35) {
    const pos = skidGeo.attributes.position.array, y = groundHeight(v.x, v.z) + 0.012;
    for (let k = 0; k < 2; k++) {
      const [ax, az] = v.skidFrom[k], [bx, bz] = wheels[k];
      const len = Math.hypot(bx - ax, bz - az) || 1, nx = (-(bz - az) / len) * 0.11, nz = ((bx - ax) / len) * 0.11;
      const o = (skidNext % SKID_MAX) * 18;
      pos.set([ax - nx, y, az - nz, bx - nx, y, bz - nz, bx + nx, y, bz + nz, ax - nx, y, az - nz, bx + nx, y, bz + nz, ax + nx, y, az + nz], o);
      skidNext++;
    }
    skidGeo.attributes.position.needsUpdate = true;
    v.skidFrom = wheels;
    if (slip > 4 && Math.random() < 0.35) for (const [x, z] of wheels) spawnPuff(x, 0.3, z, 0xd8d8d8, 0.6, 1.4, 0.8, 0.6);
  } else if (!v.skidFrom) v.skidFrom = wheels;
}

function collideVehicleWithCity(v) {
  const r = v.k.width * 0.55;
  for (const [cx, cz] of v.circles()) {
    // Light street furniture topples instead of stopping the car dead.
    if (v.speed > 5) {
      poleGrid.query(cx - r, cz - r, cx + r, cz + r, (pole) => {
        if (pole.down || !pole.breakable || Math.hypot(pole.x - cx, pole.z - cz) > r + pole.r) return;
        knockOver(pole, v.vx, v.vz);
        v.vx *= 0.88;
        v.vz *= 0.88;
        v.damage(2);
        if (v === player.vehicle) { sfx.crash(0.3); shake = Math.max(shake, 0.15); }
      });
    }
    const c = { x: cx, z: cz };
    const hit = collideCircle(c, r);
    if (!hit) continue;
    v.x += c.x - cx;
    v.z += c.z - cz;
    const vn = v.vx * hit.nx + v.vz * hit.nz;
    if (vn < 0) {
      // Small bounce plus scraping friction along the wall.
      v.vx -= 1.25 * vn * hit.nx;
      v.vz -= 1.25 * vn * hit.nz;
      const tx = -hit.nz, tz = hit.nx, vt = v.vx * tx + v.vz * tz;
      const scrape = Math.min(Math.abs(vt), -vn * 0.3) * Math.sign(vt);
      v.vx -= tx * scrape;
      v.vz -= tz * scrape;
      if (-vn > 6) {
        v.damage((-vn - 6) * 2.5);
        if (v === player.vehicle) { sfx.crash(-vn / 25); shake = Math.min(0.6, -vn / 30); }
      }
    }
  }
}

function collideVehicles() {
  const active = vehicles.filter((v) => v.mode !== 'sky' && Math.abs(v.x - player.x) < 220 && Math.abs(v.z - player.z) < 220);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      if (Math.abs(a.x - b.x) > 7 || Math.abs(a.z - b.z) > 7 || Math.abs(a.altitude - b.altitude) > 1.5) continue;
      const ra = a.k.width * 0.55, rb = b.k.width * 0.55;
      for (const [ax, az] of a.circles()) {
        for (const [bx, bz] of b.circles()) {
          const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
          if (d >= ra + rb || d < 1e-4) continue;
          const nx = dx / d, nz = dz / d, depth = ra + rb - d;
          const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
          const aRails = a.mode === 'ai' && a.stunT <= 0, bRails = b.mode === 'ai' && b.stunT <= 0;
          if (rel < -3) {
            if (aRails) stun(a);
            if (bRails) stun(b);
          }
          const aw = aRails && !bRails ? 0 : bRails && !aRails ? 1 : 0.5;
          a.x -= nx * depth * aw; a.z -= nz * depth * aw;
          b.x += nx * depth * (1 - aw); b.z += nz * depth * (1 - aw);
          if (rel < 0) {
            const j2 = -1.3 * rel * 0.5;
            if (!aRails) { a.vx -= nx * j2; a.vz -= nz * j2; }
            if (!bRails) { b.vx += nx * j2; b.vz += nz * j2; }
            if (a === player.vehicle) b.lastHitByPlayer = true;
            if (b === player.vehicle) a.lastHitByPlayer = true;
            if (-rel > 7) {
              a.damage((-rel - 7) * 1.5);
              b.damage((-rel - 7) * 1.5);
              if (a === player.vehicle || b === player.vehicle) { sfx.crash(-rel / 25); shake = Math.min(0.6, -rel / 30); }
              if ((a.mode === 'police' && b === player.vehicle) || (b.mode === 'police' && a === player.vehicle)) crime(0.4);
            }
          }
        }
      }
    }
  }
}

function stun(v) {
  v.stunT = 2.5;
}

// Traffic AI on the directed road graph (drive on the right).
function attachToRoad(v) {
  const id = nearestNode(driveGrid, v.x, v.z, 15, (n) => driveAdj.has(n));
  if (id === null) return false;
  const fx = Math.sin(v.h), fz = Math.cos(v.h);
  let best = null, bestDot = -Infinity;
  for (const e of driveAdj.get(id)) {
    const [bx, bz] = N[e.to], [ax, az] = N[id];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const dot = ((bx - ax) * fx + (bz - az) * fz) / len;
    if (dot > bestDot) { bestDot = dot; best = e; }
  }
  v.ai = { cruise: best.w >= 11 ? rand(12, 15) : rand(8, 11), edge: best, from: id, next: null, speed: v.speed, t: 0 };
  v.ai.next = pickNext(id, best.to);
  return true;
}
function pickNext(from, at) {
  const out = driveAdj.get(at);
  if (!out || !out.length) return null;
  const options = out.length > 1 ? out.filter((e) => e.to !== from) : out;
  return pick(options);
}

// Slows `target` for anything in the lane ahead. `reach` is the bumper-to-centre distance
// of both bodies, so long buses keep their gap.
function obstacleLimit(v, target) {
  const fx = Math.sin(v.h), fz = Math.cos(v.h);
  const obstacle = (ox, oz, sideLimit, reach = v.k.len / 2) => {
    const rx = ox - v.x, rz = oz - v.z;
    const ahead = rx * fx + rz * fz, side = Math.abs(rx * -fz + rz * fx);
    if (ahead > 0 && ahead < reach + 12 && side < sideLimit) target = Math.min(target, Math.max(0, (ahead - reach - 2.5) * 1.4));
  };
  for (const o of vehicles) if (o !== v && o.altitude < 1.5 && Math.abs(o.x - v.x) < 25 && Math.abs(o.z - v.z) < 25) obstacle(o.x, o.z, 2, (v.k.len + o.k.len) / 2);
  for (const r of railSections) if (Math.abs(r.x - v.x) < 25 && Math.abs(r.z - v.z) < 25) obstacle(r.x, r.z, 2.6, (v.k.len + r.len) / 2);
  if (!player.vehicle) obstacle(player.x, player.z, 1.6);
  for (const p of peds) if (p.state !== 'dead' && Math.abs(p.x - v.x) < 12 && Math.abs(p.z - v.z) < 12) obstacle(p.x, p.z, 1.4);
  return target;
}

// Buses drive their route in the right-hand lane and stop at every real stop.
const BUS_LANE = 1.8;
function routeStep(v, dt) {
  const b = v.route, r = b.r;
  let target = 11;
  if (b.dwell > 0) { b.dwell -= dt; target = 0; }
  else if (b.stopIdx < r.stops.length && b.s >= r.stops[b.stopIdx].s - 2) {
    const stop = r.stops[b.stopIdx++];
    b.dwell = 7;
    target = 0;
    // The front door, on the right side, a quarter of the way back from the nose.
    const fx = Math.sin(v.h), fz = Math.cos(v.h), rx = -fz, rz = fx;
    serveStop(stop.x, stop.z, [v.x + rx * (v.k.width / 2 + 0.5) + fx * v.k.len * 0.3, v.z + rz * (v.k.width / 2 + 0.5) + fz * v.k.len * 0.3]);
  }
  const [ax, az] = routeTangent(r, b.s), [cx, cz] = routeTangent(r, b.s + 18);
  const bend = Math.abs(angleDiff(Math.atan2(ax, az), Math.atan2(cx, cz)));
  target = Math.min(target, 4 + 8 * Math.max(0, 1 - bend / 1.2));
  target = stopForSignals(v, obstacleLimit(v, target));
  if (b.s >= r.len - 2) {
    target = 0;
    if (Math.hypot(v.x - player.x, v.z - player.z) > 150) return v.remove();
  }
  b.speed += clamp(target - b.speed, -6 * dt, 2.5 * dt);
  b.s = Math.min(r.len, b.s + b.speed * dt);
  const [px, pz] = routePoint(r, b.s), [tx, tz] = routeTangent(r, b.s);
  const gx = px - tz * BUS_LANE, gz = pz + tx * BUS_LANE;
  const ox = v.x, oz = v.z;
  v.x += (gx - v.x) * Math.min(1, dt * 5);
  v.z += (gz - v.z) * Math.min(1, dt * 5);
  v.vx = (v.x - ox) / dt;
  v.vz = (v.z - oz) / dt;
  const heading = Math.atan2(tx, tz);
  v.steer = clamp(angleDiff(v.h, heading) * 2, -1, 1);
  v.h += angleDiff(v.h, heading) * Math.min(1, dt * 4);
}
// After a knock, find the nearest point of the route again (within 40 m of where it was).
function rejoinRoute(v) {
  const b = v.route;
  let best = Infinity, bestS = b.s;
  for (let s = Math.max(0, b.s - 40); s <= Math.min(b.r.len, b.s + 40); s += 2) {
    const [x, z] = routePoint(b.r, s), d = Math.hypot(x - v.x, z - v.z);
    if (d < best) { best = d; bestS = s; }
  }
  if (best > 12) return false;
  b.s = bestS;
  b.speed = 0;
  return true;
}

function aiStep(v, dt) {
  if (v.route) return routeStep(v, dt);
  const a = v.ai;
  const [ax, az] = N[a.from], [bx, bz] = N[a.edge.to];
  const len = Math.hypot(bx - ax, bz - az) || 0.01;
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  let target = stopForSignals(v, obstacleLimit(v, a.cruise));
  if (a.next) {
    const [cx, cz] = N[a.next.to];
    const nl = Math.hypot(cx - bx, cz - bz) || 1;
    const turn = Math.acos(clamp(dx * (cx - bx) / nl + dz * (cz - bz) / nl, -1, 1));
    if (len - a.t < 14 && turn > 0.5) target = Math.min(target, 4 + 9 * (1 - turn / Math.PI));
  }
  a.speed += clamp(target - a.speed, -12 * dt, 4 * dt);
  a.t += a.speed * dt;
  if (a.t >= len) {
    if (!a.next) return v.remove();
    a.t -= len;
    a.from = a.edge.to;
    a.edge = a.next;
    a.next = pickNext(a.from, a.edge.to);
    return;
  }
  const offset = a.edge.oneway ? 0 : a.edge.w / 4;
  const tx = ax + dx * a.t - dz * offset, tz = az + dz * a.t + dx * offset;
  const px = v.x, pz = v.z;
  v.x += (tx - v.x) * Math.min(1, dt * 5);
  v.z += (tz - v.z) * Math.min(1, dt * 5);
  v.vx = (v.x - px) / dt;
  v.vz = (v.z - pz) / dt;
  v.h += angleDiff(v.h, Math.atan2(dx, dz)) * Math.min(1, dt * 5);
  v.steer = clamp(angleDiff(v.h, Math.atan2(dx, dz)) * 2, -1, 1);
}

function copStep(v, dt) {
  const target = player.vehicle || player;
  const tx = target.x + (target.vx || 0) * 0.4, tz = target.z + (target.vz || 0) * 0.4;
  const d = Math.hypot(tx - v.x, tz - v.z);
  const ai = v.ai;
  let aimX = tx, aimZ = tz;
  if (d > 40) {
    ai.repath -= dt;
    if (ai.repath <= 0) {
      ai.repath = 1.5;
      const s = nearestNode(driveGrid, v.x, v.z, 60), g = nearestNode(driveGrid, target.x, target.z, 80);
      ai.path = s !== null && g !== null ? findPath(s, g) || [] : [];
    }
    while (ai.path.length && Math.hypot(N[ai.path[0]][0] - v.x, N[ai.path[0]][1] - v.z) < 9) ai.path.shift();
    if (ai.path.length) [aimX, aimZ] = N[ai.path[0]];
  }
  const diff = angleDiff(v.h, Math.atan2(aimX - v.x, aimZ - v.z));
  let steer = clamp(diff * 2.2, -1, 1);
  let throttle = 1;
  const vf = v.forwardSpeed;
  const want = !player.vehicle && d < 12 ? 0 : Math.abs(diff) > 0.9 ? 9 : d < 25 ? 18 : 34;
  if (vf > want + 2) throttle = -0.6;
  else if (vf > want) throttle = 0;
  if (ai.reverseT > 0) {
    ai.reverseT -= dt;
    throttle = -1;
    steer = -steer;
  } else if (throttle > 0 && Math.abs(vf) < 1.5) {
    ai.stuckT += dt;
    if (ai.stuckT > 1.2) { ai.reverseT = 1.1; ai.stuckT = 0; }
  } else {
    ai.stuckT = 0;
  }
  physicsStep(v, { hb: false, s: steer, t: throttle }, dt);

  ai.shootT -= dt;
  if (player.wanted >= 2 && d < 32 && ai.shootT <= 0 && !player.dead) {
    ai.shootT = rand(0.7, 1.5) / (player.wanted / 2);
    const from = new THREE.Vector3(v.x, groundHeight(v.x, v.z) + 1.4, v.z);
    const to = new THREE.Vector3(target.x + rand(-1.5, 1.5), groundHeight(target.x, target.z) + 1.2, target.z + rand(-1.5, 1.5));
    tracer(from, to);
    sfx.gun(clamp(0.6 - d / 80, 0.1, 0.5));
    if (Math.random() < 0.35 + player.wanted * 0.05) {
      if (player.vehicle) { player.vehicle.damage(4); hurt(2); } else hurt(rand(4, 9));
    }
  }
}

const burntPaint = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
function explode(v) {
  if (v.agent) releaseAgent(v);
  v.mode = 'wreck';
  v.health = 0;
  v.siren = false;
  v.driver = false;
  v.mesh.setPaint(burntPaint);
  sfx.explosion();
  shake = 1;
  for (let i = 0; i < 30; i++) spawnPuff(v.x + rand(-1, 1), v.altitude + rand(0.5, 2), v.z + rand(-1, 1), pick([0xff7b00, 0xffc300, 0xff3c00, 0x333333]), rand(1, 2.2), rand(0.5, 1.2), rand(2, 6), 4);
  explosionFlash.position.set(v.x, groundHeight(v.x, v.z) + v.altitude + 3, v.z);
  explosionFlash.intensity = 60;
  setTimeout(() => { explosionFlash.intensity = 0; }, 250);
  // (High in the air, the blast reaches nobody on the ground.)
  const low = v.altitude < 5;
  for (const p of peds) {
    const d = Math.hypot(p.x - v.x, p.z - v.z);
    if (d < 8 && low) p.kill((p.x - v.x) * 2, (p.z - v.z) * 2, 6);
    else if (d < 50) p.scare(v.x, v.z);
  }
  for (const o of vehicles) if (o !== v && Math.hypot(o.x - v.x, o.z - v.z) < 7 && Math.abs(o.altitude - v.altitude) < 5) o.damage(35);
  if (player.vehicle === v) hurt(200);
  else if (!player.vehicle && low) {
    const d = Math.hypot(player.x - v.x, player.z - v.z);
    if (d < 8) hurt(70 * (1 - d / 8));
  }
  if (v.lastHitByPlayer) crime(v.kind === 'police' ? 6 : 2.5);
  v.wreckT = 0;
}

// ============================================================================
// Trams (trikk) and trains
// ============================================================================
// Rail cars come from railcars.js (Sloyd has no tram or modern train generator).
// Each consist follows a breadcrumb trail of its head, so sections articulate on curves.
const RN = data.railNodes;
function railGraph(lines) {
  const adj = new Map();
  const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); if (!adj.get(a).includes(b)) adj.get(a).push(b); };
  for (const l of lines) {
    if (l.s) continue;
    for (let i = 0; i + 1 < l.n.length; i++) { link(l.n[i], l.n[i + 1]); link(l.n[i + 1], l.n[i]); }
  }
  return adj;
}
const RAIL_KINDS = {
  train: { ...RAIL_STYLES.train, adj: railGraph(data.rails), cars: 4, cruise: 16, gap: 0.8 },
  tram: { ...RAIL_STYLES.tram, cars: 3, cruise: 10, gap: 0.5 },
};
// The main railway station (the city's "station"; in Oslo, Oslo S), where trains stop.
const STATION = data.city.station;
const railVehicles = [];
const railSections = [];

// Trams follow a real route (path + stops); trains roam the track graph.
class RailVehicle {
  constructor(kind, { node = null, route = null, s = 0 } = {}) {
    this.kind = kind;
    this.k = RAIL_KINDS[kind];
    const k = this.k;
    this.total = k.cars * k.len + (k.cars - 1) * k.gap;
    this.route = route;
    const sign = route ? [route.ref, route.to] : null;
    const cars = Array.from({ length: k.cars }, (_, i) => buildRailCar(kind, { back: i === k.cars - 1, front: i === 0, pantograph: i === 1, sign }));
    this.meshes = cars.map((c) => c.group);
    this.wheels = cars.flatMap((c) => c.wheels);
    this.bellows = Array.from({ length: k.cars - 1 }, () => buildBellows(kind));
    for (const o of [...this.meshes, ...this.bellows]) scene.add(o);
    this.sections = [];
    this.od = 0;
    this.speed = k.cruise * 0.6;
    this.dwell = 0;
    this.stuckT = 0;
    this.bellT = 0;
    this.servedStation = false;
    this.off = null;
    this.endT = 0;
    let x, z;
    if (route) {
      this.s = Math.max(0, s - this.total - 2);
      this.stopIdx = route.stops.findIndex((stop) => stop.s > s);
      if (this.stopIdx < 0) this.stopIdx = route.stops.length;
      [x, z] = routePoint(route, this.s);
    } else {
      this.from = node;
      this.to = pick(k.adj.get(node));
      this.t = 0;
      [x, z] = RN[node];
    }
    this.trail = [{ d: 0, x, y: terrainAt(x, z), z }];
    this.advance(this.total + 2);
    railVehicles.push(this);
  }
  remove() {
    for (const m of [...this.meshes, ...this.bellows]) scene.remove(m);
    railVehicles.splice(railVehicles.indexOf(this), 1);
  }
  // Picks the straightest continuation; switches only allow gentle divergence.
  nextNode() {
    const [ax, az] = RN[this.from], [bx, bz] = RN[this.to];
    const din = Math.atan2(bx - ax, bz - az);
    const options = (this.k.adj.get(this.to) || []).filter((n) => {
      if (n === this.from) return false;
      const [cx, cz] = RN[n];
      return Math.abs(angleDiff(din, Math.atan2(cx - bx, cz - bz))) < 0.6;
    });
    return options.length ? pick(options) : null;
  }
  advance(dist) {
    while (dist > 1e-6) {
      let x, z, y = 0, step;
      if (this.route) {
        step = Math.min(dist, 1, this.route.len - this.s);
        if (step <= 1e-6) break;
        this.s += step;
        [x, z] = routePoint(this.route, this.s);
      } else if (this.off) {
        // Past the end of the mapped track: carry on straight, dipping into a tunnel.
        step = Math.min(dist, 1);
        this.off.dist += step;
        x = this.off.x + Math.sin(this.off.h) * this.off.dist;
        z = this.off.z + Math.cos(this.off.h) * this.off.dist;
        y = -this.off.dist * 0.16;
      } else {
        const [ax, az] = RN[this.from], [bx, bz] = RN[this.to];
        const len = Math.hypot(bx - ax, bz - az) || 0.01;
        step = Math.min(dist, len - this.t, 1);
        this.t += step;
        x = ax + ((bx - ax) * this.t) / len;
        z = az + ((bz - az) * this.t) / len;
        if (this.t >= len - 1e-6) {
          const next = this.nextNode();
          if (next === null) this.off = { dist: 0, h: Math.atan2(bx - ax, bz - az), x: bx, z: bz };
          else { this.from = this.to; this.to = next; this.t = 0; }
        }
      }
      dist -= step;
      this.od += step;
      this.trail.push({ d: this.od, x, y: y + terrainAt(x, z), z });
    }
    while (this.trail.length > 2 && this.trail[1].d < this.od - this.total - 6) this.trail.shift();
  }
  trailAt(d) {
    const tr = this.trail;
    if (d <= tr[0].d) return tr[0];
    let lo = 0, hi = tr.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tr[mid].d < d) lo = mid; else hi = mid; }
    const a = tr[lo], b = tr[hi], f = (d - a.d) / (b.d - a.d || 1);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
  }
  // Distance to the next node and the turn angle there, for curve braking.
  upcomingTurn() {
    if (this.route) {
      const [ax, az] = routeTangent(this.route, this.s), [bx, bz] = routeTangent(this.route, this.s + 20);
      return { angle: Math.min(0.6, Math.abs(angleDiff(Math.atan2(ax, az), Math.atan2(bx, bz)))), dist: 10 };
    }
    if (this.off) return { angle: 0, dist: Infinity };
    const [ax, az] = RN[this.from], [bx, bz] = RN[this.to];
    const len = Math.hypot(bx - ax, bz - az);
    const options = (this.k.adj.get(this.to) || []).filter((n) => n !== this.from);
    let angle = 0;
    for (const n of options) {
      const [cx, cz] = RN[n];
      angle = Math.max(angle, Math.abs(angleDiff(Math.atan2(bx - ax, bz - az), Math.atan2(cx - bx, cz - bz))));
    }
    return { angle: Math.min(angle, 0.6), dist: len - this.t };
  }
  update(dt) {
    const k = this.k;
    let target = k.cruise;
    const route = this.route;
    if (this.dwell > 0) { this.dwell -= dt; target = 0; }
    else if (route && this.stopIdx < route.stops.length && this.s >= route.stops[this.stopIdx].s - 1) {
      const stop = route.stops[this.stopIdx++];
      this.dwell = 9;
      const head = this.sections[0];
      // Doors along the tram: riders board at the point of the track beside the stop.
      if (head && this.kind === 'tram') {
        const [tx, tz] = routePoint(route, Math.max(0, this.s - 8)), side = Math.sign((stop.x - tx) * Math.cos(head.h) - (stop.z - tz) * Math.sin(head.h)) || 1;
        serveStop(stop.x, stop.z, [tx + Math.cos(head.h) * side * (head.width / 2 + 0.5), tz - Math.sin(head.h) * side * (head.width / 2 + 0.5)]);
      }
      if (head && Math.hypot(head.x - player.x, head.z - player.z) < 60) toast(`Trikk <b>${route.ref}</b> → ${route.to} · ${stop.n}`, 4);
    } else if (route && this.s >= route.len - 0.5) {
      target = 0;
      this.endT += dt;
    } else if (this.kind === 'train' && !this.servedStation && STATION && Math.hypot(this.sections[0]?.x - STATION[0], this.sections[0]?.z - STATION[1]) < 70) {
      this.servedStation = true;
      this.dwell = 12;
    }
    const turn = this.upcomingTurn();
    if (turn.dist < 30 && turn.angle > 0.15) target = Math.min(target, k.cruise * (1 - turn.angle));
    // Brake for whatever stands on the track ahead of the front car.
    const head = this.sections[0];
    if (head) {
      const fx = Math.sin(head.h), fz = Math.cos(head.h);
      let blockedByPlayer = false;
      const check = (ox, oz, side, isPlayer = false) => {
        const rx = ox - head.x, rz = oz - head.z;
        const ahead = rx * fx + rz * fz;
        if (ahead < k.len / 2 || ahead > k.len / 2 + 35 || Math.abs(-rx * fz + rz * fx) > side) return;
        target = Math.min(target, Math.max(0, (ahead - k.len / 2 - 5) * 0.6));
        if (isPlayer) blockedByPlayer = true;
      };
      const pv = player.vehicle;
      if (pv) check(pv.x, pv.z, k.width / 2 + pv.k.width / 2, true);
      else if (!player.dead) check(player.x, player.z, k.width / 2 + 0.5, true);
      for (const p of peds) if (p.state === 'walk' && Math.abs(p.x - head.x) < 50 && Math.abs(p.z - head.z) < 50) check(p.x, p.z, k.width / 2 + 0.4);
      for (const o of railVehicles) if (o !== this) for (const sct of o.sections) if (Math.abs(sct.x - head.x) < 60 && Math.abs(sct.z - head.z) < 60) check(sct.x, sct.z, k.width);
      this.bellT -= dt;
      if (blockedByPlayer && this.kind === 'tram' && this.bellT <= 0 && Math.hypot(head.x - player.x, head.z - player.z) < 60) {
        this.bellT = 3;
        beep(1320, 0.12, 0.12, 'triangle');
        setTimeout(() => beep(1320, 0.12, 0.12, 'triangle'), 180);
      }
    }
    this.speed += clamp(target - this.speed, -3.5 * dt, 1.3 * dt);
    this.stuckT = this.speed < 0.3 && this.dwell <= 0 ? this.stuckT + dt : 0;
    if (this.speed > 0) this.advance(this.speed * dt);
    // Place every car between its two bogies on the trail.
    this.sections.length = 0;
    this.meshes.forEach((mesh, i) => {
      const center = this.od - (i * (k.len + k.gap) + k.len / 2);
      const f = this.trailAt(center + k.len * 0.32), b = this.trailAt(center - k.len * 0.32);
      const x = (f.x + b.x) / 2, z = (f.z + b.z) / 2, y = (f.y + b.y) / 2, h = Math.atan2(f.x - b.x, f.z - b.z);
      mesh.position.set(x, y, z);
      mesh.rotation.set(Math.atan2(b.y - f.y, k.len * 0.64), h, 0, 'YXZ');
      mesh.visible = y > -k.height;
      this.sections.push({ h, len: k.len, rv: this, width: k.width, x, y, z });
    });
    for (const w of this.wheels) w.rotation.x += (this.speed * dt) / 0.36;
    // Bellows sit in the gap between cars, turned halfway between them.
    this.bellows.forEach((mesh, i) => {
      const joint = this.od - (i + 1) * (k.len + k.gap) + k.gap / 2;
      const f = this.trailAt(joint + 0.6), b = this.trailAt(joint - 0.6), c = this.trailAt(joint);
      mesh.position.set(c.x, c.y, c.z);
      mesh.rotation.set(0, Math.atan2(f.x - b.x, f.z - b.z), 0);
      mesh.visible = c.y > -k.height;
    });
  }
  get gone() {
    if (this.route) {
      const head = this.sections[0];
      return this.endT > 0 && (this.endT > 40 || !head || Math.hypot(head.x - player.x, head.z - player.z) > 130);
    }
    return this.off && this.off.dist > this.total + 30;
  }
}

// Section circles push cars, knock people over, and stop AI traffic.
function collideRail() {
  for (const sct of railSections) {
    if (sct.y < -1.5 || Math.abs(sct.x - player.x) > 120 || Math.abs(sct.z - player.z) > 120) continue;
    const fx = Math.sin(sct.h), fz = Math.cos(sct.h), n = Math.round(sct.len / 2.4), r = sct.width / 2;
    const speed = sct.rv.speed, rvx = fx * speed, rvz = fz * speed;
    for (let i = 0; i < n; i++) {
      const o = -sct.len / 2 + r + ((sct.len - 2 * r) * i) / (n - 1);
      const cx = sct.x + fx * o, cz = sct.z + fz * o;
      for (const v of vehicles) {
        if (Math.abs(v.x - cx) > 9 || Math.abs(v.z - cz) > 9 || v.altitude > 1.5) continue;
        for (const [vx, vz] of v.circles()) {
          const dx = vx - cx, dz = vz - cz, d = Math.hypot(dx, dz), reach = r + v.k.width * 0.55;
          if (d >= reach || d < 1e-4) continue;
          const nx = dx / d, nz = dz / d;
          v.x += nx * (reach - d);
          v.z += nz * (reach - d);
          if (v.mode === 'ai' && v.stunT <= 0) stun(v);
          const rel = (v.vx - rvx) * nx + (v.vz - rvz) * nz;
          if (rel < 0) {
            v.vx -= 1.3 * rel * nx;
            v.vz -= 1.3 * rel * nz;
            if (-rel > 6) {
              v.damage((-rel - 6) * 2);
              if (v === player.vehicle) { sfx.crash(-rel / 20); shake = Math.min(0.7, -rel / 25); }
            }
          }
        }
      }
      if (!player.vehicle && !player.dead) {
        const dx = player.x - cx, dz = player.z - cz, d = Math.hypot(dx, dz), reach = r + 0.4;
        if (d < reach && d > 1e-4) {
          player.x = cx + (dx / d) * reach;
          player.z = cz + (dz / d) * reach;
          if (speed > 3) { hurt(speed * 4); player.vy = 4; shake = 0.4; }
        }
      }
      for (const p of peds) {
        if (p.state === 'dead' || p.state === 'fly' || Math.hypot(p.x - cx, p.z - cz) > r + 0.4) continue;
        if (speed > 2) p.kill(rvx * 0.8, rvz * 0.8, 3);
      }
    }
  }
}

const trainIds = [...RAIL_KINDS.train.adj.keys()];
function manageRail() {
  for (const rv of railVehicles.slice()) {
    const head = rv.sections[0];
    const far = !head || Math.hypot(head.x - player.x, head.z - player.z) > 750;
    if (rv.gone || far || (rv.stuckT > 20 && Math.hypot(head.x - player.x, head.z - player.z) > 90)) rv.remove();
  }
  const clearOf = (x, z) => railVehicles.every((rv) => rv.sections.every((sct) => Math.hypot(sct.x - x, sct.z - z) > 80));
  // Trams join their route somewhere out of sight, 140-550 m away.
  if (railVehicles.filter((rv) => rv.kind === 'tram').length < 6 && tramRoutes.length) {
    const route = pick(tramRoutes);
    const total = RAIL_KINDS.tram.cars * (RAIL_KINDS.tram.len + RAIL_KINDS.tram.gap);
    for (let i = 0; i < 8; i++) {
      const s = rand(total + 5, route.len - 60);
      const [x, z] = routePoint(route, s), d = Math.hypot(x - player.x, z - player.z);
      if (d > 140 && d < 550 && clearOf(x, z)) { new RailVehicle('tram', { route, s }); break; }
    }
  }
  if (railVehicles.filter((rv) => rv.kind === 'train').length < 2) {
    const options = trainIds.filter((id) => {
      const d = Math.hypot(RN[id][0] - player.x, RN[id][1] - player.z);
      return d > 140 && d < 550;
    });
    const id = options.length ? pick(options) : null;
    if (id !== null && clearOf(RN[id][0], RN[id][1])) new RailVehicle('train', { node: id });
  }
}
function updateRail(dt) {
  for (const rv of railVehicles.slice()) rv.update(dt);
  railSections.length = 0;
  for (const rv of railVehicles) railSections.push(...rv.sections);
  collideRail();
}

// ============================================================================
// Pickups and missions
// ============================================================================
const pickups = [];
const cashGeo = new THREE.BoxGeometry(0.6, 0.35, 0.3);
const cashMat = new THREE.MeshLambertMaterial({ color: 0x4caf50, emissive: 0x1b5e20 });
function dropCash(x, z, amount) {
  const mesh = new THREE.Mesh(cashGeo, cashMat);
  mesh.position.set(x, groundHeight(x, z) + 0.6, z);
  scene.add(mesh);
  pickups.push({ amount, mesh, t: 0, x, z });
}

const markerMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(2.6, 2.6, 40, 24, 1, true),
  new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, color: 0xf2d16b, depthWrite: false, opacity: 0.35, side: THREE.DoubleSide, transparent: true }),
);
markerMesh.position.y = 20;
markerMesh.visible = false;
scene.add(markerMesh);

const landmarks = data.landmarks.map((l) => {
  const id = nearestNode(driveGrid, l.p[0], l.p[1], 400);
  return { n: l.n, x: N[id][0], z: N[id][1] };
});
const mission = { stage: 'idle', t: 8 };
function startPickup() {
  const away = landmarks.filter((l) => Math.hypot(l.x - player.x, l.z - player.z) > 200);
  const from = pick(away.length ? away : landmarks);
  Object.assign(mission, { from, stage: 'pickup', target: from });
  setMarker(from, 0xf2d16b);
  hud.objective.innerHTML = `Pick up a package at <b>${from.n}</b>`;
  toast('New job! Follow the yellow blip on your radar.');
}
function setMarker(t, color) {
  markerMesh.visible = true;
  markerMesh.position.set(t.x, terrainAt(t.x, t.z) + 20, t.z);
  markerMesh.material.color.set(color);
}
function updateMission(dt) {
  if (mission.stage === 'idle') {
    mission.t -= dt;
    if (mission.t <= 0) startPickup();
    return;
  }
  const t = mission.target;
  const d = Math.hypot(t.x - player.x, t.z - player.z);
  if (mission.stage === 'pickup' && d < 5) {
    const far = landmarks.filter((l) => l !== t && Math.hypot(l.x - t.x, l.z - t.z) > 500);
    const to = pick(far.length ? far : landmarks.filter((l) => l !== t));
    const dist = Math.hypot(to.x - t.x, to.z - t.z);
    Object.assign(mission, { reward: Math.round(150 + dist * 0.6), stage: 'deliver', target: to, timer: Math.round(dist / 11 + 25) });
    setMarker(to, 0xff5544);
    hud.objective.innerHTML = `Deliver the package to <b>${to.n}</b> before time runs out`;
    sfx.cash();
  } else if (mission.stage === 'deliver') {
    mission.timer -= dt;
    hud.timer.textContent = `${Math.floor(mission.timer / 60)}:${String(Math.floor(mission.timer % 60)).padStart(2, '0')}`;
    hud.timer.style.color = mission.timer < 10 ? '#ff5544' : '#fff';
    if (d < 5) {
      player.cash += mission.reward;
      showBig('MISSION PASSED', '#f2d16b', 2.5, `$${mission.reward}`);
      sfx.pass();
      endMission();
    } else if (mission.timer <= 0) {
      showBig('MISSION FAILED', '#ff5544', 2.5);
      endMission();
    }
  }
}
function endMission() {
  Object.assign(mission, { stage: 'idle', t: 5 });
  markerMesh.visible = false;
  hud.objective.textContent = '';
  hud.timer.textContent = '';
}

// ============================================================================
// Player
// ============================================================================
// Every start and every respawn (wasted or busted) is at the city's spawn point (in Oslo the
// Jernbanetorget stop, facing the tiger), or else its centre, beside a getaway car at the
// kerb of the nearest street: one fixed place to get your bearings from.
const SPAWN = (() => {
  const { centre, spawn } = data.city, [x, z] = spawn?.p || centre, face = spawn?.face;
  // The getaway car waits at the kerb of the nearest street.
  const id = nearestNode(driveGrid, x, z, 400, (n) => driveAdj.get(n)?.length > 0) ?? nearestNode(driveGrid, x, z, 5000, (n) => driveAdj.get(n)?.length > 0);
  const edge = driveAdj.get(id)[0];
  const [ax, az] = N[id], [bx, bz] = N[edge.to];
  const carH = Math.atan2(bx - ax, bz - az), side = edge.w / 2 + 0.2;
  const carX = ax + Math.sin(carH) * 4 - Math.cos(carH) * side, carZ = az + Math.cos(carH) * 4 + Math.sin(carH) * side;
  return { carH, carX, carZ, h: face ? Math.atan2(face[0] - x, face[1] - z) : carH, x, z };
})();

const player = {
  bustT: 0, cash: 0, dead: false, evadeT: 0, h: 0, hp: 100, model: makePerson({ pants: 0x1f2a44, shirt: 0xf5f5f5, skin: 0xf1c8a5 }),
  phase: 0, shootCd: 0, vehicle: null, vx: 0, vy: 0, vz: 0, wanted: 0, wantedPoints: 0, x: SPAWN.x, y: 0, z: SPAWN.z,
};
const view = { lastMouse: -10, pitch: 0.25, yaw: 0 };

function hurt(amount) {
  if (player.dead) return;
  player.hp -= amount;
  hud.hurt.style.opacity = 1;
  setTimeout(() => (hud.hurt.style.opacity = 0), 150);
  if (player.hp <= 0) die('WASTED', '#c0392b');
}
function die(text, color) {
  player.hp = 0;
  player.dead = true;
  showBig(text, color, 3.5);
  if (player.vehicle) exitVehicle(true);
  player.model.body.rotation.x = -Math.PI / 2;
  player.model.body.position.z = 0.9;
  setTimeout(() => {
    player.cash = Math.max(0, player.cash - (text === 'BUSTED' ? 200 : 100));
    Object.assign(player, { bustT: 0, dead: false, evadeT: 0, groundY: undefined, h: SPAWN.h, hp: 100, wanted: 0, wantedPoints: 0, x: SPAWN.x, y: 0, z: SPAWN.z });
    view.yaw = SPAWN.h;
    player.model.body.rotation.x = 0;
    player.model.body.position.z = 0;
    releaseCops();
    if (mission.stage === 'deliver') endMission();
    if (!vehicles.some((o) => o.kind === 'roadster' && o.mode !== 'wreck')) collideVehicleWithCity(new Vehicle('roadster', SPAWN.carX, SPAWN.carZ, SPAWN.carH, 'parked'));
  }, 3800);
}

const WANTED_LEVELS = [1, 4, 10, 20, 35];
function crime(points) {
  player.wantedPoints += points;
  player.wanted = WANTED_LEVELS.filter((t) => player.wantedPoints >= t).length;
  player.evadeT = 0;
}
function releaseCops() {
  for (const v of vehicles.slice()) {
    if (v.mode !== 'police') continue;
    v.siren = false;
    v.mode = 'ai';
    if (!attachToRoad(v)) v.remove();
  }
}

function enterOrExit() {
  if (player.dead) return;
  if (player.vehicle) {
    if (player.vehicle.air !== null) toast('Land first: press <b>G</b>.', 2);
    else if (player.vehicle.speed < 9) exitVehicle();
    return;
  }
  let best = null, bestD = 4.5;
  for (const v of vehicles) {
    if (v.mode === 'wreck' || v.sink > 1) continue;
    const d = Math.min(...v.circles().map(([cx, cz]) => Math.hypot(cx - player.x, cz - player.z)));
    if (d < bestD) { bestD = d; best = v; }
  }
  if (!best) return;
  if (best.driver) {
    const left = [Math.cos(best.h), -Math.sin(best.h)];
    const ped = spawnPedAt(best.x + left[0] * 2, best.z + left[1] * 2);
    if (ped) ped.scare(player.x, player.z);
    const copsNear = vehicles.some((c) => c.mode === 'police' && Math.hypot(c.x - player.x, c.z - player.z) < 60);
    if (best.kind === 'police') crime(5);
    else if (copsNear) crime(1.5);
  } else if (best.kind === 'police') {
    crime(3);
  }
  if (best.agent) releaseAgent(best);
  best.mode = 'player';
  best.driver = false;
  best.ai = null;
  best.route = null;
  best.siren = false;
  player.vehicle = best;
  player.model.root.visible = false;
  best.mesh.roadster?.setDriver(true);
  toast(best.kind === 'police' ? 'You stole a police car! Bold move.' : best.kind === 'roadster' ? 'Tesla Roadster. <b>Shift</b> fires the thrusters, <b>G</b> flies.' : `You got a ${best.kind}.`, 5);
}
function exitVehicle(force = false) {
  const v = player.vehicle;
  const left = [Math.cos(v.h), -Math.sin(v.h)];
  player.x = v.x + left[0] * (v.k.width / 2 + 1.2);
  player.z = v.z + left[1] * (v.k.width / 2 + 1.2);
  if (!force) collideCircle(player, 0.4);
  player.h = v.h;
  v.mesh.roadster?.setDriver(false);
  // (Only a crash or death gets the player out in the air; the car drops to the ground.)
  Object.assign(v, { air: null, flyPitch: 0, flyRoll: 0, flying: false, thrust: null, vy: 0 });
  v.mode = v.health > 0 ? 'parked' : 'wreck';
  player.vehicle = null;
  player.model.root.visible = true;
}

// People waiting at bus and tram stops near the player (a few at each, more at busy stops and
// hours), who board buses and trams that stop there, while others get off.
const STOP_RANGE = 140, MAX_WAITING = 28;
function manageStopCrowds() {
  const waiting = peds.filter((p) => p.state === 'wait');
  for (const p of waiting) if (Math.hypot(p.x - player.x, p.z - player.z) > STOP_RANGE + 40) p.remove();
  if (waiting.length >= MAX_WAITING) return;
  const busy = HOURLY[Math.floor(hours) % 24];
  for (const st of data.stops) {
    if (Math.abs(st.x - player.x) > STOP_RANGE || Math.abs(st.z - player.z) > STOP_RANGE) continue;
    const want = Math.round(Math.min(6, (1 + Math.min(3, st.r.length / 3)) * busy * 1.6)), here = peds.filter((p) => p.waitStop === st && p.state === 'wait').length;
    if (here >= want || Math.hypot(st.x - player.x, st.z - player.z) < 25) continue;
    const p = spawnPedAt(st.x, st.z);
    if (!p) continue;
    p.dropScooter();
    // A spot on the platform (or around the stop's point), facing across the street.
    let x = st.x, z = st.z;
    for (let tries = 0; tries < 8; tries++) {
      const cx = st.x + rand(-4, 4), cz = st.z + rand(-4, 4);
      if (!st.p || pointInPoly(cx, cz, st.p)) { x = cx; z = cz; break; }
    }
    const [dx, dz] = roadIndex.direction(x, z);
    Object.assign(p, { h: Math.atan2(dx, dz) + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2, state: 'wait', waitStop: st, x, z });
    return;
  }
}
// A vehicle has stopped with its door at (dx, dz): those waiting within 30 m walk to it and
// board; 0–2 riders get off there.
function serveStop(px, pz, door) {
  for (const p of peds) if (p.state === 'wait' && p.waitStop && Math.hypot(p.waitStop.x - px, p.waitStop.z - pz) < 30) Object.assign(p, { boardTarget: door, state: 'board' });
  if (Math.hypot(px - player.x, pz - player.z) > STOP_RANGE) return;
  for (let k = Math.floor(rand(0, 3)); k > 0; k--) {
    const p = spawnPedAt(door[0] + rand(-0.6, 0.6), door[1] + rand(-0.6, 0.6));
    p?.dropScooter();
  }
}
function spawnPedAt(x, z) {
  const id = nearestNode(walkGrid, x, z, 60);
  if (id === null || !walkAdj.get(id)?.length) return null;
  const p = new Ped(id, false);
  p.x = x;
  p.z = z;
  peds.push(p);
  return p;
}

const raycaster = new THREE.Raycaster();
function shoot() {
  if (player.vehicle || player.dead || player.shootCd > 0) return;
  player.shootCd = 0.22;
  player.h = view.yaw;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.far = 160;
  const targets = [...cityMeshes];
  for (const p of peds) if (p.state !== 'dead' && Math.abs(p.x - player.x) < 160 && Math.abs(p.z - player.z) < 160) targets.push(p.model.root);
  for (const v of vehicles) if (v.mode !== 'player' && Math.abs(v.x - player.x) < 160 && Math.abs(v.z - player.z) < 160) targets.push(v.mesh.root);
  const hits = raycaster.intersectObjects(targets, true).filter((h) => h.distance > 3);
  const muzzle = new THREE.Vector3(player.x + Math.sin(player.h) * 0.6 - Math.cos(player.h) * 0.3, (player.groundY ?? groundHeight(player.x, player.z)) + 1.45, player.z + Math.cos(player.h) * 0.6 + Math.sin(player.h) * 0.3);
  const end = hits[0] ? hits[0].point : raycaster.ray.at(160, new THREE.Vector3());
  tracer(muzzle, end);
  spawnPuff(muzzle.x, muzzle.y, muzzle.z, 0xffd27a, 0.15, 0.08, 0, 0);
  sfx.gun();
  shake = Math.max(shake, 0.08);
  const owner = hits[0]?.object.userData.owner;
  if (owner instanceof Ped) {
    const dir = raycaster.ray.direction;
    owner.kill(dir.x * 4, dir.z * 4, 2);
    crime(2);
  } else if (owner instanceof Vehicle) {
    owner.lastHitByPlayer = true;
    owner.damage(9);
    spawnPuff(end.x, end.y, end.z, 0xffffaa, 0.15, 0.15, 1, 1);
    if (owner.kind === 'police') crime(1.5);
  } else if (hits[0]) {
    spawnPuff(end.x, end.y, end.z, 0xbbbbbb, 0.2, 0.4, 0.5, 0.3);
  }
  let witnessed = false;
  for (const p of peds) {
    if (Math.hypot(p.x - player.x, p.z - player.z) < 45) { p.scare(player.x, player.z); witnessed = true; }
  }
  if (witnessed) crime(0.35);
}

// ============================================================================
// Input
// ============================================================================
const keys = {};
let started = false;
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (!started) return;
  if (e.code === 'KeyF' || e.code === 'Enter') enterOrExit();
  if (e.code === 'KeyG') toggleFlight();
  if (e.code === 'KeyH' && player.vehicle) {
    sfx.horn();
    for (const p of peds) if (Math.hypot(p.x - player.x, p.z - player.z) < 15) p.scare(player.x, player.z);
  }
  if (e.code === 'KeyM') { sound.muted = !sound.muted; if (sound.master) sound.master.gain.value = sound.muted ? 0 : 0.6; }
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
let mouseDown = false;
addEventListener('mousedown', (e) => {
  if (!started) return;
  if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
  if (e.button === 0) { mouseDown = true; shoot(); }
});
addEventListener('mouseup', () => { mouseDown = false; });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  view.yaw -= e.movementX * 0.0025;
  view.pitch = clamp(view.pitch + e.movementY * 0.002, -0.35, 1.2);
  view.lastMouse = performance.now() / 1000;
});
$('start').addEventListener('click', () => {
  $('start').style.display = 'none';
  started = true;
  initAudio();
  canvas.requestPointerLock();
  setTimeout(() => toast('Welcome to Oslo. Press <b>F</b> near a car to steal it. Jobs appear as a yellow blip.', 7), 600);
});
$('loading').textContent = 'Ready.';

// ============================================================================
// HUD
// ============================================================================
const hud = {
  big: $('big'), cash: $('cash'), clock: $('clock'), crosshair: $('crosshair'), health: $('health-fill'), hurt: $('hurt'), minimap: $('minimap').getContext('2d'),
  objective: $('objective'), speed: $('speed'), stars: $('stars'), street: $('street'), timer: $('timer'), toast: $('toast'),
};
let bigTimer = null, toastTimer = null, shake = 0;
function showBig(text, color, seconds, sub = '') {
  hud.big.innerHTML = `${text}${sub ? `<div style="font-size:42px;text-align:center;color:#7ed957">${sub}</div>` : ''}`;
  hud.big.style.color = color;
  hud.big.style.opacity = 1;
  clearTimeout(bigTimer);
  bigTimer = setTimeout(() => (hud.big.style.opacity = 0), seconds * 1000);
}
function toast(html, seconds = 4) {
  hud.toast.innerHTML = html;
  hud.toast.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (hud.toast.style.opacity = 0), seconds * 1000);
}
let lastStreet = null, streetTimer = null, streetCheck = 0;
function updateHud(dt) {
  hud.cash.textContent = '$' + String(Math.floor(player.cash)).padStart(8, '0');
  const seen = player.evadeT === 0;
  hud.stars.innerHTML = [1, 2, 3, 4, 5].map((i) => `<span class="${i <= player.wanted ? 'on' : 'off'}">★</span>`).join('');
  hud.stars.classList.toggle('flash', player.wanted > 0 && !seen);
  hud.health.style.width = clamp(player.hp, 0, 100) + '%';
  hud.health.style.background = player.hp < 30 ? '#d64541' : '#5cbf3f';
  hud.crosshair.style.display = player.vehicle || player.dead ? 'none' : 'block';
  if (player.vehicle) hud.speed.innerHTML = `${Math.round(player.vehicle.speed * 3.6)}<small> km/h</small>${player.vehicle.air !== null ? `<small> · ${Math.round(player.vehicle.altitude)} m</small>` : ''}`;
  else hud.speed.textContent = '';
  streetCheck -= dt;
  if (streetCheck <= 0) {
    streetCheck = 0.4;
    const name = streetAt(player.x, player.z);
    if (name && name !== lastStreet) {
      lastStreet = name;
      hud.street.innerHTML = `${name}<small>${data.city.name}</small>`;
      hud.street.style.opacity = 1;
      clearTimeout(streetTimer);
      streetTimer = setTimeout(() => (hud.street.style.opacity = 0), 4000);
    }
  }
  drawMinimap();
}

function drawMinimap() {
  const g = hud.minimap, size = 230, c = size / 2;
  const speed = player.vehicle ? player.vehicle.speed : 0;
  const zoom = 0.9 - Math.min(0.4, speed / 80);
  const theta = view.yaw - Math.PI;
  g.save();
  g.fillStyle = '#6c7568';
  g.fillRect(0, 0, size, size);
  g.translate(c, c);
  g.rotate(theta);
  g.scale(zoom / MAP_SCALE, zoom / MAP_SCALE);
  g.drawImage(mapCanvas, -(player.x - WORLD.minX) * MAP_SCALE, -(player.z - WORLD.minZ) * MAP_SCALE);
  g.restore();

  const toScreen = (x, z) => {
    const dx = (x - player.x) * zoom, dz = (z - player.z) * zoom;
    const cs = Math.cos(theta), sn = Math.sin(theta);
    return [c + dx * cs - dz * sn, c + dx * sn + dz * cs];
  };
  const blip = (x, z, color, r, clampEdge = false) => {
    let [sx, sy] = toScreen(x, z);
    const dx = sx - c, dy = sy - c, d = Math.hypot(dx, dy);
    if (d > c - 10) {
      if (!clampEdge) return;
      sx = c + (dx / d) * (c - 10);
      sy = c + (dy / d) * (c - 10);
    }
    g.fillStyle = color;
    g.strokeStyle = '#000';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(sx, sy, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  };
  for (const v of vehicles) {
    if (v.mode === 'police') blip(v.x, v.z, Math.floor(performance.now() / 250) % 2 ? '#3355ff' : '#ff2233', 4.5, player.wanted > 0);
  }
  for (const p of pickups) blip(p.x, p.z, '#7ed957', 3);
  if (mission.stage !== 'idle') blip(mission.target.x, mission.target.z, mission.stage === 'pickup' ? '#f2d16b' : '#ff5544', 6, true);
  const ph = player.vehicle ? player.vehicle.h : player.h;
  g.save();
  g.translate(c, c);
  g.rotate(-ph + theta + Math.PI);
  g.fillStyle = '#fff';
  g.strokeStyle = '#000';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, -9);
  g.lineTo(6, 7);
  g.lineTo(0, 3);
  g.lineTo(-6, 7);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
  g.fillStyle = '#fff';
  g.font = 'bold 13px Arial';
  g.textAlign = 'center';
  const [nx, ny] = toScreen(player.x, player.z - 1000);
  const nd = Math.hypot(nx - c, ny - c);
  g.fillText('N', c + ((nx - c) / nd) * (c - 14), c + ((ny - c) / nd) * (c - 14) + 4);
}

// ============================================================================
// Spawning
// ============================================================================
const TRAFFIC_KINDS = ['sedan', 'sedan', 'sports', 'suv', 'taxi', 'van', 'wagon'];
function spawnTraffic() {
  const id = nodeInRing(driveGrid, player.x, player.z, 90, 230, (n) => driveAdj.has(n));
  if (id === null) return;
  const [x, z] = N[id];
  if (vehicles.some((v) => Math.abs(v.x - x) < 12 && Math.abs(v.z - z) < 12)) return;
  const edge = pick(driveAdj.get(id));
  const [bx, bz] = N[edge.to];
  const v = new Vehicle(pick(TRAFFIC_KINDS), x, z, Math.atan2(bx - x, bz - z), 'ai');
  v.ai = { cruise: edge.w >= 11 ? rand(12, 15) : rand(8, 11), edge, from: id, next: pickNext(id, edge.to), speed: 8, t: 0 };
}
function spawnBus() {
  if (!busRoutes.length) return;
  const r = pick(busRoutes);
  for (let i = 0; i < 8; i++) {
    const s = rand(0, r.len - 80);
    const [px, pz] = routePoint(r, s), d = Math.hypot(px - player.x, pz - player.z);
    if (d < 130 || d > 380) continue;
    const [tx, tz] = routeTangent(r, s);
    const x = px - tz * BUS_LANE, z = pz + tx * BUS_LANE;
    if (vehicles.some((v) => Math.abs(v.x - x) < 20 && Math.abs(v.z - z) < 20)) continue;
    const v = new Vehicle('bus', x, z, Math.atan2(tx, tz), 'ai');
    const stopIdx = r.stops.findIndex((stop) => stop.s > s);
    v.route = { dwell: 0, r, s, speed: 8, stopIdx: stopIdx < 0 ? r.stops.length : stopIdx };
    addDestinationSigns(v, r.ref, r.to);
    addPassengers(v);
    return;
  }
}
function signTexture(line, destination) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 80;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0b0b';
  g.fillRect(0, 0, 512, 80);
  g.fillStyle = '#ffb000';
  g.textBaseline = 'middle';
  g.font = 'bold 58px Arial';
  g.fillText(line, 14, 42);
  g.font = 'bold 44px Arial';
  g.fillText(destination, 150, 43, 350);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function addDestinationSigns(v, line, destination) {
  const material = new THREE.MeshBasicMaterial({ map: signTexture(line, destination) });
  const { height, len, width } = v.k;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.3), material);
  front.position.set(0, height - 0.45, len / 2 + 0.06);
  const side = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.24), material);
  side.position.set(-width / 2 - 0.03, height - 0.75, len * 0.3);
  side.rotation.y = -Math.PI / 2;
  // On the chassis, so they ride with the body on its suspension.
  v.mesh.chassis.add(front, side);
}

// Riders seated in the bus (2 + 2 rows; the doorways on the right are left clear) and the
// driver on the left at the front: a torso, head and hair each, merged into one mesh in
// varied clothes, skin and hair. They show through the bus's lighter glass.
const PASSENGER_MATERIAL = new THREE.MeshLambertMaterial({ vertexColors: true });
const CLOTHES = ['#2b2f36', '#3d4a5c', '#6b2e2e', '#2f4a3a', '#8a8d91', '#c9b28a', '#1d1f22', '#5a3d5c', '#b7442f', '#d8d4cc'];
const SKINS = ['#f1c9a5', '#e0b08a', '#c68d63', '#8d5a3b', '#5c3a26'];
const HAIRS = ['#2a1d14', '#4a3222', '#8a6a3a', '#c9a76a', '#1b1b1b', '#9a9a9a'];
function addPassengers(v) {
  const seats = [[0.62, 4.6]];
  for (let z = -5.0; z <= 3.4; z += 0.85) {
    for (const x of [0.92, 0.47, -0.47, -0.92]) {
      if (x < 0 && Math.abs(z - 0.6) < 0.9) continue;
      if (Math.random() < 0.55) seats.push([x, z]);
    }
  }
  const parts = [];
  const coloured = (g, hex) => {
    const c = new THREE.Color(hex), n = g.attributes.position.count, colors = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) colors.set([c.r, c.g, c.b], k * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  };
  for (const [x, z] of seats) {
    const lean = (Math.random() - 0.5) * 0.12, y = 0.85;
    parts.push(coloured(new THREE.BoxGeometry(0.42, 0.62, 0.26).rotateX(-0.12).translate(x, y + 0.31, z - 0.05), pick(CLOTHES)));
    parts.push(coloured(new THREE.SphereGeometry(0.105, 10, 8).translate(x + lean, y + 0.76, z), pick(SKINS)));
    parts.push(coloured(new THREE.SphereGeometry(0.112, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(x + lean, y + 0.775, z - 0.01), pick(HAIRS)));
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), PASSENGER_MATERIAL);
  v.mesh.chassis.add(mesh);
}

function spawnCop() {
  const id = nodeInRing(driveGrid, player.x, player.z, 130, 240);
  if (id === null) return;
  const [x, z] = N[id];
  const v = new Vehicle('police', x, z, Math.atan2(player.x - x, player.z - z), 'police');
  v.ai = { path: [], repath: 0, reverseT: 0, shootT: 2, stuckT: 0 };
}

// Parked cars along residential streets, plus a getaway car at spawn.
{
  const parkable = data.edges.filter(([a, b, oneway, w]) => N[a] && N[b] && w <= 8 && Math.hypot(N[b][0] - N[a][0], N[b][1] - N[a][1]) > 12);
  for (let i = 0; i < 70; i++) {
    const [a, b, , w] = pick(parkable);
    const [ax, az] = N[a], [bx, bz] = N[b];
    const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
    const t = rand(4, len - 4), side = w / 2 + 0.2;
    const x = ax + dx * t - dz * side, z = az + dz * t + dx * side;
    if (buildingAt(x, z) || vehicles.some((v) => Math.hypot(v.x - x, v.z - z) < 6)) continue;
    new Vehicle(pick(['sedan', 'sedan', 'sports', 'suv', 'taxi', 'van', 'wagon']), x, z, Math.atan2(dx, dz), 'parked');
  }
  const getaway = new Vehicle('roadster', SPAWN.carX, SPAWN.carZ, SPAWN.carH, 'parked');
  collideVehicleWithCity(getaway);
}

function manageSpawns() {
  const far = (o, r) => Math.abs(o.x - player.x) > r || Math.abs(o.z - player.z) > r;
  const traffic = vehicles.filter((v) => v.mode === 'ai');
  for (const v of traffic) if (far(v, 300)) v.remove();
  // (Wrecks go only once out of sight.)
  for (const v of vehicles.slice()) if ((v.mode === 'wreck' && far(v, 200) && !inView(v.x, (v.air ?? v.groundY ?? 0) + 1, v.z)) || (v.mode === 'police' && far(v, 420))) v.remove();
  if (traffic.length < 32) spawnTraffic();
  if (vehicles.filter((v) => v.route).length < 6) spawnBus();
  for (const p of peds.slice()) if (far(p, PED_RADIUS + 40)) p.remove();
  // Keep the real head count for this place and hour, spawning out of the player's way.
  const around = footfallAround(player.x, player.z);
  const target = Math.min(MAX_PEDS, Math.round(around.total * HOURLY[Math.floor(hours) % 24]));
  for (let tries = 0; tries < 3 && peds.length < target; tries++) {
    let r = Math.random() * around.total, id = null;
    for (const [n, share] of around.list) { r -= share; if (r <= 0) { id = n; break; } }
    if (id === null || Math.hypot(N[id][0] - player.x, N[id][1] - player.z) < 30) continue;
    if (walkAdj.get(id).length) peds.push(new Ped(id));
  }
  const cops = vehicles.filter((v) => v.mode === 'police').length;
  if (cops < [0, 2, 3, 4, 6, 8][player.wanted]) spawnCop();
}

// ============================================================================
// Main loop
// ============================================================================
function updatePlayerOnFoot(dt) {
  const m = player.model;
  if (player.dead) { m.root.position.set(player.x, 0.15 + groundHeight(player.x, player.z), player.z); return; }
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz += 1;
  if (keys.KeyS || keys.ArrowDown) iz -= 1;
  if (keys.KeyA || keys.ArrowLeft) ix += 1;
  if (keys.KeyD || keys.ArrowRight) ix -= 1;
  const swimming = isWater(player.x, player.z) && !onBridge(player.x, player.z, player.groundY);
  const speed = swimming ? 2.2 : keys.ShiftLeft || keys.ShiftRight ? 8 : 4;
  const fx = Math.sin(view.yaw), fz = Math.cos(view.yaw);
  let mx = fx * iz + fz * ix, mz = fz * iz - fx * ix;
  const ml = Math.hypot(mx, mz);
  if (ml > 0) {
    mx /= ml; mz /= ml;
    player.vx = mx * speed;
    player.vz = mz * speed;
    if (!mouseDown) player.h += angleDiff(player.h, Math.atan2(mx, mz)) * Math.min(1, dt * 12);
  } else {
    player.vx = player.vz = 0;
  }
  if (mouseDown) { player.h = view.yaw; shoot(); }
  player.x += player.vx * dt;
  player.z += player.vz * dt;
  if (keys.Space && player.y === 0 && !swimming) player.vy = 5.5;
  player.vy -= 16 * dt;
  player.y = Math.max(0, player.y + player.vy * dt);
  if (player.y === 0) player.vy = 0;
  collideCircle(player, 0.4);
  for (const v of vehicles) {
    if (Math.abs(v.x - player.x) > 6 || Math.abs(v.z - player.z) > 6) continue;
    for (const [cx, cz] of v.circles()) {
      const dx = player.x - cx, dz = player.z - cz, d = Math.hypot(dx, dz), r = v.k.width * 0.55 + 0.4;
      if (d >= r || d < 1e-4) continue;
      const rel = -(v.vx * dx + v.vz * dz) / d;
      if (v.speed > 7 && rel > 4) {
        hurt(v.speed * 1.6);
        player.vy = 4;
        player.vx = v.vx; player.vz = v.vz;
      }
      player.x = cx + (dx / d) * r;
      player.z = cz + (dz / d) * r;
    }
  }
  player.x = clamp(player.x, WORLD.minX, WORLD.maxX);
  player.z = clamp(player.z, WORLD.minZ, WORLD.maxZ);
  player.phase += dt * (ml > 0 ? speed * 2.4 : 0);
  animatePerson(m, player.phase, ml > 0 ? (speed > 5 ? 1 : 0.6) : 0, mouseDown);
  player.groundY = surfaceHeight(player.x, player.z, player.groundY);
  m.root.position.set(player.x, swimming ? -0.9 : player.y + player.groundY, player.z);
  m.root.rotation.y = player.h;
}

function updatePlayerVehicle(dt) {
  const v = player.vehicle;
  const input = {
    boost: !!(keys.ShiftLeft || keys.ShiftRight),
    down: !!(keys.KeyC || keys.KeyQ),
    hb: !!keys.Space,
    s: (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0),
    t: (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0),
    up: !!(keys.Space || keys.KeyE),
  };
  if (v.air !== null) flightStep(v, input, dt);
  else physicsStep(v, input, dt);
  if (v.kind === 'roadster') updateRoadster(v, input, dt);
  else if (sound.thrustGain) sound.thrustGain.gain.value = 0;
  player.x = v.x;
  player.z = v.z;
  player.h = v.h;
  if (v.sink > 1.6) {
    toast('Your car sank in the Oslofjord!');
    exitVehicle(true);
    return;
  }
  // Run over pedestrians.
  if (v.speed > 4 && v.altitude < 1) {
    for (const p of peds) {
      if (p.state === 'dead' || p.state === 'fly') continue;
      for (const [cx, cz] of v.circles()) {
        if (Math.hypot(p.x - cx, p.z - cz) < v.k.width * 0.55 + 0.4) {
          p.kill(v.vx * 0.9, v.vz * 0.9, 3 + v.speed * 0.15);
          crime(v.speed > 10 ? 2 : 1);
          shake = 0.2;
          sfx.crash(0.25);
          break;
        }
      }
    }
  }
  if (v.speed > 6) {
    for (const p of peds) {
      if (p.state !== 'walk') continue;
      const dx = p.x - v.x, dz = p.z - v.z;
      if (dx * dx + dz * dz < 100 && dx * v.vx + dz * v.vz > 0) p.scare(v.x, v.z);
    }
  }
  if (sound.engineGain && !sound.muted) {
    sound.engine.frequency.value = 45 + Math.abs(v.forwardSpeed) * 4 + (input.t ? 25 : 0);
    sound.engineGain.gain.value = 0.05;
  }
}

// The Roadster's thrusters: levels for the model (rear jets for boost and forward thrust, the
// down jets to hover, side jets to turn), vapour puffs from every firing nozzle plus downwash
// off the ground when low, and the hiss.
const vapor = createVapor();
scene.add(vapor.points);
const nozzlePosition = new THREE.Vector3(), nozzleDirection = new THREE.Vector3(), nozzleTurn = new THREE.Quaternion();
function updateRoadster(v, input, dt) {
  const airborne = v.air !== null, resting = airborne && !v.flying && v.vy === 0, active = airborne && !resting;
  const boost = input.boost && input.t >= 0 && (!airborne || active) ? 1 : 0;
  const forward = v.forwardSpeed;
  const thrust = {
    boost: Math.max(boost, active ? Math.max(0, input.t) * 0.45 : 0),
    fan: airborne ? 1 : Math.min(1, v.speed / 30),
    lift: !active ? 0 : v.flying ? 0.45 + 0.55 * Math.max(0, v.vy / 10) : 0.7,
    side: active ? -input.s * 0.8 : 0,
    // Raised for downforce at speed or in flight, tilted steep as an air brake.
    wing: input.t < 0 && forward > 12 ? 2 : forward > 20 || active ? 1 : 0,
  };
  v.thrust = thrust;
  v.vaporT = (v.vaporT || 0) - dt;
  if (v.vaporT <= 0) {
    v.vaporT = 1 / 40;
    emitThrusterVapor(v, thrust, active);
  }
  if (sound.thrustGain) sound.thrustGain.gain.value = sound.muted ? 0 : 0.06 * Math.max(thrust.boost, thrust.lift * 0.6, Math.abs(thrust.side) * 0.4);
}
// Puffs from each firing nozzle, and with `downwash` a ring blown off the ground when low.
function emitThrusterVapor(v, thrust, downwash) {
  v.mesh.root.updateMatrixWorld(true);
  for (const n of v.mesh.roadster.nozzles) {
    const level = n.kind === 'rear' ? thrust.boost : n.kind === 'down' ? thrust.lift : Math.max(0, n.side * thrust.side);
    if (level < 0.15 || Math.random() > level) continue;
    n.group.getWorldPosition(nozzlePosition);
    nozzleDirection.set(0, 1, 0).applyQuaternion(n.group.getWorldQuaternion(nozzleTurn));
    const reach = n.length * 0.7, speed = 5 + 9 * level;
    vapor.emit(
      nozzlePosition.x + nozzleDirection.x * reach, nozzlePosition.y + nozzleDirection.y * reach, nozzlePosition.z + nozzleDirection.z * reach,
      v.vx * 0.4 + nozzleDirection.x * speed + rand(-0.8, 0.8), nozzleDirection.y * speed + rand(-0.4, 0.4), v.vz * 0.4 + nozzleDirection.z * speed + rand(-0.8, 0.8),
      0.5, n.kind === 'rear' ? 3.4 : 2.4, rand(0.9, 1.6));
  }
  if (downwash && thrust.lift > 0.3 && v.altitude < 8) {
    const strength = 1 - v.altitude / 8;
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(5, 10) * strength;
      vapor.emit(v.x + Math.cos(a) * 1.4, (v.groundY ?? 0) + 0.3, v.z + Math.sin(a) * 1.4, Math.cos(a) * sp, 0.5, Math.sin(a) * sp, 0.8, 4, rand(1.2, 2.2));
    }
  }
}

// Sky traffic: hundreds of other Roadsters take off from a kerb, fly the street network at
// their own height and speed (swaying, climbing over roofs, now and then a loop, barrel roll,
// kickflip or flat spin), then land at a kerb again, wait, and take off. There are more over
// the centre. Cars only appear and go out of sight (outside the view, or past the fog),
// parked: in view they always take off or land. A guide point runs ahead along the streets
// and the car chases it, so corners become sweeping curves.
// Each is a light agent (the fields below, like a Vehicle's); past 160 m it is drawn in one
// instanced crowd, and within 140 m it borrows a full Roadster Vehicle from a pool, which
// copies its pose, fires its thrusters and can be shot down or stolen.
const [skyX, skyZ] = data.city.centre; // in Oslo, the cathedral
const skyDensity = (x, z) => 1 - 0.6 * THREE.MathUtils.smoothstep(Math.hypot(x - skyX, z - skyZ), 500, 1500);
const SKY_COLOURS = [0xe8eae9, 0xe8eae9, 0xe8eae9, 0xe8eae9, 0x1b1d20, 0x9ea3a7, 0xa3121b];
const STUNTS = { flip: 1, loop: 2.8, roll: 1.5, spin: 1.3 };
const SKY_NEAR = 140, SKY_FAR = 160, SKY_MAX_NEAR = 70;
const skyAgents = [], skyPool = [], skyPaints = new Map();
const skyCrowd = createRoadsterCrowd(1500);
scene.add(...skyCrowd.meshes);
const viewFrustum = new THREE.Frustum(), viewMatrix = new THREE.Matrix4(), viewSphere = new THREE.Sphere();
let viewFrame = -1;
// Whether a point could be on screen (within `margin` metres of the view), nearer than the fog's end.
function inView(x, y, z, margin = 6) {
  if (Math.hypot(x - camera.position.x, z - camera.position.z) > 1350) return false;
  if (viewFrame !== renderer.info.render.frame) {
    viewFrame = renderer.info.render.frame;
    viewFrustum.setFromProjectionMatrix(viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  }
  viewSphere.center.set(x, y, z);
  viewSphere.radius = margin;
  return viewFrustum.intersectsSphere(viewSphere);
}
// A kerbside spot `ahead` metres along the streets from a point on an edge, and that edge.
function kerbAhead(from, to, at, ahead) {
  for (;;) {
    const [ax, az] = N[from], [bx, bz] = N[to], len = Math.hypot(bx - ax, bz - az) || 1;
    if (at + ahead <= len) {
      const t = (at + ahead) / len, h = Math.atan2(bx - ax, bz - az), side = (driveAdj.get(from)?.find((e) => e.to === to)?.w ?? 7) / 2 - 1.2;
      return { at: at + ahead, from, h, to, x: ax + (bx - ax) * t - Math.cos(h) * side, z: az + (bz - az) * t + Math.sin(h) * side };
    }
    ahead -= len - at;
    at = 0;
    const next = pickNext(from, to);
    [from, to] = next ? [to, next.to] : [to, from];
  }
}
const near6 = (x, z, k) => Math.abs(x - k.x) < 6 && Math.abs(z - k.z) < 6;
const kerbClear = (k) => !buildingAt(k.x, k.z) && !isWater(k.x, k.z) && !vehicles.some((o) => near6(o.x, o.z, k)) && !skyAgents.some((a) => (a.sky.land ? near6(a.sky.land.x, a.sky.land.z, k) : a.sky.state === 'ground' && near6(a.x, a.z, k)));
function newFlight(s) {
  Object.assign(s, { alt: rand(12, 110), cruiseT: rand(40, 120), phase: rand(0, 20), speed: rand(14, 45), stunt: null, stuntT: rand(4, 12), swing: rand(4, 18) });
}
function spawnSkyCar() {
  for (let tries = 0; tries < 8; tries++) {
    const id = nodeInRing(driveGrid, player.x, player.z, 150, 800, (n) => driveAdj.get(n)?.length > 0);
    if (id === null) continue;
    const k = kerbAhead(id, pick(driveAdj.get(id)).to, 0, rand(5, 20));
    // (Well clear of the view, so turning the camera a little doesn't show it appearing.)
    const margin = Math.max(40, Math.hypot(k.x - camera.position.x, k.z - camera.position.z) * 0.25);
    if (Math.random() > skyDensity(k.x, k.z) || !kerbClear(k) || inView(k.x, groundHeight(k.x, k.z) + 1, k.z, margin)) continue;
    const sky = { at: k.at, clear: 0, clearT: 0, from: k.from, gx: k.x, gz: k.z, leaving: false, now: 0, state: 'ground', to: k.to, vaporT: 0, wait: rand(0.5, 10) };
    newFlight(sky);
    skyAgents.push({ air: null, car: null, colour: pick(SKY_COLOURS), flyPitch: 0, flyRoll: 0, flying: false, groundY: groundHeight(k.x, k.z), h: k.h, pose: null, sky, thrust: null, vx: 0, vy: 0, vz: 0, x: k.x, yawRate: 0, z: k.z });
    return;
  }
}
// Lends an agent a full Roadster from the pool (or a new one), and takes it back.
function attachCar(a) {
  let v = skyPool.pop();
  if (v) {
    Object.assign(v, { groundY: undefined, health: 100, lastHitByPlayer: false, landed: false, mode: 'sky', sink: 0, susp: null });
    vehicles.push(v);
  } else {
    v = new Vehicle('roadster', a.x, a.z, a.h, 'sky');
    v.mesh.roadster.setDriver(true);
  }
  if (!skyPaints.has(a.colour)) skyPaints.set(a.colour, roadsterPaint(a.colour));
  v.mesh.setPaint(skyPaints.get(a.colour));
  v.agent = a;
  a.car = v;
  followAgent(v);
}
function detachCar(a) {
  const v = a.car;
  a.car = null;
  v.agent = null;
  v.remove();
  skyPool.push(v);
}
// An agent's car that is shot down or stolen leaves sky traffic for good.
function releaseAgent(v) {
  skyAgents.splice(skyAgents.indexOf(v.agent), 1);
  v.agent.car = null;
  v.agent = null;
}
function followAgent(v) {
  const a = v.agent;
  Object.assign(v, { air: a.air, flyPitch: a.flyPitch, flyRoll: a.flyRoll, flying: a.flying, h: a.h, pose: a.pose, thrust: a.thrust, vx: a.vx, vy: a.vy, vz: a.vz, x: a.x, yawRate: a.yawRate, z: a.z });
}
// Keeps the count to the local density: extra or far cars are sent to land, and parked ones
// out of sight for 1.5 s are removed (anything past the fog goes at once).
function manageSky() {
  const sky = skyAgents.slice().sort((a, b) => Math.hypot(b.x - player.x, b.z - player.z) - Math.hypot(a.x - player.x, a.z - player.z));
  const target = Math.round(108 + 360 * skyDensity(player.x, player.z));
  let excess = sky.filter((a) => !a.sky.leaving).length - target;
  for (const a of sky) {
    const s = a.sky, d = Math.hypot(a.x - player.x, a.z - player.z);
    if (!s.leaving && (d > 700 || excess > 0)) { s.leaving = true; excess--; }
    s.hiddenT = inView(a.x, (a.air ?? a.groundY) + 1, a.z, 20) ? 0 : (s.hiddenT || 0) + 0.15;
    if (Math.hypot(a.x - camera.position.x, a.z - camera.position.z) > 1400 || (s.leaving && s.state === 'ground' && s.hiddenT > 1.5)) {
      if (a.car) detachCar(a);
      skyAgents.splice(skyAgents.indexOf(a), 1);
    }
  }
  for (let i = 0; i < 40 && skyAgents.length < target; i++) spawnSkyCar();
}
// Moves every agent, lends or takes back full cars by distance, and draws the rest as the crowd.
function updateSky(dt) {
  let near = 0;
  for (const a of skyAgents) if (a.car) near++;
  skyCrowd.begin();
  for (const a of skyAgents) {
    skyStep(a, dt);
    const d = Math.hypot(a.x - camera.position.x, a.z - camera.position.z);
    if (!a.car && d < SKY_NEAR && near < SKY_MAX_NEAR) { attachCar(a); near++; }
    else if (a.car && d > SKY_FAR) { detachCar(a); near--; }
    if (a.car || d > 1400) continue;
    // Placed as Vehicle.sync places a car's root (stunt offsets along its heading).
    const p = a.pose, fx = Math.sin(a.h), fz = Math.cos(a.h), wing = a.sky.state === 'ground' ? 0 : a.thrust?.wing ?? 1;
    skyCrowd.add(
      a.x + (p ? fx * p.forward + fz * p.side : 0), (a.air ?? a.groundY) + (p ? p.up : 0), a.z + (p ? fz * p.forward - fx * p.side : 0),
      a.h + (p ? p.yaw : 0), a.flyPitch + (p ? p.pitch : 0), a.flyRoll + (p ? p.roll : 0), wing, a.colour);
  }
  skyCrowd.end();
}
function skyStep(v, dt) {
  const s = v.sky, fade = 1 - Math.exp(-3 * dt);
  if (s.state === 'ground') {
    s.wait -= dt;
    if (s.wait <= 0 && !s.leaving) {
      newFlight(s);
      Object.assign(v, { air: v.groundY, flying: true, vy: 0 });
      s.state = 'takeoff';
    }
    return;
  }
  const altitude = v.air - v.groundY;
  // Where to steer: the guide, or the landing spot.
  if (s.state === 'landing') {
    s.gx = s.land.x;
    s.gz = s.land.z;
  } else {
    // The guide waits when it gets 50 m ahead and hurries when the car catches up.
    let [ax, az] = N[s.from], [bx, bz] = N[s.to], len = Math.hypot(bx - ax, bz - az) || 1;
    s.at += Math.max(s.now, 6) * clamp(1.6 - Math.hypot(s.gx - v.x, s.gz - v.z) / 30, 0, 1.6) * dt;
    while (s.at > len) {
      s.at -= len;
      const next = pickNext(s.from, s.to);
      [s.from, s.to] = next ? [s.to, next.to] : [s.to, s.from];
      [ax, az] = N[s.from];
      [bx, bz] = N[s.to];
      len = Math.hypot(bx - ax, bz - az) || 1;
    }
    s.gx = ax + ((bx - ax) * s.at) / len;
    s.gz = az + ((bz - az) * s.at) / len;
  }
  const toGuide = Math.hypot(s.gx - v.x, s.gz - v.z);
  // Speed: none until the car is clear of the street, its own on the way, easing off to
  // stop over the landing spot.
  const want = s.state === 'takeoff' ? (altitude > 6 ? s.speed : 0) : s.state === 'landing' ? Math.min(s.speed, toGuide * 0.4) : s.speed;
  s.now += clamp(want - s.now, -8 * dt, 6 * dt);
  if (s.state === 'landing' && toGuide < 8) {
    // Over the spot: drift straight onto it, turning to face along the street.
    v.h += angleDiff(v.h, s.land.h) * fade;
    v.yawRate = 0;
    v.vx = (s.gx - v.x) * (s.now / Math.max(toGuide, 0.01));
    v.vz = (s.gz - v.z) * (s.now / Math.max(toGuide, 0.01));
  } else {
    const turn = clamp(angleDiff(v.h, Math.atan2(s.gx - v.x, s.gz - v.z)) * 2, -1.4, 1.4) * Math.min(1, s.now / 4);
    v.yawRate += (turn - v.yawRate) * (1 - Math.exp(-4 * dt));
    v.h += v.yawRate * dt;
    v.vx = Math.sin(v.h) * s.now;
    v.vz = Math.cos(v.h) * s.now;
  }
  v.x += v.vx * dt;
  v.z += v.vz * dt;
  // Height: its own cruising level, swaying, 6 m clear of the roofs here and just ahead; on
  // approach, a glide down to the spot, the last metres slow.
  s.phase += dt;
  const ground = groundHeight(v.x, v.z), roof = (t) => buildingAt(v.x + v.vx * t, v.z + v.vz * t)?.h ?? -Infinity;
  v.groundY = ground;
  // (The roofs are looked up five times a second: hundreds of cars share the frame.)
  s.clearT -= dt;
  if (s.clearT <= 0) { s.clearT = 0.2; s.clear = Math.max(ground, roof(0), roof(1), roof(2.5)) + 6; }
  const clear = Math.max(s.clear, ground + 6);
  let aim = Math.max(clear, ground + s.alt + Math.sin(s.phase * 0.4) * s.swing), climbMax = 18, sinkMax = 12;
  if (s.state === 'takeoff' && altitude < 8) climbMax = 4;
  if (s.state === 'landing') {
    aim = toGuide < 30 ? ground + Math.max(0, (toGuide - 3) * 0.5) : Math.max(clear, ground + Math.min(s.alt, (toGuide - 3) * 0.5));
    if (altitude < 15) sinkMax = 3.5;
  }
  v.vy += (clamp((aim - v.air) * 1.2, -sinkMax, climbMax) - v.vy) * fade;
  v.air += v.vy * dt;
  v.flyPitch += (clamp(-v.vy * 0.02, -0.3, 0.3) - v.flyPitch) * fade;
  v.flyRoll += (clamp(-v.yawRate * Math.min(1, s.now / 25) * 0.5, -0.7, 0.7) - v.flyRoll) * fade;
  if (s.state === 'takeoff' && v.air - ground > Math.min(25, s.alt * 0.6)) s.state = 'cruise';
  s.cruiseT -= dt;
  if (s.state === 'cruise' && !s.stunt && (s.cruiseT <= 0 || s.leaving)) {
    // Land at a clear kerb some way ahead along the streets.
    let k = kerbAhead(s.from, s.to, s.at, 80);
    for (let i = 0; i < 6 && !kerbClear(k); i++) k = kerbAhead(k.from, k.to, k.at, 30);
    Object.assign(s, { at: k.at, from: k.from, land: k, state: 'landing', to: k.to });
  }
  if (s.state === 'landing' && toGuide < 1.5 && v.air - ground < 0.4) {
    // Touchdown, facing along the street.
    Object.assign(v, { air: null, flyPitch: 0, flyRoll: 0, flying: false, groundY: ground, h: s.land.h, pose: null, thrust: null, vx: 0, vy: 0, vz: 0, x: s.land.x, yawRate: 0, z: s.land.z });
    Object.assign(s, { gx: s.land.x, gz: s.land.z, land: null, now: 0, state: 'ground', wait: rand(4, 15) });
    return;
  }
  let boost = s.state === 'landing' ? 0.1 : 0.25 + s.now / 90, side = -v.yawRate * 0.6, lift = 0.45 + Math.max(0, v.vy / 12) * 0.5;
  if (s.state === 'takeoff' || (s.state === 'landing' && v.air - ground < 15)) lift = 1;
  s.stuntT -= dt;
  if (s.state === 'cruise' && !s.stunt && !s.leaving && s.stuntT <= 0 && v.air - ground > 15) s.stunt = { dir: pick([-1, 1]), kind: pick(Object.keys(STUNTS)), t: 0 };
  v.pose = null;
  if (s.stunt) {
    const st = s.stunt, duration = STUNTS[st.kind];
    st.t += dt;
    const k = Math.min(1, st.t / duration), ease = k * k * (3 - 2 * k), arc = Math.sin(Math.PI * k);
    if (st.kind === 'loop') {
      // A vertical circle: the car keeps moving forward, so the offset takes that back out.
      const a = 2 * Math.PI * k, R = (s.now * duration) / (2 * Math.PI);
      v.pose = { forward: R * Math.sin(a) - R * a, pitch: -a, roll: 0, side: 0, up: R * (1 - Math.cos(a)), yaw: 0 };
      boost = 1;
    } else if (st.kind === 'roll') {
      v.pose = { forward: 0, pitch: 0, roll: 2 * Math.PI * ease * st.dir, side: arc * 2.5 * st.dir, up: arc * 1.5, yaw: 0 };
      side = st.dir;
    } else if (st.kind === 'flip') {
      v.pose = { forward: 0, pitch: 0, roll: 2 * Math.PI * ease * st.dir, side: 0, up: arc * 4, yaw: 0 };
      side = st.dir;
      lift = 1;
    } else {
      v.pose = { forward: 0, pitch: 0, roll: 0, side: 0, up: 0, yaw: 2 * Math.PI * ease * st.dir };
      side = st.dir;
    }
    if (k >= 1) { s.stunt = null; s.stuntT = rand(5, 16); }
  }
  const braking = s.state === 'landing' && s.now > 8;
  v.thrust = { boost: Math.min(1, boost), fan: 1, lift: Math.min(1, lift), side: clamp(side, -1, 1), wing: braking ? 2 : 1 };
  s.vaporT -= dt;
  if (s.vaporT <= 0 && v.car) {
    s.vaporT = 1 / 15;
    emitThrusterVapor(v.car, v.thrust, true);
  }
}
// A car knocked out of the sky falls, tumbling, until it hits a roof or the ground.
function fallStep(v, dt) {
  if (v.landed) return;
  Object.assign(v, { flying: false, pose: null, thrust: null });
  v.vy -= 9.8 * dt;
  v.vx *= Math.exp(-0.4 * dt);
  v.vz *= Math.exp(-0.4 * dt);
  v.x += v.vx * dt;
  v.z += v.vz * dt;
  v.air += v.vy * dt;
  v.flyRoll += dt * 1.8;
  v.flyPitch += dt * 0.7;
  const ground = surfaceHeight(v.x, v.z, v.groundY), roof = buildingAt(v.x, v.z)?.h ?? -Infinity;
  if (v.air > Math.max(ground, roof)) return;
  sfx.crash(clamp(30 / Math.hypot(v.x - player.x, v.z - player.z), 0.05, 0.9));
  for (let i = 0; i < 12; i++) spawnPuff(v.x + rand(-1.5, 1.5), Math.max(ground, roof) - terrainAt(v.x, v.z) + 0.5, v.z + rand(-1.5, 1.5), pick([0x333333, 0x555555, 0xff7b00]), rand(0.6, 1.4), rand(0.8, 1.6), rand(1, 3), 2);
  if (roof > ground) Object.assign(v, { air: roof, flyPitch: 0, flyRoll: 0, landed: true, vx: 0, vy: 0, vz: 0 });
  else Object.assign(v, { air: null, flyPitch: 0, flyRoll: 0, vx: v.vx * 0.3, vy: 0, vz: v.vz * 0.3 });
}

function toggleFlight() {
  const v = player.vehicle;
  if (!v || v.kind !== 'roadster' || v.mode === 'wreck' || v.sink > 0) return;
  if (v.air === null) {
    Object.assign(v, { air: v.groundY ?? groundHeight(v.x, v.z), flying: true, vy: 5, yawRate: 0 });
    toast('Flying! <b>Space</b> up · <b>C</b> down · <b>W/S</b> thrust · <b>A/D</b> turn · <b>Shift</b> boost · <b>G</b> land', 6);
  } else {
    v.flying = !v.flying;
    if (v.flying && v.vy === 0) v.vy = 3;
    toast(v.flying ? 'Thrusters on.' : 'Landing…', 2);
  }
}

function updateWanted(dt) {
  if (player.wanted === 0 || player.dead) { player.bustT = 0; return; }
  const range = 55 + player.wanted * 12;
  const cops = vehicles.filter((v) => v.mode === 'police');
  const seen = cops.some((c) => Math.hypot(c.x - player.x, c.z - player.z) < range);
  if (seen) player.evadeT = 0;
  else {
    player.evadeT += dt;
    if (player.evadeT > 5 + player.wanted * 3) {
      player.wanted = 0;
      player.wantedPoints = 0;
      player.evadeT = 0;
      toast('You lost the cops.');
      releaseCops();
      return;
    }
  }
  const pSpeed = player.vehicle ? player.vehicle.speed : Math.hypot(player.vx, player.vz);
  // (No arrest while hovering out of reach.)
  const reachable = !player.vehicle || player.vehicle.altitude < 2;
  const closeCop = reachable && cops.some((c) => Math.hypot(c.x - player.x, c.z - player.z) < (player.vehicle ? 7 : 8) && c.speed < 4);
  if (closeCop && pSpeed < (player.vehicle ? 1.5 : 5)) {
    player.bustT += dt;
    if (player.bustT > (player.vehicle ? 3 : 2)) die('BUSTED', '#3d7bd9');
  } else {
    player.bustT = Math.max(0, player.bustT - dt);
  }
}

function updateCamera(dt) {
  const now = performance.now() / 1000;
  let tx = player.x, ty = 1.6 + player.y + (player.groundY ?? groundHeight(player.x, player.z)), tz = player.z, dist = 4.6, pitch = view.pitch;
  if (player.vehicle) {
    const v = player.vehicle;
    ty = 1.6 + (v.air ?? v.groundY ?? groundHeight(v.x, v.z));
    dist = (v.air === null ? 8.5 : 10) + Math.min(4, v.speed / 10);
    if (now - view.lastMouse > 1.2) {
      // Follow where the car is going, so drifts swing the view out a little.
      let heading = v.forwardSpeed < -2 ? v.h + Math.PI : v.h;
      if (v.speed > 4 && v.forwardSpeed > 0) heading += angleDiff(heading, Math.atan2(v.vx, v.vz)) * 0.5;
      view.yaw += angleDiff(view.yaw, heading) * (1 - Math.exp(-dt * 3.5));
      view.pitch += ((v.air === null ? 0.22 : 0.3) - view.pitch) * (1 - Math.exp(-dt * 2));
    }
    pitch = Math.max(0.05, view.pitch);
  }
  const fov = player.vehicle ? 65 + Math.min(14, player.vehicle.speed * 0.35) : 65;
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 3));
    camera.updateProjectionMatrix();
  }
  const fx = Math.sin(view.yaw), fz = Math.cos(view.yaw);
  const sideOffset = player.vehicle ? 0 : 0.7;
  const rx = -fz, rz = fx;
  tx -= rx * sideOffset;
  tz -= rz * sideOffset;
  let d = dist;
  for (let s = 0.5; s <= dist; s += 0.5) {
    const cx = tx - fx * Math.cos(pitch) * s, cz = tz - fz * Math.cos(pitch) * s, cy = ty + Math.sin(pitch) * s;
    const b = buildingAt(cx, cz);
    if (b && cy < b.h + 0.5) { d = Math.max(0.6, s - 0.6); break; }
  }
  const wx = tx - fx * Math.cos(pitch) * d, wz = tz - fz * Math.cos(pitch) * d;
  const want = new THREE.Vector3(wx, Math.max(terrainAt(wx, wz) + 0.4, ty + Math.sin(pitch) * d), wz);
  // In a car the camera trails slightly behind (smooths bumps and crashes); on foot it is rigid for aiming.
  if (player.vehicle && view.wasDriving) camera.position.lerp(want, 1 - Math.exp(-dt * 12));
  else camera.position.copy(want);
  view.wasDriving = !!player.vehicle;
  if (!player.vehicle) player.model.root.visible = d > 1.6;
  if (shake > 0) {
    camera.position.x += rand(-shake, shake);
    camera.position.y += rand(-shake, shake) * 0.5;
    shake = Math.max(0, shake - dt * 2);
  }
  camera.lookAt(tx + fx * 2, ty + (player.vehicle ? 0 : 0.3), tz + fz * 2);
  // Free camera for the headless screenshot tools: oslo.debugCam = { from: [x, y, z], to: [x, y, z] }.
  const debugCam = window.oslo?.debugCam;
  if (debugCam) {
    // Debug views give heights above the ground.
    const [fx, fy, fz] = debugCam.from, [tx, ty, tz] = debugCam.to;
    camera.position.set(fx, fy + terrainAt(fx, fz), fz);
    camera.lookAt(tx, ty + terrainAt(tx, tz), tz);
  }
  skyDome.position.copy(camera.position);
  // The wave grid follows the camera in whole cells, so the waves don't swim.
  waveTime.value = now;
  const cellSize = 400 / 260;
  seaSurface.position.set(Math.round(camera.position.x / cellSize) * cellSize, WATER_LEVEL, Math.round(camera.position.z / cellSize) * cellSize);
  // Only drawn with sea in reach (its shader is the heaviest in the scene).
  const { x: cx, z: cz } = camera.position;
  seaSurface.visible = [[0, 0], [150, 0], [-150, 0], [0, 150], [0, -150], [110, 110], [-110, 110], [110, -110], [-110, -110]].some(([dx, dz]) => seaAt(cx + dx, cz + dz));
  sun.position.set(player.x + SUN_OFFSET.x, SUN_OFFSET.y + terrainAt(player.x, player.z), player.z + SUN_OFFSET.z);
  sun.target.position.set(player.x, terrainAt(player.x, player.z), player.z);
}

// ============================================================================
// Day and night
// ============================================================================
// A full day lasts 20 minutes; T skips two hours.
const DAY_SECONDS = 20 * 60;
let hours = 16.5;
addEventListener('keydown', (e) => { if (started && e.code === 'KeyT') hours = (hours + 2) % 24; });
const hemi = scene.children.find((o) => o.isHemisphereLight);
const moon = new THREE.DirectionalLight(0x9db4ff, 0);
scene.add(moon);
const lampGlow = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 8, 5), new THREE.MeshBasicMaterial({ color: 0x000000 }), Math.max(1, lampHeads.length));
lampHeads.forEach(([x, z, y], i) => lampGlow.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y + 6.15, z)));
scene.add(lampGlow);
// A few real lights follow the camera, sitting in the nearest street lamps.
// One reused explosion light: adding lights at runtime recompiles every shader (a stall).
const explosionFlash = new THREE.PointLight(0xff8a3c, 0, 30);
scene.add(explosionFlash);
const lampLights = Array.from({ length: 4 }, () => { const l = new THREE.PointLight(0xffc98a, 0, 24, 1.3); scene.add(l); return l; });
const headlight = new THREE.SpotLight(0xfff3dc, 0, 70, 0.45, 0.6, 1.2);
scene.add(headlight, headlight.target);
const stars = (() => {
  const pos = [];
  for (let i = 0; i < 1500; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.asin(Math.random());
    pos.push(Math.cos(e) * Math.sin(a) * 2000, Math.sin(e) * 2000, Math.cos(e) * Math.cos(a) * 2000);
  }
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, depthWrite: false, fog: false, opacity: 0, size: 1.6, sizeAttenuation: false, transparent: true }));
  p.frustumCulled = false;
  skyDome.add(p);
  p.scale.setScalar(1 / skyDome.scale.x);
  return p;
})();
const SKY = {
  day: { horizon: new THREE.Color(HORIZON), zenith: new THREE.Color(0x4f86c6) },
  dusk: { horizon: new THREE.Color(0xf0a066), zenith: new THREE.Color(0x3a4f86) },
  night: { horizon: new THREE.Color(0x1a2640), zenith: new THREE.Color(0x060d1d) },
};
const sunWarm = new THREE.Color(0xffb878), sunNoon = new THREE.Color(0xfff1d6);
let lampAssignT = 0;
function updateDayNight(dt) {
  hours = (hours + (dt * 24) / DAY_SECONDS) % 24;
  const e = Math.sin(((hours - 6) / 12) * Math.PI) * 0.95;
  const az = (hours / 24) * Math.PI * 2 + Math.PI;
  const dir = new THREE.Vector3(Math.cos(e) * Math.sin(az), Math.sin(e), Math.cos(e) * Math.cos(az));
  const day = THREE.MathUtils.smoothstep(e, -0.1, 0.3);
  const dusk = Math.max(0, 1 - Math.abs(e) / 0.25) * 0.85;
  const night = 1 - day;
  SUN_OFFSET.copy(dir).multiplyScalar(190);
  sun.intensity = 2.2 * THREE.MathUtils.smoothstep(e, -0.02, 0.2);
  sun.color.copy(sunNoon).lerp(sunWarm, Math.min(1, dusk * 1.2));
  moon.intensity = 0.35 * night;
  moon.position.set(player.x - dir.x * 150, Math.abs(dir.y) * 150 + 40, player.z - dir.z * 150);
  moon.target.position.set(player.x, 0, player.z);
  hemi.intensity = 0.25 + 1.15 * day;
  const u = skyDome.material.uniforms;
  u.zenith.value.copy(SKY.night.zenith).lerp(SKY.day.zenith, day).lerp(SKY.dusk.zenith, dusk * 0.5);
  u.horizon.value.copy(SKY.night.horizon).lerp(SKY.day.horizon, day).lerp(SKY.dusk.horizon, dusk);
  u.sunDir.value.copy(dir);
  scene.fog.color.copy(u.horizon.value);
  scene.environmentIntensity = 0.12 + 0.68 * day;
  setRoadsterLight(day);
  stars.material.opacity = Math.max(0, night - 0.3);
  // Lights come on at dusk.
  const lightsOn = THREE.MathUtils.smoothstep(night, 0.35, 0.75);
  for (const { material, strength } of nightMaterials) material.emissiveIntensity = lightsOn * strength;
  lampGlow.material.color.setRGB(1, 0.82, 0.55).multiplyScalar(lightsOn * 1.2);
  // The glow is black by day: don't draw it at all then.
  lampGlow.visible = lightsOn > 0.01;
  lampAssignT -= dt;
  if (lampAssignT <= 0 && lampHeads.length) {
    lampAssignT = 0.5;
    const near = lampHeads.map(([x, z], i) => [(x - camera.position.x) ** 2 + (z - camera.position.z) ** 2, i]).sort((a, b) => a[0] - b[0]).slice(0, lampLights.length);
    near.forEach(([, i], k) => lampLights[k].position.set(lampHeads[i][0], lampHeads[i][2] + 6, lampHeads[i][1]));
  }
  for (const l of lampLights) l.intensity = 45 * lightsOn;
  const car = player.vehicle;
  headlight.intensity = car ? 160 * lightsOn : 0;
  if (car) {
    const fx = Math.sin(car.h), fz = Math.cos(car.h);
    headlight.position.set(car.x + fx * (car.k.len / 2), (car.groundY ?? 0) + 0.8, car.z + fz * (car.k.len / 2));
    headlight.target.position.set(car.x + fx * 25, terrainAt(car.x + fx * 25, car.z + fz * 25), car.z + fz * 25);
  }
  hud.clock.textContent = `${String(Math.floor(hours)).padStart(2, '0')}:${String(Math.floor((hours % 1) * 60)).padStart(2, '0')}`;
}

let last = performance.now(), spawnT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  adaptResolution(now - last, Math.min(0.05, (now - last) / 1000));
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!started) {
    view.yaw += dt * 0.08;
    updateCamera(dt);
    renderer.render(scene, camera);
    return;
  }
  player.shootCd -= dt;
  spawnT -= dt;
  if (spawnT <= 0) { spawnT = 0.15; manageSpawns(); manageSky(); manageRail(); manageStopCrowds(); }

  updateSky(dt);
  if (player.vehicle) updatePlayerVehicle(dt);
  else {
    updatePlayerOnFoot(dt);
    if (sound.engineGain) sound.engineGain.gain.value = 0;
    if (sound.thrustGain) sound.thrustGain.gain.value = 0;
  }

  for (const v of vehicles.slice()) {
    if (!vehicles.includes(v)) continue;
    if (v.mode === 'ai') {
      if (v.stunT > 0) {
        v.stunT -= dt;
        physicsStep(v, { hb: true, s: 0, t: 0 }, dt);
        if (v.stunT <= 0 && !(v.route ? rejoinRoute(v) : attachToRoad(v))) { v.mode = 'parked'; v.driver = false; v.route = null; }
      } else {
        aiStep(v, dt);
      }
    } else if (v.mode === 'police') copStep(v, dt);
    else if (v.mode === 'sky') followAgent(v);
    else if (v.mode === 'parked' || v.mode === 'wreck') {
      if (v.air !== null) fallStep(v, dt);
      else if (v.speed > 0.05 || v.sink > 0) physicsStep(v, { hb: true, s: 0, t: 0 }, dt);
      else { v.vx = v.vz = 0; }
    }
    if (v.mode === 'wreck') {
      v.wreckT = (v.wreckT || 0) + dt;
      if (v.wreckT < 25 && Math.random() < 0.4) spawnPuff(v.x + rand(-0.5, 0.5), 1.2, v.z + rand(-0.5, 0.5), v.wreckT < 8 && Math.random() < 0.5 ? 0xff7b00 : 0x2b2b2b, rand(0.5, 1), 1.5, 2.5);
    } else if (v.health < 35 && Math.random() < 0.15) {
      const fx = Math.sin(v.h), fz = Math.cos(v.h);
      spawnPuff(v.x + fx * v.k.len * 0.4, 1.1, v.z + fz * v.k.len * 0.4, v.health < 15 ? 0x222222 : 0x999999, 0.4, 1.2, 1.5, 0.3);
    }
    // (Sky traffic and flying cars stay drawn out to the fog: they show over the roofs, and
    // must not pop out of view.)
    const range = v.mode === 'sky' || v.air !== null ? 1400 : 220, visible = Math.abs(v.x - player.x) < range && Math.abs(v.z - player.z) < range;
    // Far vehicles leave the scene graph, so the renderer doesn't recompute their parts'
    // matrices every frame.
    if (visible !== (v.mesh.root.parent === scene)) { if (visible) scene.add(v.mesh.root); else scene.remove(v.mesh.root); }
    if (visible) v.sync(dt);
  }
  collideVehicles();
  updateRail(dt);

  for (const p of peds.slice()) p.update(dt);

  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.t += dt;
    p.mesh.rotation.y += dt * 3;
    p.mesh.position.y = groundHeight(p.mesh.position.x, p.mesh.position.z) + 0.6 + Math.sin(p.t * 3) * 0.15;
    if (Math.hypot(p.x - player.x, p.z - player.z) < (player.vehicle ? 3 : 1.5) && !player.dead && !(player.vehicle?.altitude > 3)) {
      player.cash += p.amount;
      sfx.cash();
      scene.remove(p.mesh);
      pickups.splice(i, 1);
    } else if (p.t > 60) {
      scene.remove(p.mesh);
      pickups.splice(i, 1);
    }
  }

  updateWanted(dt);
  updateMission(dt);
  markerMesh.material.opacity = 0.25 + Math.sin(now / 300) * 0.1;

  if (sound.sirenGain) {
    let nearest = Infinity;
    for (const v of vehicles) if (v.siren) nearest = Math.min(nearest, Math.hypot(v.x - player.x, v.z - player.z));
    sound.sirenGain.gain.value = sound.muted ? 0 : clamp(0.06 * (1 - nearest / 160), 0, 0.06);
    sound.siren.frequency.value = 700 + Math.sin(now / 1000 * Math.PI * 1.6) * 250;
  }

  waterNormals.offset.x += dt * 0.012;
  waterNormals.offset.y += dt * 0.007;
  swellNormals.offset.x -= dt * 0.004;
  swellNormals.offset.y += dt * 0.006;
  foamMaterial.opacity = 0.28 + Math.sin(now / 900) * 0.08;
  pondMaterial.normalMap.offset.x += dt * 0.02;
  updatePuffs(dt);
  vapor.update(dt, camera, renderer);
  updateFallen(dt);
  updateTracers(dt);
  updateCamera(dt);
  streamer.update(camera.position.x, camera.position.z);
  cullProps();
  grassField.update(camera, now / 1000);
  harbour.update(dt, now / 1000);
  birds.update(dt, now / 1000);
  traffic.update(now / 1000);
  updateDayNight(dt);
  updateHud(dt);
  poseFrame++;
  renderer.shadowMap.needsUpdate = poseFrame % 2 === 0;
  renderer.render(scene, camera);
}
player.model.root.position.set(player.x, groundHeight(player.x, player.z), player.z);
view.yaw = SPAWN.h;
window.oslo = { addPassengers, camera, inView, skyAgents, sloydCars, isRoad, propBatches, streamer, surfaceHeight, terrainAt, crowd: () => Math.round(footfallAround(player.x, player.z).total * HOURLY[Math.floor(hours) % 24]), fallen, peds, player, poleGrid, railVehicles, renderer, scene, sites, setHours: (h) => { hours = h; }, traffic, spawnVehicle: (kind, x, z, h) => new Vehicle(kind, x, z, h, 'parked'), vehicles, view };
// Street detail from OSM: fences, railings, walls and hedges along their ways, bollards.
// Each barrier segment also blocks movement (half its thickness, at least 10 cm).
const BARRIER_THICKNESS = { fence: 0.1, guard_rail: 0.15, handrail: 0.1, hedge: 0.4, railing: 0.1, retaining_wall: 0.2, wall: 0.18 };
for (const b of data.barriers || []) {
  const r = BARRIER_THICKNESS[b.k];
  if (!r) continue;
  for (let i = 0; i + 1 < b.p.length; i++) {
    const [ax, az] = b.p[i], [bx, bz] = b.p[i + 1];
    barrierGrid.insert({ ax, az, bx, bz, r }, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
  }
}
for (const m of [...buildBarriers(data.barriers || [], groundHeight), ...buildBollards(data.bollards || [], groundHeight)]) {
  m.userData.detail = 'barriers';
  scene.add(m);
  if (m.isInstancedMesh) splitInstanced(m, 250);
}
// City bikes at the real bike-share stations (tools/fetch-gbfs.mjs, when the city has a feed)
// and shared e-scooters near stops.
{
  const stations = await fetch(`${DATA}bikes.json`).then((r) => (r.ok ? r.json() : []));
  const anchors = [...data.stops.map((st) => [st.x, st.z]), ...stations.map((st) => [st.x, st.z])];
  const { docks, items, meshes } = buildMicromobility({
    anchors, blocked: (x, z) => buildingAt(x, z) || isWater(x, z), groundHeight, kerbDirection: (x, z) => roadIndex.direction(x, z),
    onSidewalk: (x, z) => groundHeight(x, z) - terrainAt(x, z) > 0.2, stations,
  });
  const moved = meshes.map((m) => { m.userData.detail = 'micromobility'; scene.add(m); return splitInstanced(m, 250); });
  // Bikes and scooters stop people and slow cars, and a car going fast knocks them over.
  for (const { index, mesh, r, x, z } of items) poleGrid.insert({ breakable: true, down: false, instances: [moved[mesh][index]], q: 0, r, x, z }, x, z, x, z);
  // Dock rows run along their rotation (the collider's depth axis).
  for (const d of docks) rectCollider(d.x, d.z, d.rot, d.d, d.w, 1);
}
// Shop signs for every named shop and café, lit at night.
for (const m of buildShopSigns(data.pois || [], data.buildings, groundHeight, (map) => nightLit(new THREE.MeshLambertMaterial({ map }), map, 0.7))) { m.userData.detail = 'signs'; scene.add(m); }

// Jernbanetorget: Østbanehallen's green neon name over the entrance, the hotel lettering
// on its roof and the clock, and Elena Engelsen's bronze tiger walking along the facade.
{
  // Trafikanten's clock tower, as tall as the laser surface says (35-45 m).
  const kiosk = data.buildings.find((b) => b.n === 'Trafikanten');
  if (kiosk) {
    const [tx, tz] = centroid(kiosk.p), ground = terrainAt(tx, tz), tower = clockTower(clamp(terrain.surfaceAt(tx, tz) - ground, 30, 45));
    tower.position.set(tx, ground, tz);
    scene.add(tower);
    rectCollider(tx, tz, 0, 3, 3, 40);
  }
  const hall = data.buildings.find((b) => b.n === 'Oslo Østbanestasjon (Oslo Ø)');
  const art = (data.artworks || []).find((a) => a.n === 'Tigeren');
  if (hall && art) {
    const neon = (map) => new THREE.MeshBasicMaterial({ alphaTest: 0.4, map });
    const white = (map) => new THREE.MeshLambertMaterial({ alphaTest: 0.4, map });
    const top = Math.max(...data.parts.filter((q) => pointInPoly(...centroid(q.p), hall.p)).map((q) => q.h + q.ground), hall.h + hall.ground);
    for (const m of [facadeLettering(hall, art.x, art.z, 'ØSTBANEHALLEN', groundHeight(art.x, art.z) + 5, 0.95, '#45f07a', neon), facadeLettering(hall, art.x, art.z, 'COMFORT HOTEL GRAND CENTRAL', top + 0.9, 1.1, '#ffffff', white)]) if (m) scene.add(m);
    // Facade nearest the tiger: the tiger walks along it, head to the right seen from the square.
    let best = null;
    for (let i = 0; i < hall.p.length; i++) {
      const a = hall.p[i], b = hall.p[(i + 1) % hall.p.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t = Math.max(0, Math.min(1, ((art.x - a[0]) * (b[0] - a[0]) + (art.z - a[1]) * (b[1] - a[1])) / (len * len)));
      const px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t, d = Math.hypot(art.x - px, art.z - pz);
      if (len > 8 && (!best || d < best.d)) best = { a, b, d, len, mx: (a[0] + b[0]) / 2, mz: (a[1] + b[1]) / 2 };
    }
    if (best) {
      let nx = -(best.b[1] - best.a[1]) / best.len, nz = (best.b[0] - best.a[0]) / best.len;
      if (nx * (art.x - best.mx) + nz * (art.z - best.mz) < 0) { nx = -nx; nz = -nz; }
      const tiger = tigerStatue();
      tiger.position.set(art.x, groundHeight(art.x, art.z), art.z);
      tiger.rotation.y = Math.atan2(nx, nz);
      scene.add(tiger);
      rectCollider(art.x, art.z, tiger.rotation.y, 4.8, 1, 1.7);
      // Clock on the central pavilion, under the hotel lettering.
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#f4f1ea'; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#222'; g.lineWidth = 4; g.stroke();
      g.fillStyle = '#222';
      for (let i = 0; i < 12; i++) { g.save(); g.translate(64, 64); g.rotate((i * Math.PI) / 6); g.fillRect(-2, -56, 4, 10); g.restore(); }
      g.lineCap = 'round'; g.lineWidth = 5; g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 26); g.moveTo(64, 64); g.lineTo(88, 74); g.stroke();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const clock = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32), new THREE.MeshLambertMaterial({ map: tex }));
      // In front of the tiger on the facade line: the central pavilion over the entrance.
      const ex = (best.b[0] - best.a[0]) / best.len, ez = (best.b[1] - best.a[1]) / best.len, t = (art.x - best.a[0]) * ex + (art.z - best.a[1]) * ez;
      clock.position.set(best.a[0] + ex * t + nx * 0.08, top - 2.2, best.a[1] + ez * t + nz * 0.08);
      clock.rotation.y = Math.atan2(nx, nz);
      scene.add(clock);
    }
  }
}

// The fjord: moored and anchored boats, ferries, channel buoys, all riding the waves.
const harbour = createHarbour({ isWater, piers: data.ground.pier || [], scene, waterLevel: WATER_LEVEL, waveAt });
// Pigeons on the big paved squares (and round the tiger on Jernbanetorget); gulls and
// pigeons circling overhead. The player and moving vehicles scare the pigeons up.
const birds = (() => {
  const area = (p) => Math.abs(p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;
  const squares = (data.ground.paving || []).map((p) => [p, area(p)]).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([p, a]) => [...centroid(p), clamp(Math.sqrt(a) / 2, 10, 30)]).filter(([x, z]) => !buildingAt(x, z));
  const tiger = (data.artworks || []).find((a) => a.n === 'Tigeren');
  if (tiger) squares.push([tiger.x + 8, tiger.z, 18]);
  return createBirds({ heightAt: groundHeight, scene, squares, threats: () => [[player.x, player.z], ...vehicles.filter((v) => v.speed > 2).map((v) => [v.x, v.z])] });
})();
// Build the tiles around Jernbanetorget before the first frame, so the start isn't empty.
streamer.update(SPAWN.x, SPAWN.z, Infinity);
// Static world: freeze the matrices of everything built so far that never moves, so the
// renderer stops recomputing thousands of them every frame. (Vehicles and people are groups.)
{
  const moving = new Set([markerMesh, skyDome]);
  for (const o of scene.children) {
    if (moving.has(o) || !(o.isMesh || o.isLine || o.isPoints)) continue;
    o.updateMatrixWorld(true);
    o.matrixAutoUpdate = false;
    o.matrixWorldAutoUpdate = false;
  }
}
requestAnimationFrame(frame);
