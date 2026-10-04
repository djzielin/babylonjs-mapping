import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { GlobeBuildingBatch } from "./GlobeBuildingBatch.js";
/** Identical extrusion on a worker, using the scene's sampled terrain heights. */
export function buildBuildingGeometry(job) {
    const position = (latitude, longitude, elevation = 0) => {
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
    for (const feature of job.features)
        batch.append(feature, job.defaultHeight, job.exaggeration);
    const data = batch.vertexData();
    return { positions: data.positions, normals: data.normals,
        indices: data.indices, ranges: batch.ranges, featureCount: batch.featureCount };
}
// This module can also be imported by geometry-equivalence tests outside a worker.
const scope = globalThis;
if (typeof scope.postMessage === "function" && typeof scope.document === "undefined") {
    scope.onmessage = event => {
        try {
            const result = buildBuildingGeometry(event.data);
            scope.postMessage({ result }, [result.positions.buffer, result.normals.buffer, result.indices.buffer]);
        }
        catch (error) {
            scope.postMessage({ error: String(error) }, []);
        }
    };
}
//# sourceMappingURL=GlobeBuildingWorker.js.map