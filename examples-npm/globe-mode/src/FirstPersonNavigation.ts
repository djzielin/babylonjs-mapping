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
