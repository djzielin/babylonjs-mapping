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

/** How far a view may drift before tile selection is redone. */
export interface ViewTolerance {
    /** Degrees the camera may turn. */
    degrees: number;
    /** Fraction of its height above the ground the camera may move. */
    distance: number;
}

const forward = new Vector3(), up = new Vector3();

/**
 * Counts significant changes of a camera's view. With no tolerance, every
 * change of the view matrix counts, so selection follows the view exactly;
 * a headset, whose pose changes every frame, can instead reselect only when
 * the head has turned or moved appreciably, drawing with the view widened by
 * the tolerance meanwhile (see `selectionFov`).
 */
export class ViewChange {
    public tolerance: ViewTolerance = { degrees: 0, distance: 0 };
    private readonly position = new Vector3(NaN, NaN, NaN);
    private readonly forward = new Vector3();
    private readonly up = new Vector3();
    private count = 0;
    private lens = { fov: NaN, minZ: NaN, maxZ: NaN, count: 0 };

    /** A number that changes when the view has changed significantly. */
    public update(camera: Camera, height: number): number {
        const { degrees, distance } = this.tolerance;
        if (degrees <= 0 && distance <= 0) return camera.getViewMatrix().updateFlag;
        const world = camera.getWorldMatrix();
        Vector3.TransformNormalToRef(Vector3.Forward(), world, forward).normalize();
        Vector3.TransformNormalToRef(Vector3.Up(), world, up).normalize();
        const position = camera.globalPosition;
        const cos = Math.cos(degrees * Math.PI / 180);
        if (!(Vector3.Distance(position, this.position) <= distance * Math.max(height, 1e-9))
            || Vector3.Dot(forward, this.forward) < cos || Vector3.Dot(up, this.up) < cos) {
            this.position.copyFrom(position);
            this.forward.copyFrom(forward);
            this.up.copyFrom(up);
            this.count++;
        }
        return this.count;
    }

    /**
     * A number that changes when the camera's lens has changed significantly.
     * A headset sets the projection anew every frame, unchanged.
     */
    public projection(camera: Camera): number {
        const { degrees, distance } = this.tolerance;
        if (degrees <= 0 && distance <= 0) return camera.getProjectionMatrix().updateFlag;
        const lens = this.lens, near = (a: number, b: number) => Math.abs(a - b) <= 1e-3 * Math.abs(b);
        if (!near(camera.fov, lens.fov) || !near(camera.minZ, lens.minZ) || !near(camera.maxZ, lens.maxZ)) {
            lens.fov = camera.fov;
            lens.minZ = camera.minZ;
            lens.maxZ = camera.maxZ;
            lens.count++;
        }
        return lens.count;
    }

    /** The widening of the view that covers its drift between selections. */
    public get widening(): number {
        return this.tolerance.degrees;
    }
}

/** The view-projection a selection draws with: the view, widened by `degrees` on every side. */
export function selectionViewProjection(camera: Camera, degrees: number, result = new Matrix()): Matrix {
    if (degrees <= 0) return camera.getViewMatrix().multiplyToRef(camera.getProjectionMatrix(), result);
    return widenedViewProjection(camera, 1 + 2 * degrees * Math.PI / 180 / camera.fov, result);
}
