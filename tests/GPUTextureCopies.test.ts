import { describe, expect, it, vi } from "vitest";
import { copyTextureArrayLayers } from "../examples-npm/globe-mode/src/GPUTextureCopies";

function fixture() {
    const source = { width: 16, height: 4, depthOrArrayLayers: 1, dimension: "2d", sampleCount: 1,
        format: "rgba8unorm", mipLevelCount: 5, usage: 1 } as GPUTexture;
    const sources = [{ ...source }, { ...source }, { ...source }] as GPUTexture[];
    const target = { ...source, depthOrArrayLayers: 3, usage: 2 } as GPUTexture;
    const copy = vi.fn();
    const finish = vi.fn(() => ({}));
    const submit = vi.fn();
    const createCommandEncoder = vi.fn(() => ({ copyTextureToTexture: copy, finish }));
    const device = { createCommandEncoder, queue: { submit } } as unknown as GPUDevice;
    return { sources, target, device, copy, finish, submit, createCommandEncoder };
}

describe("GPU terrain texture copies", () => {
    it("preserves the full mip chain for every array layer, including one-pixel rectangular mips", () => {
        const f = fixture();
        copyTextureArrayLayers(f.device, f.sources, f.target);
        expect(f.copy).toHaveBeenCalledTimes(15);
        for (let layer = 0; layer < 3; layer++) {
            const copies = f.copy.mock.calls.filter(([, destination]) => destination.origin.z === layer);
            expect(copies.map(([source]) => source.texture)).toEqual(Array(5).fill(f.sources[layer]));
            expect(copies.map(([source]) => source.mipLevel)).toEqual([0, 1, 2, 3, 4]);
            expect(copies.map(([, , extent]) => [extent.width, extent.height])).toEqual([[16, 4], [8, 2], [4, 1], [2, 1], [1, 1]]);
            expect(copies.every(([, destination, extent]) => destination.texture === f.target && extent.depthOrArrayLayers === 1)).toBe(true);
        }
        expect(f.submit).toHaveBeenCalledExactlyOnceWith([f.finish.mock.results[0].value]);
    });
    it.each([{ format: "rgba8unorm-srgb" }, { width: 8 }, { mipLevelCount: 1 }, { usage: 0 }, { sampleCount: 4 }])(
        "rejects incompatible source textures before submitting partial work: %j", mismatch => {
            const f = fixture();
            f.sources[1] = { ...f.sources[1], ...mismatch } as GPUTexture;
            expect(() => copyTextureArrayLayers(f.device, f.sources, f.target)).toThrow(/matching/);
            expect(f.createCommandEncoder).not.toHaveBeenCalled();
            expect(f.submit).not.toHaveBeenCalled();
        });
});
