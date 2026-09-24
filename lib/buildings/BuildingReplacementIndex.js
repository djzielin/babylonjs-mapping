import { Ray } from "@babylonjs/core/Culling/ray.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
/** Prefer detailed models only where their actual geometry covers a footprint. */
export default class BuildingReplacementIndex {
    root;
    setModels(meshes) {
        const valid = meshes.filter(mesh => !mesh.isDisposed() && mesh.getTotalVertices() > 0);
        for (const mesh of valid)
            mesh.computeWorldMatrix(true);
        this.root = valid.length ? this.build(valid) : undefined;
    }
    build(meshes) {
        const min = new Vector3(Infinity, Infinity, Infinity), max = min.negate();
        for (const mesh of meshes) {
            const bounds = mesh.getBoundingInfo().boundingBox;
            min.minimizeInPlace(bounds.minimumWorld);
            max.maximizeInPlace(bounds.maximumWorld);
        }
        if (meshes.length <= 4)
            return { min, max, meshes };
        const extent = max.subtract(min);
        const axis = extent.x >= extent.y && extent.x >= extent.z ? "x" : extent.y >= extent.z ? "y" : "z";
        meshes.sort((a, b) => a.getBoundingInfo().boundingBox.centerWorld[axis] - b.getBoundingInfo().boundingBox.centerWorld[axis]);
        const middle = Math.floor(meshes.length / 2);
        return { min, max, left: this.build(meshes.slice(0, middle)), right: this.build(meshes.slice(middle)) };
    }
    keepFootprint(mesh, up = Vector3.Up(), rayLength = 10000) {
        mesh.computeWorldMatrix(true);
        const center = mesh.getBoundingInfo().boundingBox.centerWorld;
        return this.keepPoint(center, up, rayLength);
    }
    keepPoint(center, up = Vector3.Up(), rayLength = 10000) {
        const normal = up.normalizeToNew();
        const ray = new Ray(center.add(normal.scale(rayLength)), normal.negate(), rayLength * 2);
        const pending = this.root ? [this.root] : [];
        while (pending.length) {
            const node = pending.pop();
            if (!ray.intersectsBoxMinMax(node.min, node.max))
                continue;
            if (node.meshes) {
                for (const candidate of node.meshes)
                    if (!candidate.isDisposed() && this.intersectsGeometry(ray, candidate))
                        return false;
            }
            else {
                pending.push(node.left, node.right);
            }
        }
        return true;
    }
    intersectsGeometry(ray, mesh) {
        const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
        const indices = mesh.getIndices();
        if (!positions || !indices || !indices.length || !mesh.subMeshes?.length)
            return ray.intersectsMesh(mesh, true).hit;
        // Babylon expands every vertex into a retained Vector3 on the first pick. Landmark
        // geometry can contain millions of vertices, so read the existing buffer instead.
        const inverse = Matrix.Invert(mesh.getWorldMatrix());
        const localRay = Ray.Transform(ray, inverse);
        const bounds = mesh.getBoundingInfo().boundingBox;
        if (!localRay.intersectsBoxMinMax(bounds.minimum, bounds.maximum))
            return false;
        const a = new Vector3(), b = new Vector3(), c = new Vector3();
        for (const subMesh of mesh.subMeshes) {
            const material = subMesh.getMaterial();
            if (!material)
                continue;
            if (material.fillMode !== 0 && material.fillMode !== 1 && material.fillMode !== 2) {
                return ray.intersectsMesh(mesh, true).hit;
            }
            if (mesh.subMeshes.length > 1 && !subMesh.canIntersects(localRay))
                continue;
            for (let i = subMesh.indexStart; i + 2 < subMesh.indexStart + subMesh.indexCount; i += 3) {
                const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
                if (ic + 2 >= positions.length || ib + 2 >= positions.length || ia + 2 >= positions.length)
                    continue;
                a.set(positions[ia], positions[ia + 1], positions[ia + 2]);
                b.set(positions[ib], positions[ib + 1], positions[ib + 2]);
                c.set(positions[ic], positions[ic + 1], positions[ic + 2]);
                if (localRay.intersectsTriangle(a, b, c))
                    return true;
            }
        }
        return false;
    }
}
//# sourceMappingURL=BuildingReplacementIndex.js.map