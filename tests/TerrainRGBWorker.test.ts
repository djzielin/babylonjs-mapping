import { expect, it, vi } from "vitest";

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
