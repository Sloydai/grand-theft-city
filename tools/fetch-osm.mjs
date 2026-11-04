// Downloads the OpenStreetMap extracts preprocess.cjs reads, for the city's box:
// CITY=<id> node tools/fetch-osm.mjs [name...]. Each goes to data/<id>/<name>-raw.json.
import { writeFileSync } from 'node:fs';
import CITY from './city.cjs';

const B = CITY.BOX;
const box = `${B.minLat},${B.minLon},${B.maxLat},${B.maxLon}`;
// Rails and routes reach a little beyond the map so their ends aren't cut short.
const wide = `${B.minLat - 0.004},${B.minLon - 0.006},${B.maxLat + 0.004},${B.maxLon + 0.006}`;
const QUERIES = {
  base: `(way["building"](${box}); way["highway"](${box}); way["natural"="water"](${box}); relation["natural"="water"](${box}); way["leisure"="park"](${box}););out geom;`,
  extra: `(way["building:part"](${box}); way["landuse"](${box}); way["leisure"~"^(pitch|playground|garden|park)$"](${box});
    way["natural"~"^(wood|scrub|grassland|beach|sand|bare_rock)$"](${box}); way["man_made"~"^(pier|breakwater|bridge)$"](${box});
    way["area:highway"](${box}); way["amenity"~"^(parking|marketplace)$"](${box}); way["place"="square"](${box});
    way["highway"]["area"="yes"](${box}); way["waterway"](${box}););out geom;`,
  rail: `(way["railway"~"^(rail|tram|subway|light_rail)$"](${wide}););out geom;`,
  routes: `(relation["route"~"^(bus|tram)$"](${box}););out geom;>;out tags;`,
  signals: `(node["highway"~"^(traffic_signals|crossing|give_way|stop)$"](${box}); node["traffic_sign"](${box}););out;`,
  trees: `(node["natural"="tree"](${box}); way["natural"="tree_row"](${box}););out geom;`,
  coast: `(way["natural"="coastline"](${wide}););out geom;`,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Public Overpass instances, tried in turn when one is busy.
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(QUERIES)) {
  const query = `[out:json][timeout:240][maxsize:536870912];${QUERIES[name]}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(SERVERS[attempt % SERVERS.length], { body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'grand-theft-city/1.0 (Sloyd game prototype)' }, method: 'POST' });
    const text = await res.text();
    if (res.ok && text.startsWith('{')) {
      writeFileSync(`${CITY.DATA}${name}-raw.json`, text);
      console.log(name, JSON.parse(text).elements.length, 'elements', (text.length / 1e6).toFixed(1), 'MB');
      break;
    }
    if (attempt >= 5) throw new Error(`${name}: ${res.status} ${text.slice(0, 200)}`);
    await sleep(8000 * (attempt + 1));
  }
  await sleep(5000);
}
