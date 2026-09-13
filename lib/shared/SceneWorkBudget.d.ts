import type { Scene } from "@babylonjs/core/scene.js";
/** Share one preparation slice across concurrent tile jobs in a scene. */
export declare class SceneWorkBudget {
    private milliseconds;
    private static scenes;
    static forScene(scene: Scene): SceneWorkBudget;
    private deadline;
    private waiting;
    private disposed;
    private fallback?;
    constructor(scene: Scene, milliseconds?: number);
    checkpoint(priority: () => number): Promise<void> | undefined;
    private scheduleFallback;
    private nextSlice;
    private drain;
}
