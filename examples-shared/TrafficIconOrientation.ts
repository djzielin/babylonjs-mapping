import { Matrix, Vector3 } from "@babylonjs/core/Maths/math";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

/** Align a camera-facing symbol's +Y nose with its projected travel direction. */
export function orientTrafficIcon(mesh: AbstractMesh, behind: Vector3): void {
    const scene = mesh.getScene();
    const camera = scene.activeCamera;
    if (!camera) return;
    const engine = scene.getEngine();
    const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const transform = scene.getTransformMatrix();
    const origin = Vector3.Project(mesh.position, Matrix.IdentityReadOnly, transform, viewport);
    const tail = Vector3.Project(behind, Matrix.IdentityReadOnly, transform, viewport);
    const dx = origin.x - tail.x;
    const dy = origin.y - tail.y;
    // Retain the last orientation when travel points straight at the camera.
    if (dx * dx + dy * dy > 1e-12) mesh.rotation.z = Math.atan2(-dx, -dy);
}
