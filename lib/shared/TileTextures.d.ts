import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
/** An image decoded off the main thread, ready for upload. */
export interface DecodedImage {
    /** Uncompressed image. */
    bitmap?: ImageBitmap;
    /** BC1 (S3TC DXT1) mip chain, largest level first. */
    bc1?: Uint8Array[];
    width: number;
    height: number;
    /** Babylon address modes: CLAMP 0, WRAP 1, MIRROR 2. */
    wrapU: number;
    wrapV: number;
}
/** True when textures can be uploaded as BC1: WebGL with S3TC support. */
export declare function supportsBC1(engine: AbstractEngine): boolean;
/**
 * Upload a decoded image as a trilinear, anisotropic texture. Bitmaps are
 * released once on the GPU; a lost context reloads tiles rather than keeping
 * a second copy of every image in memory.
 */
export declare function createDecodedTexture(image: DecodedImage, engine: AbstractEngine, name: string): {
    texture: BaseTexture;
    byteLength: number;
};
