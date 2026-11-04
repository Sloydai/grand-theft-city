// Fetches street detail over the city's box into data/<city>/street-raw.json: barriers (fences,
// railings, walls, hedges, bollards), public artworks and statues, and named shops,
// cafés, hotels and offices (for shop signs).
import { writeFileSync } from 'node:fs';
import CITY from './city.cjs';
const B = CITY.BOX;
const box = `${B.minLat},${B.minLon},${B.maxLat},${B.maxLon}`;
const query = `[out:json][timeout:240];(
  way["barrier"~"^(fence|railing|wall|hedge|guard_rail|handrail|retaining_wall)$"](${box});
  node["barrier"~"^(bollard|block)$"](${box});
  node["tourism"="artwork"](${box}); way["tourism"="artwork"](${box}); node["historic"~"^(memorial|monument)$"](${box});
  node["name"]["shop"](${box}); node["name"]["amenity"~"^(restaurant|cafe|fast_food|bar|pub|bank|pharmacy|cinema|theatre)$"](${box});
  node["name"]["tourism"="hotel"](${box}); way["name"]["tourism"="hotel"](${box}); node["name"]["office"](${box});
);out geom;`;
for (let attempt = 0; attempt < 5; attempt++) {
  const res = await fetch('https://overpass-api.de/api/interpreter', { body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'grand-theft-city/1.0 (Sloyd game prototype)' }, method: 'POST' });
  const text = await res.text();
  if (res.ok && text.startsWith('{')) {
    writeFileSync(`${CITY.DATA}street-raw.json`, text);
    const d = JSON.parse(text), count = {};
    for (const e of d.elements) { const t = e.tags || {}; const k = t.barrier ? 'barrier=' + t.barrier : t.tourism === 'artwork' || t.historic ? 'art' : 'poi'; count[k] = (count[k] || 0) + 1; }
    console.log(count);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 10000 * (attempt + 1)));
}
throw new Error('Overpass kept failing');
