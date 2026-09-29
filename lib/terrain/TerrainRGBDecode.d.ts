export type TerrainRGBEncoding = "terrarium" | "mapbox";
export declare const TERRAIN_REPAIR_VERSION = 8;
export declare function decodeTerrainRGB(pixels: ArrayLike<number>, encoding: TerrainRGBEncoding): Float32Array;
/** Repair narrow source-data spikes before terrain tiles sample this grid. */
export declare function repairIsolatedTerrainSpikes(data: ArrayLike<number>, width: number, height: number, sourceZoom: number): Float32Array | undefined;
/** Dampen small DEM oscillations around sea level without a hard height seam. */
export declare function smoothNearSeaLevel(data: ArrayLike<number>, sourceZoom: number): Float32Array | undefined;
