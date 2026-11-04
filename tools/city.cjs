// The city the tools work on: CITY (default oslo) picks cities/<CITY>/city.json, and its data
// goes to data/<CITY>/. Game coordinates are metres east (x) and south (z) of the city's
// origin. CommonJS so preprocess.cjs can require it; the .mjs tools import it as default.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const id = process.env.CITY || 'oslo';
const file = path.join(root, 'cities', id, 'city.json');
if (!fs.existsSync(file)) throw new Error(`No ${path.relative(root, file)}: copy cities/oslo/city.json and edit it (see README, "Your own city").`);
const city = JSON.parse(fs.readFileSync(file, 'utf8'));
const DATA = path.join(root, 'data', id) + path.sep;
fs.mkdirSync(DATA, { recursive: true });
const LAT0 = city.origin.lat, LON0 = city.origin.lon;
const KX = Math.cos((LAT0 * Math.PI) / 180) * 111320, KZ = 110540;

module.exports = {
  BOX: city.box,
  city,
  DATA,
  id,
  KX,
  KZ,
  LAT0,
  LON0,
  // lat/lon to game x/z, and back.
  project: (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KZ],
  root: root + path.sep,
  unproject: (x, z) => [LAT0 - z / KZ, LON0 + x / KX],
};
