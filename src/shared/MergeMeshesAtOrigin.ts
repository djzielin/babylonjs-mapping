import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";

/** Batch meshes without baking planet-sized translations into Float32 vertices. */
export function mergeMeshesAtOrigin(meshes: Mesh[], origin: Vector3): Mesh | null {
    const sources = meshes.map(mesh => ({
        mesh, frozen: mesh.isWorldMatrixFrozen, world: mesh.computeWorldMatrix(true).clone(),
    }));
    try {
        for (const { mesh, world } of sources) {
            const local = world.clone();
            local.setTranslation(world.getTranslation().subtract(origin));
            mesh.freezeWorldMatrix(local);
        }
        const merged = Mesh.MergeMeshes(meshes, true, true);
        if (merged) {
            merged.position.copyFrom(origin);
            merged.computeWorldMatrix(true);
        }
        return merged;
    } finally {
        // Restore sources if merging fails; successful merging disposes them.
        for (const { mesh, frozen, world } of sources) {
            if (mesh.isDisposed()) continue;
            if (frozen) mesh.freezeWorldMatrix(world);
            else mesh.unfreezeWorldMatrix();
        }
    }
}
