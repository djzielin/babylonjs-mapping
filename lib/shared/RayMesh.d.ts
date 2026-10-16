import type { Ray } from "@babylonjs/core/Culling/ray.js";
/**
 * Ray queries against a static triangle mesh. Triangles are grouped, in index
 * order, into small chunks whose bounding boxes are tested first: tile meshes
 * are spatially coherent in that order, so a ray tests a few chunks' triangles
 * instead of every triangle.
 */
export declare class RayMesh {
    private readonly positions;
    private readonly indices;
    private readonly bounds;
    private readonly triangles;
    private constructor();
    /** The query structure for a mesh, built on first use and kept with its positions. */
    static for(positions: ArrayLike<number>, indices: ArrayLike<number>): RayMesh;
    /** Distance along `ray` (in its direction's units) to the nearest triangle, either face, or undefined. */
    intersect(ray: Ray, maximum?: number): number | undefined;
}
/** Indices of a (grid + 1)² vertex grid's triangles, in the order GlobeSurface draws them. */
export declare function gridTriangles(grid: number): Uint32Array;
