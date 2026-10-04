import type { Scene } from "@babylonjs/core/scene.js";

type Waiting = { priority: () => number; score: number; order: number; resolve: () => void };

/** Share one preparation slice across concurrent tile jobs in a scene. */
export class SceneWorkBudget {
    private static scenes = new WeakMap<Scene, SceneWorkBudget>();
    public static forScene(scene: Scene): SceneWorkBudget {
        let budget = this.scenes.get(scene);
        if (!budget) { budget = new SceneWorkBudget(scene); this.scenes.set(scene, budget); }
        return budget;
    }
    private deadline = 0;
    private nextOrder = 0;
    private eye = [NaN, NaN, NaN];
    private waiting: Waiting[] = [];
    private disposed = false;
    private fallback?: ReturnType<typeof setTimeout>;
    constructor(private scene: Scene, private milliseconds = 1) {
        const frame = scene.onAfterRenderObservable.add(() => {
            this.nextSlice();
        });
        scene.onDisposeObservable.addOnce(() => {
            this.disposed = true;
            clearTimeout(this.fallback);
            scene.onAfterRenderObservable.remove(frame);
            this.waiting.splice(0).forEach(task => task.resolve());
        });
    }
    public checkpoint(priority: () => number): Promise<void> | undefined {
        if (this.disposed || performance.now() < this.deadline) return undefined;
        return new Promise(resolve => {
            const task = { priority, score: priority(), order: this.nextOrder++, resolve };
            let low = 0, high = this.waiting.length;
            while (low < high) {
                const mid = (low + high) >>> 1;
                if (this.waiting[mid].score <= task.score) low = mid + 1; else high = mid;
            }
            this.waiting.splice(low, 0, task);
            this.scheduleFallback();
        });
    }
    private scheduleFallback(): void {
        // Preparation also works before the application starts its render loop.
        if (!this.disposed && this.waiting.length && this.fallback === undefined)
            this.fallback = setTimeout(() => this.nextSlice(), 16);
    }
    private nextSlice(): void {
        clearTimeout(this.fallback); this.fallback = undefined;
        this.deadline = performance.now() + this.milliseconds;
        const eye = this.scene.activeCamera?.globalPosition;
        if (!eye || eye.x !== this.eye[0] || eye.y !== this.eye[1] || eye.z !== this.eye[2]) {
            for (const task of this.waiting) task.score = task.priority();
            this.waiting.sort((a, b) => a.score - b.score || a.order - b.order);
            if (eye) { this.eye[0] = eye.x; this.eye[1] = eye.y; this.eye[2] = eye.z; }
        }
        this.drain(true);
    }
    private drain(first = false): void {
        if (!this.waiting.length) return;
        if (!first && performance.now() >= this.deadline) { this.scheduleFallback(); return; }
        this.waiting.shift()!.resolve();
        // The resumed producer runs first, consuming this same shared deadline.
        queueMicrotask(() => this.drain());
    }
}
