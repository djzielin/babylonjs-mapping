# Globe fidelity explorer

Orbit the Earth, fly to a city or ocean trench, zoom to detailed geometry, then use **Inspect in 3D** to orbit the local surface from an angle. Return to globe navigation to travel again.

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

- **Manhattan**: Overture footprints and height extrusions. Buildings begin at zoom 14; higher zooms reuse the archive's most detailed parent tile and select the appropriate child footprints.
- **Grand Canyon / Everest**: numeric land elevations, terrain lighting, optional 1–10× relief, and oblique inspection.
- **Mariana Trench / Monterey Canyon**: negative numeric ocean elevations. Select GEBCO for bathymetric colour imagery. The geometry comes from Mapzen/Tilezen's numeric terrain grid, not image luminance. This is not a claim that the streamed DEM is the latest GEBCO grid.
- **Fiji**: longitude seam navigation. Arbitrary latitude/longitude targeting and double-click fly-to are also available.
- **Guided tour** visits the presets every 12 seconds; the same button stops it.
- **Bring your data** accepts geographically positioned GeoJSON FeatureCollections. Polygon holes, roof properties, multipolygons, points, LineStrings and MultiLineStrings reuse the feature pipeline. Import after navigating to the feature's location; user features are tile-owned and expire when that tile is recycled.
- Optional Mapbox public token enables satellite imagery, road geometry, and landmark model tiles. Tokens remain in the input for the current page session and are sent only to the selected Mapbox services. The default DEM, OSM raster and Overture building path needs no token.

Reload retries elevation failures and regenerates features. Provider availability, CORS, native resolution, missing heights, and source coverage still apply. At the Mercator poles the backing cap is a fill surface, not polar raster/elevation coverage.

## Performance

The detail window has at most 25 tiles. Orbital geometry uses 16 subdivisions and terrain views use 64. New patch generation is spread over frames with a 4 ms CPU budget (a single tile is atomic). Raster requests are bounded at six, elevation jobs at four, and decoded DEM tiles use a 64-entry cache. Retained tiles keep their geometry, DEM and in-flight imagery. Geometry is projected when it loads, not every frame. Fine vertices use local origins and the demo enables Babylon's high-precision matrices. Feature creation has a 4 ms frame budget and an eight-feature cap; one feature is atomic and can exceed the budget.

The HUD reports actual browser FPS, active meshes, vertices, and detail-job counts. These are measurements of the current browser/device, not a promised frame rate. `Inspect in 3D` keeps the current geographic tile window fixed; return to globe mode to stream a different region. Terrain and buildings share a rendering group above the overview so low-resolution sea-level imagery cannot hide the seafloor.

## Sources

- [OSM contributors](https://www.openstreetmap.org/copyright)
- [Mapzen terrain documentation and attribution](https://github.com/tilezen/joerd/tree/master/docs)
- [Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/)
- [Overture attribution](https://docs.overturemaps.org/attribution/)
- [GEBCO WMS](https://www.gebco.net/data-products/gebco-web-services/web-map-service)
- [Mapbox](https://www.mapbox.com/about/maps/)
