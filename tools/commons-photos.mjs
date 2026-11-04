// Collects geotagged Wikimedia Commons photos (with camera heading when recorded) over the
// city's focus box (or 1.5 km round its centre) into data/<city>/photos/index.json. Free
// licences; used only to sample colours. Optional (tools/facade-colours.mjs uses them).
import { mkdirSync, writeFileSync } from 'node:fs';
import CITY from './city.cjs';
const UA = { 'User-Agent': 'grand-theft-city/1.0 (Sloyd game prototype; colour reference)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Commons throttles bursts: retry with a growing pause when the reply isn't JSON.
async function api(url) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const text = await (await fetch(url, { headers: UA })).text();
    try { return JSON.parse(text); } catch { await sleep(5000 * (attempt + 1)); }
  }
  throw new Error('Commons API kept refusing: ' + url);
}
const c = CITY.city.centre || CITY.city.origin;
const box = CITY.city.focus || { maxLat: c.lat + 0.007, maxLon: c.lon + 0.014, minLat: c.lat - 0.007, minLon: c.lon - 0.014 };
const photos = new Map();
for (let lat = box.minLat; lat <= box.maxLat + 1e-9; lat += 0.0035) {
  for (let lon = box.minLon; lon <= box.maxLon + 1e-9; lon += 0.006) {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lon}&gsradius=300&gslimit=500&gsnamespace=6&gsprop=type|name|dim&format=json`;
    const d = await api(url);
    for (const g of d.query?.geosearch || []) photos.set(g.pageid, { lat: g.lat, lon: g.lon, title: g.title });
    await sleep(1200);
  }
}
// Camera heading and a small thumbnail URL, 50 pages per request.
const ids = [...photos.keys()];
for (let i = 0; i < ids.length; i += 50) {
  const chunk = ids.slice(i, i + 50).join('|');
  const url = `https://commons.wikimedia.org/w/api.php?action=query&pageids=${chunk}&prop=coordinates|imageinfo&coprop=type|name|dim|globe&coprimary=all&iiprop=url|extmetadata&iiurlwidth=480&format=json`;
  const d = await api(url);
  for (const p of Object.values(d.query?.pages || {})) {
    const rec = photos.get(p.pageid);
    if (!rec) continue;
    const coord = (p.coordinates || []).find((c) => c.primary !== undefined) || p.coordinates?.[0];
    rec.heading = coord?.heading !== undefined ? Number(coord.heading) : undefined;
    const ii = p.imageinfo?.[0];
    rec.thumb = ii?.thumburl;
    rec.license = ii?.extmetadata?.LicenseShortName?.value;
    rec.date = ii?.extmetadata?.DateTimeOriginal?.value?.slice(0, 10);
  }
  await sleep(1200);
}
const list = [...photos.values()].filter((p) => p.thumb && /\.(jpe?g)$/i.test(p.title));
mkdirSync(`${CITY.DATA}photos`, { recursive: true });
writeFileSync(`${CITY.DATA}photos/index.json`, JSON.stringify(list));
console.log('photos', list.length, 'with heading', list.filter((p) => p.heading !== undefined).length, 'since 2010', list.filter((p) => (p.date || '') >= '2010').length);
