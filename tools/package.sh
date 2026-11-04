#!/bin/bash
# Builds the shared versions of the game for one built city (default oslo) in dist/, named
# after its title (default GrandTheft<Name>):
# - GrandTheft<Name>.zip: download to play offline; launchers, README and credits from
#   dist-template/, the game in game/.
# - GrandTheft<Name>-web.zip: for itch.io's HTML5 upload (index.html at the root, under its
#   1,000 files / 500 MB / 200 MB-a-file limits).
# Both hold only the files the game loads (no raw data, photos or build tools), with the
# car textures at most 2048 px, and open that city (index.html's default-city).
# (dist-template/ is written for Oslo: edit its README and credits for another city.)
# Usage: CITY=<id> bash tools/package.sh
set -euo pipefail
cd "$(dirname "$0")/.."
city="${CITY:-oslo}"
name="$(node -e "const c = require('./cities/$city/city.json'); process.stdout.write((c.title || 'Grand Theft ' + c.name).replace(/[^A-Za-z0-9]/g, ''))")"
out="dist/$name"
web="dist/$name-web"
game="$out/game"
rm -rf "$out" "$web" "dist/$name.zip" "dist/$name-web.zip"
mkdir -p "$game/tools" "$game/data" "$game/models/cars" "$game/node_modules/three/build"
cp index.html ./*.js "$game/"
mkdir -p "$game/data/$city"
for f in bikes.json bridge-heights.json streets.json surface.bin terrain.bin terrain.json world.json; do
  if [ -f "data/$city/$f" ]; then cp "data/$city/$f" "$game/data/$city/"; fi
done
cp -R "data/$city/street-mesh" "$game/data/$city/"
sed -i '' "s|<meta name=\"default-city\" content=\"[^\"]*\"|<meta name=\"default-city\" content=\"$city\"|" "$game/index.html"
cp models/manifest.json models/*.glb "$game/models/"
# The Sloyd car bodies cars.js loads (the bus stays lofted).
cp models/cars/{police,sedan,sports,suv,taxi,van,wagon}.glb "$game/models/cars/"
node tools/shrink-glb.mjs 2048 "$game"/models/cars/*.glb
cp node_modules/three/LICENSE "$game/node_modules/three/"
cp node_modules/three/build/three.module.js "$game/node_modules/three/build/"
# The three.js addons the game imports, and what they import.
for addon in geometries/RoundedBoxGeometry.js loaders/GLTFLoader.js objects/MarchingCubes.js utils/BufferGeometryUtils.js; do
  mkdir -p "$game/node_modules/three/examples/jsm/$(dirname "$addon")"
  cp "node_modules/three/examples/jsm/$addon" "$game/node_modules/three/examples/jsm/$addon"
done

# Web: the game alone, plus the credits.
mkdir -p "$web"
cp -R "$game"/. "$web/"
cp dist-template/CREDITS.txt "$web/"
rmdir "$web/tools"

# Download: launchers and their servers around the game.
cp dist-template/* "$out/"
chmod +x "$out/Start Game (Mac).command"
cp tools/serve.mjs tools/serve.ps1 "$game/tools/"

(cd dist && zip -qr -X "$name.zip" "$name" -x '*.DS_Store')
(cd "$web" && zip -qr -X "../$name-web.zip" . -x '*.DS_Store')
echo "web files: $(find "$web" -type f | wc -l | tr -d ' ')"
du -sh "$out" "$web" "dist/$name.zip" "dist/$name-web.zip"
