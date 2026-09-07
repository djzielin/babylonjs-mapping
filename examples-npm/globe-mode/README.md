# Globe fidelity explorer

Orbit the Earth, fly to a city or ocean trench, zoom to detailed geometry, then adjust **Tilt** (0–89°) and **Heading** to look across the local surface. **Tilt view** starts at 60°; drag to orbit the selected spot or scroll to move closer. **Top down** restores globe navigation. Choosing a destination or starting a tour also returns to globe navigation.

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

Use **Map / Satellite** at the top of the panel to switch imagery across the entire globe, including all distance tiers. Satellite uses the Mapbox public token in More options; choosing it without a token opens and focuses that field. Terrain and buildings stay enabled while imagery changes.

Type an address or place in the search box (at least three characters), then click a suggestion or use arrow keys and Enter. Escape closes suggestions. Selecting a result stops the tour and returns to globe navigation before flying there. Search uses [Photon’s public autocomplete service](https://github.com/komoot/photon), based on OpenStreetMap, with a 450 ms debounce, cancellation, timeout and a bounded session cache. Typed queries are sent to Photon; coverage and availability depend on the provider. For substantial traffic, host a Photon instance and change the endpoint in `src/AddressSearch.ts`.

- **Manhattan**: Overture footprints and height extrusions. Buildings begin at zoom 14; higher zooms reuse the archive's most detailed parent tile and select the appropriate child footprints.
- **Grand Canyon / Everest**: numeric land elevations, terrain lighting, optional 1–10× relief, and oblique inspection.
- **Mariana Trench / Monterey Canyon**: negative numeric ocean elevations. Select GEBCO for bathymetric colour imagery. The geometry comes from Mapzen/Tilezen's numeric terrain grid, not image luminance. This is not a claim that the streamed DEM is the latest GEBCO grid.
- **Fiji**: longitude seam navigation. Arbitrary latitude/longitude targeting and double-click fly-to are also available.
- **Guided tour** visits the presets every 12 seconds; the same button stops it.
- **More options → Import GeoJSON** accepts geographically positioned GeoJSON FeatureCollections. Polygon holes, roof properties, multipolygons, points, LineStrings and MultiLineStrings reuse the feature pipeline. Import after navigating to the feature's location; user features are tile-owned and expire when that tile is recycled.
- A Mapbox public token enables satellite imagery, road geometry, and landmark model tiles. Landmarks are enabled by default once a token is entered and follow any location at zoom 14+, including search results and manual navigation; they no longer wait for the footprint job queue. Model availability varies by location, with Overture extrusions providing ordinary buildings where bespoke models are absent. Manually entered tokens remain in the input for the current page session; configured demo tokens are included in the browser build. Tokens are sent to the selected Mapbox services. The default DEM, OSM raster and Overture building path needs no token.

Reload retries elevation failures and regenerates features. Provider availability, CORS, native resolution, missing heights, and source coverage still apply. At the Mercator poles the backing cap is a fill surface, not polar raster/elevation coverage.

## Performance

The close detail window has at most 25 tiles. Five overlapping distance tiers step through progressively coarser imagery (at zoom 18: 17, 15, 13, 11 and 10). Shared `MapLayerRenderer` draws fine coverage first and reserves its pixels using the stencil buffer. All tiers keep one depth buffer; coarse surfaces cannot overwrite finer coverage. Alpha-blended stacked terrain has been removed. The regional tier remains 16 × 16 zoom-11 tiles (roughly 250 km across at Tokyo), with a 32 × 32 zoom-10 horizon tier (roughly 1,000 km), using 8 subdivisions. Intermediate tiers use 8 × 8 windows and 32 subdivisions. Their combined terrain budget stays below 600,000 vertices, plus the close patch. Regional and intermediate Overture buildings use merged meshes. Distant tiers each allow two raster requests and 0.5 ms geometry work per frame, with four elevation jobs in the regional tier and two elsewhere; terrain jobs start nearest the viewer. Loading counts and data failures are visible in the main panel.

The Tokyo preset starts at zoom 16 in central Tokyo, 600 m above the terrain and tilted toward Fuji (heading 249.5°). Numeric terrain near the summit was verified against the live source at about 3,744 m. This does not replace browser validation: final appearance, transition quality and frame rate remain unverified in this environment.

The detail window has at most 25 tiles. Orbital geometry uses 16 subdivisions and terrain views use 64. New patch generation is spread over frames with a 4 ms CPU budget (a single tile is atomic). Raster requests are bounded at six, elevation jobs at four, and decoded DEM tiles use a 64-entry cache. Retained tiles keep their geometry, DEM and in-flight imagery. Geometry is projected when it loads, not every frame. Fine vertices use local origins and the demo enables Babylon's high-precision matrices. Feature creation has a 4 ms frame budget and a 32-feature cap; one feature is atomic and can exceed the budget.

The HUD reports actual browser FPS, active meshes, vertices, and detail-job counts. These are measurements of the current browser/device, not a promised frame rate. `Tilt view` keeps the current geographic tile window fixed; return to globe mode to stream a different region. Terrain and buildings share a rendering group above the overview so low-resolution sea-level imagery cannot hide the seafloor.

## Sources

- [OSM contributors](https://www.openstreetmap.org/copyright)
- [Mapzen terrain documentation and attribution](https://github.com/tilezen/joerd/tree/master/docs)
- [Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/)
- [Overture attribution](https://docs.overturemaps.org/attribution/)
- [GEBCO WMS](https://www.gebco.net/data-products/gebco-web-services/web-map-service)
- [Mapbox](https://www.mapbox.com/about/maps/)

## Shared rendering and replacement

The globe and Tokyo–Fuji example both use `landscapeTerrainLOD` and `TerrainMB.setupTerrainLOD`; the profile keeps 32-step terrain through the Tokyo–Fuji distance. Terrain LOD meshes inherit their parent rendering group. `BuildingReplacementIndex` tests real detailed-model geometry along the local up direction, and the common `Buildings.buildingMeshFilter` hook rejects covered footprints before merging. Disabling landmarks restores footprint generation. Fine building windows own their geographic coverage, excluding coarser representations there. These APIs live in the library rather than being another independent demo renderer.

All distance tiers now have Overture building providers, including the horizon tier. Building requests begin at source zoom 10, where the archive supplies simplified distant geometry (verified against Tokyo). Detailed models replace overlapping footprints, and finer building tiers retain exclusive geographic coverage. Distant terrain/feature jobs prioritize the active camera frustum, retaining the existing concurrency and per-frame generation limits. Source coverage still determines which individual buildings are available.
