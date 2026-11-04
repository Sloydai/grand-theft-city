# Technical notes

How the game and its city pipeline work, in detail (the development log of the Oslo build). Start
with the [README](../README.md).

# Grand Theft Oslo

A small GTA-style browser game set in central Oslo, built from real OpenStreetMap
data (buildings, streets, parks, the fjord) and three.js. Any other city can be built from
the same open data: see "Your own city".

## Controls

| Key | Action |
|---|---|
| WASD | Move / drive |
| Mouse | Look |
| Click | Shoot (on foot) |
| F | Enter, steal, or exit a car |
| Shift | Sprint / fire the Roadster's thrusters |
| G | Fly or land (Tesla Roadster) |
| Space / E, C / Q | Climb, descend (flying) |
| Space | Jump / handbrake |
| H | Horn |
| M | Mute |

## Tesla Roadster

You start beside the Tesla Roadster from its October 2026 reveal (`roadster.js`), modelled
on Tesla's launch photos: the faceted wedge with fender blades over a flat bonnet, a
bronze-tinted canopy, black five-spoke wheels, light bars across the nose and tail, the
RDSTR plate and a bronze swan-neck wing that rises at speed and tilts up as an air brake.
The SpaceX package has ten cold-gas thrusters: four nozzles across the tail above four
suction fans, four firing down at the corners and one each side. Shift fires the rear
nozzles (0-100 km/h in under a second). G takes off: the down jets hold the car at its height,
W/S thrust and brake, A/D turn with the body banking into the turn, Space and C climb and
sink. Every firing nozzle puffs vapour, and near the ground the down jets blow it out in a
ring. Walls taller than the car stop it; press G again to land on a street or a roof. You
can't get out in the air. A new Roadster waits at the spawn after you're wasted or busted.
Other Roadsters fill the sky (sky traffic in `game.js`): up to 470 over the centre (around
Domkirken), thinning to about 250 out of town. Each takes off from a kerb, follows the streets
at its own height (12-110 m) and speed (50-160 km/h), sways up and down, climbs over roofs in
its way, throws the odd loop, barrel roll, kickflip or flat spin, then lands at a clear kerb,
waits and takes off again. Cars are only added or removed parked and out of sight (outside the
view for 1.5 s, or past the fog), so on screen they always take off or land. Shot down, they
tumble to the ground or a roof. Each car is a light agent: past 160 m all of them are drawn
as one instanced crowd (body and wing, as a far Roadster looks anyway), and within 140 m an agent
borrows a full Roadster from a pool, with thrusters, vapour, and something to shoot. `node tools/sky-test.mjs` watches them headless with the camera sweeping round and
counts any car that appears or vanishes on screen.
`node tools/fly-test.mjs` (`GPU=1` for real speed) flies it headless and saves screenshots,
and `tools/roadster-preview.html` shows the model on its own.

## Sloyd models

Slottet, the Akershus walls and street props (lights, bus stops, benches, bins,
post boxes, bike racks, trees, fountains, flags) are generated
by Sloyd's own parametric engine (https://www.sloyd.ai). The finished GLBs are in `models/`.
New models can be made in Sloyd, or from text prompts through the Sloyd API with
`node tools/sloyd-generate.mjs` (keys in `.env`, see `.env.example`).

Trams and buses run the real Ruter routes from OpenStreetMap (`data/oslo/routes-raw.json`):
each vehicle follows its line's path, stops at the real stops, and shows its line and
terminus on the destination sign. Bus shelters stand at the real bus stops. Stretches of
a route that run through tunnels are cut out.

## City graphics

Everything is built from OpenStreetMap (`data/oslo/extra-raw.json` adds building parts and
ground cover):

