// City-bike stations from the city's open GBFS feed (the "gbfs" base URL in its config, e.g.
// Oslo Bysykkel / Urban Sharing, NLOD): name, dock area, capacity and the bikes docked when
// fetched. Writes data/<city>/bikes.json: [{ n, cap, bikes, area: [[x, z], ...] | null, x, z }].
// Feeds for other cities: https://github.com/MobilityData/gbfs/blob/master/systems.csv
import fs from 'node:fs';
import CITY from './city.cjs';

if (!CITY.city.gbfs) { console.log('gbfs: no feed in the city config, skipped'); process.exit(0); }
const project = (lat, lon) => CITY.project(lat, lon).map((v) => Math.round(v * 100) / 100);
const headers = { 'Client-Identifier': 'grand-theft-city' };
const get = async (feed) => (await (await fetch(`${CITY.city.gbfs}/${feed}.json`, { headers })).json()).data.stations;
const [info, status] = await Promise.all([get('station_information'), get('station_status')]);
const bikes = new Map(status.map((s) => [s.station_id, s.num_bikes_available ?? 0]));
const stations = info.map((s) => {
  const ring = s.station_area?.coordinates?.[0]?.[0];
  const [x, z] = project(s.lat, s.lon);
  return { area: ring ? ring.slice(0, -1).map(([lon, lat]) => project(lat, lon)) : null, bikes: bikes.get(s.station_id) || 0, cap: s.capacity || 10, n: s.name, x, z };
});
fs.writeFileSync(`${CITY.DATA}bikes.json`, JSON.stringify(stations));
console.log(`gbfs: ${stations.length} stations, ${stations.reduce((a, s) => a + s.bikes, 0)} bikes docked`);
