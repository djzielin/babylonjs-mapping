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
/** How far a view may drift before tile selection is redone. */
export interface ViewTolerance {
    /** Degrees the camera may turn. */
    degrees: number;
    /** Fraction of its height above the ground the camera may move. */
    distance: number;
}
/**
 * Counts significant changes of a camera's view. With no tolerance, every
 * change of the view matrix counts, so selection follows the view exactly;
 * a headset, whose pose changes every frame, can instead reselect only when
 * the head has turned or moved appreciably, drawing with the view widened by
 * the tolerance meanwhile (see `selectionFov`).
 */
export declare class ViewChange {
    tolerance: ViewTolerance;
    private readonly position;
    private readonly forward;
    private readonly up;
    private count;
    private lens;
    /** A number that changes when the view has changed significantly. */
    update(camera: Camera, height: number): number;
    /**
     * A number that changes when the camera's lens has changed significantly.
     * A headset sets the projection anew every frame, unchanged.
     */
    projection(camera: Camera): number;
    /** The widening of the view that covers its drift between selections. */
    get widening(): number;
}
/** The view-projection a selection draws with: the view, widened by `degrees` on every side. */
export declare function selectionViewProjection(camera: Camera, degrees: number, result?: Matrix): Matrix;
