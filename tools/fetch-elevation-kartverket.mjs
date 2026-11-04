// Downloads Kartverket's national laser elevation (© Kartverket, CC BY 4.0) over the city's
// box as 1 m grids: DTM (bare ground) and DOM (surface incl. buildings), via WCS, into
// data/<city>/elevation-dtm-<i>.tif and -dom-<i>.tif (EPSG:25832, UTM 32N). Norway only
// ("elevation": "kartverket"); elsewhere tools/elevation-global.mjs needs no download step.
import { writeFileSync } from 'node:fs';
import CITY from './city.cjs';
import { toUtm32 } from './utm.mjs';

const B = CITY.BOX;
const [x0, y0] = toUtm32(B.minLat - 0.002, B.minLon - 0.004), [x1, y1] = toUtm32(B.maxLat + 0.002, B.maxLon + 0.004);
const minX = Math.floor(Math.min(x0, x1)), maxX = Math.ceil(Math.max(x0, x1)), minY = Math.floor(Math.min(y0, y1)), maxY = Math.ceil(Math.max(y0, y1));
console.log('bbox', minX, minY, maxX, maxY, (maxX - minX) + 'x' + (maxY - minY) + ' m');
// 1 m cells, fetched in tiles of at most 2 km so each request stays within server limits.
const tiles = [];
for (let tx = minX; tx < maxX; tx += 2000) for (let ty = minY; ty < maxY; ty += 2000) tiles.push([tx, ty, Math.min(maxX, tx + 2000), Math.min(maxY, ty + 2000)]);
for (const [name, service, coverage] of [['dtm', 'wcs.hoyde-dtm_somlos', 'las_dtm'], ['dom', 'wcs.hoyde-dom_somlos', 'las_dom']]) {
  for (const [i, [x0, y0, x1, y1]] of tiles.entries()) {
    const url = `https://wcs.geonorge.no/skwms1/${service}?service=WCS&version=1.0.0&request=GetCoverage&coverage=${coverage}&crs=EPSG:25832&bbox=${x0},${y0},${x1},${y1}&width=${x1 - x0}&height=${y1 - y0}&format=GeoTIFF`;
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || (buf.slice(0, 2).toString() !== 'II' && buf.slice(0, 2).toString() !== 'MM')) throw new Error(`${name} tile ${i}: ${res.status} ${buf.slice(0, 300).toString()}`);
    writeFileSync(`${CITY.DATA}elevation-${name}-${i}.tif`, buf);
    console.log(name, i, '/', tiles.length, buf.length, 'bytes');
  }
}
writeFileSync(`${CITY.DATA}elevation-box.json`, JSON.stringify({ maxX, maxY, minX, minY, tiles }));
