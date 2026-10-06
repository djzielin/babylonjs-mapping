import { Observable } from "@babylonjs/core/Misc/observable.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type GlobeSet from "./GlobeSet.js";
import type Tile from "./Tile.js";
import type Buildings from "../buildings/Buildings.js";
import type { ElevationLoader } from "../terrain/TerrainRGB.js";
export interface GlobeFeatureQueueOptions {
    /** Bound queued and in-flight provider work across every participating globe tier. */
    maxPendingRequests?: number;
}
interface GlobeFeatureRequest {
    owner: GlobeDataController;
    tile: Tile;
    providers: Buildings[];
    valid: () => boolean;
    priority: () => number;
    submitted: (provider: Buildings) => void;
    discarded: () => void;
    complete: () => void;
    failed: (error: unknown) => void;
}
/** Shares a small, reprioritized feature admission window across globe LOD tiers. */
export declare class GlobeFeatureQueue {
    private readonly scene;
    readonly options: GlobeFeatureQueueOptions;
    private requests;
    private providers;
    private observer;
    private timer?;
    private timerIsFallback;
    private disposed;
    constructor(scene: Scene, options?: GlobeFeatureQueueOptions);
    get pendingTileCount(): number;
    get pendingRequestCount(): number;
    enqueue(request: GlobeFeatureRequest): void;
    cancel(owner: GlobeDataController): void;
    private schedule;
    /** Admit the best currently useful tile as soon as a provider slot is free. */
    flush(): void;
    dispose(): void;
}
export interface GlobeDataOptions {
    elevation?: ElevationLoader;
    buildings?: Buildings;
    features?: Buildings[];
    minTerrainZoom?: number;
    minBuildingZoom?: number;
    maxBuildingZoom?: number;
    minFeatureZoom?: number;
    maxFeatureZoom?: number;
    concurrency?: number;
    /** Suspend new terrain and feature work while retaining useful resident data. */
    enabled?: boolean;
    /** Keep terrain streaming while deferring buildings and roads. */
    featuresEnabled?: boolean;
    /** Share bounded feature admissions across all LOD tiers. */
    featureQueue?: GlobeFeatureQueue;
    /** Lower scores win shared feature slots; recomputed when the queue drains. */
    featurePriority?: (tile: Tile) => number;
    /** Omit feature tiles outside the current useful area without delaying DEM. */
    featureFilter?: (tile: Tile) => boolean;
    /** Prefer the active camera frustum when streaming large landscape windows. */
    prioritizeVisible?: boolean;
    exaggeration?: number;
}
/** Bounded camera-driven detail loading. Retained tiles keep all their data. */
export default class GlobeDataController {
    readonly globe: GlobeSet;
    readonly options: GlobeDataOptions;
    readonly onErrorObservable: Observable<Error>;
    readonly stats: {
        active: number;
        completed: number;
        cancelled: number;
        failed: number;
        postedRefills: number;
        timerRefills: number;
    };
    private jobs;
    private ready;
    private terrainReady;
    private queuedFeatures;
    private submittedFeatures;
    private retryAt;
    private observer;
    private disposed;
    private refillTimer?;
    private refillChannel?;
    private refillQueued;
    private nextPriorityCheck;
    private priorityCamera?;
    private priorityRevision;
    private settled;
    private tiles;
    private positionObserver;
    private providers;
    constructor(globe: GlobeSet, options?: GlobeDataOptions);
    /** Number of current tiles still waiting for geometry or required elevation. */
    get pendingTerrainCount(): number;
    get isTerrainReady(): boolean;
    setEnabled(enabled: boolean): void;
    setFeaturesEnabled(enabled: boolean): void;
    /** Readmit a covered tile's features when its imagery replacement disappears. */
    requeueFeatures(tile: Tile): void;
    private needsTerrain;
    update(): void;
    private load;
    private featureDistance;
    private recordFailure;
    private scheduleRefill;
    /** Explicitly retry failures or reload after changing provider settings. */
    invalidate(preserveTerrain?: boolean, preserveBuildings?: boolean): void;
    dispose(): void;
}
export {};
