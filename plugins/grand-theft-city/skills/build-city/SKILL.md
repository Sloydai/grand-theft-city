---
name: build-city
description: Builds the Grand Theft City browser game (a GTA-style open world with traffic, police, missions and a flying car) for any real city from OpenStreetMap, under a name the user chooses, and runs it locally. Use when the user wants to make, rename or port the game to a city, change its map, or make their own city game.
license: MIT
compatibility: Needs git, Node.js 20+, bash (macOS or Linux; Windows through WSL) and internet access (Overpass, Nominatim, terrain tiles). Packaging zips needs macOS.
metadata:
  repository: https://github.com/Sloydai/grand-theft-city
  version: "1.0.0"
---

# Build a city game

The game lives in the Grand Theft City repository. One JSON file per city
(`cities/<id>/city.json`) says where the map is and what the game is called;
`tools/build-city.sh <id>` downloads the open data and builds the map into `data/<id>/`;
the game then runs at `http://localhost:8777/?city=<id>`. The repository's README section
"Your own city" describes every field; this skill is the procedure.

## 1. Get the repository

If the working directory has no `tools/build-city.sh`, clone it and install:

```sh
git clone https://github.com/Sloydai/grand-theft-city.git
cd grand-theft-city
npm install
```

Check `node --version` is 20 or newer.

## 2. Ask what to build

Ask only for what the user hasn't said:

- **City** (and country, if the name is ambiguous).
- **Game name** (`title`): default "Grand Theft <City>". Its last word is drawn in colour.
- **Area**: default about 5 × 5 km round the city centre. Larger areas take much longer to
  download and need more memory; above 8 × 8 km, warn and suggest less.

Pick an `<id>`: the city name in lower case ASCII with dashes (`sao-paulo`, `hanoi`).

## 3. Find the coordinates

Look the city up on Nominatim (fair use: one request, with a User-Agent):

```sh
curl -s -A "grand-theft-city-skill" "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=<city>,<country>"
```

Use its `lat`/`lon` as the centre. If the user named a district or landmark instead, look that
up. For a W × H km area:

- half height in degrees of latitude: `H / 2 / 110.54`
- half width in degrees of longitude: `W / 2 / (111.32 × cos(lat))`

Round box edges to 4 decimals.

## 4. Write `cities/<id>/city.json`

Start from `cities/oslo/city.json`. Set:

- `name`: the city's usual name. `title`: the game name, if not the default.
- `box`: `minLat`, `minLon`, `maxLat`, `maxLon` from step 3.
- `origin` and `centre`: the centre point.
- `elevation`: `"kartverket"` only inside Norway; everywhere else `"global"` (or `"flat"` if
  the user wants no terrain).
- `elevationBase`: leave out for cities by the sea. For an inland city whose ground is above
  about 250 m, set `"min"`. (Heights are stored within ±327 m of the base.)
- `nvdb`: `true` only in Norway; otherwise leave out.
- Remove Oslo's `spawn`, `station` and `focus` unless you set them for this city:
  - `spawn` (optional): a well-known square or station forecourt near the centre, with `face`
    pointing at a landmark. Without it the player starts at the centre.
  - `station` (optional): the main railway station, where trains stop.
  - `focus` (optional): a box of 1 to 2 km in the centre for extra detail (stairs, quays).
    Leave it out on a first build: it is the heaviest download.
- `gbfs` (optional, city bikes): find the city in
  https://github.com/MobilityData/gbfs/blob/master/systems.csv, open its `gbfs.json`, take the
  `station_information` feed URL and set `gbfs` to it without the trailing
  `/station_information.json`. Leave out if the city has none.

Validate before building: the box must contain `origin`; the JSON must parse
(`node -e "require('./cities/<id>/city.json')"`).

## 5. Build

```sh
bash tools/build-city.sh <id>
```

The first build takes 10 to 30 minutes, mostly waiting on the public Overpass servers; run it in
the background and tell the user. The fetch tools retry busy servers. If a step fails:

- Overpass errors or timeouts after the retries: wait a few minutes, then rerun the same
  command. Downloads already done are reused only with `--skip-download`, which skips all
  downloads, so use it only when every fetch step had finished.
- Out of memory or very slow processing: make the box smaller (step 3) and rebuild.
- Elevation warning about the ±327 m range: set `elevationBase` (step 4) and rerun with
  `--skip-download`.

Don't loop the build against Overpass: it is a shared public service.

## 6. Run and check

```sh
node tools/serve.mjs 8777
```

Open `http://localhost:8777/?city=<id>`. The start screen shows the game name; after
"Ready." click to play. Check that the player starts on a street, that streets, buildings and
traffic appear, and that the browser console has no errors. Common fixes:

- Starting point inside a block or far from streets: set `spawn` to a nearby square and rerun
  `bash tools/build-city.sh <id> --skip-download`.
- Everything under water or floating: wrong `elevationBase` (see step 4).

Controls to tell the user: WASD drive or walk, F get in or out of a car, Shift boost (in the
Roadster), G fly or land, Space/C climb or descend, mouse to look.

## 7. Share it (optional)

- Playable zips (macOS): `CITY=<id> bash tools/package.sh` writes `dist/<Title>.zip`
  (offline, with launchers) and `dist/<Title>-web.zip` (itch.io). The launchers' README and
  credits in `dist-template/` are written for Oslo: update them for the new city.
- Built data for others: `bash tools/release-city-data.sh <id>` publishes it as a GitHub
  release of the user's own fork (needs the GitHub CLI); others fetch it with
  `bash tools/get-city-data.sh <id>`.

## 8. Credits

Whatever is shared must credit its sources: "Map data © OpenStreetMap contributors (ODbL)"
always; the elevation source (Kartverket, CC BY 4.0; or "Terrain Tiles: Mapzen and data
sources", https://github.com/tilezen/joerd/blob/master/docs/attribution.md); NVDB (NLOD 2.0) in
Norway; and the bike feed's licence. The repository's `NOTICE.md` lists the code licences.
