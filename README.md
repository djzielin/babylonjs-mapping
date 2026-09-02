# babylonjs-mapping

`babylonjs-mapping` renders tiled maps, terrain, and geographic feature data in
[Babylon.js](https://www.babylonjs.com/) scenes. It provides a reusable tile
grid, raster providers, building and vector-feature loaders, coordinate
conversion helpers, and Mapbox terrain support.

The package is browser-oriented, published as ES modules, and includes
TypeScript declarations.

## Install

```bash
npm install babylonjs-mapping @babylonjs/core @babylonjs/gui @babylonjs/loaders
```

## Quick start

Create the tile geometry before selecting its geographic location. The tile
width and feature dimensions use Babylon world units.

```ts
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import { RasterOSM, TileSet } from "babylonjs-mapping";

const canvas = document.querySelector<HTMLCanvasElement>("#renderCanvas")!;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);

const camera = new ArcRotateCamera(
    "camera",
    -Math.PI / 2,
    Math.PI / 3,
    100,
    Vector3.Zero(),
    scene,
);
camera.attachControl(canvas, true);

new HemisphericLight("light", new Vector3(0, 1, 0), scene);

const tiles = new TileSet(scene, engine);
tiles.setRasterProvider(new RasterOSM(tiles));
tiles.createGeometry(new Vector2(4, 4), 20, 2);
tiles.updateRaster(36.0014, -78.9382, 16);

engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());
```

`createGeometry(tileCount, tileWidth, meshPrecision)` creates the reusable
mesh grid. `updateRaster(latitude, longitude, zoom)` centers that grid on a
standard slippy-map coordinate and requests imagery from the configured raster
provider.

## Providers

| Data | Provider | Credentials or configuration |
| --- | --- | --- |
| OpenStreetMap raster imagery | `RasterOSM` | None |
| Mapbox raster imagery | `RasterMB` | Mapbox access token |
| GEBCO bathymetry imagery | `RasterGEBCO` | None |
| WMTS imagery | `RasterWMTS` | WMTS endpoint and layer |
| OSM Buildings geometry | `BuildingsOSM` | OSM Buildings/OneGeo access token |
| Mapbox landmark models | `BuildingsMB` | Mapbox access token |
| Mapbox or custom MVT features | `BuildingsVectorTile` | Token for Mapbox; URL and source layers for custom services |
| Overture Maps buildings | `BuildingsOverture` | PMTiles source; defaults to the latest public release |
| GeoServer, WFS, or ArcGIS features | `BuildingsWFS` | Service URL, layer, and source CRS |
| Spherical raster maps | `GlobeSet` and `GlobeNavigator` | Any supported raster provider |
| Mapbox terrain | `TerrainMB` through `TileSet` | Mapbox access token |

External services retain their own usage terms, attribution requirements,
rate limits, and CORS policies. Keep API tokens out of source control and
inject them through your application's normal secret/configuration mechanism.

## Add buildings

Initialize raster coordinates before requesting buildings. Building requests
use the current tile coordinates and are processed while the Babylon scene is
rendering.

```ts
import { BuildingsOSM } from "babylonjs-mapping";

const buildings = new BuildingsOSM(tiles);
buildings.accessToken = osmbAccessToken;
buildings.generateBuildings();
```

Feature widths and diameters are Babylon world units, even when source data is
EPSG:4326 or EPSG:3857:

```ts
buildings.lineWidth = 0.25;
buildings.pointDiameter = 0.5;
```

For ArcGIS-hosted data, use the matching setup helper before loading:

```ts
import { BuildingsWFS, EPSG_Type } from "babylonjs-mapping";

const features = new BuildingsWFS(
    "buildings",
    "https://services.arcgis.com/example/FeatureServer",
    "0",
    EPSG_Type.EPSG_4326,
    tiles,
);

features.setupAGOLFeatureService();
features.generateBuildings();
```

`setupAGOL()` supports an ArcGIS WFS endpoint, while `setupGeoServer()`
configures GeoServer-style requests. Both WFS and ArcGIS Feature Service
loading handle paginated results.

## Globe mode

`GlobeSet` curves Web Mercator raster tiles onto a configurable sphere while
retaining the raster-provider and tile lifecycle APIs. `GlobeNavigator`
connects it to an `ArcRotateCamera`, reports the visible geographic center,
supports animated coordinate-aware flights, and streams raster detail as the
camera moves or zooms.

```ts
import { GlobeNavigator, GlobeSet, RasterOSM } from "babylonjs-mapping";

const detail = new GlobeSet(scene, engine, {
    radius: 50.05,
    backingSurface: false,
});
detail.setRasterProvider(new RasterOSM(detail));
detail.createGeometry(new Vector2(5, 5), 20, 12);

const globeCamera = new ArcRotateCamera(
    "globe camera",
    0,
    Math.PI / 2,
    150,
    Vector3.Zero(),
    scene,
);
globeCamera.attachControl(canvas, true);

const navigator = new GlobeNavigator(detail, globeCamera, {
    minZoom: 3,
    maxZoom: 18,
});
navigator.setView(35.2271, -80.8431, { zoom: 3 });
navigator.flyTo(36.1069, -112.1129, { zoom: 11, durationMs: 1400 });
```

`getSurfacePosition()`, `getSurfaceNormal()`, and
`getSurfaceCoordinates()` support markers and click-to-fly interactions. Keep
a low-resolution base globe beneath a detail layer so imagery remains visible
while higher-resolution tiles load. Planar terrain and building providers are
not automatically reprojected onto the globe.

## Add Mapbox terrain

Use a sufficiently high mesh precision when terrain detail matters. Terrain
generation is asynchronous.

```ts
import { RasterMB } from "babylonjs-mapping";

const terrainTiles = new TileSet(scene, engine);
const raster = new RasterMB(terrainTiles);
raster.accessToken = mapboxAccessToken;
terrainTiles.setRasterProvider(raster);

terrainTiles.createGeometry(new Vector2(4, 4), 50, 32);
terrainTiles.ourTerrainMB.accessToken = mapboxAccessToken;
terrainTiles.updateRaster(36.1005, -112.1127, 14);

await terrainTiles.generateTerrain(1);
terrainTiles.setupTerrainLOD([16, 4, 1, 0], [64, 128, 256, 512]);
```

The final terrain LOD precision may be `0` to hide distant tiles. LOD
distances and terrain dimensions use Babylon world units.

## Moving and endless maps

`moveAllTiles()` recycles tiles that leave the grid. Subscribe to
`onTilePositionUpdatedObservable` when application-owned markers or meshes
must move with that lifecycle:

```ts
tiles.onTilePositionUpdatedObservable.add(({ tile, previousTileCoords, tileCoords }) => {
    removeObjectsForTile(previousTileCoords);
    addObjectsForTile(tileCoords, tile);
});
```

Pass `true` as the fifth `moveAllTiles()` argument to reload terrain when a
tile is recycled.

## Performance controls

Static scenes can freeze matrices and disable interactions they do not use.
Keep tile world matrices unfrozen when tiles move.

```ts
buildings.setOptimizationOptions({
    freezeWorldMatrices: true,
    disablePicking: true,
    disableCollisions: true,
    prioritizeRequestsByDistance: true,
});

tiles.setOptimizationOptions({
    freezeRasterMaterials: true,
    freezeTileWorldMatrices: false,
    disableTilePicking: false,
    disableTileCollisions: true,
});
```

Building billboard LOD is opt-in:

```ts
buildings.buildingLOD = {
    enabled: true,
    distance: 100,
};
```

Use `setPerformanceMonitoringEnabled(true)`, `getPerformanceStats()`, and
`resetPerformanceStats()` to measure queue depth, geometry reduction, LOD
selection, and sampled frame times.

## Local caching

Providers that support `RetrievalLocation.Local` read from `map_cache/` by
default. Change `localPathPrefix` when the cache is hosted elsewhere:

```ts
raster.localPathPrefix = "assets/map_cache/";
buildings.localPathPrefix = "assets/map_cache/";
```

## Examples

Runnable applications are under [`examples-npm`](examples-npm):

- [OpenStreetMap Hello World](examples-npm/OpenStreetMap-HelloWorld)
- [Endless OpenStreetMap](examples-npm/OpenStreetMap-Endless)
- [OpenStreetMap user data at real scale](examples-npm/OpenStreetMap-UserData-RealScale)
- [Mapbox terrain](examples-npm/mapbox-terrain)
- [GEBCO bathymetry](examples-npm/gebco-bathymetry)
- [Globe navigation](examples-npm/globe-mode)

Each example has its own README and npm scripts. A typical example can be run
with:

```bash
cd examples-npm/OpenStreetMap-HelloWorld
npm install
npm start
```

Examples that use commercial services expect their access-token text files as
documented in the example directory.

## API and compatibility notes

- Public classes and types are exported from `babylonjs-mapping`.
- Compatibility subpath exports under `babylonjs-mapping/lib/*` remain
  available for existing consumers.
- The package uses ES modules. Include the `.js` suffix when importing Babylon
  modules directly, as shown above.
- Geometry-dependent calls throw descriptive errors when geometry or raster
  coordinates have not been initialized.
- Dispose application-owned providers, observers, and Babylon resources when
  their scene is torn down.

## Development

```bash
npm ci
npm run build
npm test
```

Report bugs and request features through
[GitHub Issues](https://github.com/djzielin/babylonjs-mapping/issues).

## Credits

<img align="left" height="120" src="doc/vic_thumb.jpeg" alt="Vic Szabo">

**[Vic Szabo](https://scholars.duke.edu/person/ves4)**<br>
Principal Investigator<br>
Research Professor of Art, Art History & Visual Studies, Duke University<br>
Chair of Art, Art History & Visual Studies, Duke University

<br clear="left">

<img align="left" height="120" src="doc/dave_thumb.jpg" alt="David J. Zielinski">

**[David J. Zielinski](https://people.duke.edu/~djzielin/)**<br>
Senior AR/VR Technology Specialist, Duke University<br>
Developer, 2022–2025<br>
Project Manager, 2026–present

<br clear="left">

<img align="left" height="120" src="doc/thomas_thumb.jpeg" alt="Thomas Hines">

**[Thomas Hines](https://www.linkedin.com/in/thethomashines/)**<br>
Lead Developer, 2026–present<br>
Undergraduate, Computer Science / Electrical & Computer Engineering, Duke University

<br clear="left">

## License

[MIT](LICENSE.md)
