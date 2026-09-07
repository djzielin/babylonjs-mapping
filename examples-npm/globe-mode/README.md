# Globe fidelity explorer

Orbit the Earth, fly to a city or ocean trench, zoom to detailed geometry, then adjust **Tilt** (0–89°) and **Heading** to look across the local surface. **Tilt view** starts at 60°; drag to orbit the selected spot or scroll to move closer. **Top down** restores globe navigation. Choosing a destination or starting a tour also returns to globe navigation.

## Run the current PR

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
- A Mapbox public token enables satellite imagery, road geometry, and landmark model tiles. Landmarks are enabled by default once a token is entered and follow any location at zoom 14+, including search results and manual navigation; they no longer wait for the footprint job queue. Model availability varies by location, with Overture extrusions providing ordinary buildings where bespoke models are absent. Tokens remain in the input for the current page session and are sent only to the selected Mapbox services. The default DEM, OSM raster and Overture building path needs no token.

Reload retries elevation failures and regenerates features. Provider availability, CORS, native resolution, missing heights, and source coverage still apply. At the Mercator poles the backing cap is a fill surface, not polar raster/elevation coverage.

## Performance

The close detail window has at most 25 tiles. When zooming in, a 16 × 16 regional tier uses zoom 11 and 32 subdivisions per tile, while an 8 × 8 horizon tier uses zoom 8 and 16 subdivisions. At Tokyo's latitude these span roughly 250 km and 1,000 km respectively, so Fuji fits inside the regional terrain window from Tokyo. Both tiers follow arbitrary locations and use lower source zooms while zoomed out. They add fewer than 300,000 terrain vertices at a fixed tile budget. Regional Overture buildings use merged meshes; the close layer renders above these coarse tiers. Each distant tier has one detail request at a time, two raster requests, and a 1 ms geometry budget; regional building creation also has a 1 ms budget. Distant terrain shares the decoded elevation cache and follows terrain, relief, buildings and map-style controls. Full browser FPS and long-distance transition appearance have not been visually verified in this environment.

The detail window has at most 25 tiles. Orbital geometry uses 16 subdivisions and terrain views use 64. New patch generation is spread over frames with a 4 ms CPU budget (a single tile is atomic). Raster requests are bounded at six, elevation jobs at four, and decoded DEM tiles use a 64-entry cache. Retained tiles keep their geometry, DEM and in-flight imagery. Geometry is projected when it loads, not every frame. Fine vertices use local origins and the demo enables Babylon's high-precision matrices. Feature creation has a 4 ms frame budget and a 32-feature cap; one feature is atomic and can exceed the budget.

The HUD reports actual browser FPS, active meshes, vertices, and detail-job counts. These are measurements of the current browser/device, not a promised frame rate. `Tilt view` keeps the current geographic tile window fixed; return to globe mode to stream a different region. Terrain and buildings share a rendering group above the overview so low-resolution sea-level imagery cannot hide the seafloor.

## Sources

- [OSM contributors](https://www.openstreetmap.org/copyright)
- [Mapzen terrain documentation and attribution](https://github.com/tilezen/joerd/tree/master/docs)
- [Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/)
- [Overture attribution](https://docs.overturemaps.org/attribution/)
- [GEBCO WMS](https://www.gebco.net/data-products/gebco-web-services/web-map-service)
- [Mapbox](https://www.mapbox.com/about/maps/)
