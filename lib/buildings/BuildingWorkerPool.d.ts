import type { Scene } from "@babylonjs/core/scene.js";
import type { BuildingGeometryJob, BuildingGeometryResult } from "./GlobeBuildingWorker.js";
type Task = {
    job: BuildingGeometryJob;
    valid: () => boolean;
    priority: () => number;
    resolve: (result: BuildingGeometryResult | undefined) => void;
    reject: (error: Error) => void;
};
/** A scene owns a small worker pool; camera movement reprioritizes queued work. */
export declare class BuildingWorkerPool {
    private static pools;
    static forScene(scene: Scene): BuildingWorkerPool | undefined;
    private workers;
    private queue;
    private disposed;
    private failed;
    run(job: BuildingGeometryJob, valid: Task["valid"], priority: Task["priority"]): Promise<BuildingGeometryResult | undefined>;
    private drain;
    private fail;
    dispose(): void;
}
export {};
