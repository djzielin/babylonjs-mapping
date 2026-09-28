import { expect, it, vi } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import TerrainRGB from "../src/terrain/TerrainRGB.js";
import { TerrainRGBDecodePool } from "../src/terrain/TerrainRGBDecodePool.js";

it("decodes signed terrain pixels in a worker and transfers the exact height grid", async () => {
    const postMessage = vi.fn();
    const close = vi.fn();
    const worker = { postMessage, onmessage: undefined as ((event: MessageEvent<{ blob: Blob; encoding: "terrarium" | "mapbox" }>) => Promise<void>) | undefined };
    vi.stubGlobal("self", worker);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 2, height: 1, close })));
    vi.stubGlobal("OffscreenCanvas", class {
        getContext() { return { drawImage() {}, getImageData() { return { data: Uint8ClampedArray.from([128, 0, 0, 255, 127, 255, 0, 255]) }; } }; }
    });
    try {
        await import("../src/terrain/TerrainRGBDecodeWorker.js");
        await worker.onmessage!({ data: { blob: new Blob(), encoding: "terrarium" } } as MessageEvent<{ blob: Blob; encoding: "terrarium" }>);
        const [grid, options] = postMessage.mock.lastCall!;
        expect(Array.from(grid.data)).toEqual([0, -1]);
        expect([grid.width, grid.height]).toEqual([2, 1]);
        expect(options.transfer).toEqual([grid.data.buffer]);
        expect(close).toHaveBeenCalledOnce();
    } finally {
        vi.unstubAllGlobals();
    }
});

it("repairs an impossible river pit even when a stale worker returns raw heights", async () => {
    const data = new Float32Array(64 * 64).fill(2);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) data[y * 64 + x] = -15400;
    const decode = vi.fn(async () => ({ data, width: 64, height: 64 }));
    const worker = vi.spyOn(TerrainRGBDecodePool, "get").mockReturnValue({ decode } as unknown as TerrainRGBDecodePool);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob() })));
    try {
        const grid = await new TerrainRGB({ maxZoom: 15 }).load(new Vector3(0, 0, 15), new AbortController().signal);
        expect(decode).toHaveBeenCalledOnce();
        expect(Math.min(...grid.data)).toBeGreaterThan(0);
        expect(data[0]).toBe(-15400);
    } finally {
        worker.mockRestore();
        vi.unstubAllGlobals();
    }
});
