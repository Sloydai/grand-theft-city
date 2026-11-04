// Fetches multipolygon buildings and building parts (OSM relations) over the city's box into
// data/<city>/building-rel-raw.json. The main extract only had building ways, so city blocks
// mapped as multipolygons (often with courtyards) were missing.
import { writeFileSync } from 'node:fs';
import CITY from './city.cjs';
const B = CITY.BOX;
const box = `${B.minLat},${B.minLon},${B.maxLat},${B.maxLon}`;
const query = `[out:json][timeout:240];(relation["building"](${box});relation["building:part"](${box}););out geom;`;
for (let attempt = 0; attempt < 5; attempt++) {
  const res = await fetch('https://overpass-api.de/api/interpreter', { body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'grand-theft-city/1.0 (Sloyd game prototype)' }, method: 'POST' });
  const text = await res.text();
  if (res.ok && text.startsWith('{')) {
    writeFileSync(`${CITY.DATA}building-rel-raw.json`, text);
    const d = JSON.parse(text);
    console.log('relations', d.elements.length, d.elements.slice(0, 15).map((e) => e.tags.name || e.tags.building || e.tags['building:part']).join(', '));
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 10000 * (attempt + 1)));
}
throw new Error('Overpass kept failing');
