// Fetches every OSM feature (with geometry) in the city's optional focus area (its "focus"
// box; in Oslo round Oslo S, Bjørvika, the Opera, Sørenga and the Akershus quays), for the
// detailed street, stair and quay layers. Writes data/<city>/focus-raw.json.
// © OpenStreetMap contributors (ODbL).
import fs from 'node:fs';
import CITY from './city.cjs';

const f = CITY.city.focus;
if (!f) { console.log('focus: no focus box in the city config, skipped'); process.exit(0); }
const bbox = `${f.minLat},${f.minLon},${f.maxLat},${f.maxLon}`;
const query = `[out:json][timeout:240][maxsize:536870912];(nwr(${bbox}););out geom;`;
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
for (let attempt = 0; attempt < 6; attempt++) {
  try {
    const res = await fetch(SERVERS[attempt % SERVERS.length], { body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'grand-theft-city/1.0 (Sloyd game prototype)' }, method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    fs.writeFileSync(`${CITY.DATA}focus-raw.json`, text);
    console.log(`focus: ${JSON.parse(text).elements.length} elements, ${(text.length / 1e6).toFixed(1)} MB`);
    process.exit(0);
  } catch (err) { console.warn(`attempt ${attempt + 1}: ${err.message}`); }
}
process.exit(1);
