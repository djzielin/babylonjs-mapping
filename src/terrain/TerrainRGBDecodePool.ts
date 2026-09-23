import type { ElevationGrid } from "./TerrainRGB.js";
import type { TerrainRGBEncoding } from "./TerrainRGBDecode.js";

type Task = { blob: Blob; encoding: TerrainRGBEncoding; resolve: (grid: ElevationGrid) => void; reject: (error: Error) => void };

/** Keep image decoding and pixel readback off the render thread. */
export class TerrainRGBDecodePool {
    private static shared?: TerrainRGBDecodePool;
    public static get(): TerrainRGBDecodePool | undefined {
        if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return undefined;
        if (this.shared?.failed) return undefined;
        return this.shared ??= new TerrainRGBDecodePool();
    }
    private workers = new Map<Worker, Task | undefined>();
    private queue: Task[] = [];
    private failed = false;
    public decode(blob: Blob, encoding: TerrainRGBEncoding): Promise<ElevationGrid> {
        if (this.failed) return Promise.reject(new Error("Terrain decoder workers unavailable"));
        return new Promise((resolve, reject) => { this.queue.push({ blob, encoding, resolve, reject }); this.drain(); });
    }
    private drain(): void {
        const limit = Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 4)));
        while (this.queue.length) {
            let worker = [...this.workers].find(([, task]) => !task)?.[0];
            if (!worker && this.workers.size >= limit) return;
            try {
                if (!worker) {
                    worker = new Worker(new URL("./TerrainRGBDecodeWorker.js", import.meta.url), { type: "module" });
                    const current = worker;
                    worker.onmessage = event => {
                        const task = this.workers.get(current);
                        this.workers.set(current, undefined);
                        if (event.data.error) { task?.reject(new Error(event.data.error)); this.fail(); return; }
                        task?.resolve(event.data as ElevationGrid);
                        this.drain();
                    };
                    worker.onerror = () => this.fail();
                }
                const task = this.queue.shift()!;
                this.workers.set(worker, task);
                worker.postMessage({ blob: task.blob, encoding: task.encoding });
            } catch { this.fail(); return; }
        }
    }
    private fail(): void {
        this.failed = true;
        const error = new Error("Terrain decoder workers unavailable");
        for (const [worker, task] of this.workers) { worker.terminate(); task?.reject(error); }
        this.workers.clear();
        this.queue.splice(0).forEach(task => task.reject(error));
    }
}
