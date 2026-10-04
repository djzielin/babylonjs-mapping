import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
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
export function buildBuildingGeometry(job: BuildingGeometryJob): BuildingGeometryResult {
    const position = (latitude: number, longitude: number, elevation = 0) => {
        const lat = latitude * (Math.PI / 180), lon = longitude * (Math.PI / 180);
        const radius = job.radius + elevation, horizontal = radius * Math.cos(lat);
        return new Vector3(-horizontal * Math.sin(lon), radius * Math.sin(lat), horizontal * Math.cos(lon));
    };
    const batch = new GlobeBuildingBatch({
        metresToWorld: job.metresToWorld,
        sampleElevation: (lat, lon) => job.elevations.get(`${lat}/${lon}`) ?? 0,
        getSurfacePosition: position,
        getSurfaceNormal: (lat, lon) => position(lat, lon).normalize(),
    }, Vector3.FromArray(job.origin));
    for (const feature of job.features) batch.append(feature, job.defaultHeight, job.exaggeration);
    const data = batch.vertexData();
    return { positions: data.positions as Float32Array, normals: data.normals as Float32Array,
        indices: data.indices as Uint32Array, ranges: batch.ranges, featureCount: batch.featureCount };
}

// This module can also be imported by geometry-equivalence tests outside a worker.
const scope = globalThis as typeof globalThis & {
    document?: unknown;
    postMessage?: (message: unknown, transfer: Transferable[]) => void;
    onmessage: ((event: MessageEvent<BuildingGeometryJob>) => void) | null;
};
if (typeof scope.postMessage === "function" && typeof scope.document === "undefined") {
    scope.onmessage = event => {
        try {
            const result = buildBuildingGeometry(event.data);
            scope.postMessage!({ result }, [result.positions.buffer, result.normals.buffer, result.indices.buffer] as ArrayBuffer[]);
        } catch (error) { scope.postMessage!({ error: String(error) }, []); }
    };
}
