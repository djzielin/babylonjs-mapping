import type { Scene } from "@babylonjs/core/scene.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";

type Waiting = { priority: () => number; score: number; urgency: number; order: number; resolve: () => void };

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
    private camera?: Camera;
    private cameraRevision = -1;
    private waiting: Waiting[] = [];
    private disposed = false;
    private fallback?: ReturnType<typeof setTimeout>;
    private postedTask?: MessageChannel;
    private posted = false;
    constructor(private scene: Scene, private milliseconds = 1, fallbackMode: "timer" | "posted" = "timer") {
        if (fallbackMode === "posted" && typeof MessageChannel !== "undefined") {
            this.postedTask = new MessageChannel();
            this.postedTask.port1.onmessage = () => {
                this.posted = false;
                if (!this.disposed && this.waiting.length) this.nextSlice();
            };
        }
        const frame = scene.onAfterRenderObservable.add(() => {
            this.nextSlice();
        });
        scene.onDisposeObservable.addOnce(() => {
            this.disposed = true;
            clearTimeout(this.fallback);
            this.postedTask?.port1.close();
            this.postedTask?.port2.close();
            scene.onAfterRenderObservable.remove(frame);
            this.waiting.splice(0).forEach(task => task.resolve());
        });
    }
    public checkpoint(priority: () => number, urgency = 1): Promise<void> | undefined {
        if (this.disposed || performance.now() < this.deadline) return undefined;
        return new Promise(resolve => {
            const task = { priority, score: priority(), urgency, order: this.nextOrder++, resolve };
            let low = 0, high = this.waiting.length;
            while (low < high) {
                const mid = (low + high) >>> 1;
                if (this.waiting[mid].urgency < task.urgency
                    || this.waiting[mid].urgency === task.urgency && this.waiting[mid].score <= task.score)
                    low = mid + 1;
                else high = mid;
            }
            this.waiting.splice(low, 0, task);
            this.scheduleFallback();
        });
    }
    private scheduleFallback(): void {
        // Preparation also works before the application starts its render loop.
        // Posted startup slices yield to browser tasks without waiting a fixed
        // frame interval or inheriting nested-timer minimum delays.
        if (!this.disposed && this.waiting.length && this.postedTask) {
            if (!this.posted) { this.posted = true; this.postedTask.port2.postMessage(undefined); }
            return;
        }
        if (!this.disposed && this.waiting.length && this.fallback === undefined)
            this.fallback = setTimeout(() => this.nextSlice(), 16);
    }
    private nextSlice(): void {
        clearTimeout(this.fallback); this.fallback = undefined;
        this.deadline = performance.now() + this.milliseconds;
        const camera = this.scene.activeCamera;
        camera?.getViewMatrix?.();
        const eye = camera?.globalPosition;
        const revision = camera?.getTransformationMatrix?.().updateFlag ?? -1;
        if (camera !== this.camera || revision !== this.cameraRevision
            || !eye || eye.x !== this.eye[0] || eye.y !== this.eye[1] || eye.z !== this.eye[2]) {
            for (const task of this.waiting) task.score = task.priority();
            this.waiting.sort((a, b) => a.urgency - b.urgency || a.score - b.score || a.order - b.order);
            if (eye) { this.eye[0] = eye.x; this.eye[1] = eye.y; this.eye[2] = eye.z; }
            this.camera = camera ?? undefined;
            this.cameraRevision = revision;
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
