/** Share one preparation slice across concurrent tile jobs in a scene. */
export class SceneWorkBudget {
    scene;
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
    nextOrder = 0;
    eye = [NaN, NaN, NaN];
    waiting = [];
    disposed = false;
    fallback;
    constructor(scene, milliseconds = 1) {
        this.scene = scene;
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
    checkpoint(priority, urgency = 1) {
        if (this.disposed || performance.now() < this.deadline)
            return undefined;
        return new Promise(resolve => {
            const task = { priority, score: priority(), urgency, order: this.nextOrder++, resolve };
            let low = 0, high = this.waiting.length;
            while (low < high) {
                const mid = (low + high) >>> 1;
                if (this.waiting[mid].urgency < task.urgency
                    || this.waiting[mid].urgency === task.urgency && this.waiting[mid].score <= task.score)
                    low = mid + 1;
                else
                    high = mid;
            }
            this.waiting.splice(low, 0, task);
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
        const eye = this.scene.activeCamera?.globalPosition;
        if (!eye || eye.x !== this.eye[0] || eye.y !== this.eye[1] || eye.z !== this.eye[2]) {
            for (const task of this.waiting)
                task.score = task.priority();
            this.waiting.sort((a, b) => a.urgency - b.urgency || a.score - b.score || a.order - b.order);
            if (eye) {
                this.eye[0] = eye.x;
                this.eye[1] = eye.y;
                this.eye[2] = eye.z;
            }
        }
        this.drain(true);
    }
    drain(first = false) {
        if (!this.waiting.length)
            return;
        if (!first && performance.now() >= this.deadline) {
            this.scheduleFallback();
            return;
        }
        this.waiting.shift().resolve();
        // The resumed producer runs first, consuming this same shared deadline.
        queueMicrotask(() => this.drain());
    }
}
//# sourceMappingURL=SceneWorkBudget.js.map