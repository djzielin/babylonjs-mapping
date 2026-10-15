import type { IGLTF } from "babylonjs-gltf2interface";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { TileDrawable } from "../shared/TileBatch.js";
import { type DecodedImage } from "../shared/TileTextures.js";
/** One drawable primitive, decoded off the main thread and ready for upload. */
export interface DecodedGooglePrimitive {
    positions: Float32Array;
    uvs?: Float32Array;
    indices: Uint16Array | Uint32Array;
    /** glTF-space bounds of `positions`. */
    minimum: Vector3;
    maximum: Vector3;
    /** Node hierarchy transform, glTF space. */
    nodeMatrix: Matrix;
    /** Index into `DecodedGoogleTile.images`. */
    image?: number;
}
export type DecodedGoogleImage = DecodedImage;
export interface DecodedGoogleTile {
    primitives: DecodedGooglePrimitive[];
    images: DecodedGoogleImage[];
    /** CESIUM_RTC centre in tile (ECEF) coordinates. */
    rtcCenter?: Vector3;
    attributions: string[];
}
/** Babylon objects created for one tile. */
export interface GoogleTileMeshes {
    meshes: Mesh[];
    textures: BaseTexture[];
    /** Approximate GPU memory in bytes. */
    byteLength: number;
}
/** Parsed GLB container: the JSON document and its binary chunk. */
export declare function parseGLB(buffer: ArrayBuffer): {
    json: IGLTF;
    binary?: Uint8Array;
};
/** Attribution sources from the glTF `asset.copyright` field, which Google separates with semicolons. */
export declare function glbAttributions(json: IGLTF): string[];
/** Start loading the Draco decoder before the first tile arrives. */
export declare function warmGoogleTileDecoder(): void;
/**
 * Decode a Google photorealistic GLB. Geometry decompression runs in the
 * Draco worker pool and JPEG/PNG decoding in the browser's image decoder, so
 * the main thread only parses the JSON chunk. Normals are skipped: the tiles
 * are unlit photogrammetry.
 */
export declare function decodeGoogleTile(buffer: ArrayBuffer, signal?: AbortSignal): Promise<DecodedGoogleTile>;
/** Babylon objects created for one tile when drawn by `TileBatch`. */
export interface TileDrawables {
    drawables: TileDrawable[];
    textures: BaseTexture[];
    /** Approximate GPU memory in bytes. */
    byteLength: number;
}
/**
 * Create GPU buffers and textures for a decoded tile without scene meshes,
 * for `TileBatch`. `localToWorld` receives each primitive's glTF-space
 * matrix and returns its world matrix.
 */
export declare function createTileDrawables(tile: DecodedGoogleTile, engine: AbstractEngine, name: string, localToWorld: (primitive: DecodedGooglePrimitive) => Matrix): TileDrawables;
/**
 * Create GPU resources for a decoded tile. `localToWorld` receives each
 * primitive's glTF-space matrix and returns its frozen world matrix. Bitmaps
 * are released after upload; a lost context reloads tiles rather than
 * keeping a second copy of every image in memory.
 */
export declare function createGoogleTileMeshes(tile: DecodedGoogleTile, scene: Scene, material: Material, name: string, localToWorld: (primitive: DecodedGooglePrimitive) => Matrix): GoogleTileMeshes;
