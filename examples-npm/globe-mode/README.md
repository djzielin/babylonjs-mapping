# Globe fidelity explorer

Orbit the Earth, fly to a city or ocean trench, and zoom to detailed geometry.

## Run the current PR

For automatic Mapbox setup, put a public token in the ignored `mapbox-key.txt` beside this README, or set `MAPBOX_PUBLIC_TOKEN` when building. The build includes it in the browser demo and pre-fills the token field. Rebuild after rotating the key.

From the repository root:

```sh
npm ci
npm run build
npm pack --pack-destination /tmp
cd examples-npm/globe-mode
npm install /tmp/babylonjs-mapping-1.1.44.tgz --no-save --no-package-lock
npm start
```

`npm run build` in this directory creates the production `dist/` demo. CI builds this demo from the packed current library, not an older npm release.

## Explore

The **New York Harbor · traffic feeds** destination pairs with **NYC traffic, aircraft & ships** under More options. Start the [focused traffic demo server](../../examples-local/live-traffic/README.md) on port 4173 and enable the checkbox. Globe mode reads its `/api/traffic` endpoint every minute, placing road speed links on the surface, aircraft above it, and ships near sea level. The API URL field can point to another server. The server supplies NYC DOT and OpenSky data without a key; AISStream vessels require `AISSTREAM_API_KEY`. The overlay stays off until enabled.

Use **Map / Satellite** at the top of the panel to switch imagery across the entire globe, including all distance tiers. Satellite uses the Mapbox public token in More options; choosing it without a token opens and focuses that field. Terrain and buildings stay enabled while imagery changes.

