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

The October 6 checkpoint's default New York normal reload measured **1.3717 s to baseline coverage and 4.8286 s to nearby detail**, including initialization and presentation waits. The nearby result meets the 5 s target; **the 1 s baseline goal is not achieved**. An earlier best sample was 1.1749 s / 3.7794 s under a different stable Google root session, so it is not a controlled comparison with this checkpoint. These reloads do not establish fully cold-cache timing or guaranteed loading times. Coverage and nearby screenshots were captured; the 257 m / 17 m / 16 m baseline targets and the full 300 m nearby demand, including 1,113 source-detail models at New York, remain unchanged.

Google mode starts through four barriers:

1. Load elevation for the 25-tile detail patch and the regional terrain window. Google baseline hierarchy requests and raw GLB downloads overlap this work. Native model decoding and publication wait for terrain readiness, leaving terrain jobs access to the CPU and GPU first. Other terrain tiers, Overture, roads and landmarks wait.
2. Publish complete Google 3D baseline coverage throughout the 15-mile radius. Target geometric error is 16 m within 100 m, 17 m from there to 750 m, and 257 m beyond that. The 17 m and 257 m targets admit Google's nominal 16.05095 m and 256.8152 m levels without needlessly descending another level; the core keeps the tighter geometry needed around the starting landmark.
3. Load high-detail Google geometry within 300 m while retaining the outer baseline. Distance uses the ground footprint, ignoring roof elevation, so tall buildings above the viewer remain part of the immediate area. Each Google barrier waits for a render after publication and then the next browser animation frame before starting the next pass, giving the browser a chance to present the updated view.
4. Stream Overture and further Google refinement together. Overture favors the 750 m–8 km band; Google favors nearby detail. Background selection uses four times the requested screen-space error (Automatic: 4 pixels; Balanced: 8; Highest: 3), a 1,080-pixel reference height and a 129 m display-error limit. An explicit `?sse=` setting scales proportionally. It preserves already loaded nearby finer detail while improving the rest of the disk. Jobs follow the current camera and preserve useful resident models during movement.

Each startup generation owns its cancellation signal. An obsolete download cannot release the next view's barriers. `maxTiles` gives the Google quality frontier a 4,096-tile budget. Settled coverage-only fallbacks have a separate allowance equal to the smaller of that budget and the initial renderable-frontier tile count, so near refinement cannot remove a distant sibling. Preserved nearby fine residents can also exceed the quality-frontier count; these limits do not promise a total resident-asset or memory cap. Google passes report visible coverage and requested quality separately. The baseline barrier accepts complete visible coverage and successful nearby baseline quality with no budget limits when remaining distant quality misses are source-limited. Those far models stay at their best available source quality, and the strict `coverageQualityComplete` flag remains false. A baseline failure still attempts the nearby detail barrier before releasing fallback buildings; `loadingGoogleCoverageReady` stays false while nearby success can independently set `loadingImmediateReady` true. Source limitations and budget limits remain in the results rather than becoming successful strict-quality flags. Terrain continues retrying transient errors. Download availability and source quality can still delay progress, and these targets do not guarantee a particular screenshot appearance or verified full-radius quality.

The coverage pass loads its own hierarchy while downloading raw model bodies. The demo runs no extra coverage or nearby JSON preparation pass; nearby hierarchy work begins in stage three. Startup traversal uses its configured 128 pending-hierarchy allowance immediately, bounded 16 ms work slices and `MessageChannel` task yields where available. Background work returns to 32 pending hierarchy requests, the shared 1 ms budget and frame/timer scheduling. Demo startup defaults are 512 network requests, 192 concurrent model preparations and a 1,024-model buffer window. Typed diagnostic overrides `?tileRequests=`, `?tileDecodes=` and `?tileBuffer=` accept positive integers up to those same limits; invalid values use the defaults. Stage four resets these limits to 48 network requests, four model preparations and a 32-model buffer window. Raw bodies waiting for terrain count toward the model buffer, which can briefly exceed the normal window by up to 50% for newly urgent work.

