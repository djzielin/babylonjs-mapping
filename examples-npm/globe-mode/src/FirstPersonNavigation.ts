import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";

/** Rotate the sight line without changing the viewer's location. */
export function lookFromEye(camera: ArcRotateCamera, up: Vector3, backward: Vector3): void {
    const eye = camera.position.clone();
    const distance = camera.radius;
    camera.upVector = up;
    camera.setTarget(eye.subtract(backward.scale(distance)));
    camera.setPosition(eye);
}

/** Translate eye and sight line together, including when looking above the horizon. */
export function moveEye(camera: ArcRotateCamera, shift: Vector3): void {
    const eye = camera.position.add(shift);
    camera.setTarget(camera.getTarget().add(shift));
    camera.setPosition(eye);
}

/** Transport the sight line as the local vertical changes around a globe. */
export function alignEyeHorizon(camera: ArcRotateCamera, up: Vector3): void {
    const oldUp = camera.upVector.normalizeToNew();
    const axis = Vector3.Cross(oldUp, up);
    const sine = axis.length();
    if (sine < 1e-12) return;
    axis.scaleInPlace(1 / sine);
    const cosine = Math.max(-1, Math.min(1, Vector3.Dot(oldUp, up)));
    const backward = camera.position.subtract(camera.getTarget()).normalize();
    const transported = backward.scale(cosine).add(Vector3.Cross(axis, backward).scale(sine))
        .add(axis.scale(Vector3.Dot(axis, backward) * (1 - cosine)));
    lookFromEye(camera, up, transported);
}
