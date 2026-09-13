/** Share one preparation slice across concurrent tile jobs in a scene. */
export class SceneWorkBudget {
    milliseconds;
    static scenes = new WeakMap();
    static forScene(scene) {
        let budget = this.scenes.get(scene);
        if (!budget) {
            budget = new SceneWorkBudget(scene);
            this.scenes.set(scene, budget);
        }
        return budget;
    }
    deadline = 0;
    waiting = [];
    disposed = false;
    fallback;
    constructor(scene, milliseconds = 1) {
        this.milliseconds = milliseconds;
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
    checkpoint(priority) {
        if (this.disposed || performance.now() < this.deadline)
            return undefined;
        return new Promise(resolve => {
            this.waiting.push({ priority, resolve });
            this.scheduleFallback();
        });
    }
    scheduleFallback() {
        // Preparation also works before the application starts its render loop.
        if (!this.disposed && this.waiting.length && this.fallback === undefined)
            this.fallback = setTimeout(() => this.nextSlice(), 16);
    }
    nextSlice() {
        clearTimeout(this.fallback);
        this.fallback = undefined;
        this.deadline = performance.now() + this.milliseconds;
        this.drain(true);
    }
    drain(first = false) {
        if (!this.waiting.length)
            return;
        if (!first && performance.now() >= this.deadline) {
            this.scheduleFallback();
            return;
        }
        this.waiting.sort((a, b) => a.priority() - b.priority());
        this.waiting.shift().resolve();
        // The resumed producer runs first, consuming this same shared deadline.
        queueMicrotask(() => this.drain());
    }
}
//# sourceMappingURL=SceneWorkBudget.js.map