The exact EGM96 module starts loading alongside the local key read, overlapping scene construction. Hidden globe tiers retain attribution credits without allocating fullscreen GUI canvases; explicit access to their GUI creates it and replays those credits. The visible base attribution and Google credit display remain available. The automatic key-based switch to Google 2D satellite imagery waits for stage four; choosing imagery manually cancels that pending switch.

Startup also checks actual loaded Google triangles and vertices within a 20 m column around the camera, using only models whose geometric error is at most 16 m. If the orbit camera is inside that geometry or has less than 50 m clearance, it rises once to 80 m above the measured surface while keeping its latitude and longitude. This check skips inspection mode and active keyboard movement; it does not use coarse fallback bounds to estimate roof height.

Native Google hierarchy downloads retry network failures and HTTP 408, 429 and 5xx responses at most twice, after 150 ms and 450 ms. Obsolete branches stop before retrying. Permanent responses and malformed hierarchy data remain failures. `googleHierarchyRetries` counts these extra requests, and each load result's bounded `hierarchyFailureSamples` contains only the failure type, HTTP status and attempt count.

At street zoom in Google mode, the regional window uses 18 × 18 zoom-13 meshes with 16 subdivisions. Startup admits all 324 child requests to expose their shared zoom-10 DEM sources: nine sources in the starting New York window, or approximately 9–16 depending on alignment. Source pixel spacing remains finer than the regional mesh's vertex spacing. Windows without this source overzoom use 32 bootstrap child slots. Stage four restores 64 regional child slots and upgrades the DEM to zoom 12, where four neighboring meshes share one source grid. The bootstrap cache holds 32 source tiles, the regional upgrade cache 128, and the separate detail/intermediate cache 256. Controller updates advance pending geometry in bounded slices, and completed downloads refill slots with posted tasks without waiting for another rendered frame. Border elevations are welded as they arrive, then position/normal uploads coalesce once per dirty tile in each source burst; terrain readiness remains false until those uploads finish. Terrain preparation can therefore progress when rendering is throttled; the Google presentation barriers still wait for rendering. Satellite/raster imagery does not block any startup barrier: only two close and two regional raster requests run during terrain startup, and new raster requests pause during the Google coverage/detail barriers.

Overture and road tile jobs share an eight-request admission window across all globe tiers. Admission recomputes camera distance and visibility, so one tier cannot flood every provider queue. Fine Overture geometry replaces coarse footprints only after the matching geometry is ready. Google baseline meshes render below Overture; detailed Google meshes replace overlapping footprints. Feature creation shares a 1 ms scene budget per frame, with a 32-feature close-patch cap and 64-feature distance-tier caps; one atomic feature can exceed that budget.

Five overlapping distance tiers use zooms 8, 13, 14, 16 and 17 at Google zoom 18. During startup only the regional tier allocates its full window; the other four use one-tile placeholders and expand in stage four. Their full terrain geometry stays below 800,000 vertices, plus the close patch. Distance-tier geometry creation uses 0.5 ms work slices per tier; close-patch creation uses 4 ms slices. A single tile is atomic and can exceed its slice budget. The close patch uses 16 subdivisions at global zooms and 64 for terrain views. Retained tiles keep their geometry, DEM and in-flight imagery. Geometry is projected when it loads, rather than every frame; local mesh origins and high-precision matrices preserve fine detail. Shared `MapLayerRenderer` reserves finer coverage with the stencil buffer while all tiers use one depth buffer.

