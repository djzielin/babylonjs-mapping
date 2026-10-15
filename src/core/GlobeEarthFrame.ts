import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { geodeticToECEF, GoogleTileFrame } from "../google/GoogleTileFrame.js";
import type GlobeSet from "./GlobeSet.js";

/**
 * An Earth-fixed placement that overlays can share with other content, such
 * as photorealistic 3D tiles, so that they line up exactly. A globe models
 * the Earth as a sphere; 3D tiles keep the ellipsoid's true shape near the
 * view. Overlays placed through the same frame as the tiles sit on them,
 * wherever the frame is anchored.
 */
export interface GlobeEarthFrame {
    /** ECEF metres to world (Babylon row-vector convention), or undefined until placed. */
    readonly ecefToWorld: Matrix | undefined;
    /** ECEF metres of a point `height` metres above sea level. */
    toECEF(latitude: number, longitude: number, height: number, result?: Vector3): Vector3;
}

/** ECEF metres of a point `height` metres above the ellipsoid (sea level, within the geoid's undulation). */
export function ellipsoidECEF(latitude: number, longitude: number, height: number, result = new Vector3()): Vector3 {
    return geodeticToECEF(latitude, longitude, height, result);
}

/**
 * ECEF to world on the globe's sphere, exact at (`latitude`, `longitude`):
 * for placing overlays built in ECEF when no shared frame is available.
 */
export function globeECEFToWorld(globe: GlobeSet, latitude: number, longitude: number, result = new Matrix()): Matrix {
    const scale = globe.metresToWorld;
    const up = globe.getSurfaceNormal(latitude, longitude);
    const lambda = longitude * Math.PI / 180;
    const east = new Vector3(-Math.cos(lambda), 0, -Math.sin(lambda));
    const north = Vector3.Cross(east, up).normalize();
    const frame = new GoogleTileFrame();
    frame.set({ latitude, longitude }, { position: globe.getSurfacePosition(latitude, longitude), east, north, up, scale });
    return result.copyFrom(frame.matrix);
}
