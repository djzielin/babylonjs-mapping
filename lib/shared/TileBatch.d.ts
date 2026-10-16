import type { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import type { DataBuffer } from "@babylonjs/core/Buffers/dataBuffer.js";
import type { ThinEngine } from "@babylonjs/core/Engines/thinEngine.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import { Scene } from "@babylonjs/core/scene.js";
/** GPU resources of one textured tile primitive, drawn by `TileBatch`. */
export interface TileDrawable {
    positions: VertexBuffer;
    uvs?: VertexBuffer;
    indexBuffer: DataBuffer;
    indexCount: number;
    texture?: BaseTexture;
    /** Tile-local to world, double precision. */
    world: Matrix;
    /** Recorded on first draw, once the effect's attribute locations are known. */
    vao?: WebGLVertexArrayObject;
    /** The vertex array for the cross-fading variant of the shader. */
    fadeVao?: WebGLVertexArrayObject;
    /**
     * When the tile started to fade in (`performance.now()`), or out with
     * `fadeOut`. Tiles fade over `TileBatch.fadeDuration`.
     */
    fadeStart?: number;
    fadeOut?: boolean;
    /** Further per-vertex attributes for custom shaders, by attribute name. */
    attributes?: Record<string, VertexBuffer>;
    /** CPU copies for ray queries, and for culling by camera. */
    localPositions?: Float32Array;
    localIndices?: Uint16Array | Uint32Array;
    /** World bounding sphere for culling, kept by `TileBatch`. */
    bounds?: TileBounds;
}
/** A drawable's bounding sphere, tile-local and as last placed in the world. */
interface TileBounds {
    local: Vector3;
    localRadius: number;
    center: Vector3;
    radius: number;
    world?: Matrix;
    flag: number;
}
/** True where tiles can be drawn by `TileBatch` (WebGL engines). */
export declare function supportsTileBatch(scene: Scene): boolean;
/**
 * Draws every visible tile of a streaming layer in one pass. Babylon sees a single
 * mesh, so the tiles take part in rendering groups, stencil layering
 * (`MapLayerRenderer`) and multiple cameras like any other mesh, while the
 * per-tile cost is only a matrix upload, a vertex array bind, a texture bind
 * and the draw itself.
 */
export interface TileBatchShader {
    /** Name of a shader pair in `Effect.ShadersStore`, with the same core inputs as the default. */
    name: string;
    attributes?: string[];
    uniforms?: string[];
    /** Set custom uniforms before drawing. */
    bind?: (effect: Effect) => void;
    /** The fragment shader implements `#ifdef FADE` like the default; otherwise tiles appear at once. */
    fades?: boolean;
}
export declare class TileBatch extends Mesh {
    /** Tiles to draw, nearest first, which lets early depth testing reject hidden ones. */
    items: TileDrawable[];
    private readonly relativeWorld;
    private readonly viewProjection;
    private readonly viewRotation;
    private readonly viewProjection32;
    private readonly bindShader?;
    /** The shader with FADE defined, compiled on first use: discarding costs early depth testing, so only fading tiles pay for it. */
    private fadeEffect?;
    private readonly createFadeEffect?;
    /**
     * Skip tiles outside the rendering camera's own frustum. Layers select
     * tiles for the view as a whole, a little widened; each eye of a headset
     * sees only part of that.
     */
    cullByCamera: boolean;
    /** Tiles drawn by the last render, for diagnostics. */
    drawnCount: number;
    private readonly planes;
    /** The planes as (normal, d) quadruples, for the per-tile test. */
    private readonly planeValues;
    /** Milliseconds over which tiles that change level cross-fade; 0 swaps them at once. */
    fadeDuration: number;
    /**
     * With `clip`, fragments farther than `clipRadius` (world units) from
     * `clipCenter` are not drawn: a layer can end on a circle, whatever the
     * shape of its coarsest tiles, and leave the rest to layers beneath.
     */
    clipCenter: Vector3;
    clipRadius: number;
    constructor(name: string, scene: Scene, shader?: TileBatchShader, { clip }?: {
        clip?: boolean;
    });
    render(subMesh: SubMesh, _enableAlphaMode: boolean): Mesh;
    /** True while any tile is cross-fading, so the layer keeps redrawing. */
    get isFading(): boolean;
    private inView;
    private draw;
    /** Release a drawable's GPU resources (its texture is owned by the tile). */
    static release(engine: ThinEngine, item: TileDrawable, shared?: boolean): void;
}
export {};
