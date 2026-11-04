// Adds camera headings to data/<city>/photos/index.json from each photo's EXIF GPSImgDirection.
import { readFileSync, writeFileSync } from 'node:fs';
import CITY from './city.cjs';
const file = `${CITY.DATA}photos/index.json`;
const UA = { 'User-Agent': 'oslo-gta-local/1.0 (personal project; colour reference)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(url) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const text = await (await fetch(url, { headers: UA })).text();
    try { return JSON.parse(text); } catch { await sleep(5000 * (attempt + 1)); }
  }
  throw new Error('Commons API kept refusing');
}
const photos = JSON.parse(readFileSync(file));
const byTitle = new Map(photos.map((p) => [p.title, p]));
const rational = (v) => { const [a, b] = String(v).split('/').map(Number); return b ? a / b : a; };
for (let i = 0; i < photos.length; i += 50) {
  const titles = photos.slice(i, i + 50).map((p) => p.title).join('|');
  const d = await api(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=metadata&format=json&formatversion=2`);
  for (const page of d.query?.pages || []) {
    const meta = page.imageinfo?.[0]?.metadata || [];
    const dir = meta.find((m) => m.name === 'GPSImgDirection');
    const p = byTitle.get(page.title);
    if (p && dir) p.heading = rational(dir.value);
  }
  await sleep(1000);
}
writeFileSync(file, JSON.stringify(photos));
console.log('with heading', photos.filter((p) => Number.isFinite(p.heading)).length, 'of', photos.length);
