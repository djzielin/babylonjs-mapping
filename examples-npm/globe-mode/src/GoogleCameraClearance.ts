import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Matrix } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

interface SurfaceGlobe {
    metresToWorld: number;
    getSurfacePosition(latitude: number, longitude: number, elevation?: number): Vector3;
}
interface GoogleSurfaceModel {
    root: Pick<TransformNode, "isDisposed" | "isEnabled">;
    asset: { meshes: readonly AbstractMesh[] };
}

/** Highest actual enabled Google surface at a coordinate, in metres above globe zero.
 * A positive radius also includes referenced vertices in that radial column,
 * allowing a narrow spire beside the exact center ray to establish clearance.
 * Run at loading barriers; this intentionally does not move the camera or pick
 * meshes through Babylon's retained per-vertex Vector3 cache.
 */
export function sampleGoogleSurfaceElevation(globe: SurfaceGlobe, models: readonly GoogleSurfaceModel[],
    latitude: number, longitude: number, sampleRadiusMetres = 0): number | undefined {
    if (!Number.isFinite(globe.metresToWorld) || globe.metresToWorld <= 0)
        throw new RangeError("Invalid globe scale");
    if (!Number.isFinite(sampleRadiusMetres) || sampleRadiusMetres < 0)
        throw new RangeError("Invalid Google surface sample radius");
    const origin = globe.getSurfacePosition(latitude, longitude);
    const direction = origin.normalizeToNew();
    const surfaceRadius = origin.length(), minimumHeight = -surfaceRadius;
    const radius = sampleRadiusMetres * globe.metresToWorld, radiusSquared = radius * radius;
    const localOrigin = new Vector3(), localDirection = new Vector3(), padding = new Vector3();
    let inverse: Matrix | undefined;
    let visited: Uint8Array | undefined;
    let highest = -Infinity;
    for (const model of models) {
        if (model.root.isDisposed() || !model.root.isEnabled()) continue;
        for (const mesh of model.asset.meshes) {
            if (mesh.isDisposed() || !mesh.isEnabled() || !mesh.isVisible || mesh.getTotalVertices() < 3) continue;
            const world = mesh.computeWorldMatrix();
            if (!world.determinant()) continue;
            // Use the mesh matrix's runtime/precision, including consumers
            // with a separately installed Babylon copy for their demo.
            inverse ??= world.clone();
            world.invertToRef(inverse);
            Vector3.TransformCoordinatesToRef(origin, inverse, localOrigin);
            // Do not normalize: the resulting intersection parameter stays in
            // world units even under rotated and nonuniformly scaled parents.
            Vector3.TransformNormalToRef(direction, inverse, localDirection);
            const values = inverse.m;
            padding.set(radius * Math.hypot(values[0], values[4], values[8]),
                radius * Math.hypot(values[1], values[5], values[9]),
                radius * Math.hypot(values[2], values[6], values[10]));
            const bounds = mesh.getBoundingInfo().boundingBox;
            if (!lineIntersectsBox(localOrigin, localDirection, bounds.minimum, bounds.maximum, padding)) continue;
            const positions = mesh.getVerticesData(VertexBuffer.PositionKind), indices = mesh.getIndices();
            if (!positions) continue;
            if (radius) {
                const count = Math.floor(positions.length / 3);
                if (!visited || visited.length < count) visited = new Uint8Array(count);
                else visited.fill(0, 0, count);
            }
            const m = world.m;
            const includeColumnVertex = (offset: number) => {
                const index = offset / 3;
                if (visited![index]) return;
                visited![index] = 1;
                const x = positions[offset], y = positions[offset + 1], z = positions[offset + 2];
                const wx = x * m[0] + y * m[4] + z * m[8] + m[12];
                const wy = x * m[1] + y * m[5] + z * m[9] + m[13];
                const wz = x * m[2] + y * m[6] + z * m[10] + m[14];
                const dx = wx - origin.x, dy = wy - origin.y, dz = wz - origin.z;
                const height = dx * direction.x + dy * direction.y + dz * direction.z;
                const horizontalSquared = dx * dx + dy * dy + dz * dz - height * height;
                if (height >= minimumHeight && horizontalSquared <= radiusSquared)
                    highest = Math.max(highest, Math.hypot(wx, wy, wz) - surfaceRadius);
            };
            const length = indices?.length ?? Math.floor(positions.length / 3);
            for (let index = 0; index + 2 < length; index += 3) {
                const a = (indices ? indices[index] : index) * 3;
                const b = (indices ? indices[index + 1] : index + 1) * 3;
                const c = (indices ? indices[index + 2] : index + 2) * 3;
                if (a + 2 >= positions.length || b + 2 >= positions.length || c + 2 >= positions.length) continue;
                if (radius) { includeColumnVertex(a); includeColumnVertex(b); includeColumnVertex(c); }
                const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
                const e1x = positions[b] - ax, e1y = positions[b + 1] - ay, e1z = positions[b + 2] - az;
                const e2x = positions[c] - ax, e2y = positions[c + 1] - ay, e2z = positions[c + 2] - az;
                const px = localDirection.y * e2z - localDirection.z * e2y;
                const py = localDirection.z * e2x - localDirection.x * e2z;
                const pz = localDirection.x * e2y - localDirection.y * e2x;
                const determinant = e1x * px + e1y * py + e1z * pz;
                if (!determinant) continue;
                const reciprocal = 1 / determinant;
                const tx = localOrigin.x - ax, ty = localOrigin.y - ay, tz = localOrigin.z - az;
                const u = (tx * px + ty * py + tz * pz) * reciprocal;
                if (u < -1e-9 || u > 1 + 1e-9) continue;
                const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
                const v = (localDirection.x * qx + localDirection.y * qy + localDirection.z * qz) * reciprocal;
                if (v < -1e-9 || u + v > 1 + 1e-9) continue;
                const height = (e2x * qx + e2y * qy + e2z * qz) * reciprocal;
                if (Number.isFinite(height) && height >= minimumHeight) highest = Math.max(highest, height);
            }
        }
    }
    return highest === -Infinity ? undefined : highest / globe.metresToWorld;
}

function lineIntersectsBox(origin: Vector3, direction: Vector3, minimum: Vector3, maximum: Vector3, padding: Vector3): boolean {
    let near = -Infinity, far = Infinity;
    for (const axis of ["x", "y", "z"] as const) {
        if (Math.abs(direction[axis]) < 1e-15) {
            if (origin[axis] < minimum[axis] - padding[axis] || origin[axis] > maximum[axis] + padding[axis]) return false;
            continue;
        }
        const a = (minimum[axis] - padding[axis] - origin[axis]) / direction[axis];
        const b = (maximum[axis] + padding[axis] - origin[axis]) / direction[axis];
        near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
        if (near > far) return false;
    }
    return true;
}
