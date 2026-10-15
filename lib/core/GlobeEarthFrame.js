import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { geodeticToECEF, GoogleTileFrame } from "../google/GoogleTileFrame.js";
/** ECEF metres of a point `height` metres above the ellipsoid (sea level, within the geoid's undulation). */
export function ellipsoidECEF(latitude, longitude, height, result = new Vector3()) {
    return geodeticToECEF(latitude, longitude, height, result);
}
/**
 * ECEF to world on the globe's sphere, exact at (`latitude`, `longitude`):
 * for placing overlays built in ECEF when no shared frame is available.
 */
export function globeECEFToWorld(globe, latitude, longitude, result = new Matrix()) {
    const scale = globe.metresToWorld;
    const up = globe.getSurfaceNormal(latitude, longitude);
    const lambda = longitude * Math.PI / 180;
    const east = new Vector3(-Math.cos(lambda), 0, -Math.sin(lambda));
    const north = Vector3.Cross(east, up).normalize();
    const frame = new GoogleTileFrame();
    frame.set({ latitude, longitude }, { position: globe.getSurfacePosition(latitude, longitude), east, north, up, scale });
    return result.copyFrom(frame.matrix);
}
//# sourceMappingURL=GlobeEarthFrame.js.map