Type an address or place in the search box (at least three characters), then click a suggestion or use arrow keys and Enter. Escape closes suggestions. Selecting a result stops the tour and returns to globe navigation before flying there. Search uses [Photon’s public autocomplete service](https://github.com/komoot/photon), based on OpenStreetMap, with a 450 ms debounce, cancellation, timeout and a bounded session cache. Typed queries are sent to Photon; coverage and availability depend on the provider. For substantial traffic, host a Photon instance and change the endpoint in `src/AddressSearch.ts`.

- **Manhattan**: Overture footprints and height extrusions. The demo requests footprint tiles at zooms 10–14, using simplified source geometry for distant buildings.
- **Grand Canyon / Everest**: numeric land elevations, terrain lighting, optional 1–10× relief, and oblique inspection.
- **Mariana Trench / Monterey Canyon**: negative numeric ocean elevations. Select GEBCO for bathymetric colour imagery. The geometry comes from Mapzen/Tilezen's numeric terrain grid, not image luminance. This is not a claim that the streamed DEM is the latest GEBCO grid.
- **Fiji**: longitude seam navigation. Arbitrary latitude/longitude targeting and double-click fly-to are also available.
- **Guided tour** visits the presets every 12 seconds; the same button stops it.
- **More options → Import GeoJSON** accepts geographically positioned GeoJSON FeatureCollections. Polygon holes, roof properties, multipolygons, points, LineStrings and MultiLineStrings reuse the feature pipeline. Import after navigating to the feature's location; user features are tile-owned and expire when that tile is recycled.
- A Mapbox public token enables satellite imagery, road geometry, and landmark model tiles. Landmarks are enabled by default once a token is entered and follow any location at zoom 14+, including search results and manual navigation. They begin in startup stage four and then load independently of the footprint job queue. Model availability varies by location, with Overture extrusions providing ordinary buildings where bespoke models are absent. Manually entered tokens remain in the input for the current page session; configured demo tokens are included in the browser build. Tokens are sent to the selected Mapbox services. The default DEM, OSM raster and Overture building path needs no token.

Reload retries elevation failures and regenerates features. Provider availability, CORS, native resolution, missing heights, and source coverage still apply. At the Mercator poles the backing cap is a fill surface, not polar raster/elevation coverage.

## Performance

Google mode starts through four barriers:

1. Load elevation for the 25-tile detail patch and the regional terrain window. Other terrain tiers, Overture, roads and landmarks wait.
2. Load Google 3D baseline coverage throughout the 15-mile radius, accepting up to 256 m geometric error before spending requests on fine detail. This first pass favors coverage speed over image fidelity.
3. Load high-detail Google geometry within 300 m, covering the immediate blocks while retaining the outer baseline.
4. Stream Overture and further Google refinement together. Overture favors the 750 m–8 km band; Google favors nearby detail. Jobs follow the current camera and preserve useful resident models during movement.

Each startup generation owns its cancellation signal. An obsolete download cannot release the next view's barriers. Google passes report coverage and detail completeness separately; failed or missing Google coverage releases fallback building work without reporting a successful Google barrier. Terrain continues retrying transient errors. Source availability and download failures can still delay progress.

At street zoom in Google mode, the regional window uses 18 × 18 zoom-13 meshes with 16 subdivisions. Four neighboring meshes share one zoom-12 DEM download and decoded grid, reducing the 324 tile elevation jobs to approximately 81–100 distinct source requests, depending on tile alignment. The regional DEM cache holds 128 source tiles; the separate detail/intermediate cache holds 256. This keeps the regional mesh spacing unchanged while avoiding duplicate downloads and decoding. The regional tier permits eight elevation jobs and the close patch four. Satellite/raster imagery does not block any startup barrier: only two close and two regional raster requests run during terrain startup, and new raster requests pause during the Google coverage/detail barriers.

Overture and road tile jobs share an eight-request admission window across all globe tiers. Admission recomputes camera distance and visibility, so one tier cannot flood every provider queue. Fine Overture geometry replaces coarse footprints only after the matching geometry is ready. Google baseline meshes render below Overture; detailed Google meshes replace overlapping footprints. Feature creation shares a 1 ms scene budget per frame, with a 32-feature close-patch cap and 64-feature distance-tier caps; one atomic feature can exceed that budget.

Five overlapping distance tiers use zooms 8, 13, 14, 16 and 17 at Google zoom 18. Their terrain geometry stays below 800,000 vertices, plus the close patch. Distance-tier geometry creation has a 0.5 ms budget per tier; close-patch creation has a 4 ms budget. The close patch uses 16 subdivisions at global zooms and 64 for terrain views. Retained tiles keep their geometry, DEM and in-flight imagery. Geometry is projected when it loads, rather than every frame; local mesh origins and high-precision matrices preserve fine detail. Shared `MapLayerRenderer` reserves finer coverage with the stencil buffer while all tiers use one depth buffer.

The Tokyo preset starts at zoom 16 in central Tokyo, 600 m above the terrain and tilted toward Fuji (heading 249.5°). Numeric terrain near the summit was verified against the live source at about 3,744 m. This does not replace browser validation: final appearance, transition quality and frame rate remain unverified in this environment.

The HUD reports the active startup stage, actual browser FPS, active meshes, vertices and job counts. Inspect `document.getElementById("renderCanvas").dataset` for startup measurements:

- `loadingStage`, `loadingStatus`, `loadingGoogleCoverageReady`, `loadingImmediateReady` and `loadingDegraded` describe the current outcome.
- `loadingStageTimings` is JSON containing each stage's `startedMs`, `endedMs`, `durationMs` and status. Running stages have no final duration yet.
- `loadingTimeToBackgroundMs` measures elapsed time from demo start to stage four, including key loading and initialization. `loadingFirstTimeToBackgroundMs` retains the first such measurement; `loadingBarrierTimeToBackgroundMs` measures only the latest barrier sequence.
- `googleCoverageResult` and `googleImmediateResult` contain the provider's most recent barrier results, including failed, source-limited and budget-limited tile counts.
- `googleModelFetchMs`, `googleModelDecodeMs` and `googleModelIntegrationMs` help distinguish network, decode and publication costs. Aggregate worker times can overlap and should not be added together as wall time.

For startup comparisons, serve the production `dist/` build, keep the browser visible, and record both cold and warm runs at the same preset, renderer and viewport. The separate 60-second **Measure frame pacing** control measures rendering and movement rather than time to stage four. Browser/device results are measurements, not promised loading times or frame rates. Read only these diagnostic fields when sharing results; request URLs can contain API keys.

## Sources

- [OSM contributors](https://www.openstreetmap.org/copyright)
- [Mapzen terrain documentation and attribution](https://github.com/tilezen/joerd/tree/master/docs)
- [Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/)
- [Overture attribution](https://docs.overturemaps.org/attribution/)
- [GEBCO WMS](https://www.gebco.net/data-products/gebco-web-services/web-map-service)
- [Mapbox](https://www.mapbox.com/about/maps/)

## Shared rendering and replacement

The globe and Tokyo–Fuji example both use `landscapeTerrainLOD` and `TerrainMB.setupTerrainLOD`; the profile keeps 32-step terrain through the Tokyo–Fuji distance. Terrain LOD meshes inherit their parent rendering group. Globe LOD meshes retain every full-resolution boundary sample while reducing the interior, so neighboring resolutions meet without vertical skirts or stretched coastal imagery. Planar terrain retains its existing skirt behavior. `BuildingReplacementIndex` tests real detailed-model geometry along the local up direction, and the common `Buildings.buildingMeshFilter` hook rejects covered footprints before merging. Disabling landmarks restores footprint generation. Fine building windows own their geographic coverage, excluding coarser representations there. These APIs live in the library rather than being another independent demo renderer.

All distance tiers have Overture building providers. Building requests begin at source zoom 10, where the archive supplies simplified distant geometry (verified against Tokyo); tiers below that zoom load terrain only. Google mode limits vector admission to tiles overlapping the 15-mile disk. Detailed models replace overlapping footprints, and prepared finer building tiers retain exclusive geographic coverage. Terrain prioritizes the camera frustum and nearby tiles; shared feature admission favors medium-distance Overture first. Source coverage still determines which individual buildings are available.

The globe enables logarithmic depth consistently for terrain, footprints and detailed model submaterials on supported devices. Merged globe buildings retain tile-local vertex coordinates to preserve small details at GPU precision. Planar consumers keep their existing depth and merge behavior.

Address autocomplete uses Mapbox Geocoding when the demo token is configured, with Photon as a fallback for empty results or provider errors. Keyless search still uses Photon. Queries remain debounced and cancellable; Mapbox results are not retained in the query cache.
