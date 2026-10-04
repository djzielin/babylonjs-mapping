import { GlobeBuildingBatch } from "./GlobeBuildingBatch.js";
import type { feature } from "./GeoJSON.js";
export interface BuildingGeometryJob {
    features: feature[];
    elevations: Map<string, number>;
    radius: number;
    metresToWorld: number;
    origin: number[];
    defaultHeight: number;
    exaggeration: number;
}
export interface BuildingGeometryResult {
    positions: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
    ranges: GlobeBuildingBatch["ranges"];
    featureCount: number;
}
/** Identical extrusion on a worker, using the scene's sampled terrain heights. */
export declare function buildBuildingGeometry(job: BuildingGeometryJob): BuildingGeometryResult;
