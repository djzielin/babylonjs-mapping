/** A scene owns a small worker pool; camera movement reprioritizes queued work. */
export class BuildingWorkerPool {
    static pools = new WeakMap();
    static forScene(scene) {
        if (typeof Worker === "undefined")
            return undefined;
        let pool = this.pools.get(scene);
        if (!pool) {
            pool = new BuildingWorkerPool();
            this.pools.set(scene, pool);
            scene.onDisposeObservable.addOnce(() => pool.dispose());
        }
        return pool.failed || pool.disposed ? undefined : pool;
    }
    workers = new Map();
    queue = [];
    disposed = false;
    failed = false;
    run(job, valid, priority) {
        if (this.disposed || this.failed)
            return Promise.reject(new Error("Building workers unavailable"));
        return new Promise((resolve, reject) => { this.queue.push({ job, valid, priority, resolve, reject }); this.drain(); });
    }
    drain() {
        const limit = Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 4)));
        // Enqueueing another tile cannot change a fully occupied worker pool.
        // Rank the pending camera positions when a worker actually becomes free.
        if (this.workers.size >= limit && ![...this.workers.values()].some(task => !task))
            return;
        this.queue = this.queue.filter(task => { if (task.valid())
            return true; task.resolve(undefined); return false; });
        for (const task of this.queue)
            task.distance = task.priority();
        this.queue.sort((a, b) => a.distance - b.distance);
        while (this.queue.length) {
            let worker = [...this.workers].find(([, task]) => !task)?.[0];
            if (!worker && this.workers.size >= limit)
                return;
            try {
                if (!worker) {
                    worker = new Worker(new URL("./GlobeBuildingWorker.js", import.meta.url), { type: "module" });
                    const current = worker;
                    worker.onmessage = event => {
                        const task = this.workers.get(current);
                        this.workers.set(current, undefined);
                        if (event.data.error)
                            task?.reject(new Error(event.data.error));
                        else
                            task?.resolve(task.valid() ? event.data.result : undefined);
                        this.drain();
                    };
                    worker.onerror = () => this.fail();
                }
                const task = this.queue.shift();
                this.workers.set(worker, task);
                worker.postMessage(task.job);
            }
            catch {
                this.fail();
                return;
            }
        }
    }
    fail() { this.failed = true; this.dispose(); }
    dispose() {
        this.disposed = true;
        const error = new Error("Building worker pool stopped");
        for (const [worker, task] of this.workers) {
            worker.terminate();
            task?.reject(error);
        }
        this.workers.clear();
        this.queue.splice(0).forEach(task => task.reject(error));
    }
}
//# sourceMappingURL=BuildingWorkerPool.js.map