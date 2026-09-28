import { Vector3 } from "@babylonjs/core/Maths/math.js";
import { decodeTerrainRGB, repairIsolatedTerrainSpikes, smoothNearSeaLevel } from "./TerrainRGBDecode.js";
import { TerrainRGBDecodePool } from "./TerrainRGBDecodePool.js";

export interface ElevationGrid {
    data: ArrayLike<number>;
    width: number;
    height: number;
}
export type ElevationLoader = (
    coordinates: Vector3,
    signal: AbortSignal,
) => Promise<ElevationGrid>;
export interface TerrainRGBOptions {
    url?: string;
    encoding?: "terrarium" | "mapbox";
    maxZoom?: number;
    cacheSize?: number;
}
type PendingGrid = { promise: Promise<ElevationGrid>; controller: AbortController; users: number };
/** Numeric DEM streaming, including negative ocean depths. No GPU readback. */
export default class TerrainRGB {
    private cache = new Map<string, ElevationGrid>();
    private cropped = new Map<string, ElevationGrid>();
    private pending = new Map<string, PendingGrid>();
    private url: string;
    private encoding: "terrarium" | "mapbox";
    private maxZoom: number;
    private cacheSize: number;
    constructor(options: TerrainRGBOptions = {}) {
        this.url =
            options.url ??
            "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
        this.encoding = options.encoding ?? "terrarium";
        this.maxZoom = options.maxZoom ?? 15;
        this.cacheSize = options.cacheSize ?? 64;
        if (
            !Number.isInteger(this.maxZoom) ||
            this.maxZoom < 0 ||
            this.maxZoom > 22 ||
            !Number.isInteger(this.cacheSize) ||
            this.cacheSize < 0
        )
            throw new RangeError("Invalid terrain cache size or zoom");
    }
    public static decode(
        pixels: ArrayLike<number>,
        encoding: "terrarium" | "mapbox",
    ): Float32Array {
        return decodeTerrainRGB(pixels, encoding);
    }
    /** Remove single-pixel DEM pits/ridges without flattening broad terrain or bathymetry. */
    public static repairIsolatedSpikes(grid: ElevationGrid, sourceZoom: number): ElevationGrid {
        const repaired = repairIsolatedTerrainSpikes(grid.data, grid.width, grid.height, sourceZoom);
        return repaired ? { data: repaired, width: grid.width, height: grid.height } : grid;
    }
    public static smoothNearSeaLevel = smoothNearSeaLevel;
    /** Resample a child of an overzoomed source without losing its geographic bounds. */
    public static crop(
        grid: ElevationGrid,
        coordinates: Vector3,
        sourceZoom: number,
    ): ElevationGrid {
        const factor = 2 ** (coordinates.z - sourceZoom),
            size = Math.max(2, Math.ceil(grid.width / factor) + 1);
        const ox = ((coordinates.x % factor) + factor) % factor,
            oy = ((coordinates.y % factor) + factor) % factor;
        const data = new Float32Array(size * size);
        for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++) {
                const sx = Math.min(
                    grid.width - 1,
                    ((ox + x / (size - 1)) / factor) * grid.width,
                );
                const sy = Math.min(
                    grid.height - 1,
                    ((oy + y / (size - 1)) / factor) * grid.height,
                );
                const x0 = Math.floor(sx),
                    y0 = Math.floor(sy),
                    x1 = Math.min(x0 + 1, grid.width - 1),
                    y1 = Math.min(y0 + 1, grid.height - 1),
                    tx = sx - x0,
                    ty = sy - y0;
                data[y * size + x] =
                    (grid.data[y0 * grid.width + x0] * (1 - tx) +
                        grid.data[y0 * grid.width + x1] * tx) *
                        (1 - ty) +
                    (grid.data[y1 * grid.width + x0] * (1 - tx) +
                        grid.data[y1 * grid.width + x1] * tx) *
                        ty;
            }
        return { data, width: size, height: size };
    }
    public load: ElevationLoader = async (coords, signal) => {
        signal.throwIfAborted();
        const childKey = `${coords.z}/${coords.x}/${coords.y}`;
        const reused = this.cropped.get(childKey);
        if (reused) {
            this.cropped.delete(childKey);
            this.cropped.set(childKey, reused);
            return reused;
        }
        const z = Math.min(coords.z, this.maxZoom),
            factor = 2 ** (coords.z - z),
            n = 2 ** z;
        const x = ((Math.floor(coords.x / factor) % n) + n) % n,
            y = Math.max(0, Math.min(n - 1, Math.floor(coords.y / factor)));
        const url = this.url
            .replace("{z}", String(z))
            .replace("{x}", String(x))
            .replace("{y}", String(y));
        signal.throwIfAborted();
        let grid = this.cache.get(url);
        if (!grid) {
            let pending = this.pending.get(url);
            if (!pending || pending.controller.signal.aborted) {
                // Overzoomed children share one decoded source. A moving caller must
                // not abort the same request still needed by its neighbours.
                const controller = new AbortController();
                let entry!: PendingGrid;
                const promise = this.fetchGrid(url, z, controller.signal).then(grid => {
                    if (!controller.signal.aborted) {
                        this.cache.set(url, grid);
                        while (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value!);
                    }
                    return grid;
                }).finally(() => {
                    if (this.pending.get(url) === entry) this.pending.delete(url);
                });
                pending = entry = { controller, users: 0, promise };
                this.pending.set(url, pending);
            }
            const entry = pending;
            entry.users++;
            let released = false;
            const release = () => {
                if (released) return;
                released = true;
                entry.users--;
                if (entry.users === 0 && this.pending.get(url) === entry) entry.controller.abort();
            };
            signal.addEventListener("abort", release, { once: true });
            try { grid = await entry.promise; }
            finally { signal.removeEventListener("abort", release); release(); }
        }
        signal.throwIfAborted();
        this.cache.delete(url);
        this.cache.set(url, grid);
        while (this.cache.size > this.cacheSize)
            this.cache.delete(this.cache.keys().next().value!);
        const cropped = TerrainRGB.crop(grid, coords, z);
        if (this.cacheSize) {
            this.cropped.set(childKey, cropped);
            while (this.cropped.size > this.cacheSize * 8)
                this.cropped.delete(this.cropped.keys().next().value!);
        }
        return cropped;
    };
    private async fetchGrid(url: string, sourceZoom: number, signal: AbortSignal): Promise<ElevationGrid> {
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error(`Elevation HTTP ${response.status}`);
        const blob = await response.blob();
        signal.throwIfAborted();
        const workers = TerrainRGBDecodePool.get();
        if (workers) try {
            const grid = await workers.decode(blob, this.encoding, sourceZoom);
            signal.throwIfAborted();
            // A worker can outlive a hot update to the decoder. A shallow
            // coastal tile with a deep sample needs validation before its DEM
            // reaches globe geometry. Already-repaired tiles only pay for a
            // linear range check; the normal repair stays off the render thread.
            let minimum = Infinity, maximum = -Infinity;
            for (let i = 0; i < grid.data.length; i++) {
                minimum = Math.min(minimum, grid.data[i]);
                maximum = Math.max(maximum, grid.data[i]);
            }
            // A corrupt tile can be entirely water, so a positive sample is
            // not required before checking deep pits. Small raised patches in
            // otherwise low terrain need the same audit after a stale worker.
            const suspectCoast = sourceZoom >= 8 && (minimum < -20
                || sourceZoom >= 10 && maximum > 40 && minimum < 10);
            const checked = suspectCoast ? TerrainRGB.repairIsolatedSpikes(grid, sourceZoom) : grid;
            const smoothed = smoothNearSeaLevel(checked.data, sourceZoom);
            return smoothed ? { ...checked, data: smoothed } : checked;
        } catch {
            signal.throwIfAborted();
            /* Unsupported workers use the same main-thread decoder. */
        }
        const bitmap = await createImageBitmap(blob, {
            colorSpaceConversion: "none", premultiplyAlpha: "none",
        });
        try {
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext("2d")!;
            context.drawImage(bitmap, 0, 0);
            const grid = TerrainRGB.repairIsolatedSpikes({
                data: TerrainRGB.decode(context.getImageData(0, 0, bitmap.width, bitmap.height).data, this.encoding),
                width: bitmap.width, height: bitmap.height,
            }, sourceZoom);
            const smoothed = smoothNearSeaLevel(grid.data, sourceZoom);
            signal.throwIfAborted();
            return smoothed ? { ...grid, data: smoothed } : grid;
        } finally { bitmap.close(); }
    }
    public clearCache(): void {
        this.cache.clear();
        this.cropped.clear();
    }
}
