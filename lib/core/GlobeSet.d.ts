import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Vector3 } from "@babylonjs/core/Maths/math.js";
import { Scene } from "@babylonjs/core/scene.js";
import Tile from "./Tile.js";
import GlobeTileMath from "./GlobeTileMath.js";
import TileSet from "./TileSet.js";
export interface GlobeSetOptions {
    /** Radius of the globe in Babylon world units. */
    radius?: number;
    /** Optional CPU budget per frame for new patches; default builds synchronously. */
    geometryBudgetMs?: number;
    /** Creates a recessed fill sphere behind raster tiles. Defaults to true. */
    backingSurface?: boolean;
    /** Shows this layer's raster attribution. Defaults to true. */
    attribution?: boolean;
}
export interface GlobeCoordinates {
    latitude: number;
    longitude: number;
    elevation: number;
}
/**
 * A spherical TileSet for globe-centric map displays.
 *
 * GlobeSet keeps TileSet's raster-provider and tile-lifecycle API, but turns
 * each Web-Mercator raster tile into a curved patch on a sphere. The
 * `tileWidth` argument passed to createGeometry is retained for TileSet
 * compatibility; the visible globe size is controlled by `radius`.
 *
 * Raster, DEM, and GeoJSON providers share the normal TileSet lifecycle.
 * Elevations are radial; feature footprints are projected after extrusion so
 * courtyards, roofs, roads, and points retain their existing geometry.
 */
export default class GlobeSet extends TileSet {
    readonly isGlobe = true;
    private flatMath;
    private geometryKeys;
    private elevationTileMap;
    private tileDirections;
    private geometryBudgetMs;
    private geometryQueue;
    get pendingGeometryCount(): number;
    isTileGeometryReady(tile: Tile): boolean;
    private flushGeometry;
    /** Metres of elevation per world unit use a fixed spherical Earth radius. */
    get metresToWorld(): number;
    getGeometryMath(): GlobeTileMath;
    private _radius;
    private backingMesh?;
    private polarCapMeshes;
    private attributionEnabled;
    constructor(scene: Scene, engine: Engine, options?: GlobeSetOptions);
    /** Radius of the globe in Babylon world units. */
    get radius(): number;
    set radius(value: number);
    /**
     * Convert longitude, latitude, and an optional radial offset to globe
     * coordinates. Longitude zero is on +Z and increases toward +X; latitude
     * increases toward +Y.
     */
    getSurfacePosition(latitude: number, longitude: number, elevation?: number): Vector3;
    /** Return the outward unit normal at a longitude/latitude location. */
    getSurfaceNormal(latitude: number, longitude: number): Vector3;
    /** Convert a Babylon world position back to globe coordinates. */
    getSurfaceCoordinates(position: Vector3): GlobeCoordinates;
    /**
     * Return a point on a raster tile's curved surface. `u` runs west to east
     * and `v` runs north to south, both in the inclusive range 0..1.
     */
    getTileSurfacePosition(tileCoords: Vector3, u?: number, v?: number, elevation?: number): Vector3;
    /**
     * The base class creates a temporary ground mesh before raster coordinates
     * are known. updateRaster() replaces its vertices with the corresponding
     * spherical tile patch once tile coordinates are available.
     */
    makeSingleTileMesh(_x: number, _y: number, precision: number): Mesh;
    updateRaster(lat: number, lon: number, zoom: number): void;
    protected reuseRasterTilesOnUpdate(): boolean;
    protected showRasterAttribution(): boolean;
    /** Signed elevation grids (including bathymetry) are supplied in metres. */
    setElevationData(tile: Tile, data: ArrayLike<number>, width: number, height: number, exaggeration?: number): void;
    applyElevationGrid(tile: Tile, heights: number[], precision: number): void;
    applyGlobeHeights(mesh: Mesh, tile: Tile, precision: number, heights: number[]): void;
    /** Warp already-extruded feature vertices and their LOD meshes once, at load time. */
    projectFeatureMesh(mesh: Mesh): void;
    /** Bilinear loaded-surface elevation in world units; zero where data is absent. */
    sampleElevation(latitude: number, longitude: number): number;
    private createBackingMesh;
    private createPolarCap;
    private updateTileGeometry;
}
