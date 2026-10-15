import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
/**
 * How much wider than the view the margin is: tiles in it load (but are not
 * drawn) before the camera turns to them, so they arrive at full detail
 * instead of as their coarse parents.
 */
export declare const VIEW_MARGIN = 1.15;
/** Tracks whether a camera is moving slowly enough for tiles to cross-fade. */
export declare class MotionTracker {
    private readonly last;
    slow: boolean;
    /** Call once per frame with the camera's world position and its height above the ground (same units). */
    update(position: Vector3, height: number): void;
}
/** The view-projection of `camera` with its field of view widened by `factor`, for culling. */
export declare function widenedViewProjection(camera: Camera, factor?: number, result?: Matrix): Matrix;
