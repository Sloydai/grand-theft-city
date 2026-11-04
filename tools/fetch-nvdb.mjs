// Fetches street detail from NVDB, the Norwegian Road Database (Statens vegvesen, open data
// under NLOD 2.0: https://data.norge.no/nlod/no/2.0), for the map box: kerbs, lowered
// kerbs, sidewalks, traffic islands, longitudinal and transverse markings, pedestrian
// crossings, stairs and measured carriageway widths. Writes data/<city>/nvdb-<type>.json.
// Norway only: tools/build-city.sh runs it when the city's config has "nvdb": true.
import fs from 'node:fs';
import CITY from './city.cjs';

const box = CITY.BOX;
const TYPES = { 9: 'kerbs', 10: 'lowered-kerbs', 48: 'sidewalks', 49: 'islands', 99: 'lines', 174: 'crossings', 519: 'transverse', 838: 'widths', 875: 'stairs' };
const API = 'https://nvdbapiles.atlas.vegvesen.no';
const headers = { Accept: 'application/json', 'X-Client': 'grand-theft-city' };

for (const [type, name] of Object.entries(TYPES)) {
  const objects = [];
  let url = `${API}/vegobjekter/${type}?kartutsnitt=${box.minLon},${box.minLat},${box.maxLon},${box.maxLat}&srid=4326&inkluder=geometri,egenskaper&antall=1000`;
  while (url) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${await res.text()}`);
    const page = await res.json();
    for (const o of page.objekter || []) {
      // Some objects (crossings, stairs) carry their outline as a "Geometri, flate" property
      // beside a point geometry; keep it (it is in UTM 33, EPSG:25833).
      const props = {};
      let area;
      for (const e of o.egenskaper || []) {
        if (e.verdi === undefined) continue;
        if (e.navn === 'Geometri, flate') area = e.verdi;
        else if (!/^Geometri/.test(e.navn)) props[e.navn] = e.verdi;
      }
      objects.push({ area, id: o.id, props, wkt: o.geometri?.wkt });
    }
    url = page.objekter?.length ? page.metadata?.neste?.href : null;
  }
  fs.writeFileSync(`${CITY.DATA}nvdb-${name}.json`, JSON.stringify(objects));
  console.log(`${name}: ${objects.length}`);
}
