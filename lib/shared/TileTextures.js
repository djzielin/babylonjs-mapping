import { Constants } from "@babylonjs/core/Engines/constants.js";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { InternalTexture, InternalTextureSource } from "@babylonjs/core/Materials/Textures/internalTexture.js";
const COMPRESSED_RGB_S3TC_DXT1 = 0x83f0;
/** True when textures can be uploaded as BC1: WebGL with S3TC support. */
export function supportsBC1(engine) {
    return !engine.isWebGPU && !!engine.getCaps().s3tc && "_gl" in engine;
}
/**
 * Upload a decoded image as a trilinear, anisotropic texture. Bitmaps are
 * released once on the GPU; a lost context reloads tiles rather than keeping
 * a second copy of every image in memory.
 */
export function createDecodedTexture(image, engine, name) {
    let internal, byteLength;
    if (image.bc1) {
        internal = createBC1Texture(engine, image.bc1, image.width, image.height);
        byteLength = image.bc1.reduce((total, level) => total + level.byteLength, 0);
    }
    else {
        internal = engine.createTexture(name, false, false, null, Constants.TEXTURE_TRILINEAR_SAMPLINGMODE, null, null, image.bitmap);
        internal._buffer = null;
        byteLength = image.width * image.height * 4 * 4 / 3;
        image.bitmap.close();
    }
    const texture = new BaseTexture(engine, internal);
    texture.wrapU = image.wrapU;
    texture.wrapV = image.wrapV;
    texture.anisotropicFilteringLevel = 16;
    return { texture, byteLength };
}
/** Upload a BC1 mip chain as a trilinear-filtered texture. */
function createBC1Texture(engine, levels, width, height) {
    const texture = new InternalTexture(engine, InternalTextureSource.Unknown);
    texture.baseWidth = texture.width = width;
    texture.baseHeight = texture.height = height;
    texture.format = COMPRESSED_RGB_S3TC_DXT1;
    texture.generateMipMaps = levels.length > 1;
    texture.invertY = false;
    const gl = engine._gl;
    engine._bindTextureDirectly(gl.TEXTURE_2D, texture, true);
    levels.forEach((data, level) => engine._uploadCompressedDataToTextureDirectly(texture, COMPRESSED_RGB_S3TC_DXT1, Math.max(1, width >> level), Math.max(1, height >> level), data, 0, level));
    engine._bindTextureDirectly(gl.TEXTURE_2D, null);
    // Mipmaps are uploaded, not generated: compressed formats cannot generate them.
    engine.updateTextureSamplingMode(Constants.TEXTURE_TRILINEAR_SAMPLINGMODE, texture, false);
    texture.isReady = true;
    return texture;
}
//# sourceMappingURL=TileTextures.js.map