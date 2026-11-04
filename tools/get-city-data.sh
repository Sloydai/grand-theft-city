#!/bin/bash
# Downloads a ready-built city's game data (default oslo) from the GitHub release "<city>-data"
# into data/<city>/, to play it without building it. Looks in REPO (owner/name; default this
# clone's GitHub origin), then in the main repository.
# Usage: bash tools/get-city-data.sh [city]
set -euo pipefail
cd "$(dirname "$0")/.."
city="${1:-oslo}"
upstream="Sloydai/grand-theft-city"
origin=$(git remote get-url origin 2>/dev/null | sed -nE 's#.*github\.com[:/]([^/]+/[^/.]+)(\.git)?$#\1#p')
mkdir -p "data/$city"
zip="data/$city-data.zip"
for repo in ${REPO:-$origin} "$upstream"; do
  [ -n "$repo" ] || continue
  if curl -fsSL -o "$zip" "https://github.com/$repo/releases/download/$city-data/$city-data.zip"; then
    unzip -q -o "$zip" -d "data/$city"
    rm "$zip"
    echo "Done (from $repo). Run: node tools/serve.mjs 8777, then open http://localhost:8777/?city=$city"
    exit 0
  fi
done
rm -f "$zip"
echo "No $city-data release found. Build the city instead: bash tools/build-city.sh $city"
exit 1