The demo enables the guarded static Google GLB loader by default; `?staticTiles=0` selects Babylon's native loader. The library's `fastStaticModels` default remains false. Supported static models preserve their original geometry buffers, PBR materials and full-resolution embedded atlases, with direct bitmap decoding where available. Unsupported formats and failed preparation fall back to the native loader. Prepared assets stay hidden until publication, cancelled work releases its assets, and retained bitmap buffers remain available for graphics-context restoration until texture disposal. `?tileMaterial=standard` opts into the experimental lightweight unlit material, and `?tileAtlas=1024` opts into a 1,024-pixel baseline atlas cap; neither experiment is part of the checkpoint's default measurements.

Checkpoint validation passed 666 automated tests; three optional live-source GLB fixture checks were skipped. A local WebGL harness compared the experimental unlit material with native PBR.unlit across 216 texture, factor, culling and image-processing cases with exact RGBA8 pixel parity. That controlled comparison does not establish parity for every source format or rendering configuration.

The Tokyo preset starts at zoom 16 in central Tokyo, 600 m above the terrain and tilted toward Fuji (heading 249.5°). Numeric terrain near the summit was verified against the live source at about 3,744 m. This does not replace browser validation: final appearance, transition quality and frame rate remain unverified in this environment.

The HUD reports the active startup stage, actual browser FPS, active meshes, vertices and job counts. Its background timestamp records when concurrent streaming began rather than claiming all detail is ready; nearby readiness and distant limitations are reported separately. Inspect `document.getElementById("renderCanvas").dataset` for startup measurements:

- `loadingStage`, `loadingStatus`, `loadingGoogleCoverageReady`, `loadingImmediateReady` and `loadingDegraded` describe the current outcome. The Google coverage-ready field reports the baseline barrier, including its best-available distant-source exception; inspect the provider's strict quality flags for full-radius quality.
- `loadingStageTimings` is JSON containing each stage's `startedMs`, `endedMs`, `durationMs` and status. Running stages have no final duration yet.
- `loadingTimeToBackgroundMs` measures elapsed time from demo start to stage four, including key loading and initialization. `loadingFirstTimeToBackgroundMs` retains the first such measurement; `loadingBarrierTimeToBackgroundMs` measures only the latest barrier sequence.
- `loadingTimeToCoverageMs` and `loadingTimeToImmediateMs` measure successful baseline and nearby-detail completion from the same demo-start timestamp, including their render/presentation waits. The current goals are at most 1 s and 5 s respectively; the checkpoint above still misses the 1 s baseline goal.
- `googleCoverageResult` and `googleImmediateResult` contain the provider's most recent barrier results, including failed, source-limited and budget-limited tile counts. `coverageComplete` means the selected frontier is visible; `coverageQualityComplete` additionally requires the near/far baseline targets. `nearCoverageQualityComplete` reports the nearby baseline separately, while `coverageAvailableQualityComplete` allows only loaded finest-source leaves outside that near area to exceed the far target. `immediateQualityComplete` enforces the immediate area's source-error cap; `detailComplete` is the stricter result with no source or budget limits.
- `googleModelFetchMs`, `googleModelDecodeMs` and `googleModelIntegrationMs` help distinguish network, decode and publication costs. Aggregate worker times can overlap and should not be added together as wall time.
- `googleCameraHeightM`, `googleCameraSurfaceHeightM` and, when a correction occurs, `googleStartupCameraRaiseM` report the startup clearance check.
- `googleStartupTuning` records the actual startup throughput limits. The numeric `rootResponseFingerprint` in provider stats compares root-response identity without revealing session or key values; a stable fingerprint alone does not prove an HTTP cache hit.

For startup comparisons, serve the production `dist/` build, keep the browser visible, and record both cold and warm runs at the same preset, renderer and viewport. Record cache controls explicitly: a normal reload can warm some resources without proving that every Google response came from cache, while a live renderer also retains prepared assets. The separate 60-second **Measure frame pacing** control measures rendering and movement rather than time to stage four. Browser/device results are measurements, not promised loading times or frame rates. Read only these diagnostic fields when sharing results; request URLs can contain API keys.

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
