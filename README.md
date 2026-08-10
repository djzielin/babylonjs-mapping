# babylonjs-mapping
This project is to help do mapping inside BabylonJS. 

Currently supported data sources include:
* OpenStreetMaps and OpenStreetMaps Buildings
![lots of gray buildings on top of map of roads](https://raw.githubusercontent.com/djzielin/babylonjs-mapping/main/doc/charlotte.jpg "Open Street Maps Demo")
* Mapbox (satellite and terrain)
![grand canyon with river at bottom](https://raw.githubusercontent.com/djzielin/babylonjs-mapping/main/doc/grand_canyon.jpg "Mapbox Terrain Demo")
* Custom Buildings from GeoServer and ArcGIS Online (WFS)

The "Hello World" of creating an OpenStreetMap tileset, along with extruded buildings is:

```
    this.ourTS = new TileSet(this.scene,this.engine);
    this.ourTS.setRasterProvider(new RasterOSM(this.ourTS)); //set basemap to pull from Open Street Maps
    this.ourTS.createGeometry(new Vector2(4,4), 20, 2); //4x4 tile set, 20m width of each tile, and 2 divisions on each tile
    this.ourTS.updateRaster(36.0014, -78.9382, 16); //lat, lon, zoom. takes us to Duke University in Durham.

    this.ourOSM=new BuildingsOSM(this.ourTS); //lets pull building footprints from Open Street Map Buildings
    this.ourOSM.accessToken=accessToken;      //now requires Auth token
    this.ourOSM.generateBuildings();
```
Live Demos!  
https://people.duke.edu/~djzielin/babylonjs-mapping/HelloWorld/  
https://people.duke.edu/~djzielin/babylonjs-mapping/Terrain/  

Tested with:
Node 20.10.0 LTS

## Releasing

The package is published by `.github/workflows/publish-npm.yml` when a GitHub
release is published with a matching `v<package version>` tag. The workflow
runs the tests and build first, then publishes with npm provenance. Before
creating the release, configure npm's trusted publisher for repository
`djzielin/babylonjs-mapping` and workflow file `publish-npm.yml`.

## Building geometry options

Call `createGeometry` and `updateRaster` before generating buildings. The library throws
a descriptive error when a geometry-dependent operation is called out of order.

Line and point feature sizes are specified in Babylon world units, regardless of whether
the source data uses EPSG:4326 or EPSG:3857:

```ts
streets.lineWidth = 0.25;
points.pointDiameter = 0.5;
```

OSM Buildings roof metadata is applied automatically. `gabled`, `hipped`,
`pyramidal`/`pyramid`, and `skillion` roof shapes honor `roofHeight`,
`roofLevels`, and `roofDirection` (as well as the equivalent raw
`roof:*` property names). Complex footprints that cannot be roofed without
changing their topology keep the existing full-height flat extrusion.

## Mapbox landmark buildings

Mapbox's detailed landmark models can be loaded after the tileset raster
coordinates are initialized. The provider automatically requests and places
the fixed zoom-14 model tiles that overlap the current tileset:

```ts
const landmarks = new BuildingsMB(tileSet);
landmarks.accessToken = mapboxAccessToken;
await landmarks.generateBuildings();
```

Call `generateBuildings()` again after `updateRaster()` to reuse overlapping
model tiles and dispose models that moved out of view. Call `dispose()` when
the provider is no longer needed.

## Endless tile lifecycle

When `moveAllTiles()` recycles a tile, `onTilePositionUpdatedObservable`
provides the tile plus snapshots of its previous and new coordinates. This lets
an endless-world application remove user-owned objects for the old tile and
create replacements for the new one:

```ts
tileSet.onTilePositionUpdatedObservable.add(({ tile, previousTileCoords, tileCoords }) => {
    removeItemsForTile(previousTileCoords);
    addItemsForTile(tileCoords, tile);
});
```

The notification is sent after the tile's raster request and optional building
request have been submitted.

## ArcGIS Online WFS pagination

`BuildingsWFS.setupAGOL()` enables WFS 2.0 result paging automatically. Each
request is limited to 3,000 features and subsequent requests use a zero-based
`startIndex`, so large hosted WFS layers can be loaded without silently losing
features. Geometry creation and optional merging continue after the final page.

```ts
const buildings = new BuildingsWFS(
    "buildings",
    "https://your-org.arcgis.com/.../WFSServer?",
    "your-layer:your-feature-type",
    EPSG_Type.EPSG_4326,
    tileSet,
);

buildings.setupAGOL(); // enables count=3000/startIndex pagination
buildings.generateBuildings();
```

`maxFeaturesPerRequest` defaults to `3000` and can be lowered when testing or
when a service advertises a smaller page limit.

For ArcGIS Feature Services, the REST query API can be used directly instead of
creating a WFS share. The provider sends a GeoJSON query constrained to each
map tile and uses `resultOffset`/`resultRecordCount` paging:

```ts
const buildings = new BuildingsWFS(
    "buildings",
    "https://services.arcgis.com/.../FeatureServer",
    "0",
    EPSG_Type.EPSG_4326,
    tileSet,
);

buildings.setupAGOLFeatureService();
buildings.generateBuildings();
```

You can also pass a complete `/query` URL or preserve a service token in the
URL query string.

## Building LOD

Building billboards are opt-in. Configure them before generating buildings:

```ts
this.ourOSM.buildingLOD = {
    enabled: true,
    distance: 100, // Babylon world units
};
this.ourOSM.generateBuildings();
```

At the configured distance, Babylon.js swaps each detailed building for a double-sided rectangle sized from its world-space bounds and billboarded around the vertical axis. Set `billboardMode` to `Mesh.BILLBOARDMODE_ALL` when full camera-facing rotation is preferred. Per-building LOD requires individual meshes, so `buildingLOD.enabled` keeps buildings separate even when `doMerge` is also true.

## Endless terrain recycling

`moveAllTiles` can reload Mapbox terrain for tiles that are recycled at the edge
of an endless tileset. Pass `true` as the optional fifth argument after terrain
has been configured:

```ts
await tileSet.generateTerrain(1);

scene.onBeforeRenderObservable.add(() => {
    tileSet.moveAllTiles(dx, dz, 2, buildings, true);
});
```

Terrain seam repair is re-applied for every loaded cardinal and diagonal
neighbor whenever a tile finishes loading, so recycled DEM data does not retain
stale seam state.

## Credits

<img align="left" height="120" src="doc/vic_thumb.jpeg" alt="Vic Szabo">

**[Vic Szabo](https://scholars.duke.edu/person/ves4)**  
Principal Investigator  
Research Professor of Art, Art History & Visual Studies, Duke University  
Chair of Art, Art History & Visual Studies, Duke University

<br clear="left">

<img align="left" height="120" src="doc/dave_thumb.jpg" alt="David J. Zielinski">

**[David J. Zielinski](https://people.duke.edu/~djzielin/)**  
Senior AR/VR Technology Specialist, Duke University  
Developer, 2022–2025  
Project Manager, 2026–present

<br clear="left">

<img align="left" height="120" src="doc/thomas_thumb.jpeg" alt="Thomas Hines">

**[Thomas Hines](https://www.linkedin.com/in/thethomashines/)**  
Lead Developer, 2026–present  
Undergraduate, Computer Science / Electrical & Computer Engineering, Duke University

<br clear="left">
