type Position = { x: number; y: number; z: number };
type CameraFacingIcon = {
    position: Position;
    rotation: { z: number };
    getScene(): {
        activeCamera: { viewport: { toGlobal(width: number, height: number): { width: number; height: number } } } | null;
        getEngine(): { getRenderWidth(): number; getRenderHeight(): number };
        getTransformMatrix(): { m: ArrayLike<number> };
    };
};

/** Align a camera-facing symbol's +Y nose with its projected travel direction. */
export function orientTrafficIcon(mesh: CameraFacingIcon, behind: Position): void {
    const scene = mesh.getScene();
    const camera = scene.activeCamera;
    if (!camera) return;
    const engine = scene.getEngine();
    const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const m = scene.getTransformMatrix().m;
    // Use coordinates rather than Babylon class types: each demo can install its
    // own supported Babylon version. Viewport translation cancels in the delta.
    const project = (p: Position) => {
        const w = p.x * m[3] + p.y * m[7] + p.z * m[11] + m[15];
        return {
            x: (p.x * m[0] + p.y * m[4] + p.z * m[8] + m[12]) / w * viewport.width / 2,
            y: -(p.x * m[1] + p.y * m[5] + p.z * m[9] + m[13]) / w * viewport.height / 2,
        };
    };
    const origin = project(mesh.position);
    const tail = project(behind);
    const dx = origin.x - tail.x;
    const dy = origin.y - tail.y;
    // Retain the last orientation when travel points straight at the camera.
    if (Number.isFinite(dx) && Number.isFinite(dy) && dx * dx + dy * dy > 1e-12)
        mesh.rotation.z = Math.atan2(-dx, -dy);
}
