import { Vector3 } from "@babylonjs/core/Maths/math.js";
import { smoothNearSeaLevel } from "./TerrainRGBDecode.js";
export interface ElevationGrid {
    data: ArrayLike<number>;
    width: number;
    height: number;
    repairVersion?: number;
}
export type ElevationLoader = (coordinates: Vector3, signal: AbortSignal) => Promise<ElevationGrid>;
export interface TerrainRGBOptions {
    url?: string;
    encoding?: "terrarium" | "mapbox";
    maxZoom?: number;
    cacheSize?: number;
}
/** Numeric DEM streaming, including negative ocean depths. No GPU readback. */
export default class TerrainRGB {
    readonly stats: {
        sourceRequests: number;
        sharedSourceRequests: number;
        sourceCacheHits: number;
        childCacheHits: number;
        peakSourceActive: number;
        sourceMs: number;
    };
    /** URL-free source occupancy: controller slots may share one source request. */
    get loadingProgress(): {
        sourceRequests: number;
        sharedSourceRequests: number;
        sourceCacheHits: number;
        childCacheHits: number;
        peakSourceActive: number;
        sourceMs: number;
        sourceActive: number;
        sourceChildren: number;
    };
    private cache;
    private cropped;
    private pending;
    private url;
    private encoding;
    private maxZoom;
    private cacheSize;
    constructor(options?: TerrainRGBOptions);
    static decode(pixels: ArrayLike<number>, encoding: "terrarium" | "mapbox"): Float32Array;
    /** Remove single-pixel DEM pits/ridges without flattening broad terrain or bathymetry. */
    static repairIsolatedSpikes(grid: ElevationGrid, sourceZoom: number): ElevationGrid;
    static smoothNearSeaLevel: typeof smoothNearSeaLevel;
    /** Resample a child of an overzoomed source without losing its geographic bounds. */
    static crop(grid: ElevationGrid, coordinates: Vector3, sourceZoom: number): ElevationGrid;
    load: ElevationLoader;
    private fetchGrid;
    clearCache(): void;
}