- Buildings use their OSM 3D tags: real roof shapes (gabled, hipped, pyramidal,
  skillion…), building parts (Rådhus towers, the Domkirke spire, the Opera's slopes),
  heights and floor counts. Facades have one row of windows per real storey, shopfronts
  on the ground floor, a cornice, and darker walls near the ground (`buildings.js`).
  Landmarks are drawn from their parts in their real colours; churches and the Opera
  get masonry instead of apartment windows.
- The Oslofjord sits below quay level. A blurred sea mask gives each point its distance
  from the shore: clear turquoise water along the quays, deep blue further out, over a
  seabed 7 m down. Quay walls reach the bottom, two ripple layers drift in different
  directions, and a faint foam line runs along the quays. Wooden piers and bridges (Aker
  Brygge) are walkable.
- Road markings follow the OSM lane tags: lanes per direction, Norwegian yellow centre
  lines (dashed, or double solid on four-lane roads), white lane dashes running
  continuously along each street, red cycle lanes, stop lines at signalled junctions,
  turn arrows from `turn:lanes`, zebra crossings, and no paint where `lane_markings=no`.
- Lawns and flowerbeds grow swaying grass and flowers around the camera
  (`vegetation.js`); parks have shrubs; trees stand 9 to 15 m tall unless OSM gives
  their height.
- Colours and facade styles come from the OSM tags (building type, wall and roof
  material, colour) in central Oslo's tones: light stucco with zinc or slate roofs for
  older blocks, stone with ribbon windows or reflective glass for offices; checked
  against CC0 street photos from Wikimedia Commons.
- Every tree mapped in OSM (`data/oslo/trees-raw.json`, ~4,400, mostly lindens) stands where
  it really is, e.g. the linden rows along Karl Johans gate.
- Ground cover (grass, gardens, woods, flowerbeds, paving, plazas, pitches, parking)
  is drawn in its real shapes with procedural textures (`textures.js`).
- Gradient sky dome whose reflections light cars and water.

The trams (trikk) and Vy trains
(`railcars.js`: profile-extruded bodies, separate windows, doors, destination signs,
LED lamps, spinning wheelsets, pantograph and bellows), because no Sloyd generator fits
them; they run on the real OSM tram and rail tracks
(`data/oslo/rail-raw.json`), stop along the way and at Oslo S, and dip into a tunnel where the
mapped track ends.

After adding or removing a model in `models/`, update `models/manifest.json`.

`window.oslo` exposes game state for the headless tools (`tools/smoke.mjs`,
`tools/tour.mjs`, `tools/shot.mjs`).

## Traffic, people, day and night

- `traffic.js`: signal heads at every signalled junction approach and crossing in OSM
  (184 junction nodes, 355 crossings), with two-phase junction cycles and crossing
  cycles; AI traffic and buses stop at red. Stop lines sit at the signals. Norwegian
  signs: speed limits from `maxspeed`, crossings (516), give way, priority road,
  one-way and no entry.
- `person.js`: pedestrians and the player are skinned meshes (one draw call each) on a
  17-bone skeleton, with varied heights, builds, hair and outfits, and a procedural walk
  and run with knee and elbow bends.
- Day and night: a day lasts 20 minutes (T skips two hours). The sun crosses the sky,
  the sky goes from blue to dusk to night with stars, and at dusk street lamps, windows
  and shopfronts light up; the car you drive gets headlights.

## Vehicles

Every car, taxi, police car, van and bus is built in code by `cars.js` in one style:
a side profile with round wheel arches, a narrower glass greenhouse with a painted roof
and pillars, LED lamps, grille, mirrors, door seams, Norwegian EV plates, and separate
wheels (lathe-turned tyre with tread, dished ten-spoke rim, brake disc and caliper) that
roll with the speed while the front pair steers. Bodies taper towards the ends, and the
chassis rides on a spring: it dives under braking, squats under power and leans out of
corners. Sliding, locked wheels or the handbrake leave skid marks and tyre smoke. Police cars carry the blue-and-yellow checks, POLITI and a light bar; taxis a
TAXI roof sign. Body dimensions per kind are in `BODY_STYLES`.

## Files

- `game.js`: the whole game (city meshes, traffic, pedestrians, police, missions, HUD).
- `cars.js`: every road vehicle, with rolling and steering wheels.
- `traffic.js`: traffic lights and road signs from OSM.
- `person.js`: skinned, walking people.
- `railcars.js`: detailed trikk and train cars.
- `buildings.js`: roof shapes and facades from OSM tags.
- `textures.js`: procedural facade and ground textures.
- `vegetation.js`: swaying grass and flowers around the camera.
- `tools/views.mjs`: screenshots from fixed viewpoints (aerial, Aker Brygge, …).
- `sloyd.js`: loads the Sloyd GLBs, merges them per material, and rigs the humanoid (scaled from Sloyd's 3.4 m output to 1.75 m) for walking.
- `models/`: Sloyd-generated GLBs.
- `data/<id>/world.json`: preprocessed map in local meters (Oslo's origin is near Stortinget).
- `tools/preprocess.cjs`: rebuilds `world.json` from the raw Overpass downloads in `data/<id>/`.
- `tools/smoke.mjs`: headless Chrome smoke test that saves screenshots to `shots/`.

Map data © OpenStreetMap contributors, ODbL.

## Real facade colours

- `node tools/commons-photos.mjs` collects geotagged Wikimedia Commons photos of central Oslo (freely licensed).
- `node tools/photo-headings.mjs` adds each photo's camera heading from its EXIF data.
- `node tools/facade-colours.mjs` matches each photo to the building it faces and samples that building's sunlit wall colour into `data/oslo/facade-colours.json`.
- `node tools/preprocess.cjs` uses those colours for buildings without an OSM `building:colour`. The full set of sampled colours becomes the palette (`data.facades`) for every other plain building.
- `tools/showroom.html` shows every car model side by side.

## Street detail (from Oslo street-level photos)

- Sidewalks are light grey asphalt with 0.25 m granite kerbstones. Courtyards and other urban ground are asphalt too. Plazas and pedestrian streets stay paved.
- Each lane has a manhole cover every 40 m, and there is a gully grating along each kerb every 25 m.
- Trams have an overhead contact wire 5.6 m up. Every 30 m a span wire runs across the street to the facades.
- Buildings have projecting cornices (soffit, face and top). Classic buildings without shops get a granite plinth. Two in three classic shopfront buildings get canvas awnings.

## Scale, signs and crowds

- **Street furniture** (`street.js`) is built at true size. The bus shelter is 4.4 × 1.5 × 2.65 m and has a lit ad panel, a bench and a sign 512 stop post. The Posten post box is 1.2 m tall and the green street bin about 1 m. The Sloyd versions were out of proportion: the bin's footprint was 1.1 × 2.5 m.
- **People** (`person.js`): average heights are women 1.67 m and men 1.80 m. Joints sit at real heights (hip 0.90, knee 0.47, shoulder 1.42, wrist 0.84 m). Bodies have a lofted torso with male and female shapes, tapered limbs, and a face with nose, ears and eyes. Variation comes from hair styles, beards, hats, scarves and backpacks. `tools/people.html` lines them up against a 1.75 m bar.
- **Signs** (`traffic.js`) are 600 mm in town and 800 mm on main roads, each on a blank of its own shape, with clamps and a post cap. Plate types:
  - Oslo street name plates: white on navy, at the street corners.
  - Yellow direction signs, using OSM `destination` tags.
  - Sign 548 Gågate at pedestrian streets.
  - Sign 552 parking.
- **Crowds** come from footfall per walk node (people per hour, by way kind) and an hourly curve. Karl Johans gate is 4,500/h on weekdays (Thon Eiendom). On-screen people are capped at 140. `oslo.crowd()` returns the target head count at the player's position.

## Building accuracy and landmarks

- **Multipolygon buildings.** `node tools/fetch-building-relations.mjs` fetches the buildings and parts that OSM maps as relations: 162, many of them city blocks with courtyards. `preprocess.cjs` joins their member ways into rings, adds inner rings as courtyard holes, and drops building ways that only outline a relation. Before this, landmarks such as the Royal Palace, Nasjonalmuseet, Akershus slott, Norges Bank, Domus academica and Oslo konserthus were missing.
- **Height fixes.** Parts whose `height` is below `min_height` are treated as relative. Roof-only parts (spire stages) are drawn. Free-standing `building:part=roof` canopies are skipped.
- **Positions.** A top-down render matches the OSM tiles (`tools/views.mjs top`, compared against `shots/ref-tiles/`).
- **Landmarks** (`LANDMARK_COLOURS` in `game.js`):
  - City Hall: red brick, window strips and a clock on the east tower.
  - Cathedral: copper above 28 m.
  - Opera: a marble roof rising from the fjord, with its glass walls and stage tower kept.
  - Royal Palace: built from its real footprint.
  - Akershus, Nasjonalmuseet, Norges Bank and the university keep their own colours.
  - Landmarks get no shopfronts.
- **Materials.** Facades are PBR: matt render, glossy window glass reflecting the sky, and bump relief from the colour maps. The sky shader outputs sRGB so the horizon meets the fog without bands.
- **Vegetation and lamps.** Trees and shrubs (`vegetation.js`) have bark limbs and crowns of alpha-cut leaf cards with canopy normals. Street lights are slim post-top LED lanterns (`street.js`).

## Performance

`node tools/perf.mjs` measures frame times on the real GPU (Metal) at four spots. `PERF_SPLIT`, `PERF_PROFILE` (with `INCLUSIVE`, `ONLY`), `PERF_CALLS` and `PERF_COUNT` break the cost down.

On an M4 at 1600×900, the busy junction went from 24 ms average / 51 ms p95 / 94 ms worst to about 10 / 18–30 / 35 ms. What did it:

- **People.** 24 shared looks (building a body per spawn caused hitches), fewer segments, frustum culling. People beyond 35 m animate every other frame and cast no shadow. At most 90 on screen.
- **Cars.** One multi-material body mesh and one mesh per wheel, with trim, metal and lamps sharing materials through vertex colours. A coarse level of detail beyond 45 m. Resting cars stop updating their matrices. Cars are drawn within 220 m.
- **Shadows.** Detailed buildings, leaf-card trees and cars cast through cheap proxies on a separate layer that only the shadow pass sees (`SHADOW_LAYER`). Shadows redraw every other frame, with PCF filtering.
- **Scene graph.** Buildings come in 300 m tiles so the camera culls them. Static meshes have frozen matrices. Grass rebuilds in 2 ms slices. The explosion light is reused rather than added, since adding a light recompiles every shader. The lamp glow is hidden by day.
- **Adaptive resolution.** The render scale drops from 1.5 towards 0.75 while frames take over 18 ms, and rises again when there is headroom.

## Jernbanetorget, signs, barriers and kerbs

- **Kerbs.** The carriageway is at 0.10 m and sidewalks and islands sit 13 cm above it on granite kerbs. Before, the step was only 4 cm. `groundHeight(x, z)` (from a kerb mask) puts people, cars and props on the surface, and cars ease up and down kerbs.
- **Street detail.** `node tools/fetch-street-detail.mjs` fetches OSM barriers, bollards, artworks and named shops into `data/oslo/street-raw.json`. `street.js` builds:
  - steel bar fences and railings
  - stone walls with a coping
  - clipped hedges
  - black bollards with a reflective band, and granite blocks

  Barriers are meshed in 300 m tiles.
- **Shop signs** (`signage.js`). Every named shop and café gets a fascia on the facade it faces, at 4 m above the awnings. Known chains use their colours (7-Eleven, Narvesen, Deli de Luca, Rema 1000, Apotek 1, Vinmonopolet and others). Signs are packed 128 per atlas sheet and glow at night.
- **Tigeren** (`tiger.js`). Elena Engelsen's 4.5 m bronze tiger (2000) stands at its OSM point. It is built as a signed distance field turned into a seamless surface with marching cubes, and walks along the Østbanehallen facade as in the reference photo (`tools/tiger.html`).
- **Østbanehallen.** Cream render with round-arched windows (`archedTexture`), the green neon ØSTBANEHALLEN over the entrance, COMFORT HOTEL GRAND CENTRAL on the roof and the clock on the central pavilion.
- **People are pooled.** Removed pedestrians' models are reused, which stops spawn hitches and the bone-texture leak. Far people skip bone uploads on the frames they don't animate.

## Terrain, heights, stairs, sea and birds

- **Terrain.** `node tools/fetch-elevation-kartverket.mjs` downloads Kartverket's national laser elevation over the area (DTM and DOM, 1 m, © Kartverket, CC BY 4.0). `node tools/elevation.mjs` writes:
  - `data/oslo/terrain.bin`: the ground on a 4 m grid in game coordinates, ranging 0–37.5 m.
  - `data/oslo/building-heights.json`: per building, roof height = 90th percentile of DOM − DTM inside the footprint.

  `terrain.js` loads the grid (`heightAt`). `drape()` subdivides ground meshes and lays them on it, and `terrainMesh()` is the ground itself; the sea floor is pushed under the water. Buildings stand on the lowest ground under their footprint, and everything placed on the ground follows the hills: people, cars (pitched and rolled by the slope), props, signs, lights, wires, trams, the camera and shots. Bridges (`br`) run straight between their ends. Ground meshes come in 400 m tiles, culled by frustum and beyond 650 m.
- **Measured heights.** `preprocess.cjs` replaces OSM's estimated heights with the measured ones (1,567 buildings) and keeps roof shapes.
- **Facade detail.** Brick chimneys on older pitched roofs. Balconies (stone slab, iron railing) on about a quarter of older apartment blocks.
- **Stairs.** OSM steps with at least 30 cm of climb become granite flights (16 cm risers) with handrails.
- **Props off the roads.** Furniture, mapped trees and sleepers are never placed on the carriageway.
- **Waves.** Four directional swells (`WAVES`, `waveAt`) on a 400 m grid that follows the camera, with crests whitening, calmer by the quays and fading with distance. Shown only with sea in reach.
- **Harbour** (`boats.js`). Motor and sailing boats moored along the piers and at anchor, two passenger ferries on loops, red and green channel buoys. All instanced and riding the waves.
- **Birds** (`birds.js`). Pigeon flocks on the big squares and around the tiger, pecking and wandering. They burst into flight from the player or moving cars and land again. Gulls and pigeons circle overhead, flapping in the vertex shader.

## Bridges

- **Flags.** `preprocess.cjs` keeps `br` (bridge) and `ly` (layer) on roads and on paths/footways. Before, footbridges had no flag and were laid flat on the ground.
- **Deck profile** (`bridges.js`). Each deck meets the ground at both ends; the terrain model keeps the approach embankments. It rises to clear what is beneath: 4.6 m over roads and rails plus 2.5 m per extra layer, 1.6 m over water. Ramps are at most 25 %.
- **What follows the deck.** Road and path strips, kerbstones, lane markings and cycle lanes all use the deck profile (`line.height`). Before, the markings stayed on the ground below.
- **Structure.** Concrete slab edges and underside, concrete parapets on road bridges, steel railings on footbridges, piers every ~24 m where the deck stands over 2.5 m up.
- **Getting across.** `surfaceHeight(x, z, nearY)` returns the deck when something is at deck level and the ground when it passes underneath. Cars, the player and pedestrians use it, so they can drive and walk over bridges and pass under them. Being on a bridge over water is not swimming or sinking.

### Bridge and road detail

- **Measured decks.** The terrain model leaves bridges out, but the surface model has them. `tools/elevation-kartverket.mjs` samples each bridge's centre line every 2 m (the lowest of three points across it) into `data/oslo/bridge-heights.json`. `bridges.js` smooths the profile (rolling median, then mean), eases it into the ground over the last 6 m at each end, and uses it wherever it clears water. Otherwise it falls back to the clearance profile.
- **Structure.** Low stretches stand on embankment walls down to the ground. Higher spans are open, with a deep edge beam and T-shaped piers (columns and a cap across the deck) every ~24 m. Every bridge has expansion joints every 30 m. Road bridges have double-faced concrete parapets with a light coping, plus street lamps every 30 m, alternating sides; the lamps glow at deck height and have no collider. Footbridges have steel posts, a handrail and glass infill.
- **Gutters.** Two rows of granite setts line both edges of every carriageway, on bridges too.

## Sloyd models (API)

**Off by default (by choice):** the game's own lofted cars look cleaner than the AI bodies, so traffic uses them again. Add `?sloyd` to the URL to see the Sloyd bodies. The tools and models below stay for later.

- **Generating:** `node tools/sloyd-generate.mjs [jobs.json]` calls the Sloyd public API (`https://api.sloyd.ai/api`).
  - It sends text-to-3D (or image-to-3D with `"image"`), polls the job and saves `models/<name>.glb`, at most 4 jobs at a time.
  - It needs `SLOYD_CLIENT_ID` (the `sok_live_…` id shown in the API dashboard) and `SLOYD_CLIENT_SECRET` in `.env`, which is git-ignored.
  - Each job costs API credits.
- **Vehicles** (`tools/sloyd-cars.json` → `models/cars/{bus,police,sedan,sports,suv,taxi,van,wagon}.glb`, 60k triangles (80k for the bus), 2k PBR textures; prompts ask for photorealism with no text, logos or plates). Every road vehicle kind now has a Sloyd body. Models lying along x are turned lengthwise first.
  - **Lamps, plates and lettering (audit).** The lofted car's mapped lamps floated off the Sloyd bodies, so they are gone, replaced as follows:
    - **Lamps.** The AI's own lamps light up (`splitLamps()`): pale bright faces at the nose and red faces at the tail (dark reds included) are drawn unlit and brightened. Where no tail lights are found, two red bars are laid on the tail, each turned to follow its curve.
    - **Plates.** Number plates are flat quads on the bumper surface, front and back.
    - **Lettering.** The AI can't letter, so the police car is generated plain white and wears a canvas-drawn Battenburg band and POLITI (`policeLivery()`, hugging the body's side). The taxi carries a lit TAXI box.
  - **Even colour.** The model's own smooth normals are kept: recomputing them after the cuts shaded every triangle on its own, so bodies looked patchy. `evenTexture()` also takes out colour casts pixel by pixel: each pixel keeps its brightness while its colour ratios move 65 % towards the texture's median.
  - **Tail lights.** The AI's red tail lights are drawn solid bright red, lit at any hour. Bars are added only where it painted none.
    - **Paint-aware.** Lamps are judged against the car's own paint (the median colour of its sides). On a red car only red clearly brighter than the paint counts. Headlights must be brighter than the paint, so white cars don't light up. If "tail lights" cover over a quarter of the tail, they were paint after all: the red sports car had its whole bumper lit.
  - **Sharper bodies.** All seven were regenerated with 4k textures and 80k triangles. The prompts ask for crisp panel lines, symmetry, clean paint and no text, decals or plates. Body textures use 16× anisotropic filtering.
  - **Audit shots:** `tools/car-reference.html?kind=<kind>&view=front|rear3&sloyd=1&near=1`.
  - **Reference shots** (`tools/car-reference.html` → `models/refs/<kind>-{ahead,left,back,front}.jpg`). These show the game's own lofted cars, for multi-image-to-3D (`"images": {front, left, back}` in a job; `tools/sloyd-cars-ref.json`). A test sedan followed the lofted design closely but kept its plainness, so the text-prompt bodies stay.
  - **Glass.** The AI paints windows into the texture, so `splitGlass()` builds the glass from the band above the kind's belt line. It takes the faces there that aren't roof and whose texture is darker than the band's paint (70 % of its 85th-percentile brightness, so black cars still find their windows), and moves them into a separate see-through glass mesh. Cars get a seated driver on the left and sometimes a passenger.
  - **Bus.** The Sloyd bus came out broken, so buses keep the lofted body.
  - `loadSloydCars()` in `cars.js` scales each body to its kind's length and finds the axles where the tyres touch the ground.
  - It cuts the moulded-on wheels out (triangles inside each wheel disc on the outer side) and mounts the game's own spinning, steering wheels there.
  - AI models can face either way, so each body is turned so its nose is +z. The roof (its highest tenth) sits behind the middle, since a bonnet is longer than a boot. The taxi model came out backwards. `oslo.sloydCars` reports what was turned.
  - Sloyd bodies keep their own textured paint; wrecks darken it. Kinds without a model keep the lofted body.
  - `?nosloyd` turns them off, for comparing.

## Core rewrite, after Worldhood (prebuilt, one ground)

The game used to work out the street surfaces in the browser (triangulating polygons, laying them on a raw laser terrain), with many separate systems each following the ground on their own. It was slow, and the parts disagreed, which caused holes, spikes and sawtooth. Following Worldhood's engine (github.com/worldhood/worldhood, MIT), the core now works like this:

- **Drive terrain** (`tools/drive-terrain.mjs`, after Worldhood's `city-terrain.mjs`). It turns the 2 m Kartverket grid (`data/oslo/terrain-raw.bin`) into one smooth height field that everything stands on:
  - The land is smoothed (sigma 4 m). Sea cells keep their level and are not averaged in, so quays stay sharp.
  - Every ground-level carriageway gets its own profile: median-cleaned over ±15 m, Gaussian 6 m, and held under 12 % unless the street is really steeper (up to 20 %). The profile is laid across the street and blended over 6 m.
  - A light final smoothing follows.

  This replaces the 0.5 m focus grid, the street smoothing and the wall snapping.
- **Prebuilt street meshes** (`tools/street-meshes.mjs`, using `street-geometry.js`). Per 300 m tile, the carriageway, sidewalks, dropped kerbs, paths, setts, decks, zebras, kerb faces and gutters are triangulated and laid on the drive terrain at build time. Triangles are up to 6 m and split only where the ground bends more than 4 cm. They are written as Int16 centimetres to `data/oslo/street-mesh/` (about 76 MB in all). The game fetches each tile's file as it streams in and only decodes it. The streamer's `WAIT` lets a tile wait for its file while the others carry on.
- **Result** (`tools/perf.mjs`, M4): load 5.4 s (was 11–22 s), 9–10 ms a frame on average and under 17 ms at worst, heap about 1.2 GB.
- **Smooth street outlines** (`ribbon()` in `tools/streets.mjs`). Each street's carriageway and sidewalks are now one continuous ribbon. The line is densified to 3 m, each point is offset along the bisector of its two segments (lengthened round bends), and the widths are smoothed along the street: carriageway over ±6 m, walks the widest within ±3 m, then averaged. Bends come out round, and width changes are gradual instead of the notched, sawtooth edges that per-segment rectangles with square ends made on curves.
- **Street shaders, after Worldhood's ground and kerb shaders (MIT).** Street surfaces are drawn from world-space patterns rather than tiled pictures (`streetSurface()` in `game.js`, PBR roughness). Their detail fades to its mean colour as it shrinks towards a pixel, so nothing visibly repeats or sparkles:
  - Asphalt is dark with a slow tone drift and fine grain.
  - Sidewalks are granite slabs, 0.7 × 0.48 m (Worldhood's pavement grid) in running bond, each slab its own tone.
  - Paths and squares are 0.28 × 0.2 m pavers.
  - Kerbs are 1.25 m granite stones 17 cm wide. Their joints and per-stone tones come from a running `along` coordinate that `street-geometry.js` writes for every kerb vertex (`curbAlong` in the tile files), plus speckle, with faces a shade darker than tops.
- **E-scooter riders** (after Worldhood). About one walker in four rides a shared scooter along the walking network at 15–20 km/h, standing on its deck with both hands on the handlebar. Riders leave the scooter behind when scared or knocked down.
- **Fountains** come from OSM (`amenity=fountain` areas, `fountains` in `world.json`) at their mapped size, instead of three hand-placed 11 m ones (one of them stood on the street at Jernbanetorget, where there is none).
- **Stops come alive** (`manageStopCrowds()`, `serveStop()`).
  - **Waiting.** People wait at bus and tram stops within 140 m of the player, standing on the platform and facing the street. There are up to 6 per stop, depending on how many routes call there and the hour, and up to 28 in all.
  - **Boarding and alighting.** When a bus stops (front door on the right) or a tram stops (at the track beside the platform), those waiting walk to the door and board, and 0–2 riders get off.
- **Bus signs ride with the bus.** Destination signs and riders hang on the chassis, so they pitch and roll with the body instead of staying level while it moves on its suspension.
- **Bikes and scooters are solid** (`items` from `micromobility.js` in `poleGrid`). They stop people. A car going faster than 5 m/s knocks them over, through the same `knockOver()` as lamp posts, which now also handles single instanced meshes (`splitInstanced()` returns where each instance went). Knocked-over things no longer get the ground height added twice.
- **Rebuild order:** `tools/preprocess.cjs` → `tools/streets.mjs` → `tools/drive-terrain.mjs` → `tools/street-meshes.mjs`. The package is now ESM (`"type": "module"`), so preprocess is `.cjs`.

## Surveyed city (2 m laser grids)

- **Grids.** `tools/elevation-kartverket.mjs` writes the terrain (DTM) and the surface (DOM) on a 2 m grid (`data/oslo/terrain.bin`, `data/oslo/surface.bin`). `loadTerrain()` returns `heightAt` and `surfaceAt`.
- **Terrain tiles.** 400 m tiles, with a 2 m mesh within 300 m of the camera and 8 m beyond. Terraces, retaining walls and slopes are now resolved at 2 m.
- **Ground cover** (`ground.js`). Grass, woodland, sand, pitches, playgrounds, flowerbeds, paving and parking are painted onto the terrain by one material: two RGBA weight masks at 1 m per pixel blend the tiled textures, later layers covering earlier ones. This replaces the eight stacked, draped polygon layers, which fought on slopes. Roads, paths, kerbs and markings are still strips, draped at 2.5 m.
- **Surveyed buildings** (`surveyed()` in `buildings.js`). Every building without mapped 3D parts takes its shape from the surface model:
  - **Cleaning the scan** (`smoothRoof()`). The 2 m roof cells get a 3×3 median, then are flood-filled into roof faces (neighbours under 1.6 m apart). Each face that fits a plane within 0.6 m RMS becomes that plane, and faces sloping under 1:13 become level. So flat roofs come out flat, ramps straight and steps clean. Specks of under 6 cells (chimneys, trees over the eaves) join the bordering face nearest in height.
  - **Walls.** Walls are 2 m pieces at the roof height just inside them. They slope with a pitched roof and step where the roof face changes.
  - **Roof steps.** Steps of more than 2.5 m between cells get a facade with windows.
  - **Landmarks mapped in parts** (cathedral, City Hall) keep their part models.
- **Oslo S and the Opera** (`LANDMARK_PARTS` in `game.js`). Both are drawn from their OSM 3D parts, with a look chosen for each part. Surveying their whole outlines gave jagged results, because each overlaps other buildings (Østbanehallen sits inside the Oslo S outline) and overhanging towers.
  - **Oslo S:** the glass Jernbanetorget entrance under maroon gabled metal roofs, the glass hall behind it, the two hotel towers, and the platform canopies as mapped.
  - **Opera:** the marble roof sloping into the fjord and the glass foyer walls under it take their shape from the scan. The foyer is capped at its mapped height so the stage tower doesn't pull it up. The stage towers are windowless white aluminium, and the workshops are aluminium-clad.
- **Street surfaces** (`tools/streets.mjs` → `data/oslo/streets.json`, after Worldhood's method, MIT). Every ground-level centreline is buffered into a polygon with round joins and caps (Clipper, in integer centimetres, so unions never fail). Per 300 m tile, the layers are then dissolved in order, each subtracting what's already placed:
  1. **Carriageway**: the union of all roads, minus traffic islands.
  2. **Sidewalk**: each road side out to the facade where a building stands within 7 m (else 3.2 m on main roads, 2.6 m otherwise), plus mapped sidewalks and islands, minus carriageway, buildings and sea.
  3. **Dropped kerb**: the sidewalk within 1.5 m of a crossing.
  4. **Path**: footways and pedestrian streets not under the above.

  Junctions come out as one clean area, sidewalks wrap round corners, and nothing overlaps. The game draws each layer as one draped mesh per tile at its own height. Kerb edges come from the sidewalk outlines, classed by what lies just outside them (carriageway, dropped kerb or other ground). Each edge gets a granite face, and along the carriageway also a granite top band, two rows of gutter setts and a soft shadow. Bridge decks keep their strips. Rebuild with `node tools/streets.mjs` after `tools/preprocess.cjs`, `tools/fetch-nvdb.mjs` and `tools/fetch-focus.mjs` (about 15 s).
- **NVDB street detail** (`tools/fetch-nvdb.mjs`, Statens vegvesen, NLOD 2.0). These layers are fetched for the map box, and `tools/streets.mjs` uses them where mapped:
  - **Kerb lines** (9,174). They set each side of the carriageway: three probes per segment against kerbs running alongside. So sidewalks start at the real kerb, not at an estimated road width.
  - **Crossing outlines** (2,850). They give zebra bars (0.5 m every 1 m, across the outline) and the dropped kerbs at their ends. OSM crossings are only used where NVDB has none.
  - **Lowered-kerb points** (10,265). They give driveway drops.
  - **Painted lines** (3,310). Edge, divider, warning, barrier and lane lines are drawn in the Norwegian dash patterns and colours. Streets they cover get no generated lane lines.
- **Focus area: Oslo S, Bjørvika, the Opera, Sørenga and the Akershus quays** (`focus` in `cities/oslo/city.json`):
  - **Terrain** (`tools/elevation-focus.mjs`). Kartverket's DTM is sampled at 0.5 m there (2 m elsewhere), blended over 10 m at the edge. The ground mesh is 1 m and streets drape at 1 m, so steps, terraces and quay edges keep their shape.
  - **Full OSM** (`tools/fetch-focus.mjs`). Carriageway and island areas (`area:highway`), squares and pedestrian areas by surface (paving, setts or wood), and `barrier=kerb` lines (as extra kerbs) all feed `tools/streets.mjs`.
- **Stairs.** Heights come from the terrain just beyond each end. The count comes from `step_count`, else risers of ~16 cm, and the direction from `incline` on flat ground. Area steps (closed ways, such as the steps up to Oslo S) get a climb direction fitted to the terrain inside and are cut into level granite treads. Handrails go on flights narrower than 6 m.
- **Smooth streets in the focus area.** `tools/elevation-focus.mjs` (run after `tools/streets.mjs`) smooths the 0.5 m terrain under carriageways, sidewalks and paths (Gaussian, sigma 1 m, street cells only), so the laser model's centimetre noise no longer pokes through the road or bounces the cars. Steps, walls and quays keep their shape. The street drape tolerance is 1.5 cm, checked at three points per edge.
- **Clean ground in the focus area.** A 5 × 5 median (2.5 m) over the whole 0.5 m grid clears the laser model's specks and bumps (where it was interpolated under cars, kiosks and crowds) but keeps the edges of steps, terraces and quays. Streets are then smoothed further. Retaining walls smooth their foot and coping separately over ±3 m, so copings run level.
- **Walls as clean steps.** The laser model smears every wall that holds up ground into a slope. Two fixes, applied to retaining walls and to plain walls with 0.5 m or more of step across them:
  - **Terrain data** (`tools/elevation-focus.mjs`). Within 3.5 m on the low side the ground is set to the lower level, and within 2 m on the high side to the upper. Each cell follows the nearest segment of its wall.
  - **Terrain mesh** (`snap` in `terrainTiles`). Grid vertices within 0.8 m of such a wall move onto its nearer face and take the height from 0.8 m out on their own side. So the step falls inside the wall instead of zigzagging across the 1 m grid.

  A bilateral filter (1.5 m, 25 cm) then evens out broad bumps on open ground. Bare urban ground uses a calm worn-concrete texture instead of coarse asphalt.
- **No holes in the streets.**
  - The city's 2 m terrain is smoothed under every street (`tools/smooth-terrain.mjs`: 3 × 3 median, then a 2 m Gaussian over street cells, always from `terrain-raw.bin`), so roads follow the hills without bumps.
  - The adaptive drape now also checks each triangle's centre and keeps edges under 2 × maxEdge, so convex ground can't rise through a big flat triangle.
  - The ground mesh is pushed back in depth (polygon offset +1/+4).
  - The camera's near plane is 0.4 m (it was 0.2), which halves depth error at a distance.
- **Tram rails** are drawn as grooved rails set in the street: a narrow, dull steel head beside a dark groove, on a bed barely darker than the asphalt. The bright full-width lines used before read as road markings.
- **No duplicate paint.** OSM zebra bars are skipped within 3 m of an NVDB crossing outline (`streets.json` carries the outlines). NVDB lines lying mostly within 30 cm of one already drawn are skipped, and generated cycle-lane edge lines are skipped on streets NVDB marks. The transparent kerb-shadow band is gone (overlapping at corners, it made dark smears), and the gutter setts are toned down.
- **Not from Google.** Google Maps and Street View imagery isn't scraped or traced (their terms forbid it). Kerbs come from NVDB's surveyed kerb lines and OSM.
- **Depth bias.** Street surfaces use a small polygon offset (-4 units; gutters, kerb shadow and paint -8 to -10), just enough to beat the terrain they lie on. The old -40 let gutters and shadows under raised sidewalks and platforms show through them.
- **Ground blending.** The 2 m ground-cover masks are sharpened in the shader (smoothstep 0.3–0.7), so grass, paving and asphalt meet in a narrow seam instead of smearing over metres.
- **Barrier collisions.** Fences, railings, walls, retaining walls and hedges block people and vehicles (`barrierGrid` in `collideCircle()`, half each barrier's thickness).
- **City bikes and e-scooters** (`micromobility.js`, after Worldhood, MIT).
  - **Bike stations.** All 267 Oslo Bysykkel stations come from the open GBFS feed (`tools/fetch-gbfs.mjs`, NLOD). Each gets a row of grey dock posts along its mapped dock area (solid), with as many blue city bikes as were docked when the feed was read.
  - **E-scooters.** Clusters of 2–5 in Voi, Dott, Ryde and Bolt colours (no branding) lean on their kickstands on the sidewalk near about half of the stops and bike stations. These spots are interpreted: no operator publishes parking positions.
- **Fences.** Every fence, railing, wall and hedge stands on the ground smoothed over ±2 m, so tops run straight. Posts are spaced evenly along the whole barrier. Bar textures use a lower alpha cut and anisotropic filtering, so distant railings keep their bars instead of turning into thin mesh.
- **Walls and retaining walls** follow the ground in 1 m pieces. Retaining walls run from the lower ground to just above the higher side instead of standing 1 m tall on one level.
- **Drape tolerance.** `drape()` takes a tolerance (after Worldhood): long edges split only where the ground bends more than 3 cm, so flat streets keep big triangles.
- **Worn asphalt.** A shader adds tone variation over ~9 m, darker resurfaced bays with seams, and grain that fades with distance.
- **Junction clipping** (`roadIndex`). Lane markings and cycle lanes stop on crossing carriageways. Zebra bars are drawn only on the carriageway.
- **Bus riders.** Each bus carries seated riders (2 + 2 rows, the right-hand doorways clear) and a driver on the left. They are one merged mesh of torsos, heads and hair in varied colours, seen through clearer bus glass (`addPassengers()`).
- **Stops** (`data.stops`, `buildStops()`). Every bus and tram platform of the routes comes from OSM: 382 in the map, 119 of them tram. Each is drawn at its mapped outline as a raised platform with granite kerbs and a pale tactile edge. A shelter stands where OSM says there is one (`shelter=yes`), its open side to the street. At the end nearest the street is a Ruter stop sign: the mode square (bus red, tram blue), the stop's name and its routes, all drawn into one atlas texture. Routes and stops now cover the whole map box rather than the old centre area.
- **Sidewalk look.** Sidewalks are pale concrete slabs on light granite kerbs 15 cm high, with a soft shadow band at the kerb's foot, so the walk reads clearly against the dark carriageway.
- This follows the same approach as voxel city models built from Kartverket's public data. It uses the source data directly rather than copying any third party's processed model.

## The larger map (Majorstuen to Tøyen, Sagene to the fjord islands)

- **Area.** Set in `cities/oslo/city.json` (`box`): lat 59.885–59.942, lon 10.700–10.790, about 5 × 6.3 km. It takes in Majorstuen, Sagene, Grünerløkka, Tøyen, Bjørvika and Ekeberg's slopes, and Hovedøya and Lindøya. All fetch tools read the box:
  - `tools/fetch-osm.mjs` covers buildings, roads, ground cover, rail, routes, signals, trees and coastline, trying several Overpass servers.
  - `fetch-building-relations.mjs` and `fetch-street-detail.mjs`.
  - `fetch-elevation-kartverket.mjs` fetches Kartverket WCS tiles of at most 2 km.
- **Rebuild:** `bash tools/build-city.sh oslo` runs every step in order (see "Your own city").
- **Streaming** (`streaming.js`). The city is cut into 300 m tiles. Road, path, kerb, marking and rail strips, detailed buildings and the 2 m terrain are built only for tiles within 600 m of the camera:
  - at most 5 ms per frame, nearest tiles first;
  - building tiles a dozen buildings at a time;
  - each tile gets only the pieces of the lines that cross it;
  - tiles are freed past 850 m.

  Until a tile loads, and out to the end of the fog, the city shows plain coloured blocks (which also cast the shadows and stop bullets) over the coarse 8 m terrain.
- **Frame cost.**
  - `drape()` splits triangles in one flat number pool instead of an array per vertex. That cut load from about 22 s to 17–18 s, and with it the streaming hitches.
  - Plain-coloured strips (markings, stop lines, rails, track beds) share one vertex-coloured mesh per tile.
  - Streamed layers can be `near`-limited: kerb faces, kerbstones, kerb shadows, gutters, dropped kerbs and markings show only within 250–350 m.
  - Cars beyond 90 m draw only their coarse body, and cars beyond 220 m leave the scene graph.
  - Together these cut draw calls at the junction test spot from about 1,100 to about 830. `PERF_CPU=1 node tools/perf.mjs` splits the frame into update and render time.
- **Citywide instances** (manholes, gullies, fence posts, bollards, signal and sign posts and faces) are split into 400 m chunks by `splitInstanced()` and hidden by distance.
- **Spawn.** Every start and every respawn (wasted or busted) is at the Jernbanetorget stop by the tiger, facing it.
