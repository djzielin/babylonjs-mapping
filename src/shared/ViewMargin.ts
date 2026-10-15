import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";

/**
 * How much wider than the view the margin is: tiles in it load (but are not
 * drawn) before the camera turns to them, so they arrive at full detail
 * instead of as their coarse parents.
 */
export const VIEW_MARGIN = 1.15;

const projection = new Matrix();

/**
 * Fraction of its height above the ground a camera may move per frame and
 * still count as gliding: level changes cross-fade then, while faster
 * motion hides them anyway.
 */
const GLIDE = 0.01;

/** Tracks whether a camera is moving slowly enough for tiles to cross-fade. */
export class MotionTracker {
    private readonly last = new Vector3(NaN, NaN, NaN);
    public slow = false;

    /** Call once per frame with the camera's world position and its height above the ground (same units). */
    public update(position: Vector3, height: number): void {
        this.slow = Vector3.Distance(position, this.last) <= GLIDE * Math.max(height, 1e-9);
        this.last.copyFrom(position);
    }
}

/** The view-projection of `camera` with its field of view widened by `factor`, for culling. */
export function widenedViewProjection(camera: Camera, factor = VIEW_MARGIN, result = new Matrix()): Matrix {
    const engine = camera.getEngine();
    const fov = Math.min(Math.PI * 0.9, camera.fov * factor);
    Matrix.PerspectiveFovLHToRef(fov, engine.getAspectRatio(camera), camera.minZ, camera.maxZ || 1e10, projection,
        camera.fovMode === 0, engine.isNDCHalfZRange);
    return camera.getViewMatrix().multiplyToRef(projection, result);
}
