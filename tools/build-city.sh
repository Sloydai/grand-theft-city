#!/bin/bash
# Builds a city's game data in data/<city>/ from cities/<city>/city.json: the downloads (OSM
# from Overpass, elevation, and the city's optional extras), then every processing step.
# A first build takes 10-30 minutes, mostly Overpass. Usage:
#   bash tools/build-city.sh <city>                   download and build
#   bash tools/build-city.sh <city> --skip-download   rebuild from the downloads already there
set -euo pipefail
cd "$(dirname "$0")/.."
export CITY="${1:?usage: bash tools/build-city.sh <city> [--skip-download]}"
config="cities/$CITY/city.json"
[ -f "$config" ] || { echo "No $config: copy cities/oslo/city.json and edit it (see README, \"Your own city\")."; exit 1; }
# A setting from the config, empty when missing or false.
setting() { node -e "const v = require('./$config')['$1']; process.stdout.write(v === undefined || v === null || v === false ? '' : String(v))"; }
elevation=$(setting elevation)
step() { echo; echo "== $*"; "$@"; }

if [ "${2:-}" != "--skip-download" ]; then
  step node tools/fetch-osm.mjs
  step node tools/fetch-building-relations.mjs
  step node tools/fetch-street-detail.mjs
  step node tools/fetch-focus.mjs
  step node tools/fetch-gbfs.mjs
  if [ -n "$(setting nvdb)" ]; then step node tools/fetch-nvdb.mjs; fi
  if [ "$elevation" = kartverket ]; then step node tools/fetch-elevation-kartverket.mjs; fi
fi
step node tools/preprocess.cjs
if [ "$elevation" = kartverket ]; then
  step node tools/elevation-kartverket.mjs
  # Again, now with the measured building heights.
  step node tools/preprocess.cjs
else
  step node tools/elevation-global.mjs
fi
# drive-terrain.mjs keeps the unsmoothed grid as terrain-raw.bin: start from the new one.
rm -f "data/$CITY/terrain-raw.bin"
step node tools/drive-terrain.mjs
step node tools/streets.mjs
step node tools/street-meshes.mjs
echo
echo "Done. Run: node tools/serve.mjs 8777, then open http://localhost:8777/?city=$CITY"
