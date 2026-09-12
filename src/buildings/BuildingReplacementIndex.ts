import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Ray } from "@babylonjs/core/Culling/ray.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";

/** Prefer detailed models only where their actual geometry covers a footprint. */
export default class BuildingReplacementIndex {
    private meshes: Mesh[] = [];
    public setModels(meshes: Mesh[]): void {
        this.meshes = meshes.filter(mesh => !mesh.isDisposed() && mesh.getTotalVertices() > 0);
        for (const mesh of this.meshes) mesh.computeWorldMatrix(true);
    }
    public keepFootprint(mesh: Mesh, up = Vector3.Up(), rayLength = 10000): boolean {
        mesh.computeWorldMatrix(true);
        const center = mesh.getBoundingInfo().boundingBox.centerWorld;
        return this.keepPoint(center, up, rayLength);
    }
    public keepPoint(center: Vector3, up = Vector3.Up(), rayLength = 10000): boolean {
        const normal = up.normalizeToNew();
        const ray = new Ray(center.add(normal.scale(rayLength)), normal.negate(), rayLength * 2);
        for (const candidate of this.meshes) {
            if (!candidate.isDisposed() && ray.intersectsMesh(candidate, true).hit) return false;
        }
        return true;
    }
}
