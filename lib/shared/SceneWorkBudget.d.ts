import type { Scene } from "@babylonjs/core/scene.js";
/** Share one preparation slice across concurrent tile jobs in a scene. */
export declare class SceneWorkBudget {
    private scene;
    private milliseconds;
    private static scenes;
    static forScene(scene: Scene): SceneWorkBudget;
    private deadline;
    private nextOrder;
    private eye;
    private camera?;
    private cameraRevision;
    private waiting;
    private disposed;
    private fallback?;
    private postedTask?;
    private posted;
    constructor(scene: Scene, milliseconds?: number, fallbackMode?: "timer" | "posted");
    checkpoint(priority: () => number, urgency?: number): Promise<void> | undefined;
    private scheduleFallback;
    private nextSlice;
    private drain;
}
