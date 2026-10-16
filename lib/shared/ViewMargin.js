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
    last = new Vector3(NaN, NaN, NaN);
    slow = false;
    /** Call once per frame with the camera's world position and its height above the ground (same units). */
    update(position, height) {
        this.slow = Vector3.Distance(position, this.last) <= GLIDE * Math.max(height, 1e-9);
        this.last.copyFrom(position);
    }
}
/** The view-projection of `camera` with its field of view widened by `factor`, for culling. */
export function widenedViewProjection(camera, factor = VIEW_MARGIN, result = new Matrix()) {
    const engine = camera.getEngine();
    const fov = Math.min(Math.PI * 0.9, camera.fov * factor);
    Matrix.PerspectiveFovLHToRef(fov, engine.getAspectRatio(camera), camera.minZ, camera.maxZ || 1e10, projection, camera.fovMode === 0, engine.isNDCHalfZRange);
    return camera.getViewMatrix().multiplyToRef(projection, result);
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
    tolerance = { degrees: 0, distance: 0 };
    position = new Vector3(NaN, NaN, NaN);
    forward = new Vector3();
    up = new Vector3();
    count = 0;
    lens = { fov: NaN, minZ: NaN, maxZ: NaN, count: 0 };
    /** A number that changes when the view has changed significantly. */
    update(camera, height) {
        const { degrees, distance } = this.tolerance;
        if (degrees <= 0 && distance <= 0)
            return camera.getViewMatrix().updateFlag;
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
    projection(camera) {
        const { degrees, distance } = this.tolerance;
        if (degrees <= 0 && distance <= 0)
            return camera.getProjectionMatrix().updateFlag;
        const lens = this.lens, near = (a, b) => Math.abs(a - b) <= 1e-3 * Math.abs(b);
        if (!near(camera.fov, lens.fov) || !near(camera.minZ, lens.minZ) || !near(camera.maxZ, lens.maxZ)) {
            lens.fov = camera.fov;
            lens.minZ = camera.minZ;
            lens.maxZ = camera.maxZ;
            lens.count++;
        }
        return lens.count;
    }
    /** The widening of the view that covers its drift between selections. */
    get widening() {
        return this.tolerance.degrees;
    }
}
/** The view-projection a selection draws with: the view, widened by `degrees` on every side. */
export function selectionViewProjection(camera, degrees, result = new Matrix()) {
    if (degrees <= 0)
        return camera.getViewMatrix().multiplyToRef(camera.getProjectionMatrix(), result);
    return widenedViewProjection(camera, 1 + 2 * degrees * Math.PI / 180 / camera.fov, result);
}
//# sourceMappingURL=ViewMargin.js.map