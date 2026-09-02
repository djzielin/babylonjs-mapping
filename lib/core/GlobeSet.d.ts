import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Vector3 } from "@babylonjs/core/Maths/math.js";
import { Scene } from "@babylonjs/core/scene.js";
import TileSet from "./TileSet.js";
export interface GlobeSetOptions {
    /** Radius of the globe in Babylon world units. */
    radius?: number;
}
/**
 * A spherical TileSet for globe-centric map displays.
 *
 * GlobeSet keeps TileSet's raster-provider and tile-lifecycle API, but turns
 * each Web-Mercator raster tile into a curved patch on a sphere. The
 * `tileWidth` argument passed to createGeometry is retained for TileSet
 * compatibility; the visible globe size is controlled by `radius`.
 *
 * Raster content is supported directly. Planar building and terrain
 * providers should not be used with GlobeSet yet because those providers
 * currently generate geometry in flat map space. Use getSurfacePosition() to
 * place application-owned markers or other globe overlays.
 */
export default class GlobeSet extends TileSet {
    private _radius;
    private backingMesh?;
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
    private createBackingMesh;
    private updateTileGeometry;
}
