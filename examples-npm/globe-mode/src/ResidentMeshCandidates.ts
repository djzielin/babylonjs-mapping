import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

/** Reject dormant static content before Babylon's material and LOD preparation. */
export function installResidentMeshCandidates(scene: Scene): () => void {
    const previous = scene.getActiveMeshCandidates;
    const result = { data: [] as AbstractMesh[], length: 0 };
    const select = () => {
        const source = previous();
        const camera = scene.activeCamera;
        if (!camera || scene.skipFrustumClipping) return source;
        let count = 0;
        for (let i = 0; i < source.length; i++) {
            const mesh = source.data[i];
            // Animated, instanced and LOD-bearing meshes retain Babylon's full
            // evaluation path. Frozen map meshes have current world bounds.
            const staticMesh = mesh as Mesh;
            const canCull = mesh.isWorldMatrixFrozen && !mesh.alwaysSelectAsActiveMesh
                && !mesh.hasInstances && !staticMesh.hasThinInstances && !mesh.skeleton
                && !mesh.billboardMode && !staticMesh.getLODLevels?.().length;
            if (canCull && (!mesh.isVisible || mesh.visibility <= 0
                || !(mesh.layerMask & camera.layerMask) || !mesh.isEnabled()
                || !mesh.isInFrustum(scene.frustumPlanes))) continue;
            result.data[count++] = mesh;
        }
        result.data.length = result.length = count;
        return result;
    };
    scene.getActiveMeshCandidates = select;
    const dispose = () => {
        if (scene.getActiveMeshCandidates === select) scene.getActiveMeshCandidates = previous;
        result.data.length = result.length = 0;
    };
    scene.onDisposeObservable.addOnce(dispose);
    return dispose;
}
