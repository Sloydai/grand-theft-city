#!/bin/bash
# Shares a built city: zips the game files in data/<city>/ (not the raw downloads) and
# publishes them as this repo's GitHub release "<city>-data", replacing the zip if the release
# exists. Others then get it with tools/get-city-data.sh. Needs the GitHub CLI (gh auth login).
# Usage: bash tools/release-city-data.sh <city>
set -euo pipefail
cd "$(dirname "$0")/.."
city="${1:?usage: bash tools/release-city-data.sh <city>}"
name=$(node -e "process.stdout.write(require('./cities/$city/city.json').name)")
zip="$PWD/data/$city-data.zip"
rm -f "$zip"
files=()
for f in bikes.json bridge-heights.json streets.json surface.bin terrain.bin terrain.json world.json street-mesh; do
  if [ -e "data/$city/$f" ]; then files+=("$f"); fi
done
(cd "data/$city" && zip -qr -X "$zip" "${files[@]}")
# Release notes with the credits the sources require (see NOTICE.md).
credits=$(node -e "const c = require('./cities/$city/city.json'); const out = ['Map data © OpenStreetMap contributors, Open Database License (ODbL); this data is a derived database under the ODbL.'];
if (c.elevation === 'kartverket') out.push('Elevation © Kartverket, CC BY 4.0.');
if (c.elevation === 'global') out.push('Elevation: Terrain Tiles, Mapzen and data sources (https://github.com/tilezen/joerd/blob/master/docs/attribution.md).');
if (c.nvdb) out.push('Road data © Statens vegvesen (NVDB), NLOD 2.0.');
if (c.gbfs) out.push('City bikes from ' + c.gbfs + ' (see the operator\\'s licence).');
process.stdout.write(out.map((l) => '- ' + l).join('\\n'))")
notes="Built game data for $name (cities/$city/city.json). Get it with: bash tools/get-city-data.sh $city

$credits"
if gh release view "$city-data" >/dev/null 2>&1; then
  gh release upload "$city-data" "$zip" --clobber
else
  gh release create "$city-data" "$zip" --title "$name game data" --notes "$notes"
fi
rm "$zip"
echo "Published $city-data"
