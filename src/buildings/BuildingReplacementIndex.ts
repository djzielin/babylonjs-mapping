import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Ray } from "@babylonjs/core/Culling/ray.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";

type Node = { min: Vector3; max: Vector3; meshes?: Mesh[]; left?: Node; right?: Node };

/** Prefer detailed models only where their actual geometry covers a footprint. */
export default class BuildingReplacementIndex {
    private root?: Node;
    public setModels(meshes: Mesh[]): void {
        const valid = meshes.filter(mesh => !mesh.isDisposed() && mesh.getTotalVertices() > 0);
        for (const mesh of valid) mesh.computeWorldMatrix(true);
        this.root = valid.length ? this.build(valid) : undefined;
    }
    private build(meshes: Mesh[]): Node {
        const min = new Vector3(Infinity, Infinity, Infinity), max = min.negate();
        for (const mesh of meshes) {
            const bounds = mesh.getBoundingInfo().boundingBox;
            min.minimizeInPlace(bounds.minimumWorld); max.maximizeInPlace(bounds.maximumWorld);
        }
        if (meshes.length <= 4) return { min, max, meshes };
        const extent = max.subtract(min);
        const axis = extent.x >= extent.y && extent.x >= extent.z ? "x" : extent.y >= extent.z ? "y" : "z";
        meshes.sort((a, b) => a.getBoundingInfo().boundingBox.centerWorld[axis] - b.getBoundingInfo().boundingBox.centerWorld[axis]);
        const middle = Math.floor(meshes.length / 2);
        return { min, max, left: this.build(meshes.slice(0, middle)), right: this.build(meshes.slice(middle)) };
    }

    public keepFootprint(mesh: Mesh, up = Vector3.Up(), rayLength = 10000): boolean {
        mesh.computeWorldMatrix(true);
        const center = mesh.getBoundingInfo().boundingBox.centerWorld;
        return this.keepPoint(center, up, rayLength);
    }
    public keepPoint(center: Vector3, up = Vector3.Up(), rayLength = 10000): boolean {
        const normal = up.normalizeToNew();
        const ray = new Ray(center.add(normal.scale(rayLength)), normal.negate(), rayLength * 2);
        const pending = this.root ? [this.root] : [];
        while (pending.length) {
            const node = pending.pop()!;
            if (!ray.intersectsBoxMinMax(node.min, node.max)) continue;
            if (node.meshes) {
                for (const candidate of node.meshes) if (!candidate.isDisposed() && ray.intersectsMesh(candidate, true).hit) return false;
            } else {
                pending.push(node.left!, node.right!);
            }
        }
        return true;
    }
}
