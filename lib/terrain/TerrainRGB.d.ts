import { Vector3 } from '@babylonjs/core/Maths/math.js';
export interface ElevationGrid {
    data: ArrayLike<number>;
    width: number;
    height: number;
}
export type ElevationLoader = (coordinates: Vector3, signal: AbortSignal) => Promise<ElevationGrid>;
export interface TerrainRGBOptions {
    url?: string;
    encoding?: 'terrarium' | 'mapbox';
    maxZoom?: number;
    cacheSize?: number;
}
/** Numeric DEM streaming, including negative ocean depths. No GPU readback. */
export default class TerrainRGB {
    private cache;
    private url;
    private encoding;
    private maxZoom;
    private cacheSize;
    constructor(options?: TerrainRGBOptions);
    static decode(pixels: ArrayLike<number>, encoding: 'terrarium' | 'mapbox'): Float32Array;
    /** Resample a child of an overzoomed source without losing its geographic bounds. */
    static crop(grid: ElevationGrid, coordinates: Vector3, sourceZoom: number): ElevationGrid;
    load: ElevationLoader;
    clearCache(): void;
}
