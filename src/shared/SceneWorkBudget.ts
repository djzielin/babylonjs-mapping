import type { Scene } from "@babylonjs/core/scene.js";

type Waiting = { priority: () => number; resolve: () => void };

/** Share one preparation slice across concurrent tile jobs in a scene. */
export class SceneWorkBudget {
    private static scenes = new WeakMap<Scene, SceneWorkBudget>();
    public static forScene(scene: Scene): SceneWorkBudget {
        let budget = this.scenes.get(scene);
        if (!budget) { budget = new SceneWorkBudget(scene); this.scenes.set(scene, budget); }
        return budget;
    }
    private deadline = 0;
    private waiting: Waiting[] = [];
    private disposed = false;
    private fallback?: ReturnType<typeof setTimeout>;
    constructor(scene: Scene, private milliseconds = 1) {
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
            this.waiting.push({ priority, resolve });
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
        this.drain(true);
    }
    private drain(first = false): void {
        if (!this.waiting.length) return;
        if (!first && performance.now() >= this.deadline) { this.scheduleFallback(); return; }
        this.waiting.sort((a, b) => a.priority() - b.priority());
        this.waiting.shift()!.resolve();
        // The resumed producer runs first, consuming this same shared deadline.
        queueMicrotask(() => this.drain());
    }
}
