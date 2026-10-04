import { expect, it, vi } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import TerrainRGB from "../src/terrain/TerrainRGB.js";
import { TerrainRGBDecodePool } from "../src/terrain/TerrainRGBDecodePool.js";
import { TERRAIN_REPAIR_VERSION } from "../src/terrain/TerrainRGBDecode.js";

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
        expect(grid.repairVersion).toBe(TERRAIN_REPAIR_VERSION);
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

it("repairs a moderate riverbank seam returned by a stale worker", async () => {
    const data = new Float32Array(64 * 64).fill(2);
    for (let y = 8; y < 56; y++) data[y * 64 + 32] = -76;
    const worker = vi.spyOn(TerrainRGBDecodePool, "get").mockReturnValue({
        decode: vi.fn(async () => ({ data, width: 64, height: 64 })),
    } as unknown as TerrainRGBDecodePool);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob() })));
    try {
        const grid = await new TerrainRGB({ maxZoom: 15 }).load(new Vector3(0, 0, 15), new AbortController().signal);
        expect(Math.min(...grid.data)).toBeGreaterThan(0);
        expect(data[30 * 64 + 32]).toBe(-76);
    } finally {
        worker.mockRestore();
        vi.unstubAllGlobals();
    }
});

it("repairs a deep pit when a stale worker returns an all-water tile", async () => {
    const data = new Float32Array(64 * 64).fill(-1);
    for (let y = 8; y < 32; y++) for (let x = 8; x < 32; x++) data[y * 64 + x] = -15000;
    const worker = vi.spyOn(TerrainRGBDecodePool, "get").mockReturnValue({
        decode: vi.fn(async () => ({ data, width: 64, height: 64 })),
    } as unknown as TerrainRGBDecodePool);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob() })));
    try {
        const grid = await new TerrainRGB({ maxZoom: 15 }).load(new Vector3(0, 0, 15), new AbortController().signal);
        expect(Math.min(...grid.data)).toBeGreaterThan(-20);
        expect(data[12 * 64 + 12]).toBe(-15000);
    } finally {
        worker.mockRestore();
        vi.unstubAllGlobals();
    }
});

it("repairs a raised waterfront patch when a stale worker returns only positive heights", async () => {
    const data = new Float32Array(64 * 64).fill(2);
    for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) data[y * 64 + x] = 80;
    const worker = vi.spyOn(TerrainRGBDecodePool, "get").mockReturnValue({
        decode: vi.fn(async () => ({ data, width: 64, height: 64 })),
    } as unknown as TerrainRGBDecodePool);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob() })));
    try {
        const grid = await new TerrainRGB({ maxZoom: 15 }).load(new Vector3(0, 0, 15), new AbortController().signal);
        expect(Math.max(...grid.data)).toBeLessThan(10);
        expect(data[12 * 64 + 12]).toBe(80);
    } finally {
        worker.mockRestore();
        vi.unstubAllGlobals();
    }
});

it("repairs a moderate regional ridge returned by a stale worker", async () => {
    const data = new Float32Array(64 * 64).fill(2);
    data[33 * 64 + 34] = 21;
    const worker = vi.spyOn(TerrainRGBDecodePool, "get").mockReturnValue({
        decode: vi.fn(async () => ({ data, width: 64, height: 64 })),
    } as unknown as TerrainRGBDecodePool);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob() })));
    try {
        const grid = await new TerrainRGB({ maxZoom: 12 }).load(new Vector3(0, 0, 12), new AbortController().signal);
        expect(grid.data[33 * 64 + 34]).toBeLessThan(1);
        expect(data[33 * 64 + 34]).toBe(21);
    } finally {
        worker.mockRestore();
        vi.unstubAllGlobals();
    }
});

it("refetches terrain when cached grids use an older repair version", async () => {
    const terrain = new TerrainRGB({ maxZoom: 14 });
    const stale = { data: new Float32Array(4).fill(59), width: 2, height: 2,
        repairVersion: TERRAIN_REPAIR_VERSION - 1 };
    const source = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/0/0.png";
    (terrain as any).cache.set(source, stale);
    (terrain as any).cropped.set("14/0/0", stale);
    const fetchGrid = vi.spyOn(terrain as any, "fetchGrid").mockResolvedValue({
        data: new Float32Array(4).fill(2), width: 2, height: 2,
        repairVersion: TERRAIN_REPAIR_VERSION,
    });
    const grid = await terrain.load(new Vector3(0, 0, 14), new AbortController().signal);
    expect(fetchGrid).toHaveBeenCalledOnce();
    expect(Array.from(grid.data)).toEqual(new Array(9).fill(2));
    expect(grid.repairVersion).toBe(TERRAIN_REPAIR_VERSION);
});

it("aborts a shared DEM fetch only after every moving tile releases it", async () => {
    const terrain = new TerrainRGB({ maxZoom: 14 });
    const signals: AbortSignal[] = [];
    const fetchGrid = vi.spyOn(terrain as any, "fetchGrid").mockImplementation((_url: string, _zoom: number, signal: AbortSignal) => {
        signals.push(signal);
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const first = new AbortController(), second = new AbortController();
    const a = terrain.load(new Vector3(0, 0, 15), first.signal);
    const b = terrain.load(new Vector3(1, 0, 15), second.signal);
    expect(fetchGrid).toHaveBeenCalledOnce();
    first.abort();
    expect(signals[0].aborted).toBe(false);
    second.abort();
    expect(signals[0].aborted).toBe(true);
    await expect(a).rejects.toBeDefined();
    await expect(b).rejects.toBeDefined();
    const third = new AbortController();
    const c = terrain.load(new Vector3(0, 0, 15), third.signal);
    expect(fetchGrid).toHaveBeenCalledTimes(2);
    third.abort();
    await expect(c).rejects.toBeDefined();
});

it("passes the final consumer's cancellation through to the DEM HTTP request", async () => {
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
        requestSignal = init.signal as AbortSignal;
        return new Promise((_resolve, reject) => requestSignal!.addEventListener("abort",
            () => reject(requestSignal!.reason), { once: true }));
    }));
    try {
        const controller = new AbortController();
        const load = new TerrainRGB().load(new Vector3(0, 0, 15), controller.signal);
        expect(requestSignal).toBeDefined();
        controller.abort();
        expect(requestSignal!.aborted).toBe(true);
        await expect(load).rejects.toBeDefined();
    } finally { vi.unstubAllGlobals(); }
});
