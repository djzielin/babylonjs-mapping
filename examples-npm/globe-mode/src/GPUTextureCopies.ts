import type {} from "@babylonjs/core/Engines/webgpuEngine";
import { TextureUsage } from "@babylonjs/core/Engines/WebGPU/webgpuConstants";

/** Preserve every existing mip and pixel when combining raster textures. */
export function copyTextureArrayLayers(device: GPUDevice, sources: readonly GPUTexture[], target: GPUTexture): void {
    if (!(target.usage & TextureUsage.CopyDst) || target.depthOrArrayLayers !== sources.length
        || target.dimension !== "2d" || target.sampleCount !== 1
        || sources.some(source => source.format !== target.format
            || source.width !== target.width || source.height !== target.height
            || source.mipLevelCount !== target.mipLevelCount || source.sampleCount !== 1
            || source.dimension !== "2d" || source.depthOrArrayLayers !== 1
            || !(source.usage & TextureUsage.CopySrc))) {
        throw new Error("Terrain texture copies require matching dimensions, formats and mip chains");
    }
    const encoder = device.createCommandEncoder({ label: "terrain array copies" });
    for (let layer = 0; layer < sources.length; layer++) {
        for (let mip = 0; mip < target.mipLevelCount; mip++) {
            encoder.copyTextureToTexture({ texture: sources[layer], mipLevel: mip },
                { texture: target, mipLevel: mip, origin: { z: layer } },
                { width: Math.max(1, target.width >> mip), height: Math.max(1, target.height >> mip), depthOrArrayLayers: 1 });
        }
    }
    device.queue.submit([encoder.finish()]);
}
