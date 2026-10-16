import type { Ray } from "@babylonjs/core/Culling/ray.js";

/** Triangles per chunk whose bounds are tested before its triangles. */
const CHUNK = 128;
const EPSILON = 1e-12;

const cache = new WeakMap<ArrayLike<number>, RayMesh>();

/**
 * Ray queries against a static triangle mesh. Triangles are grouped, in index
 * order, into small chunks whose bounding boxes are tested first: tile meshes
 * are spatially coherent in that order, so a ray tests a few chunks' triangles
 * instead of every triangle.
 */
export class RayMesh {
    private readonly bounds: Float32Array;
    private readonly triangles: number;

    private constructor(private readonly positions: ArrayLike<number>, private readonly indices: ArrayLike<number>) {
        this.triangles = Math.floor(indices.length / 3);
        const chunks = Math.ceil(this.triangles / CHUNK);
        const bounds = this.bounds = new Float32Array(chunks * 6);
        for (let chunk = 0; chunk < chunks; chunk++) {
            let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
            const end = Math.min(this.triangles, (chunk + 1) * CHUNK) * 3;
            for (let i = chunk * CHUNK * 3; i < end; i++) {
                const v = indices[i] * 3, x = positions[v], y = positions[v + 1], z = positions[v + 2];
                if (x < x0) x0 = x; if (x > x1) x1 = x;
                if (y < y0) y0 = y; if (y > y1) y1 = y;
                if (z < z0) z0 = z; if (z > z1) z1 = z;
            }
            bounds.set([x0, y0, z0, x1, y1, z1], chunk * 6);
        }
    }

    /** The query structure for a mesh, built on first use and kept with its positions. */
    public static for(positions: ArrayLike<number>, indices: ArrayLike<number>): RayMesh {
        let mesh = cache.get(positions);
        if (!mesh || mesh.indices !== indices) cache.set(positions, mesh = new RayMesh(positions, indices));
        return mesh;
    }

    /** Distance along `ray` (in its direction's units) to the nearest triangle, either face, or undefined. */
    public intersect(ray: Ray, maximum = Infinity): number | undefined {
        const { x: ox, y: oy, z: oz } = ray.origin, { x: dx, y: dy, z: dz } = ray.direction;
        const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
        const bounds = this.bounds, p = this.positions, indices = this.indices;
        let nearest = maximum;
        for (let chunk = 0, b = 0; b < bounds.length; chunk++, b += 6) {
            // Slab test against the chunk's box.
            let t0 = (bounds[b] - ox) * ix, t1 = (bounds[b + 3] - ox) * ix;
            let near = Math.min(t0, t1), far = Math.max(t0, t1);
            t0 = (bounds[b + 1] - oy) * iy; t1 = (bounds[b + 4] - oy) * iy;
            near = Math.max(near, Math.min(t0, t1)); far = Math.min(far, Math.max(t0, t1));
            t0 = (bounds[b + 2] - oz) * iz; t1 = (bounds[b + 5] - oz) * iz;
            near = Math.max(near, Math.min(t0, t1)); far = Math.min(far, Math.max(t0, t1));
            // NaN (a ray in a box's face plane) fails both tests: test the triangles then.
            if (far < 0 || near > far || near > nearest) continue;
            const end = Math.min(this.triangles, (chunk + 1) * CHUNK) * 3;
            for (let i = chunk * CHUNK * 3; i < end; i += 3) {
                // Möller–Trumbore.
                const a = indices[i] * 3, bi = indices[i + 1] * 3, c = indices[i + 2] * 3;
                const ax = p[a], ay = p[a + 1], az = p[a + 2];
                const e1x = p[bi] - ax, e1y = p[bi + 1] - ay, e1z = p[bi + 2] - az;
                const e2x = p[c] - ax, e2y = p[c + 1] - ay, e2z = p[c + 2] - az;
                const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
                const det = e1x * px + e1y * py + e1z * pz;
                if (det > -EPSILON && det < EPSILON) continue;
                const inv = 1 / det;
                const tx = ox - ax, ty = oy - ay, tz = oz - az;
                const u = (tx * px + ty * py + tz * pz) * inv;
                if (u < 0 || u > 1) continue;
                const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
                const v = (dx * qx + dy * qy + dz * qz) * inv;
                if (v < 0 || u + v > 1) continue;
                const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
                if (t >= 0 && t < nearest) nearest = t;
            }
        }
        return nearest < maximum ? nearest : undefined;
    }
}

/** Indices of a (grid + 1)² vertex grid's triangles, in the order GlobeSurface draws them. */
export function gridTriangles(grid: number): Uint32Array {
    const indices = new Uint32Array(grid * grid * 6);
    let k = 0;
    for (let row = 0; row < grid; row++) for (let column = 0; column < grid; column++) {
        const i = row * (grid + 1) + column;
        indices.set([i, i + grid + 1, i + 1, i + 1, i + grid + 1, i + grid + 2], k);
        k += 6;
    }
    return indices;
}
