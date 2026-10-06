import { SceneWorkBudget } from "../shared/SceneWorkBudget.js";
import { PriorityQueue } from "../shared/PriorityQueue.js";
import { attachGoogleStaticAssetContainer } from "./GoogleStaticAssetContainer.js";
import { tryLoadGoogle3DFastModel, type GoogleFastModelTiming, type GoogleFastModelAtlasOptions } from "./Google3DFastModel.js";
import { safeToSkipGoogleCoastalRepair } from "./GoogleCoastalBounds.js";
import type GlobeSet from "../core/GlobeSet.js";
import { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { Frustum, Matrix, Vector2, Vector3 } from "@babylonjs/core/Maths/math.js";
import type { Plane } from "@babylonjs/core/Maths/math.js";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";

import { EPSG_Type } from "../core/TileMath.js";

import type TileSet from "../core/TileSet.js";

/** Google Maps Platform Map Tiles API Photorealistic 3D Tiles endpoint. */
export const GOOGLE_3D_TILES_ROOT_URL =
    "https://tile.googleapis.com/v1/3dtiles/root.json";

const WGS84_SEMI_MAJOR_AXIS = 6378137;
const WGS84_FIRST_ECCENTRICITY_SQUARED = 6.6943799901413165e-3;
const RADIANS_PER_DEGREE = Math.PI / 180;
let nextModelFileId = 0;
const fastTimingFields = { parse: "fastParseMs", creation: "fastCreationMs", material: "fastMaterialMs", geometry: "fastGeometryMs",
    atlasUpdate: "fastAtlasUpdateMs", atlasReady: "fastAtlasReadyMs", atlasBitmap: "fastAtlasBitmapMs" } as const;

export interface Google3DTileset {
    asset?: {
        version?: string;
        [key: string]: unknown;
    };
    geometricError?: number;
    root: Google3DTile;
    [key: string]: unknown;
}

export interface Google3DTile {
    boundingVolume?: Google3DBoundingVolume;
    children?: Google3DTile[];
    content?: Google3DTileContent;
    contents?: Google3DTileContent[];
    geometricError?: number;
    refine?: "ADD" | "REPLACE" | string;
    transform?: number[];
    [key: string]: unknown;
}

export interface Google3DBoundingVolume {
    /** west, south, east, north, minimum height, maximum height in radians/meters. */
    region?: number[];
    /** 3D Tiles box in the standard twelve-value format. */
    box?: number[];
    /** center x/y/z followed by radius. */
    sphere?: number[];
    [key: string]: unknown;
}

export interface Google3DTileContent {
    uri?: string;
    url?: string;
    mimeType?: string;
    [key: string]: unknown;
}

export interface Google3DTilesOrigin {
    /** WGS84 latitude in degrees. */
    latitude: number;
    /** WGS84 longitude in degrees. */
    longitude: number;
    /** WGS84 ellipsoid height in meters. */
    height?: number;
}

export interface GoogleGLBMetadata {
    /** Individual attribution sources from glTF asset.copyright. */
    attributions: string[];
    /** CESIUM_RTC center in the tile's ECEF coordinate system, when present. */
    rtcCenter?: Vector3;
}

export interface LoadedGoogleModelTile {
    asset: AssetContainer;
    attributions: readonly string[];
    rtcCenter?: Vector3;
    /** The default GLB loader sets false when decoding produced no drawable mesh. */
    renderable?: boolean;
}

export type GoogleTilesetLoader = (url: string) => Promise<Google3DTileset>;

export type GoogleModelTileLoader = (
    url: string,
    scene: Scene,
    signal?: AbortSignal,
) => Promise<LoadedGoogleModelTile | undefined>;

export type Google3DLoadingStage = "coverage" | "immediate" | "refinement";

export interface Google3DLoadOptions {
    /** Coverage uses a coarse full-disk frontier; immediate refines the nearby part of that same frontier. */
    stage?: Google3DLoadingStage;
    /** Radius of nearby quality demand in metres; defaults to 750. Keep selectionRadius at the full coverage radius. */
    detailRadius?: number;
    /** Source error tolerated by the coarse frontier in metres; defaults to 256. */
    coverageGeometricError?: number;
    /** Optional tighter source-error target for recognizable coverage around the viewer. */
    coverageNearGeometricError?: number;
    /** Ground radius of tighter baseline demand, in metres; defaults to 750 when a near error is supplied. */
    coverageNearRadius?: number;
    /** Optional strict source-error target for the central core, independently of the near/far targets. */
    coverageCoreGeometricError?: number;
    /** Ground radius of the strict central core, in metres; defaults to 100 when a core error is supplied. */
    coverageCoreRadius?: number;
    /** Download/decode now, but publish models only after this promise resolves (for example terrain readiness). */
    publicationBarrier?: Promise<unknown>;
    /** Cancels an unresolved publication barrier and its unpublished model work. */
    publicationSignal?: AbortSignal;
    /** With a publication barrier, fetch bodies now but defer native model decoding until the barrier opens. */
    deferModelPreparationUntilPublication?: boolean;
    /** Optional decoded atlas preview edge for distant refinable coverage models; full source remains the default. */
    coverageAtlasMaxSize?: number;
}

export interface Google3DLoadResult {
    stage: Google3DLoadingStage;
    cancelled: boolean;
    selectedTiles: number;
    loadedTiles: number;
    /** Selected content still missing or hidden after the pass, including failed downloads. */
    failedTiles: number;
    /** Model attempts that failed, even if an existing parent supplied fallback coverage. */
    failedModelTiles: number;
    hierarchyFailures: number;
    /** Up to eight final failures, without request URLs, credentials, or server-provided messages. */
    hierarchyFailureSamples: Array<{ type: "network" | "http" | "response" | "loader"; status?: number; attempts: number }>;
    nearHierarchyFailures: number;
    nearFailedModelTiles: number;
    budgetLimitedTiles: number;
    sourceLimitedTiles: number;
    /** Intersecting source branches with neither model content nor an available fallback ancestor. */
    sourceCoverageGaps: number;
    nearSourceCoverageGaps: number;
    /** Every model in a nonempty complete frontier is visible and hierarchy traversal succeeded. */
    coverageComplete: boolean;
    /** Complete coverage at the configured near and far baseline error targets. */
    coverageQualityComplete: boolean;
    /** Target quality is met nearby; every distant miss is a visible finest-source leaf. */
    coverageAvailableQualityComplete: boolean;
    /** Nearby recognizable baseline is complete even when distant source leaves exceed the far target. */
    nearCoverageQualityComplete: boolean;
    coverageQualityMissingTiles: number;
    coverageNearQualityMissingTiles: number;
    coverageCoreQualityMissingTiles: number;
    /** Up to sixteen source-error bands, with distance-tier counts, for measuring startup demand. */
    geometricErrorHistogram: Array<{ geometricError?: number; selectedTiles: number; loadedTiles: number;
        coreTiles: number; nearTiles: number; immediateTiles: number }>;
    /** Complete visible frontier at the requested quality, without download, source, or budget limits. */
    detailComplete: boolean;
    /** Immediate frontier is visible at the display limit or the best available source quality, without budget limits. */
    immediateQualityComplete: boolean;
    immediateSelectedTiles: number;
    immediateLoadedTiles: number;
    immediateQualityMissingTiles: number;
    qualityLimitedSamples: Array<{ groundDistance: number; geometricError: number; depth: number; sourceLeaf: boolean }>;
}

export interface Google3DTilesOptions {
    /** Google Maps Platform API key. It is appended to every request. */
    apiKey?: string;
    /** Root tileset URL, primarily useful for compatible test endpoints. */
    rootUrl?: string;
    /** Maximum number of hierarchy levels visited for one load. */
    maxDepth?: number;
    /** Maximum quality-frontier demand. A bounded coarse reserve and existing finer residents may remain for coverage. */
    maxTiles?: number;
    /** Optional minimum coverage radius around the current map center, in metres. */
    coverageRadius?: number;
    /** Keep usable Google coverage across this region, including behind the camera. */
    coverageRegion?: { south: number; north: number; west: number; east: number };
    /** Stop refinement once source geometric error is below this value in metres. */
    maximumGeometricError?: number;
    /** Projected geometric error in physical pixels; globe scenes only. */
    maximumScreenSpaceError?: number;
    /** Omit budget-limited content above this source error (metres), leaving room for a fallback provider. */
    maximumDisplayGeometricError?: number;
    /** Maximum projected error ratio for a newly exposed broad Google model. Coarse residents remain until replacement is ready. */
    maximumInitialErrorRatio?: number;
    /** Stream only bounding volumes intersecting the active camera frustum. */
    cullToCamera?: boolean;
    /** Demand the same projected quality throughout the coverage disk, including behind the camera. */
    fullRadiusDemand?: boolean;
    /** Fixed vertical resolution used for full-radius geometric-error demand. */
    referenceImageHeight?: number;
    /** Fixed vertical field of view in radians used for full-radius geometric-error demand. */
    referenceFovY?: number;
    /** Concurrent native GLB decodes, including asynchronous texture/geometry preparation; defaults to 2. */
    maxConcurrentModelDecodes?: number;
    /** Concurrent hierarchy/model requests sharing the priority queue; defaults to 48. */
    maxConcurrentRequests?: number;
    /** Native models fetching or awaiting decode; defaults to 16, with up to 50% extra for newly urgent work. */
    maxBufferedModels?: number;
    /** Shared CPU preparation slice for coverage/immediate passes in milliseconds; defaults to 1. */
    startupTraversalSliceMs?: number;
    /** Opt in to direct preparation of supported static Google GLBs; unsupported formats use the native loader. */
    fastStaticModels?: boolean;
    /** Opt in to the compatible opaque-unlit material subset in the static loader; native PBR remains the default. */
    lightweightUnlitMaterials?: boolean;
    /** Metres added to ellipsoid heights to match the scene vertical datum. */
    heightOffset?: number;
    /** Multiplier applied to the local vertical axis after loading. */
    exaggeration?: number;
    /** Explicit local origin. Defaults to TileSet.centerCoords. */
    origin?: Google3DTilesOrigin;
    /** Injectable tileset JSON loader for tests or an application cache. */
    tilesetLoader?: GoogleTilesetLoader;
    /** Injectable GLB loader for tests or a custom Babylon loader. */
    modelTileLoader?: GoogleModelTileLoader;
}

export interface LoadedGoogle3DTile {
    /** Authenticated content URL. */
    url: string;
    /** Hierarchy depth at which the content was selected. */
    depth: number;
    /** Source error in metres, useful for distinguishing coarse coverage from detailed replacement. */
    geometricError?: number;
    /** Root transform that places the tile in the TileSet's local map space. */
    root: TransformNode;
    /** Babylon assets loaded from the GLB. */
    asset: AssetContainer;
    /** Attribution sources reported by the tile. */
    attributions: readonly string[];
}

interface GeographicBounds {
    south: number;
    north: number;
    longitudes: Array<[number, number]>;
    localVolume?: { origin: Vector3; axes: Vector3[]; minimum: number[]; maximum: number[] };
    circle?: { center: Vector3; east: Vector3; north: Vector3; radius: number };
}

interface TileSelection {
    geometricError?: number;
    hasRefinement?: boolean;
    refine?: string;
    ancestors?: string[];
    boundingVolume?: Google3DBoundingVolume;
    url: string;
    depth: number;
    transform?: number[];
}

interface FrontierTile {
    tile: Google3DTile;
    responseUrl: string;
    depth: number;
    transform: Matrix;
    refine: string;
    selections: TileSelection[];
    ancestors: string[];
    priority: number;
    offscreen: boolean;
    incompleteChildren?: boolean;
    incompleteChildrenNear?: boolean;
}

interface NetworkWaiter {
    priority: number | (() => number);
    kind: "hierarchy" | "model";
    resume: (offscreen: boolean | undefined) => void;
    wanted?: () => boolean;
    sequence: number;
    distance?: number;
}

class ChangedTileMap<T> extends Map<string, T> {
    constructor(private readonly changed: (url: string, previous: T | undefined, current: T | undefined) => void) { super(); }

    public override set(url: string, value: T): this {
        const previous = this.get(url);
        if (previous !== value) this.changed(url, previous, value);
        return super.set(url, value);
    }

    public override delete(url: string): boolean {
        const previous = this.get(url);
        const removed = super.delete(url);
        if (removed) this.changed(url, previous, undefined);
        return removed;
    }

    public override clear(): void {
        for (const [url, previous] of this) this.changed(url, previous, undefined);
        super.clear();
    }
}

interface LoadedTileset {
    tileset: Google3DTileset;
    url: string;
}

/**
 * Loads Google's Photorealistic 3D Tiles directly into a Babylon scene.
 *
 * Google serves an authenticated 3D Tiles hierarchy whose content is GLB.
 * This provider follows the hierarchy for the current TileSet extent, loads
 * the selected content into Babylon, and re-bases ECEF coordinates around the
 * TileSet center so that the existing local map and raster providers line up.
 * Call load() again after updateRaster() to refresh the selected area.
 */
export default class Google3DTiles {
    public apiKey = "";
    public rootUrl: string;
    public maxDepth: number;
    public maxTiles: number;
    public exaggeration: number;
    public coverageRadius?: number;
    /** Center of the latest geographic frontier admitted during the active load. */
    public selectedCoverageCenter?: { latitude: number; longitude: number };
    public coverageRegion?: Google3DTilesOptions["coverageRegion"];
    public maximumGeometricError = 0;
    public maximumScreenSpaceError?: number;
    public maximumDisplayGeometricError?: number;
    public maximumInitialErrorRatio?: number;
    public cullToCamera = false;
    public fullRadiusDemand = false;
    /** Completion of the latest load, suitable for gating staged startup. */
    public lastLoadResult?: Google3DLoadResult;
    /** Maximum hierarchy branches inspected in parallel during frontier selection. */
    public maxPendingHierarchy = 16;
    public referenceImageHeight: number;
    public referenceFovY: number;
    public maxConcurrentModelDecodes: number;
    public maxConcurrentRequests: number;
    public maxBufferedModels: number;
    public startupTraversalSliceMs: number;
    public fastStaticModels: boolean;
    public lightweightUnlitMaterials: boolean;
    public heightOffset = 0;
    public readonly stats = { hierarchyRequests: 0, hierarchyRetries: 0, rootResponseFingerprint: 0, modelRequests: 0, reusedModels: 0,
        networkQueueRebuilds: 0, networkPriorityEvaluations: 0, hierarchyQueuePriorityChecks: 0, hierarchyQueuePriorityChanges: 0,
        obsoleteModelRequests: 0, obsoleteHierarchyRequests: 0,
        detailLimitedTiles: 0, sourceLimitedTiles: 0,
        visibleDetailLimitedTiles: 0, offscreenDetailLimitedTiles: 0,
        visibleSourceLimitedTiles: 0, offscreenSourceLimitedTiles: 0,
        rootMs: 0, frontierTraversalMs: 0,
        frontierBudgetScanMs: 0, frontierBudgetScanCount: 0, frontierYieldCount: 0,
        frontierCommitMs: 0, replacementMs: 0, modelWaitMs: 0, loadMs: 0,
        modelFetchMs: 0, modelDecodeMs: 0, modelIntegrationMs: 0, modelIntegrationMaxMs: 0,
        modelFetchHeaderMs: 0, modelFetchBodyMs: 0,
        fastParseMs: 0, fastCreationMs: 0, fastMaterialMs: 0, fastGeometryMs: 0, fastAtlasUpdateMs: 0, fastAtlasReadyMs: 0, fastAtlasBitmapMs: 0,
        modelResponsePositiveMaxAgeCount: 0, modelResponseMaxAgeMinSeconds: 0, modelResponseMaxAgeMaxSeconds: 0,
        modelResourceTimingReadableCount: 0, modelResourceTimingUnavailableCount: 0, modelResourceTimingOpaqueCount: 0,
        modelResourceZeroTransferCount: 0, modelResourceTransferBytes: 0, modelResourceEncodedBytes: 0,
        coveragePreviewCandidateModels: 0, coveragePreviewModels: 0, coveragePreviewTextures: 0,
        coveragePreviewSelectedMaxSize: 0, coveragePreviewSourceMaxSize: 0, coveragePreviewDecodedMaxSize: 0,
        modelFetchCount: 0, modelFetchBytes: 0, staticContainerModels: 0, fastModelCount: 0, genericModelCount: 0, lightweightMaterialCount: 0,
        modelDecodeCount: 0, modelDecodeActive: 0, peakModelDecodeActive: 0,
        modelDecodeQueued: 0, peakModelDecodeQueued: 0, reusedDownloadedModels: 0,
        coastalSkirtTrianglesRemoved: 0,
        peakHierarchyActive: 0, peakModelActive: 0, peakNetworkActive: 0 };
    public origin?: Google3DTilesOrigin;

    private readonly tilesetLoader: GoogleTilesetLoader;
    private static readonly startupWorkBudgets = new WeakMap<Scene, Map<number, SceneWorkBudget>>();
    private readonly modelTileLoader: GoogleModelTileLoader;
    private readonly usesDefaultModelLoader: boolean;
    private rootTileset: Google3DTileset | undefined;
    private rootRequestKey = "";
    private rootRequest?: { key: string; generation: number | null; preparations: Set<() => boolean>; promise: Promise<Google3DTileset> };
    private session: string | undefined;
    private readonly externalTilesets = new Map<string, Promise<LoadedTileset>>();
    private readonly hierarchyPriorities = new Map<string, { queued: boolean; priority?: number }>();
    private readonly externalTilesetDemand = new Map<string, Set<{ generation: number | null; wanted?: () => boolean; priority: number | (() => number) }>>();
    private preparationEpoch = 0;
    private readonly preparationWaiters = new Set<() => void>();
    private readonly dirtyCoverageEntries = new Set<string>();
    private readonly attributionCounts = new Map<string, number>();
    private readonly loadedTiles = new ChangedTileMap<LoadedGoogle3DTile>((url, previous, current) => {
        this.dirtyCoverageEntries.add(url);
        this.attributionCacheValid = false;
        for (const [tile, delta] of [[previous, -1], [current, 1]] as const) if (tile)
            for (const attribution of new Set(tile.attributions)) {
                const count = (this.attributionCounts.get(attribution) ?? 0) + delta;
                if (count) this.attributionCounts.set(attribution, count);
                else this.attributionCounts.delete(attribution);
            }
    });
    private retainedTiles = new Map<string, LoadedGoogle3DTile>();
    private generation = 0;
    private frontierGeneration = -1;
    private desiredTiles = new Map<string, TileSelection>();
    private originStateKey = "";
    private originGeneration = 0;
    private readonly pendingModelUploads = new Set<() => void>();
    private publicationGate?: { generation: number; open: boolean; deferPreparation: boolean; wait: Promise<boolean>; cancel: () => void };
    private publicationQueued = 0;
    private preparationQueued = 0;
    private googleAttributionAdded = false;
    private attributionCacheValid = false;
    private attributionCache: string[] = [];
    private pendingModels = new Map<string, { generation: number; request: Promise<LoadedGoogle3DTile | undefined> }>();
    private readonly unusableModelURLs = new Set<string>();
    private readonly prefetchModels = new Set<string>();
    private activeModelFetches = new Map<string, { selection: TileSelection; controller: AbortController }>();
    private lastModelAbortEye?: Vector3;
    private selectionEye?: Vector3;
    private requestEye?: Vector3;
    private requestPriorityRevision = 0;
    private lastPriorityUpdateAt = -Infinity;
    private readonly movementWaiters = new Set<() => void>();
    private frustumCache?: { camera: Camera; updateFlag: number; planes: Plane[] };
    private frontierCache?: { key: string; selections: TileSelection[] };
    private networkActive = 0;
    private networkActiveOffscreen = 0;
    private networkActiveHierarchy = 0;
    private networkActiveModel = 0;
    private networkQueuedHierarchy = 0;
    private networkQueuedModel = 0;
    private networkDispatchCount = 0;
    private networkWaiters = new Set<NetworkWaiter>();
    private networkPendingInsertions: NetworkWaiter[] = [];
    private networkEnqueueSequence = 0;
    private networkQueueRevision = -1;
    private readonly networkQueues = {
        visibleHierarchy: new PriorityQueue<NetworkWaiter>((a, b) => a.distance! - b.distance! || a.sequence - b.sequence),
        visibleModel: new PriorityQueue<NetworkWaiter>((a, b) => a.distance! - b.distance! || a.sequence - b.sequence),
        offscreenHierarchy: new PriorityQueue<NetworkWaiter>((a, b) => a.distance! - b.distance! || a.sequence - b.sequence),
        offscreenModel: new PriorityQueue<NetworkWaiter>((a, b) => a.distance! - b.distance! || a.sequence - b.sequence),
    };
    private modelDecodeActive = 0;
    private modelDecodeWaiters: Array<{ priority: () => number; generation: number;
        reuse?: () => boolean; wanted?: () => boolean; resume: (ready: boolean) => void; distance?: number; evaluatedAt?: number }> = [];
    private pendingModelReuseBlocked = false;
    private pendingReuseBounds?: { revision: number; bounds: GeographicBounds };
    private loadingStage: Google3DLoadingStage = "refinement";
    private stageDetailRadius = 750;
    private stageCoverageGeometricError = 256;
    private stageCoverageNearGeometricError?: number;
    private stageCoverageNearRadius = 750;
    private stageCoverageCoreGeometricError?: number;
    private stageCoverageCoreRadius = 100;
    private stageCoverageAtlasMaxSize?: number;
    private coverageQualityEye?: { revision: number; eye: Vector3; east: Vector3; north: Vector3 };
    private readonly coverageDistances = new WeakMap<Google3DBoundingVolume, { revision: number; transformFlag: number; distance: number }>();
    private loadingPhase: "idle" | "root" | "frontier" | "replacement" | "models" = "idle";
    private frontierProgress?: () => { queued: number; pending: number };
    private replacementGroupsPending = 0;

    private canReusePendingModel(selection: TileSelection, origin: Google3DTilesOrigin): boolean {
        if (this.pendingModelReuseBlocked || this.getOriginStateKey(origin) !== this.originStateKey) return false;
        if (this.pendingReuseBounds?.revision !== this.requestPriorityRevision)
            this.pendingReuseBounds = { revision: this.requestPriorityRevision, bounds: this.getTileSetBounds() };
        const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
        return boundingVolumeIntersects(selection.boundingVolume, this.pendingReuseBounds.bounds, transform);
    }

    private canDecodeModel(generation: number, reuse?: () => boolean, wanted?: () => boolean): boolean {
        return generation === this.generation ? wanted?.() ?? true : !!reuse?.();
    }

    private drainModelDecode(): void {
        // A cancelled view must release its downloaded buffers even while all
        // decoder slots are busy with work from the previous generation.
        this.modelDecodeWaiters = this.modelDecodeWaiters.filter(waiter => {
            if (this.canDecodeModel(waiter.generation, waiter.reuse, waiter.wanted)) return true;
            waiter.resume(false);
            return false;
        });
        this.stats.modelDecodeQueued = this.modelDecodeWaiters.length;
        if (this.modelDecodeActive >= this.maxConcurrentModelDecodes || !this.modelDecodeWaiters.length) return;
        for (const waiter of this.modelDecodeWaiters) {
            if (waiter.evaluatedAt === this.requestPriorityRevision) continue;
            waiter.distance = waiter.priority();
            waiter.evaluatedAt = this.requestPriorityRevision;
        }
        this.modelDecodeWaiters.sort((a, b) => a.distance! - b.distance!);
        while (this.modelDecodeActive < this.maxConcurrentModelDecodes && this.modelDecodeWaiters.length) {
            const next = this.modelDecodeWaiters.shift()!;
            this.stats.modelDecodeQueued = this.modelDecodeWaiters.length;
            if (!this.canDecodeModel(next.generation, next.reuse, next.wanted)) { next.resume(false); continue; }
            this.modelDecodeActive++;
            next.resume(true);
        }
    }

    private async modelDecodeSlot<T>(work: () => Promise<T>, priority: () => number,
        generation: number, reuse?: () => boolean, wanted?: () => boolean): Promise<T | undefined> {
        const ready = await new Promise<boolean>(resume => {
            this.modelDecodeWaiters.push({ priority, generation, reuse, wanted, resume });
            this.stats.modelDecodeQueued = this.modelDecodeWaiters.length;
            this.stats.peakModelDecodeQueued = Math.max(this.stats.peakModelDecodeQueued, this.stats.modelDecodeQueued);
            this.drainModelDecode();
        });
        if (!ready) return undefined;
        try {
            if (!this.canDecodeModel(generation, reuse, wanted)) return undefined;
            if (generation !== this.generation) this.stats.reusedDownloadedModels++;
            return await work();
        } finally {
            this.modelDecodeActive--;
            this.drainModelDecode();
            this.drainNetwork();
        }
    }

    private networkDrainQueued = false;
    private networkQueueName(waiter: NetworkWaiter): keyof Google3DTiles["networkQueues"] {
        if (waiter.distance! >= 1e9) return waiter.kind === "hierarchy" ? "offscreenHierarchy" : "offscreenModel";
        return waiter.kind === "hierarchy" ? "visibleHierarchy" : "visibleModel";
    }

    private networkQueueFor(waiter: NetworkWaiter): PriorityQueue<NetworkWaiter> {
        return this.networkQueues[this.networkQueueName(waiter)];
    }

    private rebuildNetworkQueues(): void {
        if (this.networkQueueRevision !== this.requestPriorityRevision) {
            this.stats.networkQueueRebuilds++;
            const buckets = {
                visibleHierarchy: [] as NetworkWaiter[], visibleModel: [] as NetworkWaiter[],
                offscreenHierarchy: [] as NetworkWaiter[], offscreenModel: [] as NetworkWaiter[],
            };
            for (const waiter of this.networkWaiters) {
                if (waiter.wanted && !waiter.wanted()) { this.cancelNetworkWaiter(waiter); continue; }
                waiter.distance = typeof waiter.priority === "function" ? waiter.priority() : waiter.priority;
                this.stats.networkPriorityEvaluations++;
                buckets[this.networkQueueName(waiter)].push(waiter);
            }
            for (const name of Object.keys(buckets) as Array<keyof typeof buckets>)
                this.networkQueues[name].replaceAll(buckets[name]);
            this.networkPendingInsertions = [];
            this.networkQueueRevision = this.requestPriorityRevision;
            return;
        }
        for (const waiter of this.networkPendingInsertions) {
            if (!this.networkWaiters.has(waiter)) continue;
            waiter.distance = typeof waiter.priority === "function" ? waiter.priority() : waiter.priority;
            this.stats.networkPriorityEvaluations++;
            this.networkQueueFor(waiter).push(waiter);
        }
        this.networkPendingInsertions = [];
    }

    private cancelNetworkWaiter(waiter: NetworkWaiter): void {
        if (!this.networkWaiters.delete(waiter)) return;
        if (waiter.kind === "hierarchy") {
            this.networkQueuedHierarchy--; this.stats.obsoleteHierarchyRequests++;
        } else { this.networkQueuedModel--; this.stats.obsoleteModelRequests++; }
        waiter.resume(undefined);
    }

    private drainNetwork(): void {
        if (this.networkDrainQueued) return;
        this.networkDrainQueued = true;
        queueMicrotask(() => {
            this.networkDrainQueued = false;
            // Reclassify on camera changes. Between turns, enqueue and dispatch
            // use heaps rather than sorting the entire backlog per free slot.
            this.rebuildNetworkQueues();
            if (this.networkActive >= this.maxConcurrentRequests) return;
            const { visibleHierarchy, visibleModel, offscreenHierarchy, offscreenModel } = this.networkQueues;
            const best = (hierarchy: PriorityQueue<NetworkWaiter>, model: PriorityQueue<NetworkWaiter>) => {
                const a = hierarchy.peek(), b = model.peek();
                return !b || a && (a.distance! < b.distance!
                    || a.distance === b.distance && a.sequence < b.sequence) ? hierarchy : model;
            };
            let visible = visibleHierarchy.length + visibleModel.length;
            let offscreen = offscreenHierarchy.length + offscreenModel.length;
            while (this.networkActive < this.maxConcurrentRequests && this.networkWaiters.size) {
                // Give the full disk a small guaranteed share under a long
                // visible backlog, while leaving nearly every released slot
                // for the camera-facing quality deficit.
                const fairBackground = visible > 0 && offscreen > 0
                    && this.networkActiveOffscreen < 4 && this.networkDispatchCount % 8 === 7;
                let queue = fairBackground ? best(offscreenHierarchy, offscreenModel)
                    : visible ? best(visibleHierarchy, visibleModel)
                    : best(offscreenHierarchy, offscreenModel);
                let next = queue.peek()!;
                if (!this.networkWaiters.has(next) || next.wanted && !next.wanted()) {
                    queue.shift();
                    if (next.distance! >= 1e9) offscreen--; else visible--;
                    this.cancelNetworkWaiter(next);
                    continue;
                }
                if (this.usesDefaultModelLoader && next.kind === "model") {
                    const outstanding = this.networkActiveModel + this.modelDecodeActive + this.modelDecodeWaiters.length
                        + this.publicationQueued + this.preparationQueued;
                    if (outstanding >= this.maxBufferedModels) {
                        const worstDecode = this.modelDecodeWaiters.reduce((worst, waiter) =>
                            Math.max(worst, waiter.evaluatedAt === this.requestPriorityRevision
                                ? waiter.distance! : waiter.priority()), -Infinity);
                        // A newly visible quality deficit can exceed the normal
                        // buffer cap after a turn, without unbounded growth.
                        if (outstanding >= Math.ceil(this.maxBufferedModels * 1.5) || next.distance! >= worstDecode) {
                            const foreground = visibleHierarchy.peek(), background = offscreenHierarchy.peek();
                            if (!foreground && !background) break;
                            queue = !background || foreground && (foreground.distance! < background.distance!
                                || foreground.distance === background.distance && foreground.sequence < background.sequence)
                                ? visibleHierarchy : offscreenHierarchy;
                            next = queue.peek()!;
                        }
                    }
                }
                const isOffscreen = next.distance! >= 1e9;
                // Keep two slots ready for a sudden camera turn while the
                // stationary full-radius queue runs. Visible work always uses
                // the current priority order and can fill the request allowance.
                if (isOffscreen && visible === 0 && this.networkActive >= Math.max(1, this.maxConcurrentRequests - 2)) break;
                queue.shift();
                this.networkWaiters.delete(next);
                if (next.kind === "hierarchy") this.networkQueuedHierarchy--; else this.networkQueuedModel--;
                if (isOffscreen) offscreen--; else visible--;
                this.networkActive++;
                if (isOffscreen) this.networkActiveOffscreen++;
                if (next.kind === "hierarchy") this.networkActiveHierarchy++; else this.networkActiveModel++;
                this.stats.peakHierarchyActive = Math.max(this.stats.peakHierarchyActive, this.networkActiveHierarchy);
                this.stats.peakModelActive = Math.max(this.stats.peakModelActive, this.networkActiveModel);
                this.stats.peakNetworkActive = Math.max(this.stats.peakNetworkActive, this.networkActive);
                if (visible > 0 && offscreen > 0) this.networkDispatchCount++;
                next.resume(isOffscreen);
            }
        });
    }
    private async networkSlot<T>(work: (releaseSlot: () => void) => Promise<T>, priority: number | (() => number) = 0,
        kind: "hierarchy" | "model" = "hierarchy", wanted?: () => boolean): Promise<T> {
        const offscreen = await new Promise<boolean | undefined>(resolve => {
            const waiter: NetworkWaiter = { priority, kind, resume: resolve, wanted,
                sequence: this.networkEnqueueSequence++ };
            this.networkWaiters.add(waiter);
            if (kind === "hierarchy") this.networkQueuedHierarchy++; else this.networkQueuedModel++;
            this.networkPendingInsertions.push(waiter);
            this.drainNetwork();
        });
        if (offscreen === undefined) throw new DOMException("Queued Google work is no longer needed.", "AbortError");
        let released = false;
        const releaseSlot = () => {
            if (released) return;
            released = true;
            this.networkActive--;
            // Classification is fixed at dispatch, even if the camera turns.
            if (offscreen) this.networkActiveOffscreen--;
            if (kind === "hierarchy") this.networkActiveHierarchy--; else this.networkActiveModel--;
            this.drainNetwork();
        };
        try {
            if (wanted && !wanted()) throw new DOMException("Queued Google work is no longer needed.", "AbortError");
            return await work(releaseSlot);
        }
        finally { releaseSlot(); }
    }

    constructor(
        public readonly tileSet: TileSet,
        options: Google3DTilesOptions = {},
    ) {
        this.rootUrl = options.rootUrl ?? GOOGLE_3D_TILES_ROOT_URL;
        this.maxDepth = options.maxDepth ?? 20;
        this.maxTiles = options.maxTiles ?? 64;
        this.exaggeration = options.exaggeration ?? 1;
        this.coverageRadius = options.coverageRadius;
        this.coverageRegion = options.coverageRegion;
        this.maximumGeometricError = options.maximumGeometricError ?? 0;
        this.maximumScreenSpaceError = options.maximumScreenSpaceError;
        this.maximumDisplayGeometricError = options.maximumDisplayGeometricError;
        this.maximumInitialErrorRatio = options.maximumInitialErrorRatio;
        this.cullToCamera = options.cullToCamera ?? false;
        this.fullRadiusDemand = options.fullRadiusDemand ?? false;
        this.referenceImageHeight = options.referenceImageHeight ?? 2160;
        this.referenceFovY = options.referenceFovY ?? 0.8;
        this.maxConcurrentModelDecodes = options.maxConcurrentModelDecodes ?? 2;
        this.maxConcurrentRequests = options.maxConcurrentRequests ?? 48;
        this.maxBufferedModels = options.maxBufferedModels ?? 16;
        this.startupTraversalSliceMs = options.startupTraversalSliceMs ?? 1;
        this.fastStaticModels = options.fastStaticModels ?? false;
        this.lightweightUnlitMaterials = options.lightweightUnlitMaterials ?? false;
        this.heightOffset = options.heightOffset ?? 0;
        this.origin = options.origin;
        this.apiKey = options.apiKey ?? "";
        this.tilesetLoader = options.tilesetLoader ?? defaultTilesetLoader;
        this.usesDefaultModelLoader = !options.modelTileLoader;
        this.modelTileLoader = options.modelTileLoader ?? ((url, scene, signal) => defaultModelTileLoader(url, scene, this.stats, signal,
            undefined, undefined, this.fastStaticModels, undefined, this.lightweightUnlitMaterials));
    }

    /** Content currently attached to the Babylon scene. */
    public get loadedModelTiles(): readonly LoadedGoogle3DTile[] {
        return Array.from(this.loadedTiles.values());
    }

    /** Current queue occupancy, including work that can delay a startup-stage barrier. */
    public get loadingProgress() {
        const frontier = this.frontierProgress?.();
        return { stage: this.loadingStage, phase: this.loadingPhase,
            queuedFrontier: frontier?.queued ?? 0, pendingHierarchy: frontier?.pending ?? 0,
            replacementGroups: this.replacementGroupsPending, pendingModels: this.pendingModels.size,
            hierarchyActive: this.networkActiveHierarchy, modelActive: this.networkActiveModel,
            hierarchyQueued: this.networkQueuedHierarchy, modelQueued: this.networkQueuedModel,
            decodeActive: this.modelDecodeActive, decodeQueued: this.modelDecodeWaiters.length,
            uploadQueued: this.pendingModelUploads.size, publicationQueued: this.publicationQueued, preparationQueued: this.preparationQueued };
    }

    /** Current camera-facing resident quality, sampled independently of the last completed traversal. */
    public measureVisibleQuality(): { visibleTiles: number; underDetailedTiles: number; missingVisibleTiles: number;
        worstErrorRatio: number; worstDepth: number; worstGeometricError: number } {
        const eye = this.cameraEye();
        let visibleTiles = 0, underDetailedTiles = 0, missingVisibleTiles = 0, worstErrorRatio = 0;
        let worstDepth = 0, worstGeometricError = 0;
        for (const [url, selection] of this.loadedSelections) {
            if (!this.loadedTiles.has(url) || !selection.boundingVolume) continue;
            const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
            const allowed = this.allowedGeometricError(selection.boundingVolume, transform, false, eye, true);
            if (allowed < 0) continue;
            visibleTiles++;
            const ratio = selection.geometricError === undefined ? Infinity
                : selection.geometricError / Math.max(allowed, 1e-12);
            if (ratio > 1) underDetailedTiles++;
            if (ratio > worstErrorRatio) {
                worstErrorRatio = ratio;
                worstDepth = selection.depth;
                worstGeometricError = selection.geometricError ?? Infinity;
            }
        }
        for (const [url, selection] of this.desiredTiles) {
            if (this.loadedTiles.has(url) || !selection.boundingVolume) continue;
            const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
            if (this.allowedGeometricError(selection.boundingVolume, transform, false, eye, true) >= 0)
                missingVisibleTiles++;
        }
        return { visibleTiles, underDetailedTiles, missingVisibleTiles,
            worstErrorRatio, worstDepth, worstGeometricError };
    }

    /** Probe the current ground view independently of a possibly stale frontier. */
    public sampleVisibleSurfaceCoverage(): { sampled: number; missing: number } {
        const camera = this.tileSet.scene.activeCamera;
        if (!camera || !this.tileSet.isGlobe) return { sampled: 0, missing: 0 };
        camera.getViewMatrix();
        const globe = this.tileSet as GlobeSet;
        const engine = this.tileSet.scene.getEngine();
        const width = engine.getRenderWidth(), height = engine.getRenderHeight();
        const eye = globe.getSurfaceCoordinates(camera.globalPosition);
        const eyeGround = globe.getSurfacePosition(eye.latitude, eye.longitude);
        let sampled = 0, missing = 0;
        for (const [u, v] of [[0.25, 0.5], [0.5, 0.5], [0.75, 0.5],
            [0.25, 0.75], [0.5, 0.75], [0.75, 0.75]]) {
            const ray = this.tileSet.scene.createPickingRay(u * width, v * height, Matrix.Identity(), camera);
            // Babylon starts the picking ray on the camera's near plane. At
            // globe scale that plane can already be below the terrain.
            const origin = camera.globalPosition;
            const a = ray.direction.lengthSquared();
            const b = Vector3.Dot(origin, ray.direction);
            const c = origin.lengthSquared() - globe.radius * globe.radius;
            const discriminant = b * b - a * c;
            if (discriminant < 0) continue;
            const near = (-b - Math.sqrt(discriminant)) / a;
            const far = (-b + Math.sqrt(discriminant)) / a;
            const distance = near >= 0 ? near : far;
            if (distance < 0) continue;
            const ground = origin.add(ray.direction.scale(distance));
            if (this.coverageRadius && Vector3.Distance(ground, eyeGround) > this.coverageRadius * globe.metresToWorld)
                continue;
            const location = globe.getSurfaceCoordinates(ground);
            sampled++;
            if (!this.coversLocation(location.latitude, location.longitude)) missing++;
        }
        return { sampled, missing };
    }

    private coverageKey = "";
    private coverageVersion = 0;
    public get coverageRevision(): number { return this.coverageVersion; }
    private changedCoverageURLs?: readonly string[];
    private changedCoverageRevision = -1;
    private changedCoverageBounds: Array<GeographicBounds | undefined> = [];
    /** Conservatively test whether changed model bounds can affect a geographic tile. */
    public coverageChangesIntersect(
        urls: readonly string[], south: number, west: number, north: number, east: number,
    ): boolean {
        if (!urls.length) return false;
        if (urls !== this.changedCoverageURLs || this.changedCoverageRevision !== this.coverageVersion) {
            this.changedCoverageURLs = urls;
            this.changedCoverageRevision = this.coverageVersion;
            this.changedCoverageBounds = urls.map(url => {
                const selection = this.loadedSelections.get(url) ?? this.desiredTiles.get(url);
                return selection ? geographicEnvelope(selection) : undefined;
            });
        }
        const longitudes = longitudeIntervals(west, east);
        for (const bounds of this.changedCoverageBounds) {
            if (!bounds || bounds.north >= south && bounds.south <= north
                && bounds.longitudes.some(([left, right]) => longitudes.some(([queryLeft, queryRight]) =>
                    right >= queryLeft && left <= queryRight))) return true;
        }
        return false;
    }
    private coverageIndex = new Map<string, TileSelection[]>();
    private indexedCoverage = new Map<string, TileSelection>();
    private broadCoverage = new Map<string, TileSelection>();
    private coverageTests = new WeakMap<TileSelection, (latitude: number, longitude: number) => boolean>();
    private footprintEnvelopes = new WeakMap<TileSelection, GeographicBounds>();
    private footprintTests = new WeakMap<TileSelection, (south: number, west: number, north: number, east: number) => boolean>();
    private loadedSelections = new ChangedTileMap<TileSelection>(url => this.dirtyCoverageEntries.add(url));

    /** Whether loaded model bounds cover this position at an optional source-error limit. */
    public coversLocation(latitude: number, longitude: number, maximumGeometricError?: number): boolean {
        const key = `${this.coverageVersion}/${this.loadedTiles.size}`;
        if (this.coverageKey !== key || this.dirtyCoverageEntries.size) {
            this.coverageKey = key;
            for (const url of this.dirtyCoverageEntries) {
                const indexed = this.indexedCoverage.get(url);
                if (!indexed) continue;
                this.indexedCoverage.delete(url);
                if (!this.broadCoverage.delete(url)) {
                    const bounds = this.footprintEnvelopes.get(indexed);
                    if (bounds) for (const [west, east] of bounds.longitudes)
                        for (let x = Math.floor(west * 1000); x <= Math.floor(east * 1000); x++)
                        for (let y = Math.floor(bounds.south * 1000); y <= Math.floor(bounds.north * 1000); y++) {
                            const cell = `${x}/${y}`;
                            const entries = this.coverageIndex.get(cell);
                            if (!entries) continue;
                            const index = entries.indexOf(indexed);
                            if (index >= 0) entries.splice(index, 1);
                            if (!entries.length) this.coverageIndex.delete(cell);
                        }
                }
            }
            for (const url of this.dirtyCoverageEntries) {
                if (!this.loadedTiles.has(url)) continue;
                const selection = this.loadedSelections.get(url) ?? this.desiredTiles.get(url);
                if (!selection?.boundingVolume) continue;
                this.indexedCoverage.set(url, selection);
                const bounds = geographicEnvelope(selection);
                if (!bounds) {
                    this.broadCoverage.set(url, selection); continue;
                }
                this.footprintEnvelopes.set(selection, bounds);
                const south = Math.floor(bounds.south * 1000), north = Math.floor(bounds.north * 1000);
                const cells = bounds.longitudes.reduce((sum, [west, east]) =>
                    sum + (Math.floor(east * 1000) - Math.floor(west * 1000) + 1) * (north - south + 1), 0);
                if (cells > 4096) { this.broadCoverage.set(url, selection); continue; }
                for (const [west, east] of bounds.longitudes)
                    for (let x = Math.floor(west * 1000); x <= Math.floor(east * 1000); x++)
                    for (let y = south; y <= north; y++) {
                        const cell = `${x}/${y}`;
                        const entries = this.coverageIndex.get(cell) ?? [];
                        entries.push(selection); this.coverageIndex.set(cell, entries);
                    }
            }
            this.dirtyCoverageEntries.clear();
        }
        const nearby = this.coverageIndex.get(`${Math.floor(longitude * 1000)}/${Math.floor(latitude * 1000)}`) ?? [];
        for (const selection of nearby) if (this.coverageQualityMatches(selection, maximumGeometricError)
            && this.coverageTest(selection)(latitude, longitude)) return true;
        for (const selection of this.broadCoverage.values())
            if (this.coverageQualityMatches(selection, maximumGeometricError)
                && this.coverageTest(selection)(latitude, longitude)) return true;
        return false;
    }

    /** Skip a fallback tile only when one resident model covers its whole sampled footprint. */
    public coversAreaCompletely(south: number, west: number, north: number, east: number, maximumGeometricError?: number): boolean {
        if (south > north || ![south, west, north, east].every(Number.isFinite)) return false;
        const span = east >= west ? east - west : east + 360 - west;
        if (span > 180) return false;
        const longitudes = [west, west + span / 2, west + span].map(normalizeLongitude);
        const latitudes = [south, (south + north) / 2, north];
        const midpoint = longitudes[1], latitude = latitudes[1];
        // Rebuild the resident-only index before examining its center cell.
        this.coversLocation(latitude, midpoint);
        const nearby = this.coverageIndex.get(`${Math.floor(midpoint * 1000)}/${Math.floor(latitude * 1000)}`) ?? [];
        const covers = (selection: TileSelection) => {
            if (!this.coverageQualityMatches(selection, maximumGeometricError)) return false;
            const test = this.coverageTest(selection);
            return latitudes.every(lat => longitudes.every(lon => test(lat, lon)));
        };
        return nearby.some(covers) || Array.from(this.broadCoverage.values()).some(covers);
    }

    /** Whether a resident model overlaps a geographic building footprint. */
    public overlapsFootprint(south: number, west: number, north: number, east: number, maximumGeometricError?: number): boolean {
        if (!this.loadedTiles.size || south > north || ![south, west, north, east].every(Number.isFinite)) return false;
        // coversLocation also rebuilds the resident-only spatial index after a
        // replacement commits. A point query alone misses narrow tile edges
        // that pass between the building footprint's sample points.
        this.coversLocation((south + north) / 2, (west + east) / 2);
        const queryLongitudes = longitudeIntervals(west, east);
        const seen = new Set<TileSelection>();
        const overlaps = (selection: TileSelection): boolean => {
            if (seen.has(selection) || !this.coverageQualityMatches(selection, maximumGeometricError)) return false;
            seen.add(selection);
            let bounds = this.footprintEnvelopes.get(selection);
            if (!bounds) {
                bounds = geographicEnvelope(selection);
                if (bounds) this.footprintEnvelopes.set(selection, bounds);
            }
            return !!bounds && bounds.north >= south && bounds.south <= north
                && bounds.longitudes.some(([left, right]) => queryLongitudes.some(([queryLeft, queryRight]) =>
                    right >= queryLeft && left <= queryRight))
                && this.footprintTest(selection)(south, west, north, east);
        };
        const minY = Math.floor(south * 1000), maxY = Math.floor(north * 1000);
        const ranges = queryLongitudes.map(([left, right]) => [Math.floor(left * 1000), Math.floor(right * 1000)]);
        const cells = ranges.reduce((sum, [minX, maxX]) => sum + (maxX - minX + 1) * (maxY - minY + 1), 0);
        if (cells <= 4096) {
            for (const [minX, maxX] of ranges)
                for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++)
                    for (const selection of this.coverageIndex.get(`${x}/${y}`) ?? []) if (overlaps(selection)) return true;
        } else {
            for (const selection of this.loadedSelections.values())
                if (this.loadedTiles.has(selection.url) && overlaps(selection)) return true;
        }
        for (const selection of this.broadCoverage.values()) if (overlaps(selection)) return true;
        return false;
    }

    private coverageQualityMatches(selection: TileSelection, maximumGeometricError?: number): boolean {
        return maximumGeometricError === undefined || selection.geometricError === undefined
            || selection.geometricError <= maximumGeometricError;
    }

    private coverageTest(selection: TileSelection): (latitude: number, longitude: number) => boolean {
        let test = this.coverageTests.get(selection);
        if (!test) {
            test = compileVerticalIntersection(selection.boundingVolume!, selection.transform);
            this.coverageTests.set(selection, test);
        }
        return test;
    }

    private footprintTest(selection: TileSelection): (south: number, west: number, north: number, east: number) => boolean {
        let test = this.footprintTests.get(selection);
        if (!test) {
            test = compileBoxFootprintIntersection(selection.boundingVolume!, selection.transform);
            this.footprintTests.set(selection, test);
        }
        return test;
    }

    /** The last root tileset response, if load() has been called. */
    public get tileset(): Google3DTileset | undefined {
        return this.rootTileset;
    }

    /** The session token discovered in the tileset's child URIs. */
    public get sessionToken(): string | undefined {
        return this.session;
    }

    /** Returns attribution sources sorted by frequency, then alphabetically. */
    public getAttributions(): string[] {
        if (this.attributionCacheValid) return [...this.attributionCache];
        this.attributionCache = Array.from(this.attributionCounts.entries())
            .sort(([leftName, leftCount], [rightName, rightCount]) => {
                return rightCount - leftCount || leftName.localeCompare(rightName);
            })
            .map(([name]) => name);
        this.attributionCacheValid = true;
        return [...this.attributionCache];
    }

    /**
     * Resolves a Google 3D Tiles URI and adds the API key and session token.
     * Child URIs returned by Google are path/query components rather than
     * complete URLs, so callers should pass the URL of the response containing
     * the URI as baseUrl.
     */
    public getTileURL(uri: string, baseUrl = this.rootUrl): string {
        return this.authenticateURL(uri, baseUrl);
    }

    /** Cancel queued work while retaining the visible scene and hierarchy cache. */
    public cancelPendingLoad(preserveDownloadedModels = false): void {
        const unpublished = !!this.publicationGate && !this.publicationGate.open;
        this.pendingModelReuseBlocked = unpublished || !preserveDownloadedModels;
        this.generation++;
        this.publicationGate?.cancel();
        if (unpublished) for (const { controller } of this.activeModelFetches.values()) controller.abort();
        this.preparationEpoch++;
        for (const wake of this.preparationWaiters) wake();
        for (const waiter of this.networkWaiters) if (waiter.kind === "model" && waiter.wanted && !waiter.wanted())
            this.cancelNetworkWaiter(waiter);
        // A successor view can register interest in the same queued hierarchy
        // before the next microtask. Shared JSON work remains reusable on turns.
        this.networkQueueRevision = -1;
        this.drainModelDecode();
        this.drainNetwork();
        for (const wake of this.movementWaiters) wake();
    }

    /** The active frontier can follow camera movement without discarding its work. */
    public get selectingFrontier(): boolean {
        return this.frontierGeneration === this.generation;
    }

    /** Reorder queued downloads immediately when the camera moves, without cancelling active requests. */
    public reprioritizeRequests(): void {
        this.requestEye = this.cameraEye();
        this.requestPriorityRevision++;
        this.lastPriorityUpdateAt = performance.now();
        if (this.activeModelFetches.size && this.coverageRadius && !this.coverageRegion && this.tileSet.isGlobe
            && (!this.lastModelAbortEye || Vector3.Distance(this.lastModelAbortEye, this.requestEye) >= 250)) {
            this.lastModelAbortEye = this.requestEye.clone();
            const bounds = this.getTileSetBounds();
            for (const { selection, controller } of this.activeModelFetches.values()) {
                const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
                if (!boundingVolumeIntersects(selection.boundingVolume, bounds, transform)) controller.abort();
            }
        }
        this.drainNetwork();
        this.drainModelDecode();
        for (const wake of this.movementWaiters) wake();
    }

    /** Warm only the full-radius baseline JSON hierarchy. No GLBs, publication, stage, or readiness changes. */
    public prepareCoverageHierarchy(selectionRadius = this.coverageRadius, options: Google3DLoadOptions = {}, signal?: AbortSignal): Promise<void> {
        return this.prepareHierarchy("coverage", selectionRadius, options, signal);
    }

    /** Warm nearby detail JSON while baseline models load, retaining the same full-radius baseline policy. */
    public prepareImmediateHierarchy(selectionRadius = this.coverageRadius, options: Google3DLoadOptions = {}, signal?: AbortSignal): Promise<void> {
        return this.prepareHierarchy("immediate", selectionRadius, options, signal);
    }

    private async prepareHierarchy(stage: "coverage" | "immediate", selectionRadius: number | undefined,
        options: Google3DLoadOptions, signal?: AbortSignal): Promise<void> {
        this.tileSet.assertRasterSetup("prepare Google 3D Tiles hierarchy");
        this.validateOptions();
        for (const [name, value] of Object.entries({ selectionRadius, detailRadius: options.detailRadius,
            coverageGeometricError: options.coverageGeometricError, coverageNearGeometricError: options.coverageNearGeometricError,
            coverageNearRadius: options.coverageNearRadius, coverageCoreGeometricError: options.coverageCoreGeometricError,
            coverageCoreRadius: options.coverageCoreRadius }))
            if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new RangeError(`${name} must be positive and finite.`);
        const epoch = this.preparationEpoch, key = this.apiKey, rootUrl = this.rootUrl;
        let finished = false;
        const wanted = () => !finished && epoch === this.preparationEpoch && !signal?.aborted
            && key === this.apiKey && rootUrl === this.rootUrl;
        if (!wanted()) return;
        let wake!: () => void;
        const cancelled = new Promise<void>(resolve => { wake = resolve; });
        const abort = () => { wake(); this.networkQueueRevision = -1; this.drainNetwork(); };
        this.preparationWaiters.add(abort); signal?.addEventListener("abort", abort, { once: true });
        try {
            await Promise.race([this.loadRootTileset(null, wanted).catch(() => undefined), cancelled]);
            if (!wanted() || !this.rootTileset) return;
            const eye = this.cameraEye(), bounds = this.getTileSetBounds(selectionRadius);
            const scale = Math.sqrt((eye.x ** 2 + eye.y ** 2) / WGS84_SEMI_MAJOR_AXIS ** 2
                + eye.z ** 2 / (WGS84_SEMI_MAJOR_AXIS ** 2 * (1 - WGS84_FIRST_ECCENTRICITY_SQUARED)));
            const ground = scale > 0 ? eye.scale(1 / scale) : eye;
            const east = new Vector3(-ground.y, ground.x, 0).normalize();
            if (!east.lengthSquared()) east.set(0, 1, 0);
            const up = new Vector3(ground.x, ground.y, ground.z / (1 - WGS84_FIRST_ECCENTRICITY_SQUARED)).normalize();
            const north = Vector3.Cross(up, east).normalize();
            const budget = this.startupWorkBudget();
            type PreparedNode = { tile: Google3DTile; url: string; depth: number; transform: Matrix };
            const queue: PreparedNode[] = [{ tile: this.rootTileset.root, url: this.getRootTilesetURL(), depth: 0, transform: Matrix.Identity() }];
            const pending = new Set<Promise<void>>();
            const visit = async (node: PreparedNode) => {
                if (!wanted() || node.depth > this.maxDepth) return;
                const transform = getTileTransform(node.tile)?.multiply(node.transform) ?? node.transform;
                if (!boundingVolumeIntersects(node.tile.boundingVolume, bounds, transform)) return;
                const pause = budget.checkpoint(() => 2e9 + this.tilePriority(node.tile.boundingVolume, transform), 1);
                if (pause) await Promise.race([pause, cancelled]);
                if (!wanted()) return;
                const distance = !node.tile.boundingVolume ? 0 : this.tileSet.isGlobe
                    ? horizontalBoundsDistance(node.tile.boundingVolume, transform, ground, east, north)
                    : this.tilePriority(node.tile.boundingVolume, transform, eye);
                let allowed = options.coverageGeometricError ?? 256;
                if (options.coverageNearGeometricError !== undefined && distance <= (options.coverageNearRadius ?? 750))
                    allowed = Math.min(allowed, options.coverageNearGeometricError);
                if (options.coverageCoreGeometricError !== undefined && distance <= (options.coverageCoreRadius ?? 100))
                    allowed = Math.min(allowed, options.coverageCoreGeometricError);
                if (stage === "immediate" && distance <= (options.detailRadius ?? 750))
                    allowed = Math.min(this.maximumDisplayGeometricError ?? Infinity,
                        this.allowedGeometricError(node.tile.boundingVolume, transform, false, eye, false, false));
                const contents = getTileContents(node.tile);
                if (node.depth >= this.maxDepth || contents.some(content => !isTilesetContent(content))
                    && node.tile.geometricError !== undefined && node.tile.geometricError <= allowed) return;
                for (const child of node.tile.children ?? []) queue.push({ tile: { ...child,
                    boundingVolume: child.boundingVolume ?? node.tile.boundingVolume,
                    geometricError: child.geometricError ?? node.tile.geometricError }, url: node.url, depth: node.depth + 1, transform });
                await Promise.all(contents.filter(isTilesetContent).map(async content => {
                    const external = await this.loadExternalTileset(getContentURI(content), node.url,
                        () => 2e9 + this.tilePriority(node.tile.boundingVolume, transform), null, wanted);
                    if (wanted()) queue.push({ tile: external.tileset.root, url: external.url, depth: node.depth + 1, transform });
                }));
            };
            let visited = 0;
            const preparationLimit = Math.max(1, Math.min(64, Math.floor(this.maxConcurrentRequests / 4)));
            while (wanted() && (queue.length || pending.size)) {
                while (queue.length && pending.size < preparationLimit && visited++ < this.maxTiles * 8) {
                    const task = visit(queue.shift()!).catch(() => undefined).finally(() => pending.delete(task));
                    pending.add(task);
                }
                if (!pending.size) break;
                await Promise.race([...pending, cancelled]);
            }
        } finally {
            finished = true; this.preparationWaiters.delete(abort); signal?.removeEventListener("abort", abort);
            this.networkQueueRevision = -1; this.drainNetwork();
        }
    }

    private startupWorkBudget(): SceneWorkBudget {
        if (this.startupTraversalSliceMs === 1) return SceneWorkBudget.forScene(this.tileSet.scene);
        const budgets = Google3DTiles.startupWorkBudgets.get(this.tileSet.scene) ?? new Map<number, SceneWorkBudget>();
        Google3DTiles.startupWorkBudgets.set(this.tileSet.scene, budgets);
        const budget = budgets.get(this.startupTraversalSliceMs) ?? new SceneWorkBudget(this.tileSet.scene, this.startupTraversalSliceMs, "posted");
        budgets.set(this.startupTraversalSliceMs, budget);
        return budget;
    }

    private configurePublication(generation: number, options: Google3DLoadOptions): void {
        this.publicationGate?.cancel(); this.publicationGate = undefined;
        if (!options.publicationBarrier) return;
        let settled = false, resolve!: (ready: boolean) => void;
        const wait = new Promise<boolean>(ready => { resolve = ready; });
        const finish = (ready: boolean) => {
            if (settled) return;
            settled = true; gate.open = ready;
            options.publicationSignal?.removeEventListener("abort", abort);
            resolve(ready); this.drainNetwork();
        };
        const gate = this.publicationGate = { generation, open: false as boolean,
            deferPreparation: options.deferModelPreparationUntilPublication ?? false, wait, cancel: () => finish(false) };
        const abort = () => {
            if (settled || generation !== this.generation) return;
            finish(false); this.cancelPendingLoad();
        };
        options.publicationSignal?.addEventListener("abort", abort, { once: true });
        if (options.publicationSignal?.aborted) abort();
        void options.publicationBarrier.then(() => finish(generation === this.generation), abort);
    }

    private async awaitPublication(generation: number): Promise<boolean> {
        const gate = this.publicationGate;
        return generation === this.generation && (!gate || gate.generation !== generation || gate.open || await gate.wait)
            && generation === this.generation;
    }

    /**
     * Loads content overlapping selectionRadius while reusing the hierarchy and resident models.
     * Startup can await load(radius, {stage: "coverage"}), then load(radius,
     * {stage: "immediate", detailRadius: 750}), then load(radius) for normal refinement.
     * Both startup passes select the complete disk, so nearby replacement cannot remove distant coverage.
     */
    public async load(selectionRadius = this.coverageRadius, options: Google3DLoadOptions = {}): Promise<readonly LoadedGoogle3DTile[]> {
        const loadStarted = performance.now();
        this.tileSet.assertRasterSetup("load Google 3D Tiles");
        this.validateOptions();
        const stage = options.stage ?? "refinement";
        const detailRadius = options.detailRadius ?? 750;
        const coverageGeometricError = options.coverageGeometricError ?? 256;
        const coverageNearRadius = options.coverageNearRadius ?? 750;
        const coverageCoreRadius = options.coverageCoreRadius ?? 100;
        if (!["coverage", "immediate", "refinement"].includes(stage)) throw new RangeError("Unknown Google loading stage.");
        if (!Number.isFinite(detailRadius) || detailRadius <= 0) throw new RangeError("detailRadius must be positive and finite.");
        if (!Number.isFinite(coverageGeometricError) || coverageGeometricError <= 0)
            throw new RangeError("coverageGeometricError must be positive and finite.");
        if (!Number.isFinite(coverageNearRadius) || coverageNearRadius <= 0)
            throw new RangeError("coverageNearRadius must be positive and finite.");
        if (!Number.isFinite(coverageCoreRadius) || coverageCoreRadius <= 0)
            throw new RangeError("coverageCoreRadius must be positive and finite.");
        if (options.coverageNearGeometricError !== undefined
            && (!Number.isFinite(options.coverageNearGeometricError) || options.coverageNearGeometricError <= 0))
            throw new RangeError("coverageNearGeometricError must be positive and finite.");
        if (options.coverageCoreGeometricError !== undefined
            && (!Number.isFinite(options.coverageCoreGeometricError) || options.coverageCoreGeometricError <= 0))
            throw new RangeError("coverageCoreGeometricError must be positive and finite.");
        if (options.coverageAtlasMaxSize !== undefined && (!Number.isInteger(options.coverageAtlasMaxSize) || options.coverageAtlasMaxSize <= 0))
            throw new RangeError("coverageAtlasMaxSize must be a positive integer.");
        this.loadingStage = stage;
        this.loadingPhase = "root";
        this.stageDetailRadius = detailRadius;
        this.stageCoverageGeometricError = coverageGeometricError;
        this.stageCoverageNearGeometricError = options.coverageNearGeometricError;
        this.stageCoverageNearRadius = coverageNearRadius;
        this.stageCoverageCoreGeometricError = options.coverageCoreGeometricError;
        this.stageCoverageCoreRadius = coverageCoreRadius;
        this.stageCoverageAtlasMaxSize = options.coverageAtlasMaxSize;
        const result: Google3DLoadResult = this.lastLoadResult = { stage, cancelled: false, selectedTiles: 0, loadedTiles: 0,
            failedTiles: 0, failedModelTiles: 0, hierarchyFailures: 0, hierarchyFailureSamples: [], nearHierarchyFailures: 0, nearFailedModelTiles: 0,
            budgetLimitedTiles: 0, sourceLimitedTiles: 0, sourceCoverageGaps: 0, nearSourceCoverageGaps: 0,
            coverageComplete: false, coverageQualityComplete: false, coverageAvailableQualityComplete: false,
            nearCoverageQualityComplete: false,
            coverageQualityMissingTiles: 0, coverageNearQualityMissingTiles: 0, coverageCoreQualityMissingTiles: 0,
            geometricErrorHistogram: [],
            detailComplete: false, immediateQualityComplete: false, immediateSelectedTiles: 0, immediateLoadedTiles: 0,
            immediateQualityMissingTiles: 0, qualityLimitedSamples: [] };
        const cancelled = () => { result.cancelled = true; return [] as readonly LoadedGoogle3DTile[]; };

        this.selectionEye = this.cameraEye();
        this.requestEye = this.selectionEye;
        this.requestPriorityRevision++;
        this.pendingModelReuseBlocked = false;
        const residentAtStart = new Set([...this.loadedTiles.keys(), ...this.retainedTiles.keys()]);
        const generation = ++this.generation;
        this.configurePublication(generation, options);
        if (generation !== this.generation) return cancelled();
        this.drainModelDecode();
        this.unusableModelURLs.clear();
        const origin = this.getOrigin();
        const originStateKey = this.getOriginStateKey(origin);
        if (this.originStateKey !== "" && this.originStateKey !== originStateKey) {
            this.disposeLoadedTiles();
        }
        this.originStateKey = originStateKey;

        const residentAncestors = new Set<string>();
        const residentDetails = this.indexLoadedDescendants();
        const currentCoverage = this.getTileSetBounds();
        for (const [url, selection] of this.loadedSelections) if (this.loadedTiles.has(url)
            && boundingVolumeIntersects(selection.boundingVolume, currentCoverage,
                selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity()))
            for (const ancestor of selection.ancestors ?? []) residentAncestors.add(ancestor);
        // The new view can use prefetched coverage before hierarchy traversal
        // finishes. Keep it visible until the selected finer subtree commits.
        let promoted = false;
        for (const [url, tile] of this.retainedTiles) {
            if (this.publicationGate?.generation === generation && !this.publicationGate.open) break;
            const selection = this.loadedSelections.get(url);
            if (!selection || residentAncestors.has(url)
                || selection.ancestors?.some(ancestor => this.loadedTiles.has(ancestor))
                || !this.acceptableDisplayQuality(selection) || !this.acceptableInitialQuality(selection)) continue;
            const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
            if (this.allowedGeometricError(selection.boundingVolume, transform, false,
                this.selectionEye ?? this.cameraEye(), true) < 0) continue;
            this.retainedTiles.delete(url);
            this.loadedTiles.set(url, tile);
            tile.root.setEnabled(true);
            for (const ancestor of selection.ancestors ?? []) residentAncestors.add(ancestor);
            this.coverageKey = ""; this.coverageVersion++;
            promoted = true;
        }
        if (promoted) this.updateAttribution();

        await this.loadRootTileset(generation);
        this.stats.rootMs = performance.now() - loadStarted;
        if (generation !== this.generation) return cancelled();
        if (!this.rootTileset) {
            throw new Error("Google 3D Tiles root tileset was not loaded.");
        }

        const desiredTiles = new Map<string, TileSelection>();
        this.desiredTiles = desiredTiles;
        const modelRequests: Promise<unknown>[] = [];
        const startModel = (selection: TileSelection) => {
            modelRequests.push(this.loadTile(selection, origin, generation).catch((error: unknown) => {
                console.warn("Unable to load a Google 3D Tile.");
            }));
        };
        if (this.maximumScreenSpaceError || stage !== "refinement") {
            this.frontierGeneration = generation;
            this.loadingPhase = "frontier";
            try { await this.selectFrontier(desiredTiles, generation, selection => {
                desiredTiles.set(selection.url, selection);
                // A nearby offscreen parent may already be prefetched. Show it
                // immediately on a turn while its complete detail subtree loads.
                for (const ancestor of [...(selection.ancestors ?? [])].reverse()) {
                    if (this.publicationGate?.generation === generation && !this.publicationGate.open) break;
                    const coarse = this.retainedTiles.get(ancestor);
                    const coarseSelection = this.loadedSelections.get(ancestor);
                    // Cold coverage has no retained ancestors. Avoid scanning
                    // every visible tile for a parent that cannot be promoted.
                    if (!coarse || !coarseSelection) continue;
                    // Resident children can finish after residentAncestors was
                    // captured at the start of this pass. Promoting their
                    // coarse parent now would draw both replacement levels.
                    if (residentAncestors.has(ancestor) || this.hasVisibleDescendant(ancestor)) continue;
                    if (!this.acceptableDisplayQuality(coarseSelection)
                        || !this.acceptableInitialQuality(coarseSelection)) continue;
                    this.retainedTiles.delete(ancestor);
                    this.loadedTiles.set(ancestor, coarse);
                    coarse.root.setEnabled(true);
                    this.coverageKey = ""; this.coverageVersion++;
                    break;
                }
                if (residentAncestors.has(selection.url) && this.preserveResidentDetail(selection,
                    (residentDetails.get(selection.url) ?? []).map(([, previous]) => previous))) return;
                const overlapsExisting = selection.ancestors?.some(url => this.loadedTiles.has(url))
                    || residentAncestors.has(selection.url);
                // New, disjoint coverage can appear immediately. Overlapping
                // refinements still commit as a complete replacement subtree.
                modelRequests.push(this.loadTile(selection, origin, generation,
                    !overlapsExisting && this.acceptableInitialQuality(selection)).catch(() => undefined));
            }, false, selectionRadius); }
            finally { if (this.frontierGeneration === generation) {
                this.frontierGeneration = -1;
                this.frontierProgress = undefined;
            } }
            if (Array.from(desiredTiles.keys()).some(url => !this.loadedTiles.has(url))) {
                this.loadingPhase = "replacement";
                const replacementStarted = performance.now();
                await this.loadReplacementGroups(desiredTiles, origin, generation);
                this.stats.replacementMs = performance.now() - replacementStarted;
            } else {
                this.stats.replacementMs = 0;
            }
        } else await this.collectTileContent(
            this.rootTileset.root,
            this.getRootTilesetURL(),
            0,
            this.getTileSetBounds(selectionRadius),
            desiredTiles,
            Matrix.Identity(),
            "REPLACE",
            generation,
            startModel,
        );
        if (generation !== this.generation) return cancelled();
        this.desiredTiles = desiredTiles;

        const modelWaitStarted = performance.now();
        this.loadingPhase = "models";
        await Promise.all(modelRequests);
        this.stats.modelWaitMs = performance.now() - modelWaitStarted;
        if (generation !== this.generation) return cancelled();
        if (!await this.awaitPublication(generation)) return cancelled();
        this.stats.reusedModels += Array.from(desiredTiles.keys()).filter(url => residentAtStart.has(url) && this.loadedTiles.has(url)).length;
        // Keep the previous view visible while its replacement is streaming.
        // A short-radius foreground pass is only a scheduling hint. Content
        // already inside the full coverage area must stay visible while that
        // pass and the subsequent wider selection are in flight.
        const currentBounds = this.getTileSetBounds();
        const revisionBeforeCleanup = this.coverageVersion;
        let retired = false;
        for (const url of Array.from(this.loadedTiles.keys())) {
            if (!desiredTiles.has(url)) {
                const previous = this.loadedSelections.get(url);
                if ((this.maximumScreenSpaceError || stage !== "refinement") && previous) {
                    const transform = previous.transform ? Matrix.FromArray(previous.transform) : Matrix.Identity();
                    if (boundingVolumeIntersects(previous.boundingVolume, currentBounds, transform)) continue;
                }
                const tile = this.loadedTiles.get(url)!;
                tile.root.setEnabled(false);
                this.loadedTiles.delete(url);
                this.retainedTiles.set(url, tile);
                retired = true;
            }
        }
        this.trimVisibleHistory(desiredTiles);
        // Bound GPU memory while retaining the most recently visited detail.
        this.trimRetainedTiles();
        if (retired) {
            this.coverageKey = ""; this.coverageVersion++;
        }
        if (this.coverageVersion !== revisionBeforeCleanup || !this.googleAttributionAdded) this.updateAttribution();
        this.stats.loadMs = performance.now() - loadStarted;
        result.selectedTiles = desiredTiles.size;
        result.loadedTiles = Array.from(desiredTiles.keys()).filter(url => this.loadedTiles.has(url)).length;
        result.failedTiles = result.selectedTiles - result.loadedTiles;
        result.budgetLimitedTiles = this.stats.detailLimitedTiles;
        result.sourceLimitedTiles = this.stats.sourceLimitedTiles;
        result.coverageComplete = result.selectedTiles > 0 && !result.failedTiles && !result.hierarchyFailures
            && !result.sourceCoverageGaps;
        result.detailComplete = result.coverageComplete && !result.failedModelTiles
            && !result.budgetLimitedTiles && !result.sourceLimitedTiles;
        if (stage === "coverage") for (const selection of desiredTiles.values()) {
            const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
            if (!this.loadedTiles.has(selection.url) || selection.geometricError !== undefined
                && selection.geometricError > this.coverageGeometricError(selection.boundingVolume, transform)) {
                result.coverageQualityMissingTiles++;
                const groundDistance = this.horizontalTileDistance(selection.boundingVolume, transform,
                    this.requestEye ?? this.selectionEye ?? this.cameraEye());
                if (groundDistance <= this.stageCoverageNearRadius) result.coverageNearQualityMissingTiles++;
                if (this.stageCoverageCoreGeometricError !== undefined && groundDistance <= this.stageCoverageCoreRadius)
                    result.coverageCoreQualityMissingTiles++;
                if (selection.geometricError !== undefined) result.qualityLimitedSamples.push({ groundDistance,
                    geometricError: selection.geometricError, depth: selection.depth, sourceLeaf: selection.hasRefinement === false });
            }
        }
        result.coverageQualityComplete = stage === "coverage" && result.coverageComplete && !result.failedModelTiles
            && !result.coverageQualityMissingTiles && !result.budgetLimitedTiles;
        result.nearCoverageQualityComplete = stage === "coverage" && result.coverageComplete
            && !result.coverageNearQualityMissingTiles && !result.coverageCoreQualityMissingTiles;
        result.coverageAvailableQualityComplete = result.nearCoverageQualityComplete && !result.failedModelTiles
            && !result.budgetLimitedTiles
            && Array.from(desiredTiles.values()).every(selection => {
                const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
                return selection.geometricError === undefined
                    || selection.geometricError <= this.coverageGeometricError(selection.boundingVolume, transform)
                    || selection.hasRefinement === false && this.loadedTiles.has(selection.url)
                        && this.horizontalTileDistance(selection.boundingVolume, transform,
                            this.requestEye ?? this.selectionEye ?? this.cameraEye()) > Math.max(this.stageCoverageNearRadius,
                                this.stageCoverageCoreGeometricError === undefined ? 0 : this.stageCoverageCoreRadius);
            });
        if (stage === "immediate") for (const selection of desiredTiles.values()) {
                const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
                const groundDistance = this.horizontalTileDistance(selection.boundingVolume, transform,
                    this.requestEye ?? this.selectionEye ?? this.cameraEye());
                if (groundDistance > this.stageDetailRadius) continue;
                result.immediateSelectedTiles++;
                if (this.loadedTiles.has(selection.url)) result.immediateLoadedTiles++;
                const qualityCap = this.stageCoverageCoreGeometricError !== undefined && groundDistance <= this.stageCoverageCoreRadius
                    ? Math.min(this.stageCoverageNearGeometricError ?? Infinity, this.stageCoverageCoreGeometricError)
                    : this.stageCoverageNearGeometricError ?? Infinity;
                if (!this.loadedTiles.has(selection.url) || !this.acceptableDisplayQuality(selection)
                    || selection.geometricError !== undefined && selection.geometricError > qualityCap) {
                    result.immediateQualityMissingTiles++;
                    if (selection.geometricError !== undefined) result.qualityLimitedSamples.push({ groundDistance,
                        geometricError: selection.geometricError, depth: selection.depth, sourceLeaf: selection.hasRefinement === false });
                }
        }
        result.qualityLimitedSamples.sort((a, b) => a.groundDistance - b.groundDistance);
        result.qualityLimitedSamples.length = Math.min(8, result.qualityLimitedSamples.length);
        result.immediateQualityComplete = stage === "immediate" && result.immediateSelectedTiles > 0
            && !result.immediateQualityMissingTiles && !result.nearFailedModelTiles && !result.nearHierarchyFailures
            && !result.nearSourceCoverageGaps && !result.budgetLimitedTiles;
        const histogram = new Map<string, Google3DLoadResult["geometricErrorHistogram"][number]>();
        for (const selection of desiredTiles.values()) {
            const key = selection.geometricError?.toFixed(3) ?? "unknown";
            const band = histogram.get(key) ?? { geometricError: selection.geometricError, selectedTiles: 0, loadedTiles: 0,
                coreTiles: 0, nearTiles: 0, immediateTiles: 0 };
            histogram.set(key, band);
            band.selectedTiles++;
            if (this.loadedTiles.has(selection.url)) band.loadedTiles++;
            const groundDistance = this.horizontalTileDistance(selection.boundingVolume,
                selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity(),
                this.requestEye ?? this.selectionEye ?? this.cameraEye());
            if (this.stageCoverageCoreGeometricError !== undefined && groundDistance <= this.stageCoverageCoreRadius) band.coreTiles++;
            if (groundDistance <= this.stageCoverageNearRadius) band.nearTiles++;
            if (groundDistance <= this.stageDetailRadius) band.immediateTiles++;
        }
        result.geometricErrorHistogram = [...histogram.values()].sort((a, b) => b.selectedTiles - a.selectedTiles).slice(0, 16)
            .sort((a, b) => (a.geometricError ?? Infinity) - (b.geometricError ?? Infinity));
        this.loadingPhase = "idle";
        return this.loadedModelTiles;
    }

    private usesCoverageQuality(volume: Google3DBoundingVolume | undefined, transform: Matrix,
        eye = this.requestEye ?? this.selectionEye ?? this.cameraEye()): boolean {
        if (this.loadingStage === "coverage") return true;
        if (this.loadingStage !== "immediate") return false;
        return this.horizontalTileDistance(volume, transform, eye) > this.stageDetailRadius;
    }

    private coverageGeometricError(volume: Google3DBoundingVolume | undefined, transform: Matrix,
        eye = this.requestEye ?? this.selectionEye ?? this.cameraEye()): number {
        if (this.stageCoverageNearGeometricError === undefined && this.stageCoverageCoreGeometricError === undefined)
            return this.stageCoverageGeometricError;
        const distance = this.horizontalTileDistance(volume, transform, eye);
        let error = this.stageCoverageGeometricError;
        if (this.stageCoverageNearGeometricError !== undefined && distance <= this.stageCoverageNearRadius)
            error = Math.min(error, this.stageCoverageNearGeometricError);
        if (this.stageCoverageCoreGeometricError !== undefined && distance <= this.stageCoverageCoreRadius)
            error = Math.min(error, this.stageCoverageCoreGeometricError);
        return error;
    }

    private horizontalTileDistance(volume: Google3DBoundingVolume | undefined, transform: Matrix, eye: Vector3): number {
        if (!this.tileSet.isGlobe) return this.tilePriority(volume, transform, eye);
        if (!volume) return 0;
        if (this.coverageQualityEye?.revision !== this.requestPriorityRevision) {
            const scale = Math.sqrt((eye.x * eye.x + eye.y * eye.y) / WGS84_SEMI_MAJOR_AXIS ** 2
                + eye.z * eye.z / (WGS84_SEMI_MAJOR_AXIS ** 2 * (1 - WGS84_FIRST_ECCENTRICITY_SQUARED)));
            const ground = scale > 0 ? eye.scale(1 / scale) : eye;
            const east = new Vector3(-ground.y, ground.x, 0).normalize();
            if (!east.lengthSquared()) east.set(0, 1, 0);
            const up = new Vector3(ground.x, ground.y, ground.z / (1 - WGS84_FIRST_ECCENTRICITY_SQUARED)).normalize();
            this.coverageQualityEye = { revision: this.requestPriorityRevision, eye: ground, east,
                north: Vector3.Cross(up, east).normalize() };
        }
        let cached = this.coverageDistances.get(volume);
        if (!cached || cached.revision !== this.requestPriorityRevision || cached.transformFlag !== transform.updateFlag) {
            const frame = this.coverageQualityEye;
            cached = { revision: this.requestPriorityRevision, transformFlag: transform.updateFlag,
                distance: horizontalBoundsDistance(volume, transform, frame.eye, frame.east, frame.north) };
            this.coverageDistances.set(volume, cached);
        }
        return cached.distance;
    }

    private preserveResidentDetail(selection: TileSelection, descendants: TileSelection[]): boolean {
        const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
        if (this.loadingStage !== "refinement" || selection.geometricError === undefined
            || selection.geometricError > this.allowedGeometricError(selection.boundingVolume, transform)) return true;
        const bounds = this.getTileSetBounds();
        return descendants.some(previous => {
            const previousTransform = previous.transform ? Matrix.FromArray(previous.transform) : Matrix.Identity();
            return boundingVolumeIntersects(previous.boundingVolume, bounds, previousTransform)
                && this.horizontalTileDistance(previous.boundingVolume, previousTransform,
                    this.requestEye ?? this.selectionEye ?? this.cameraEye()) <= this.stageDetailRadius;
        });
    }

    private acceptableDisplayQuality(selection: TileSelection): boolean {
        const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
        return this.usesCoverageQuality(selection.boundingVolume, transform)
            || this.maximumDisplayGeometricError === undefined || selection.geometricError === undefined
            || selection.geometricError <= this.maximumDisplayGeometricError;
    }

    private acceptableInitialQuality(selection: TileSelection): boolean {
        if (this.usesCoverageQuality(selection.boundingVolume,
            selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity())) return true;
        // Google can publish a nonzero error on its finest available model.
        // Do not wait for a nonexistent refinement during immediate startup.
        if (this.loadingStage === "immediate" && selection.hasRefinement === false
            && this.acceptableDisplayQuality(selection)) return true;
        if (this.maximumInitialErrorRatio === undefined || selection.geometricError === undefined) return true;
        const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
        // Geometric error from the source can remain high even for a small,
        // textured city block. A radius near 500 m can cover an entire low
        // detail landscape slab, so only exempt genuinely small models.
        const volume = selection.boundingVolume;
        if (!selection.hasRefinement && volume?.sphere) {
            const scale = Math.max(...[Vector3.Right(), Vector3.Up(), Vector3.Forward()]
                .map(axis => Vector3.TransformNormal(axis, transform).length()));
            if (volume.sphere[3] * scale <= 250) return true;
        } else if (!selection.hasRefinement && volume?.box) {
            const radius = Math.hypot(...[3, 6, 9].map(offset =>
                Vector3.TransformNormal(Vector3.FromArray(volume.box!, offset), transform).length()));
            if (radius <= 250) return true;
        }
        const allowed = this.allowedGeometricError(selection.boundingVolume, transform,
            false, this.requestEye ?? this.selectionEye ?? this.cameraEye());
        return allowed > 0 && selection.geometricError <= allowed * this.maximumInitialErrorRatio;
    }

    private trimVisibleHistory(desired: Map<string, TileSelection>): void {
        if (this.loadedTiles.size > this.maxTiles * 2) {
            const coverage = this.coverageRadius ? this.getTileSetBounds() : undefined;
            const candidates = Array.from(this.loadedSelections).filter(([url, selection]) => {
                if (!this.loadedTiles.has(url) || desired.has(url)) return false;
                const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
                // The full disk is demanded even behind the camera. Only
                // release history once it leaves that disk, regardless of a
                // transient resident-count excess during movement.
                return (!coverage || !boundingVolumeIntersects(selection.boundingVolume, coverage, transform))
                    && this.allowedGeometricError(selection.boundingVolume, transform,
                        false, this.requestEye ?? this.selectionEye ?? this.cameraEye(), true) < 0;
            });
            const priorities = candidates.map(([url, selection]) => ({ url,
                priority: this.tilePriority(selection.boundingVolume,
                    selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity()) }));
            priorities.sort((a, b) => b.priority - a.priority);
            for (const { url } of priorities) { if (this.loadedTiles.size <= this.maxTiles * 2) break; this.retireTile(url); }
        }
    }

    private trimRetainedTiles(): void {
        while (this.retainedTiles.size > Math.max(128, Math.min(512, this.maxTiles))) {
            const url = Array.from(this.retainedTiles.keys()).find(url => !this.pendingModels.has(url) && !this.desiredTiles.has(url));
            if (!url) break;
            const tile = this.retainedTiles.get(url)!;
            tile.asset.dispose(); tile.root.dispose(false, false);
            this.retainedTiles.delete(url);
            this.loadedSelections.delete(url);
        }
    }

    /** Prepare a bounded surrounding ring after visible loading has finished. */
    public async prefetchSurroundings(): Promise<void> {
        if (!this.rootTileset || !this.maximumScreenSpaceError) return;
        const generation = this.generation;
        const origin = this.getOrigin();
        const selections = new Map<string, TileSelection>();
        const candidates = new Map<string, TileSelection>();
        const requests: Promise<unknown>[] = [];
        await this.selectFrontier(selections, generation, selection => {
            if (generation !== this.generation || this.loadedTiles.has(selection.url) || this.retainedTiles.has(selection.url)) return;
            candidates.set(selection.url, selection);
        }, true);
        if (generation !== this.generation) return;
        const eye = this.selectionEye ?? this.cameraEye();
        const longitude = Math.atan2(eye.y, eye.x);
        const latitude = Math.atan2(eye.z, Math.hypot(eye.x, eye.y));
        const east = new Vector3(-Math.sin(longitude), Math.cos(longitude), 0);
        const north = new Vector3(-Math.sin(latitude) * Math.cos(longitude),
            -Math.sin(latitude) * Math.sin(longitude), Math.cos(latitude));
        const sectors: TileSelection[][] = Array.from({ length: 16 }, () => []);
        const priorities = new Map<TileSelection, number>();
        for (const selection of candidates.values()) {
            const volume = selection.boundingVolume;
            const values = volume?.box ?? volume?.sphere;
            const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
            let center: Vector3;
            if (values) center = Vector3.TransformCoordinates(Vector3.FromArray(values), transform);
            else if (volume?.region) {
                const [west, south, right, top, low, high] = volume.region;
                center = geographicToECEF({ latitude: (south + top) / 2 / RADIANS_PER_DEGREE,
                    longitude: (west + right) / 2 / RADIANS_PER_DEGREE, height: (low + high) / 2 });
            } else center = eye;
            const offset = center.subtract(eye);
            const angle = Math.atan2(Vector3.Dot(offset, east), Vector3.Dot(offset, north));
            const sector = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * sectors.length) % sectors.length;
            sectors[sector].push(selection);
            priorities.set(selection, this.tilePriority(volume, transform, eye));
        }
        for (const sector of sectors) sector.sort((a, b) =>
            priorities.get(a)! - priorities.get(b)!);
        let models = 0;
        while (models < 512 && sectors.some(sector => sector.length)) for (const sector of sectors) {
            const selection = sector.shift();
            if (!selection || models >= 512) continue;
            models++;
            this.prefetchModels.add(selection.url);
            requests.push(this.loadTile(selection, origin, generation, false).catch(() => undefined)
                .finally(() => this.prefetchModels.delete(selection.url)));
        }
        await Promise.all(requests);
        this.trimRetainedTiles();
    }

    /** Alias matching the building-provider lifecycle used by older examples. */
    public async generateBuildings(): Promise<readonly LoadedGoogle3DTile[]> {
        return this.load();
    }

    /** Disposes loaded GLB assets and clears the provider's request caches. */
    public dispose(): void {
        this.cancelPendingLoad();
        this.tileSet.ourAttribution.setGoogleAttributions?.([]);
        this.desiredTiles.clear();
        this.disposeLoadedTiles();
        this.rootTileset = undefined;
        this.rootRequestKey = "";
        this.rootRequest = undefined;
        this.session = undefined;
        this.externalTilesets.clear();
        this.originStateKey = "";
    }

    private validateOptions(): void {
        if (this.apiKey.trim().length === 0) {
            throw new Error("A Google Maps Platform API key is required to load 3D Tiles.");
        }
        if (!Number.isInteger(this.maxDepth) || this.maxDepth < 0) {
            throw new RangeError("maxDepth must be a non-negative integer.");
        }
        if (!Number.isInteger(this.maxTiles) || this.maxTiles <= 0) {
            throw new RangeError("maxTiles must be a positive integer.");
        }
        if (!Number.isInteger(this.maxConcurrentModelDecodes) || this.maxConcurrentModelDecodes <= 0)
            throw new RangeError("maxConcurrentModelDecodes must be a positive integer.");
        if (!Number.isInteger(this.maxConcurrentRequests) || this.maxConcurrentRequests <= 0)
            throw new RangeError("maxConcurrentRequests must be a positive integer.");
        if (!Number.isInteger(this.maxBufferedModels) || this.maxBufferedModels <= 0)
            throw new RangeError("maxBufferedModels must be a positive integer.");
        if (!Number.isFinite(this.startupTraversalSliceMs) || this.startupTraversalSliceMs <= 0)
            throw new RangeError("startupTraversalSliceMs must be positive and finite.");
        if (!Number.isFinite(this.exaggeration) || this.exaggeration <= 0) {
            throw new RangeError("exaggeration must be a finite number greater than zero.");
        }
        if (this.coverageRadius !== undefined && (!Number.isFinite(this.coverageRadius) || this.coverageRadius <= 0))
            throw new RangeError("coverageRadius must be positive and finite.");
        if (this.maximumScreenSpaceError !== undefined && (!Number.isFinite(this.maximumScreenSpaceError) || this.maximumScreenSpaceError <= 0))
            throw new RangeError("maximumScreenSpaceError must be positive and finite.");
        if (this.maximumDisplayGeometricError !== undefined && (!Number.isFinite(this.maximumDisplayGeometricError) || this.maximumDisplayGeometricError <= 0))
            throw new RangeError("maximumDisplayGeometricError must be positive and finite.");
        if (this.maximumInitialErrorRatio !== undefined && (!Number.isFinite(this.maximumInitialErrorRatio) || this.maximumInitialErrorRatio < 1))
            throw new RangeError("maximumInitialErrorRatio must be at least one and finite.");
        if (!Number.isFinite(this.referenceImageHeight) || this.referenceImageHeight <= 0)
            throw new RangeError("referenceImageHeight must be positive and finite.");
        if (!Number.isFinite(this.referenceFovY) || this.referenceFovY <= 0 || this.referenceFovY >= Math.PI)
            throw new RangeError("referenceFovY must be between zero and pi.");
        if (!Number.isFinite(this.heightOffset)) throw new RangeError("heightOffset must be finite.");
        if (!Number.isFinite(this.maximumGeometricError) || this.maximumGeometricError < 0)
            throw new RangeError("maximumGeometricError must be non-negative and finite.");
        if (!this.rootUrl.trim()) {
            throw new Error("rootUrl must not be empty.");
        }
    }

    private getOrigin(): Google3DTilesOrigin {
        if (this.origin) {
            return validateOrigin(this.origin);
        }
        return validateOrigin({
            latitude: this.tileSet.centerCoords.y,
            longitude: this.tileSet.centerCoords.x,
            height: 0,
        });
    }

    private getOriginStateKey(origin: Google3DTilesOrigin): string {
        return [
            origin.latitude,
            origin.longitude,
            origin.height ?? 0,
            this.heightOffset,
            this.tileSet.isGlobe ? (this.tileSet as GlobeSet).metresToWorld : this.tileSet.tileScale,
            this.exaggeration,
        ].join(":");
    }

    private getRootTilesetURL(): string {
        return this.authenticateURL(this.rootUrl, this.rootUrl, false);
    }

    private async loadRootTileset(generation: number | null, preparation?: () => boolean): Promise<void> {
        const rootUrl = this.getRootTilesetURL();
        const requestKey = `${rootUrl}|${this.apiKey}`;
        if (this.rootTileset && this.rootRequestKey === requestKey) {
            return;
        }
        let request = this.rootRequest;
        if (!request || request.key !== requestKey) {
            this.stats.hierarchyRequests++;
            request = { key: requestKey, generation, preparations: new Set(), promise: this.requestTileset(rootUrl,
                () => this.rootRequest?.key === requestKey && (this.rootRequest.generation === this.generation
                    || [...this.rootRequest.preparations].some(wanted => wanted()))) };
            this.rootRequest = request;
        }
        if (generation !== null) request.generation = generation;
        if (preparation) request.preparations.add(preparation);
        let tileset: Google3DTileset;
        try { tileset = await request.promise; }
        catch (error) {
            if (this.rootRequest === request) this.rootRequest = undefined;
            if (generation !== null && generation !== this.generation) return;
            if (generation === null) throw error;
            if (!(error instanceof DOMException && error.name === "AbortError")) {
                this.recordHierarchyFailure(error);
                if (this.lastLoadResult) {
                    this.lastLoadResult.hierarchyFailures++;
                    this.lastLoadResult.nearHierarchyFailures++;
                }
            }
            throw error;
        }
        finally { if (preparation) request.preparations.delete(preparation); }
        if (this.rootRequest !== request) return;
        if (!tileset?.root) {
            this.rootRequest = undefined;
            throw new Error("Google 3D Tiles root response did not contain a root tile.");
        }
        // Opaque diagnostic of returned JSON, before authentication or traversal.
        // Never expose credentials, source URIs, or session strings in metrics.
        try {
            const raw = JSON.stringify(tileset);
            let fingerprint = 2166136261;
            for (let index = 0; index < raw.length; index++) fingerprint = Math.imul(fingerprint ^ raw.charCodeAt(index), 16777619);
            this.stats.rootResponseFingerprint = fingerprint >>> 0;
        } catch { this.stats.rootResponseFingerprint = 0; }
        this.rootTileset = tileset;
        this.rootRequestKey = requestKey;
        this.rootRequest = undefined;
        this.session = undefined;
        this.externalTilesets.clear();
    }

    private requestTileset(url: string, wanted?: () => boolean): Promise<Google3DTileset> {
        return this.tilesetLoader === defaultTilesetLoader ? defaultTilesetLoader(url, wanted, () => {
            this.stats.hierarchyRequests++;
            this.stats.hierarchyRetries++;
        }) : this.tilesetLoader(url);
    }

    private recordHierarchyFailure(error: unknown): void {
        if (!this.lastLoadResult || this.lastLoadResult.hierarchyFailureSamples.length >= 8
            || error instanceof DOMException && error.name === "AbortError") return;
        this.lastLoadResult.hierarchyFailureSamples.push(error instanceof NativeTilesetRequestError
            ? { type: error.type, status: error.status, attempts: error.attempts }
            : { type: "loader", attempts: 1 });
    }

    private authenticateURL(
        uri: string,
        baseUrl: string,
        includeSession = true,
    ): string {
        const url = new URL(uri, baseUrl);
        const uriSession = url.searchParams.get("session");
        if (uriSession) {
            this.session = uriSession;
        } else if (includeSession && (new URL(baseUrl).searchParams.get("session") || this.session)) {
            url.searchParams.set("session", new URL(baseUrl).searchParams.get("session") || this.session!);
        }
        url.searchParams.set("key", this.apiKey);
        return url.toString();
    }

    private async loadExternalTileset(uri: string, baseUrl: string, priority: number | (() => number) = 0,
        generation: number | null = this.generation, wanted?: () => boolean): Promise<LoadedTileset> {
        const url = this.authenticateURL(uri, baseUrl);
        const interest = { generation, wanted, priority };
        const interests = this.externalTilesetDemand.get(url) ?? new Set<typeof interest>();
        interests.add(interest); this.externalTilesetDemand.set(url, interests);
        const release = () => {
            interests.delete(interest);
            if (!interests.size && this.externalTilesetDemand.get(url) === interests) this.externalTilesetDemand.delete(url);
        };
        const current = () => [...interests].filter(entry => (entry.generation === null || entry.generation === this.generation)
            && (entry.wanted?.() ?? true));
        const priorityValue = () => Math.min(...current().map(entry => typeof entry.priority === "function" ? entry.priority() : entry.priority));
        const cached = this.externalTilesets.get(url);
        if (cached) {
            const pending = this.hierarchyPriorities.get(url);
            if (pending?.queued && pending.priority !== undefined) {
                this.stats.hierarchyQueuePriorityChecks++;
                const priority = priorityValue();
                if (priority !== pending.priority) {
                    pending.priority = priority; this.stats.hierarchyQueuePriorityChanges++;
                    this.networkQueueRevision = -1; this.drainNetwork();
                }
            }
            return cached.catch(error => {
                if ((generation === null || generation === this.generation) && (wanted?.() ?? true) && error instanceof DOMException && error.name === "AbortError")
                    return this.loadExternalTileset(uri, baseUrl, priority, generation, wanted);
                throw error;
            }).finally(release);
        }

        // Keep queued hierarchy fetches across camera generations. Their
        // priority follows the current eye, and a later selection reuses the
        // same promise instead of requesting the same subtree again on turns.
        const needed = () => current().length > 0;
        const pending = { queued: true, priority: undefined as number | undefined };
        this.hierarchyPriorities.set(url, pending);
        const bestPriority = () => pending.priority = priorityValue();
        const request = this.networkSlot(() => {
            pending.queued = false;
            this.stats.hierarchyRequests++; return this.requestTileset(url, needed);
        }, bestPriority, "hierarchy", needed).then((tileset) => {
            if (!tileset || !tileset.root) {
                throw new Error("Google 3D Tiles response did not contain a root tile.");
            }
            return { tileset, url };
        }).catch((error) => {
            this.externalTilesets.delete(url);
            if (current().some(entry => entry.generation === this.generation)) this.recordHierarchyFailure(error);
            throw error;
        }).finally(() => {
            if (this.hierarchyPriorities.get(url) === pending) this.hierarchyPriorities.delete(url);
        });
        this.externalTilesets.set(url, request);
        return request.finally(release);
    }

    private cameraEye(): Vector3 {
        const camera = this.tileSet.scene.activeCamera;
        if (camera && this.tileSet.isGlobe) {
            camera.getViewMatrix();
            const globe = this.tileSet as GlobeSet;
            const location = globe.getSurfaceCoordinates(camera.globalPosition);
            return geographicToECEF({ latitude: location.latitude, longitude: location.longitude,
                height: location.elevation / globe.metresToWorld - this.heightOffset });
        }
        return geographicToECEF({ latitude: this.tileSet.centerCoords.y, longitude: this.tileSet.centerCoords.x });
    }

    private tilePriority(volume: Google3DBoundingVolume | undefined, transform: Matrix, eye = this.selectionEye ?? this.cameraEye()): number {
        if (!volume) return 0;
        const values = volume.box ?? volume.sphere;
        if (!values) {
            if (!volume.region) return 0;
            const [west, south, east, north, low, high] = volume.region;
            const longitudeSpan = east >= west ? east - west : east + 2 * Math.PI - west;
            const longitude = west + longitudeSpan / 2;
            const center = geographicToECEF({ latitude: (south + north) / 2 / RADIANS_PER_DEGREE,
                longitude: longitude / RADIANS_PER_DEGREE, height: (low + high) / 2 });
            let radius = 0;
            for (const lat of [south, north]) for (const lon of [west, east]) for (const height of [low, high])
                radius = Math.max(radius, Vector3.Distance(center, geographicToECEF({ latitude: lat / RADIANS_PER_DEGREE,
                    longitude: lon / RADIANS_PER_DEGREE, height })));
            return Math.max(0, Vector3.Distance(eye, center) - radius);
        }
        const center = Vector3.TransformCoordinates(Vector3.FromArray(values), transform);
        if (volume.box) {
            const axes = [3, 6, 9].map(offset => Vector3.TransformNormal(Vector3.FromArray(values, offset), transform));
            const delta = eye.subtract(center), closest = center.clone();
            const orthogonal = axes.every((axis, i) => axes.every((other, j) => i === j
                || Math.abs(Vector3.Dot(axis, other)) <= 1e-6 * axis.length() * other.length()));
            if (orthogonal) {
                for (const axis of axes) if (axis.lengthSquared()) closest.addInPlace(axis.scale(
                    Math.max(-1, Math.min(1, Vector3.Dot(delta, axis) / axis.lengthSquared()))));
                return Vector3.Distance(eye, closest);
            }
            return Math.max(0, Vector3.Distance(eye, center) - axes.reduce((sum, axis) => sum + axis.length(), 0));
        }
        const scale = Math.max(...[Vector3.Right(), Vector3.Up(), Vector3.Forward()].map(axis => Vector3.TransformNormal(axis, transform).length()));
        return Math.max(0, Vector3.Distance(eye, center) - volume.sphere![3] * scale);
    }

    private requestPriority(volume: Google3DBoundingVolume | undefined, transform: Matrix,
        geometricError?: number, covered = false): number {
        const distance = this.tilePriority(volume, transform, this.requestEye ?? this.selectionEye ?? this.cameraEye());
        const allowed = this.allowedGeometricError(volume, transform, false,
            this.requestEye ?? this.selectionEye ?? this.cameraEye(), true);
        // Hierarchy and models share a queue. Re-evaluate this score when a
        // slot opens so turns favor visible, missing, and under-detailed work.
        if (this.cullToCamera && allowed < 0) return 1e9 + distance;
        const shortage = allowed > 0 && geometricError !== undefined && Number.isFinite(geometricError)
            ? Math.min(32, Math.max(0, Math.log2(Math.max(1, geometricError / allowed)))) : 0;
        // One continuous score across the whole disk. A severe quality gap in
        // the current view can outrank a nearer tile that is already sharp.
        return (covered ? 2e6 : 0) - shortage * 1e6
            + Math.log2(1 + distance / 250) * 1.5e6 + distance;
    }

    private allowedGeometricError(volume: Google3DBoundingVolume | undefined, transform: Matrix,
        surroundings = false, eye = this.selectionEye ?? this.cameraEye(), forPriority = false, stagedQuality = true): number {
        if (stagedQuality && !surroundings && this.usesCoverageQuality(volume, transform, eye)) return this.coverageGeometricError(volume, transform, eye);
        const camera = this.tileSet.scene.activeCamera;
        if (!this.maximumScreenSpaceError || !this.tileSet.isGlobe || !camera || !volume) return this.maximumGeometricError;
        const globe = this.tileSet as GlobeSet;
        let center: Vector3;
        let radius = 0;
        if (volume.box) {
            center = Vector3.TransformCoordinates(Vector3.FromArray(volume.box), transform);
            const axes = [3, 6, 9].map(offset => Vector3.TransformNormal(Vector3.FromArray(volume.box!, offset), transform));
            const orthogonal = axes.every((axis, i) => axes.every((other, j) => i === j
                || Math.abs(Vector3.Dot(axis, other)) <= 1e-6 * axis.length() * other.length()));
            radius = orthogonal ? Math.hypot(...axes.map(axis => axis.length()))
                : axes.reduce((sum, axis) => sum + axis.length(), 0);
        } else if (volume.sphere) {
            center = Vector3.TransformCoordinates(Vector3.FromArray(volume.sphere), transform);
            radius = volume.sphere[3] * Math.max(...[Vector3.Right(), Vector3.Up(), Vector3.Forward()].map(axis => Vector3.TransformNormal(axis, transform).length()));
        } else if (volume.region) {
            const [west, south, east, north, low, high] = volume.region;
            center = geographicToECEF({ latitude: (south + north) / 2 / RADIANS_PER_DEGREE,
                longitude: (west + east) / 2 / RADIANS_PER_DEGREE, height: (low + high) / 2 });
            for (const latitude of [south, north]) for (const longitude of [west, east])
                radius = Math.max(radius, Vector3.Distance(center, geographicToECEF({ latitude: latitude / RADIANS_PER_DEGREE, longitude: longitude / RADIANS_PER_DEGREE, height: high })));
        } else return this.maximumGeometricError;
        // Globe-spanning hierarchy volumes contain the Earth centre and have no
        // meaningful surface latitude. Refine them before doing camera projection.
        if (center.length() <= radius + WGS84_SEMI_MAJOR_AXIS * 0.1) return 0;
        const longitude = Math.atan2(center.y, center.x);
        const horizontal = Math.hypot(center.x, center.y);
        let latitude = Math.atan2(center.z, horizontal * (1 - WGS84_FIRST_ECCENTRICITY_SQUARED));
        let altitude = 0;
        for (let i = 0; i < 5; i++) {
            const normal = WGS84_SEMI_MAJOR_AXIS / Math.sqrt(1 - WGS84_FIRST_ECCENTRICITY_SQUARED * Math.sin(latitude) ** 2);
            altitude = horizontal / Math.max(1e-12, Math.cos(latitude)) - normal;
            latitude = Math.atan2(center.z, horizontal * (1 - WGS84_FIRST_ECCENTRICITY_SQUARED * normal / (normal + altitude)));
        }
        const world = globe.getSurfacePosition(latitude / RADIANS_PER_DEGREE, longitude / RADIANS_PER_DEGREE,
            (altitude + this.heightOffset) * globe.metresToWorld);
        // Keep broad coverage behind the camera, but spend detail on the visible view.
        const cameraMatrix = camera.getTransformationMatrix();
        if (this.frustumCache?.camera !== camera || this.frustumCache.updateFlag !== cameraMatrix.updateFlag)
            this.frustumCache = { camera, updateFlag: cameraMatrix.updateFlag,
                planes: Frustum.GetPlanes(cameraMatrix) };
        const planes = this.frustumCache.planes;
        const visible = !planes.some(plane => plane.dotCoordinate(world) < -radius * globe.metresToWorld);
        if (stagedQuality && this.cullToCamera && !visible && !surroundings && this.loadingStage === "refinement"
            && (!this.fullRadiusDemand || forPriority)) return -1;
        let distance = Math.max(1, Vector3.Distance(eye, center) - radius);
        if (volume.box) {
            // A sphere around a long city block greatly exaggerates proximity.
            // Measure distance to its oriented box for the refinement decision.
            const axes = [3, 6, 9].map(offset => Vector3.TransformNormal(Vector3.FromArray(volume.box!, offset), transform));
            const orthogonal = axes.every((axis, i) => axes.every((other, j) => i === j
                || Math.abs(Vector3.Dot(axis, other)) < 1e-6 * axis.length() * other.length()));
            if (orthogonal) {
                const delta = eye.subtract(center);
                const closest = center.clone();
                for (const axis of axes) {
                    const lengthSquared = axis.lengthSquared();
                    if (lengthSquared) closest.addInPlace(axis.scale(Math.max(-1, Math.min(1, Vector3.Dot(delta, axis) / lengthSquared))));
                }
                distance = Math.max(1, Vector3.Distance(eye, closest));
            }
        }
        const referenceHeight = this.fullRadiusDemand && !surroundings
            ? this.referenceImageHeight : this.tileSet.scene.getEngine().getRenderHeight();
        const referenceFov = this.fullRadiusDemand && !surroundings ? this.referenceFovY : camera.fov;
        return this.maximumScreenSpaceError * (surroundings ? 4 : 1)
            * (this.fullRadiusDemand && !surroundings ? 1 : visible ? 1 : 4)
            * 2 * distance * Math.tan(referenceFov / 2)
            / referenceHeight;
    }

    /** A complete renderable frontier: refine the largest projected error first.
     * A budget limit leaves a parent in place instead of dropping its siblings.
     */
    private async selectFrontier(desired: Map<string, TileSelection>, generation: number, onStable: (selection: TileSelection) => void,
        surroundings = false, selectionRadius = this.coverageRadius): Promise<void> {
        const camera = this.tileSet.scene.activeCamera;
        const coverageRadius = surroundings ? this.coverageRadius : selectionRadius;
        let bounds = this.getTileSetBounds(coverageRadius);
        const recordCenter = () => {
            if (surroundings || !this.tileSet.isGlobe || !this.tileSet.scene.activeCamera) return;
            const point = (this.tileSet as GlobeSet).getSurfaceCoordinates(this.tileSet.scene.activeCamera.globalPosition);
            this.selectedCoverageCenter = { latitude: point.latitude, longitude: point.longitude };
        };
        recordCenter();
        const budget = surroundings ? Math.min(512, this.maxTiles) : this.maxTiles;
        const key = JSON.stringify([bounds, this.selectionEye?.asArray(),
            camera && Array.from(camera.getViewMatrix().m), camera && Array.from(camera.getProjectionMatrix().m),
            this.tileSet.scene.getEngine().getRenderHeight(), budget, this.maxDepth,
            this.maximumScreenSpaceError, this.maximumDisplayGeometricError, this.cullToCamera,
            this.fullRadiusDemand, this.referenceImageHeight, this.referenceFovY,
            this.maximumGeometricError, this.originStateKey, this.rootRequestKey, surroundings, this.coverageRegion,
            this.loadingStage, this.stageDetailRadius, this.stageCoverageGeometricError,
            this.stageCoverageNearGeometricError, this.stageCoverageNearRadius,
            this.stageCoverageCoreGeometricError, this.stageCoverageCoreRadius]);
        if (this.frontierCache?.key === key) {
            this.stats.frontierTraversalMs = 0;
            this.stats.frontierCommitMs = 0;
            for (const selection of this.frontierCache.selections) {
                desired.set(selection.url, selection);
                if (!this.loadedTiles.has(selection.url)) onStable(selection);
            }
            return;
        }
        const requiredBounds: GeographicBounds | undefined = this.coverageRegion && {
            south: this.coverageRegion.south, north: this.coverageRegion.north,
            longitudes: [[this.coverageRegion.west, this.coverageRegion.east]],
        };
        const required = (volume: Google3DBoundingVolume | undefined, transform: Matrix) =>
            !!requiredBounds && boundingVolumeIntersects(volume, requiredBounds, transform);
        let hierarchyFailed = false;
        const frontierStarted = performance.now();
        const workBudget = !surroundings && this.loadingStage !== "refinement" ? this.startupWorkBudget() : SceneWorkBudget.forScene(this.tileSet.scene);
        let liveFrontier: Set<FrontierTile> | undefined;
        const firstContent = async (tile: Google3DTile, responseUrl: string, depth: number,
            parentTransform: Matrix, parentRefine: string, ancestors: string[] = [], onGap?: (near: boolean) => void): Promise<FrontierTile[]> => {
            if (generation !== this.generation || depth > this.maxDepth) return [];
            const transform = getTileTransform(tile)?.multiply(parentTransform) ?? parentTransform;
            if (!boundingVolumeIntersects(tile.boundingVolume, bounds, transform)) return [];
            const pause = workBudget.checkpoint(() => this.tilePriority(tile.boundingVolume, transform,
                this.requestEye ?? this.selectionEye ?? this.cameraEye()), 0);
            if (pause) { this.stats.frontierYieldCount++; await pause; }
            if (generation !== this.generation) return [];
            let allowed = this.allowedGeometricError(tile.boundingVolume, transform, surroundings,
                this.requestEye ?? this.selectionEye ?? this.cameraEye());
            const offscreen = this.cullToCamera && this.allowedGeometricError(tile.boundingVolume, transform,
                false, this.requestEye ?? this.selectionEye ?? this.cameraEye(), true) < 0;
            const inRegion = required(tile.boundingVolume, transform);
            if (allowed < 0 && !inRegion) return [];
            if (inRegion && this.loadingStage === "refinement") allowed = allowed < 0 ? this.maximumDisplayGeometricError ?? 33
                : Math.min(allowed, this.maximumDisplayGeometricError ?? 33);
            const refine = tile.refine?.toUpperCase() ?? parentRefine;
            const contents = getTileContents(tile);
            const hasRefinement = !!tile.children?.length || contents.some(isTilesetContent);
            const selections = contents.filter(content => !isTilesetContent(content)).map(content => ({
                url: this.authenticateURL(getContentURI(content), responseUrl), depth, ancestors, geometricError: tile.geometricError,
                hasRefinement, refine,
                boundingVolume: tile.boundingVolume,
                transform: transform.isIdentity() ? undefined : Array.from(transform.m),
            }));
            const node: FrontierTile = { tile, responseUrl, depth, transform, refine, selections, ancestors,
                priority: (tile.geometricError ?? Infinity) / Math.max(allowed, 1e-12), offscreen };
            if (selections.length) return [node];
            const gap = (near: boolean) => {
                if (onGap) onGap(near);
                else if (!surroundings && generation === this.generation && this.lastLoadResult) {
                    this.lastLoadResult.sourceCoverageGaps++;
                    if (near) this.lastLoadResult.nearSourceCoverageGaps++;
                }
            };
            if (depth >= this.maxDepth || !hasRefinement) {
                // Empty external roots can be structural placeholders. An explicit
                // source error distinguishes unavailable source content from them.
                if (tile.geometricError !== undefined) gap(this.horizontalTileDistance(tile.boundingVolume, transform,
                    this.requestEye ?? this.selectionEye ?? this.cameraEye()) <= this.stageDetailRadius);
                return [];
            }
            const next = await children(node);
            if (node.incompleteChildren) gap(!!node.incompleteChildrenNear);
            return next;
        };
        const children = async (node: FrontierTile): Promise<FrontierTile[]> => {
            if (node.depth >= this.maxDepth) return [];
            const missingContent = (near: boolean) => { node.incompleteChildren = true; node.incompleteChildrenNear ||= near; };
            const branches = (node.tile.children ?? []).map(child => firstContent({
                ...child,
                boundingVolume: child.boundingVolume ?? node.tile.boundingVolume,
                geometricError: child.geometricError ?? node.tile.geometricError,
            }, node.responseUrl,
                node.depth + 1, node.transform, node.refine,
                node.ancestors.concat(node.selections.map(selection => selection.url)), missingContent));
            for (const content of getTileContents(node.tile).filter(isTilesetContent)) {
                branches.push(this.loadExternalTileset(getContentURI(content), node.responseUrl,
                    () => this.requestPriority(node.tile.boundingVolume, node.transform, node.tile.geometricError,
                        node.ancestors.some(url => this.loadedTiles.has(url))), generation,
                    () => generation === this.generation && boundingVolumeIntersects(node.tile.boundingVolume, bounds, node.transform)
                        && (!liveFrontier || !node.selections.length || liveFrontier.has(node) || seedPending.has(node)))
                    .then(external => firstContent(external.tileset.root,
                        external.url, node.depth + 1, node.transform, node.refine,
                        node.ancestors.concat(node.selections.map(selection => selection.url)), missingContent)));
            }
            return (await Promise.all(branches)).reduce((all, branch) => all.concat(branch), [] as FrontierTile[]);
        };
        let initial: FrontierTile[];
        try { initial = await firstContent(this.rootTileset!.root, this.getRootTilesetURL(), 0, Matrix.Identity(), "REPLACE"); }
        catch (error) { if (generation !== this.generation) return; throw error; }
        const frontier = new Set(initial);
        liveFrontier = frontier;
        const protectedResidentAncestors = new Set<string>();
        if (!surroundings) for (const [url, selection] of this.loadedSelections) {
            const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
            if (this.loadedTiles.has(url) && boundingVolumeIntersects(selection.boundingVolume, bounds, transform)
                && this.horizontalTileDistance(selection.boundingVolume, transform,
                    this.requestEye ?? this.selectionEye ?? this.cameraEye()) <= this.stageDetailRadius)
                for (const ancestor of selection.ancestors ?? []) protectedResidentAncestors.add(ancestor);
        }
        const fallbackFrontier = new Set<FrontierTile>();
        let fallbackCount = 0;
        let boundsRevision = 0;
        let count = initial.reduce((sum, node) => sum + node.selections.length, 0);
        const coverageReserveBudget = Math.min(budget, count);
        if (count > budget) throw new Error("The first renderable Google tile level exceeds the configured tile budget.");
        let preferCoverage = false;
        const settled = new Set<FrontierTile>();
        const fallback = new WeakSet<FrontierTile>();
        const renderable = (node: FrontierTile) => !surroundings && this.usesCoverageQuality(node.tile.boundingVolume, node.transform)
            || this.maximumDisplayGeometricError === undefined
            || (node.tile.geometricError ?? 0) <= this.maximumDisplayGeometricError
            || fallback.has(node)
            || surroundings && node.priority <= 1;
        const settle = (node: FrontierTile, useFallback = false) => {
            if (useFallback) fallback.add(node);
            if (settled.has(node)) return;
            settled.add(node);
            for (const root of nodeGroups.get(node) ?? []) changedGroups.add(root);
            if (renderable(node)) node.selections.forEach(onStable);
        };
        // Only content resident before selection can need a staged replacement.
        // Newly settled tiles are final frontier members for this generation.
        const replacementRoots = new Set(this.loadedTiles.keys());
        const replacementAncestors = new WeakMap<TileSelection, string | null>();
        const commits: Promise<void>[] = [];
        const committed = new Set<string>();
        const groups = new Map<string, Set<FrontierTile>>();
        const nodeGroups = new WeakMap<FrontierTile, Set<string>>();
        const changedGroups = new Set<string>();
        const track = (node: FrontierTile, add: boolean) => {
            if (surroundings || !replacementRoots.size) return;
            let roots = nodeGroups.get(node);
            if (!roots) {
                roots = new Set();
                for (const selection of node.selections) {
                    let ancestor = replacementAncestors.get(selection);
                    if (ancestor === undefined) {
                        ancestor = [...(selection.ancestors ?? []), selection.url].find(url => replacementRoots.has(url)) ?? null;
                        replacementAncestors.set(selection, ancestor);
                    }
                    if (ancestor) roots.add(ancestor);
                }
                nodeGroups.set(node, roots);
            }
            for (const root of roots) {
                const members = groups.get(root) ?? new Set<FrontierTile>();
                if (add) members.add(node); else members.delete(node);
                groups.set(root, members); changedGroups.add(root);
            }
        };
        initial.forEach(node => track(node, true));
        let descendants: ReturnType<Google3DTiles["indexLoadedDescendants"]> | undefined;
        const flushReplacements = () => {
            for (const ancestor of changedGroups) {
                if (committed.has(ancestor)) continue;
                const members = [...groups.get(ancestor)!];
                if (!members.length || !members.every(node => settled.has(node) && renderable(node))
                    || members.some(node => node.selections.some(selection => selection.url === ancestor))) continue;
                committed.add(ancestor);
                const batch = new Map<string, TileSelection>();
                for (const node of members) for (const selection of node.selections) batch.set(selection.url, selection);
                descendants ??= this.indexLoadedDescendants();
                commits.push(this.loadReplacementGroups(batch, this.getOrigin(), generation, descendants));
            }
            changedGroups.clear();
        };
        const priorities = new WeakMap<FrontierTile, { revision: number; distance: number; score: number; background: number; coverage: number }>();
        const priority = (node: FrontierTile) => {
            let value = priorities.get(node);
            if (!value || value.revision !== this.requestPriorityRevision) {
                const eye = this.requestEye ?? this.selectionEye ?? this.cameraEye();
                const distance = this.tilePriority(node.tile.boundingVolume, node.transform, eye);
                const projected = this.allowedGeometricError(node.tile.boundingVolume, node.transform,
                    surroundings, eye, true);
                const offscreen = this.cullToCamera && (surroundings
                    ? this.allowedGeometricError(node.tile.boundingVolume, node.transform, false, eye, true) < 0
                    : projected < 0);
                const allowed = offscreen ? this.allowedGeometricError(node.tile.boundingVolume,
                    node.transform, surroundings, eye) : projected;
                node.priority = allowed < 0 ? 0
                    : (node.tile.geometricError ?? Infinity) / Math.max(allowed, 1e-12);
                value = { revision: this.requestPriorityRevision,
                    distance, score: Math.log2(1 + distance / 250) * 2.5
                        - Math.min(32, Math.log2(Math.max(1, node.priority))),
                    background: surroundings ? Number(!offscreen) : Number(offscreen),
                    coverage: Number(!renderable(node) && required(node.tile.boundingVolume, node.transform)) };
                priorities.set(node, value);
            }
            return value;
        };
        const compare = (a: FrontierTile, b: FrontierTile) => {
            const pa = priority(a), pb = priority(b);
            return pa.background - pb.background
                || (preferCoverage ? pb.coverage - pa.coverage : 0)
                || pa.score - pb.score || pa.distance - pb.distance;
        };
        const queue = new PriorityQueue<FrontierTile>(compare);
        initial.forEach(node => queue.push(node));
        let queueRevision = this.requestPriorityRevision;
        type Expansion = { kind: "expand" | "seed"; node: FrontierTile; next: FrontierTile[] | undefined; boundsRevision: number };
        const pending = new Map<FrontierTile, Promise<Expansion>>();
        const seedQueue = new PriorityQueue<FrontierTile>(compare);
        const seedPending = new Map<FrontierTile, Promise<Expansion>>();
        let rootSeed: Promise<FrontierTile[]> | undefined;
        type Completion = Expansion | { kind: "root"; next: FrontierTile[]; boundsRevision: number };
        const completed: Completion[] = [];
        let wakeCompletion: (() => void) | undefined;
        const complete = (result: Completion) => {
            if (generation !== this.generation) return;
            completed.push(result); wakeCompletion?.();
        };
        const expand = (node: FrontierTile, kind: "expand" | "seed", revision: number): Promise<Expansion> => children(node)
            .then(next => ({ kind, node, next, boundsRevision: revision }), () => ({ kind, node, next: undefined, boundsRevision: revision }))
            .then(result => { complete(result); return result; });
        if (!surroundings) this.frontierProgress = () => ({ queued: queue.length + seedQueue.length,
            pending: pending.size + seedPending.size + Number(!!rootSeed) });
        let seededAt = this.requestEye ?? this.selectionEye ?? this.cameraEye();
        let reseeded = false;
        const activeURLs = new Set(initial.flatMap(node => node.selections.map(selection => selection.url)));
        const representedURLs = new Set(initial.flatMap(node => node.selections.flatMap(selection =>
            [selection.url, ...(selection.ancestors ?? [])])));
        const enqueueSeed = (node: FrontierTile) => {
            const url = node.selections[0]?.url;
            if (url && boundingVolumeIntersects(node.tile.boundingVolume, bounds, node.transform)) seedQueue.push(node);
        };
        while ((queue.length || pending.size || seedQueue.length || seedPending.size || rootSeed)
            && generation === this.generation) {
            // Preserve unexpanded work for turns and fast traversal. Once the
            // view settles, look farther ahead to fill idle network capacity.
            const pendingLimit = (surroundings || this.loadingStage === "refinement") && performance.now() - this.lastPriorityUpdateAt < 500
                ? Math.min(16, this.maxPendingHierarchy) : this.maxPendingHierarchy;
            if (queueRevision !== this.requestPriorityRevision) {
                queueRevision = this.requestPriorityRevision;
                queue.rebuild();
                seedQueue.rebuild();
            }
            const eye = this.requestEye ?? this.selectionEye ?? this.cameraEye();
            if (!surroundings && coverageRadius
                && Vector3.Distance(eye, seededAt) >= 250) {
                bounds = this.getTileSetBounds(coverageRadius);
                boundsRevision++;
                recordCenter();
                seededAt = eye.clone();
                reseeded = true;
                this.frontierCache = undefined;
                // The disk has moved: geometry wholly beyond its geographic
                // bounds is no longer a coverage fallback. Retire it now,
                // rather than keeping it visible for the rest of a long pass.
                let checkedResidents = 0, retiredResidents = 0;
                for (const [url, selection] of this.loadedSelections) {
                    if (!this.loadedTiles.has(url)) continue;
                    const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
                    if (!boundingVolumeIntersects(selection.boundingVolume, bounds, transform)) {
                        const tile = this.loadedTiles.get(url)!;
                        tile.root.setEnabled(false);
                        this.loadedTiles.delete(url);
                        this.retainedTiles.set(url, tile);
                        retiredResidents++;
                    }
                    if (++checkedResidents % 32 === 0) {
                        const pause = workBudget.checkpoint(() => this.tilePriority(selection.boundingVolume, transform), 0);
                        if (pause) await pause;
                        if (generation !== this.generation) return;
                    }
                }
                if (retiredResidents) {
                    this.trimRetainedTiles();
                    this.coverageKey = ""; this.coverageVersion++;
                    this.updateAttribution();
                }
                for (const node of [...frontier, ...fallbackFrontier]) {
                    if (boundingVolumeIntersects(node.tile.boundingVolume, bounds, node.transform)) continue;
                    if (frontier.delete(node)) count -= node.selections.length;
                    if (fallbackFrontier.delete(node)) fallbackCount -= node.selections.length;
                    track(node, false);
                    settled.delete(node);
                    for (const selection of node.selections) {
                        activeURLs.delete(selection.url);
                        desired.delete(selection.url);
                    }
                }
                representedURLs.clear();
                for (const node of [...frontier, ...fallbackFrontier]) for (const selection of node.selections) {
                    representedURLs.add(selection.url);
                    for (const ancestor of selection.ancestors ?? []) representedURLs.add(ancestor);
                }
                const revision = boundsRevision;
                rootSeed = firstContent(this.rootTileset!.root, this.getRootTilesetURL(),
                    0, Matrix.Identity(), "REPLACE").catch(() => []).then(next => { complete({ kind: "root", next, boundsRevision: revision }); return next; });
            }
            const coverage = count >= Math.min(128, budget / 4);
            if (coverage !== preferCoverage) { preferCoverage = coverage; queue.rebuild(); }
            while (seedQueue.length && pending.size + seedPending.size < pendingLimit) {
                const node = seedQueue.shift()!;
                const pause = workBudget.checkpoint(() => priority(node).distance, 0);
                if (pause) await pause;
                if (generation !== this.generation) return;
                if (!boundingVolumeIntersects(node.tile.boundingVolume, bounds, node.transform)) continue;
                const url = node.selections[0]?.url;
                if (!url) continue;
                // A seed reaching an active frontier member is already represented.
                // Descending it again would admit both that parent and new children.
                if (activeURLs.has(url)) continue;
                if (representedURLs.has(url)) {
                    const revision = boundsRevision;
                    seedPending.set(node, expand(node, "seed", revision));
                    continue;
                }
                if (count + node.selections.length > budget) {
                    // Evicting a demanded sibling would turn a complete replacement
                    // group into partial coverage. Keep the current frontier intact.
                    continue;
                }
                frontier.add(node); track(node, true); count += node.selections.length;
                for (const selection of node.selections) {
                    activeURLs.add(selection.url);
                    representedURLs.add(selection.url);
                    for (const ancestor of selection.ancestors ?? []) representedURLs.add(ancestor);
                }
                queue.push(node);
            }
            while (queue.length && pending.size + seedPending.size < pendingLimit) {
                const node = queue.shift()!;
                if (!frontier.has(node)) continue;
                // A tile that meets SSE may still be too coarse to display.
                if (node.priority <= 1 && renderable(node)
                    && !node.selections.some(selection => protectedResidentAncestors.has(selection.url))) { settle(node); continue; }
                const revision = boundsRevision;
                pending.set(node, expand(node, "expand", revision));
            }
            flushReplacements();
            if (!pending.size && !seedPending.size && !rootSeed) continue;
            if (!completed.length) {
                let wake!: () => void;
                await new Promise<void>(resolve => {
                    wake = resolve; wakeCompletion = wake; this.movementWaiters.add(wake);
                });
                this.movementWaiters.delete(wake); wakeCompletion = undefined;
            }
            if (generation !== this.generation) return;
            // Movement wakes selection even without a finished hierarchy branch.
            // Otherwise consume each completion once, without reattaching a
            // Promise.race callback to every other pending branch each iteration.
            const result = completed.shift();
            if (!result) continue;
            if (result.kind === "root") {
                if (result.boundsRevision !== boundsRevision) continue;
                rootSeed = undefined;
                result.next.forEach(enqueueSeed);
                continue;
            }
            const { node, next } = result;
            if (result.kind === "seed") {
                seedPending.delete(node);
                if (result.boundsRevision !== boundsRevision) { enqueueSeed(node); continue; }
                if (next) next.forEach(enqueueSeed);
                else {
                    hierarchyFailed = true;
                    if (!surroundings && this.lastLoadResult && this.horizontalTileDistance(node.tile.boundingVolume,
                        node.transform, this.requestEye ?? this.selectionEye ?? this.cameraEye()) <= this.stageDetailRadius)
                        this.lastLoadResult.nearHierarchyFailures++;
                }
                continue;
            }
            pending.delete(node);
            if (!frontier.has(node)) continue;
            if (result.boundsRevision !== boundsRevision) { node.incompleteChildren = false; queue.push(node); continue; }
            if (!next) {
                hierarchyFailed = true;
                if (!surroundings && this.lastLoadResult && this.horizontalTileDistance(node.tile.boundingVolume,
                    node.transform, this.requestEye ?? this.selectionEye ?? this.cameraEye()) <= this.stageDetailRadius)
                    this.lastLoadResult.nearHierarchyFailures++;
                settle(node, true); continue;
            }
            // A contentless sibling is a real source gap. Keep the complete parent
            // instead of replacing it with only the children that happened to exist.
            if (node.incompleteChildren) { settle(node, true); continue; }
            const extra = next.reduce((sum, child) => sum + child.selections.length, 0)
                    - (node.refine === "ADD" ? 0 : node.selections.length);
                if (!next.length) {
                    const contents = getTileContents(node.tile);
                    const leaf = !(node.tile.children?.length) && !contents.some(isTilesetContent);
                    const visibleEmptyChild = node.tile.children?.some(child => {
                        if (getTileContents(child).length || child.children?.length) return false;
                        const transform = getTileTransform(child)?.multiply(node.transform) ?? node.transform;
                        return boundingVolumeIntersects(child.boundingVolume, bounds, transform)
                            && this.allowedGeometricError(child.boundingVolume, transform, surroundings) >= 0;
                    });
                    if (node.depth >= this.maxDepth || leaf || visibleEmptyChild) settle(node, true);
                    else {
                        frontier.delete(node); track(node, false); count -= node.selections.length;
                        for (const selection of node.selections) activeURLs.delete(selection.url);
                    }
                    continue;
                }
                if (count + extra > budget) {
                    // A settled, offscreen branch may become a coverage-only
                    // fallback once. Keep it in live demand and replacement groups
                    // so making room for near detail never removes a sibling.
                    const candidates = fallbackCount >= coverageReserveBudget ? [] : [...frontier].filter(victim => victim !== node && settled.has(victim)
                        && victim.refine !== "ADD" && !pending.has(victim) && priority(victim).background
                        && compare(node, victim) < 0).sort((a, b) => compare(b, a));
                    for (const victim of candidates) {
                        if (count + extra <= budget || fallbackCount + victim.selections.length > coverageReserveBudget) break;
                        frontier.delete(victim); fallbackFrontier.add(victim);
                        fallbackCount += victim.selections.length;
                        count -= victim.selections.length;
                    }
                    // Once a frontier member settles, its GLB is useful coverage.
                    // Preserve it instead of repeatedly evicting settled siblings,
                    // downloading their replacements, and retaining both histories.
                    this.stats.frontierBudgetScanCount++;
                    if (count + extra > budget) { settle(node, true); continue; }
                }
                if (node.refine !== "ADD") {
                    frontier.delete(node); track(node, false);
                    for (const selection of node.selections) {
                        activeURLs.delete(selection.url);
                        // This parent may have been offered as an interim
                        // fallback before its complete child branch arrived.
                        // It is no longer a desired REPLACE tile once refined.
                        desired.delete(selection.url);
                    }
                }
                else settle(node);
                next.forEach(child => {
                    frontier.add(child); track(child, true); queue.push(child);
                    for (const selection of child.selections) {
                        activeURLs.add(selection.url);
                        representedURLs.add(selection.url);
                        for (const ancestor of selection.ancestors ?? []) representedURLs.add(ancestor);
                    }
                });
                count += extra;
        }
        if (generation !== this.generation) return;
        if (!surroundings && hierarchyFailed && this.lastLoadResult) this.lastLoadResult.hierarchyFailures++;
        flushReplacements();
        this.stats.frontierTraversalMs = performance.now() - frontierStarted;
        const commitStarted = performance.now();
        if (!surroundings) this.loadingPhase = "replacement";
        await Promise.all(commits);
        this.stats.frontierCommitMs = performance.now() - commitStarted;
        if (generation !== this.generation) return;
        if (!surroundings) {
            this.stats.detailLimitedTiles = 0;
            this.stats.sourceLimitedTiles = 0;
            this.stats.visibleDetailLimitedTiles = 0;
            this.stats.offscreenDetailLimitedTiles = 0;
            this.stats.visibleSourceLimitedTiles = 0;
            this.stats.offscreenSourceLimitedTiles = 0;
            const eye = this.requestEye ?? this.selectionEye ?? this.cameraEye();
            for (const node of [...frontier, ...fallbackFrontier]) {
                if (node.priority <= 1) continue;
                if (this.loadingStage === "immediate" && this.usesCoverageQuality(node.tile.boundingVolume, node.transform)) continue;
                const external = getTileContents(node.tile).some(isTilesetContent);
                const hasChildren = !!node.tile.children?.length;
                const offscreen = this.cullToCamera && this.allowedGeometricError(
                    node.tile.boundingVolume, node.transform, false, eye, true) < 0;
                if (!node.incompleteChildren && (hasChildren || external)) {
                    this.stats.detailLimitedTiles++;
                    if (offscreen) this.stats.offscreenDetailLimitedTiles++;
                    else this.stats.visibleDetailLimitedTiles++;
                } else if (node.incompleteChildren || !hasChildren && !external) {
                    this.stats.sourceLimitedTiles++;
                    if (offscreen) this.stats.offscreenSourceLimitedTiles++;
                    else this.stats.visibleSourceLimitedTiles++;
                }
            }
        }
        // onStable streams models before traversal finishes. Camera reseeding and
        // fallback promotion can leave obsolete demands behind; only the final
        // frontier is authoritative for replacement and stage completion.
        desired.clear();
        for (const node of [...frontier, ...fallbackFrontier]) if (renderable(node))
            for (const selection of node.selections) desired.set(selection.url, selection);
        if (reseeded) for (const [url, selection] of desired) {
            const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
            if (!boundingVolumeIntersects(selection.boundingVolume, bounds, transform)) desired.delete(url);
        }
        if (!hierarchyFailed && !surroundings && !reseeded && !this.lastLoadResult?.sourceCoverageGaps)
            this.frontierCache = { key, selections: Array.from(desired.values()) };
    }

    private async collectTileContent(
        tile: Google3DTile,
        responseUrl: string,
        depth: number,
        bounds: GeographicBounds,
        desiredTiles: Map<string, TileSelection>,
        parentTransform = Matrix.Identity(),
        parentRefine = "REPLACE",
        generation = this.generation,
        onSelection?: (selection: TileSelection) => void,
    ): Promise<number> {
        if (generation !== this.generation || desiredTiles.size >= this.maxTiles) {
            return 0;
        }

        const contents = getTileContents(tile);
        const tileTransform = getTileTransform(tile);
        const accumulatedTransform = tileTransform
            ? tileTransform.multiply(parentTransform)
            : parentTransform;
        if (!boundingVolumeIntersects(tile.boundingVolume, bounds, accumulatedTransform)) return 0;
        const refine = tile.refine?.toUpperCase() ?? parentRefine;
        let descendantCount = 0;

        const allowedError = this.allowedGeometricError(tile.boundingVolume, accumulatedTransform);
        if (allowedError < 0) return 0;
        const sufficientDetail = contents.some(content => !isTilesetContent(content))
            && tile.geometricError !== undefined && tile.geometricError <= allowedError;
        if (depth < this.maxDepth && !sufficientDetail) {
            const childCounts = await Promise.all((tile.children ?? []).map(child => this.collectTileContent(
                child, responseUrl, depth + 1, bounds, desiredTiles,
                accumulatedTransform, refine, generation, onSelection,
            )));
            descendantCount += childCounts.reduce((sum, count) => sum + count, 0);

            if (desiredTiles.size < this.maxTiles) {
                for (const content of contents) {
                    if (!isTilesetContent(content)) {
                        continue;
                    }
                    try {
                        const external = await this.loadExternalTileset(
                            getContentURI(content),
                            responseUrl,
                            this.tilePriority(tile.boundingVolume, accumulatedTransform),
                            generation,
                        );
                        descendantCount += await this.collectTileContent(
                            external.tileset.root,
                            external.url,
                            depth + 1,
                            bounds,
                            desiredTiles,
                            accumulatedTransform,
                            refine,
                            generation,
                            onSelection,
                        );
                    } catch (error) {
                        if (generation === this.generation) console.warn("Unable to load a Google 3D Tiles child tileset:", error);
                    }
                    if (desiredTiles.size >= this.maxTiles) {
                        break;
                    }
                }
            }
        }

        const keepContent = sufficientDetail || depth >= this.maxDepth
            || (!(tile.children?.length) && !contents.some(isTilesetContent))
            || refine === "ADD"
            || (descendantCount === 0 && tile.children?.some(child =>
                !getTileContents(child).length && !child.children?.length
                && boundingVolumeIntersects(child.boundingVolume, bounds, accumulatedTransform)));
        if (!keepContent) {
            return descendantCount;
        }

        for (const content of contents) {
            if (isTilesetContent(content) || desiredTiles.size >= this.maxTiles) {
                continue;
            }

            const url = this.authenticateURL(getContentURI(content), responseUrl);
            if (!desiredTiles.has(url)) {
                desiredTiles.set(url, {
                    url,
                    depth,
                    hasRefinement: !!tile.children?.length || contents.some(isTilesetContent),
                    refine,
                    boundingVolume: tile.boundingVolume,
                    transform: accumulatedTransform.isIdentity()
                        ? undefined
                        : Array.from(accumulatedTransform.m),
                });
                onSelection?.(desiredTiles.get(url)!);
                descendantCount++;
            }
        }

        return descendantCount;
    }

    private retireTile(url: string): void {
        const tile = this.loadedTiles.get(url);
        if (!tile) return;
        tile.root.setEnabled(false);
        this.loadedTiles.delete(url);
        this.retainedTiles.set(url, tile);
        this.trimRetainedTiles();
        this.coverageKey = ""; this.coverageVersion++;
    }

    private indexLoadedDescendants(): Map<string, [string, TileSelection][]> {
        const index = new Map<string, [string, TileSelection][]>();
        for (const [url, selection] of this.loadedSelections) if (this.loadedTiles.has(url)) {
            for (const ancestor of selection.ancestors ?? []) {
                const members = index.get(ancestor) ?? [];
                members.push([url, selection]); index.set(ancestor, members);
            }
        }
        return index;
    }

    private hasVisibleDescendant(url: string): boolean {
        for (const [loadedUrl, selection] of this.loadedSelections)
            if (this.loadedTiles.has(loadedUrl) && selection.refine !== "ADD"
                && selection.ancestors?.includes(url)) return true;
        return false;
    }

    /** Commit disjoint replacement subtrees only after every new model is ready. */
    private async loadReplacementGroups(desired: Map<string, TileSelection>, origin: Google3DTilesOrigin, generation: number,
        descendants = this.indexLoadedDescendants()): Promise<void> {
        const groups = new Map<string, { next: TileSelection[]; previous: Set<string> }>();
        const coverage = this.getTileSetBounds();
        for (const selection of Array.from(desired.values())) {
            const finerVisible = (descendants.get(selection.url) ?? []).filter(([url, previous]) => this.loadedTiles.has(url)
                && boundingVolumeIntersects(previous.boundingVolume, coverage,
                    previous.transform ? Matrix.FromArray(previous.transform) : Matrix.Identity()));
            if (finerVisible.length && this.preserveResidentDetail(selection, finerVisible.map(([, previous]) => previous))) {
                // A relaxed far-detail target may reuse existing fine models, but
                // cannot replace them with a coarser parent that now meets SSE.
                desired.delete(selection.url);
                for (const [url, old] of finerVisible) desired.set(url, old);
                continue;
            }
            const ancestor = selection.ancestors?.find(url => this.loadedTiles.has(url));
            const key = ancestor ?? selection.url;
            let group = groups.get(key);
            if (!group) { group = { next: [], previous: new Set() }; groups.set(key, group); }
            group.next.push(selection);
            if (ancestor) group.previous.add(ancestor);
            for (const [url] of finerVisible) group.previous.add(url);
        }
        await Promise.all(Array.from(groups.values()).map(async group => {
            this.replacementGroupsPending++;
            try {
            const models = await Promise.all(group.next.map(selection => this.loadTile(selection, origin, generation, false).catch(() => undefined)));
            if (generation !== this.generation) return;
            if (!await this.awaitPublication(generation)) return;
            // Traversal can replace this demand while models are still
            // decoding. An obsolete partial batch cannot replace coverage.
            if (group.next.some(selection => !desired.has(selection.url) || !this.desiredTiles.has(selection.url))) return;
            if (models.some(model => !model)) {
                // Failed refinement must not remove valid coverage.
                for (const url of group.previous) {
                    const old = this.loadedSelections.get(url);
                    if (old) desired.set(url, old);
                }
                return;
            }
            // The raster terrain is already visible underneath a disjoint
            // branch. Keep an unacceptably coarse first Google model prepared
            // offscreen until its detail catches up; never retire an existing
            // Google parent merely because its replacement is still loading.
            if (!group.previous.size && group.next.some(selection => !this.acceptableInitialQuality(selection))) return;
            for (let i = 0; i < models.length; i++) {
                const model = models[i]!;
                this.retainedTiles.delete(model.url);
                this.loadedTiles.set(model.url, model);
                this.loadedSelections.set(model.url, group.next[i]);
                model.root.setEnabled(true);
            }
            for (const url of group.previous) if (!desired.has(url)) this.retireTile(url);
            this.trimVisibleHistory(this.desiredTiles);
            this.coverageKey = ""; this.coverageVersion++;
            this.updateAttribution();
            } finally { this.replacementGroupsPending--; }
        }));
    }

    private loadTile(selection: TileSelection, origin: Google3DTilesOrigin, generation: number, activate = true): Promise<LoadedGoogle3DTile | undefined> {
        if (generation !== this.generation) return Promise.resolve(undefined);
        if (this.unusableModelURLs.has(selection.url)) return Promise.resolve(undefined);
        const existing = this.pendingModels.get(selection.url);
        if (existing?.generation === generation) return existing.request;
        if (existing) {
            // Camera movement can still need a download started by the previous view.
            return existing.request.catch(() => undefined).then(() => {
                if (generation !== this.generation) return undefined;
                return this.loadTile(selection, origin, generation, activate);
            });
        }
        const request = this.loadTileAsset(selection, origin, generation, activate);
        const entry = { generation, request };
        this.pendingModels.set(selection.url, entry);
        void request.then(() => {
            if (this.pendingModels.get(selection.url) === entry) this.pendingModels.delete(selection.url);
        }, () => {
            if (this.pendingModels.get(selection.url) === entry) this.pendingModels.delete(selection.url);
        });
        return request;
    }

    private recordModelFailure(selection: TileSelection): void {
        if (!this.lastLoadResult) return;
        this.lastLoadResult.failedModelTiles++;
        if (this.horizontalTileDistance(selection.boundingVolume,
            selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity(),
            this.requestEye ?? this.selectionEye ?? this.cameraEye()) <= this.stageDetailRadius)
            this.lastLoadResult.nearFailedModelTiles++;
    }

    private async loadTileAsset(
        selection: TileSelection,
        origin: Google3DTilesOrigin,
        generation: number,
        activate = true,
    ): Promise<LoadedGoogle3DTile | undefined> {
        const originGeneration = this.originGeneration;
        const publicationGate = this.publicationGate?.generation === generation ? this.publicationGate : undefined;
        const loaded = this.loadedTiles.get(selection.url);
        if (loaded) {
            return loaded;
        }

        const retained = this.retainedTiles.get(selection.url);
        if (retained) {
            if (publicationGate && !publicationGate.open && !await publicationGate.wait) return undefined;
            if (generation !== this.generation) return undefined;
            // A cached model can be requested again after a parent or child
            // became resident. Recheck the live hierarchy before showing it.
            if (activate && selection.refine !== "ADD"
                && (selection.ancestors?.some(url => this.loadedTiles.has(url))
                    || (selection.hasRefinement !== false && this.hasVisibleDescendant(selection.url)))) activate = false;
            if (activate) {
                this.retainedTiles.delete(selection.url);
                this.loadedTiles.set(selection.url, retained);
                this.loadedSelections.set(selection.url, selection);
                this.coverageKey = ""; this.coverageVersion++;
                retained.root.setEnabled(true);
            }
            return retained;
        }
        const priority = () => this.requestPriority(selection.boundingVolume,
            selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity(), selection.geometricError,
            selection.ancestors?.some(url => this.loadedTiles.has(url)) ?? false);
        const previewMaximum = this.loadingStage === "coverage" && this.usesDefaultModelLoader && this.fastStaticModels && this.stageCoverageAtlasMaxSize !== undefined
            && (selection.geometricError ?? 0) > 129 && selection.hasRefinement === true
            && this.horizontalTileDistance(selection.boundingVolume, selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity(),
                this.requestEye ?? this.selectionEye ?? this.cameraEye()) > Math.max(this.stageCoverageNearRadius,
                    this.stageCoverageCoreGeometricError === undefined ? 0 : this.stageCoverageCoreRadius)
            ? this.stageCoverageAtlasMaxSize : undefined;
        const wanted = () => generation === this.generation
            && (this.desiredTiles.has(selection.url) || this.prefetchModels.has(selection.url));
        let dispatched = false;
        const request = this.networkSlot(async releaseSlot => {
            if (!wanted()) return undefined;
            dispatched = true;
            this.stats.modelRequests++;
            if (previewMaximum !== undefined) {
                this.stats.coveragePreviewCandidateModels++;
                this.stats.coveragePreviewSelectedMaxSize = Math.max(this.stats.coveragePreviewSelectedMaxSize, previewMaximum);
            }
            const controller = new AbortController();
            this.activeModelFetches.set(selection.url, { selection, controller });
            const fetched = () => {
                if (this.activeModelFetches.get(selection.url)?.controller === controller)
                    this.activeModelFetches.delete(selection.url);
                releaseSlot();
            };
            try {
                return this.usesDefaultModelLoader
                    ? await defaultModelTileLoader(selection.url, this.tileSet.scene, this.stats, controller.signal,
                        fetched, async work => {
                            if (publicationGate?.deferPreparation && !publicationGate.open) {
                                this.preparationQueued++;
                                try { if (!await publicationGate.wait) return undefined; }
                                finally { this.preparationQueued--; this.drainNetwork(); }
                                if (generation !== this.generation || !wanted()) return undefined;
                            }
                            return this.modelDecodeSlot(work, priority, generation,
                                () => this.canReusePendingModel(selection, origin), wanted);
                        }, this.fastStaticModels, previewMaximum, this.lightweightUnlitMaterials)
                    : await this.modelTileLoader(selection.url, this.tileSet.scene, controller.signal);
            }
            finally {
                if (this.activeModelFetches.get(selection.url)?.controller === controller)
                    this.activeModelFetches.delete(selection.url);
            }
        }, priority, "model", wanted).then(async (model) => {
            if (!model) {
                if (wanted()) {
                    this.unusableModelURLs.add(selection.url);
                    this.recordModelFailure(selection);
                }
                return undefined;
            }
            if (model.renderable === false) {
                if (wanted()) { this.recordModelFailure(selection); this.unusableModelURLs.add(selection.url); }
                model.asset.dispose();
                return undefined;
            }
            if (generation === this.generation && !wanted()) { model.asset.dispose(); return undefined; }
            if (publicationGate && !publicationGate.open) {
                this.publicationQueued++;
                try {
                    if (!await publicationGate.wait) { model.asset.dispose(); return undefined; }
                } finally { this.publicationQueued--; this.drainNetwork(); }
            }
            const integrationStarted = performance.now();
            if (originGeneration !== this.originGeneration || this.getOriginStateKey(origin) !== this.originStateKey) {
                model.asset.dispose();
                return undefined;
            }

            const root = this.createTileRoot(
                selection,
                origin,
                model.rtcCenter,
            );
            const engine = this.tileSet.scene.getEngine();
            const webGpuMipTextures: Texture[] = [];
            // Preserve the source image resolution while keeping oblique views
            // sharp and mip transitions smooth. Babylon clamps to hardware caps.
            for (const texture of model.asset.textures) {
                texture.anisotropicFilteringLevel = engine.getCaps().maxAnisotropy;
                if (texture instanceof Texture) texture.updateSamplingMode(Texture.TRILINEAR_SAMPLINGMODE);
                if (engine.isWebGPU && texture instanceof Texture && texture.getInternalTexture()?.generateMipMaps)
                    webGpuMipTextures.push(texture);
            }
            let mipmapsReady: Promise<boolean> | undefined;
            if (webGpuMipTextures.length) {
                // GLB texture uploads can leave mip levels empty on WebGPU.
                // The loader callback runs before its upload encoder is submitted;
                // regenerate after frame end. Keep the previous tile visible
                // until that image data is usable by the replacement model.
                mipmapsReady = new Promise(resolve => {
                    const finish = (ready: boolean) => {
                        engine.onEndFrameObservable.remove(observer);
                        this.pendingModelUploads.delete(cancel);
                        resolve(ready);
                    };
                    const cancel = () => finish(false);
                    const observer = engine.onEndFrameObservable.addOnce(() => {
                        try {
                            for (const texture of webGpuMipTextures) {
                                const internal = texture.getInternalTexture();
                                if (internal?.generateMipMaps)
                                    (engine as typeof engine & { _generateMipmaps(texture: typeof internal): void })
                                        ._generateMipmaps(internal);
                            }
                            finish(true);
                        } catch { finish(false); }
                    });
                    this.pendingModelUploads.add(cancel);
                });
            }
            // The asset must stay hidden during the WebGPU upload frame. It
            // can otherwise draw over the old parent with empty mip levels.
            root.setEnabled(false);
            model.asset.addAllToScene();
            for (const node of model.asset.rootNodes) {
                node.parent = root;
            }
            if (this.tileSet.isGlobe) for (const mesh of model.asset.meshes)
                if (mesh instanceof Mesh) this.stats.coastalSkirtTrianglesRemoved += removeCoastalSkirtTriangles(
                    mesh, (this.tileSet as GlobeSet).metresToWorld, (this.tileSet as GlobeSet).radius);
            const integrationDuration = performance.now() - integrationStarted;
            this.stats.modelIntegrationMs += integrationDuration;
            this.stats.modelIntegrationMaxMs = Math.max(this.stats.modelIntegrationMaxMs, integrationDuration);

            if (mipmapsReady && !await mipmapsReady) {
                if (wanted()) { this.recordModelFailure(selection); this.unusableModelURLs.add(selection.url); }
                model.asset.dispose();
                root.dispose();
                return undefined;
            }
            // The origin or provider lifetime can change during the upload
            // frame, including a reset back to the same geographic origin.
            if (originGeneration !== this.originGeneration || this.getOriginStateKey(origin) !== this.originStateKey) {
                model.asset.dispose();
                root.dispose();
                return undefined;
            }

            const result: LoadedGoogle3DTile = {
                url: selection.url,
                depth: selection.depth,
                geometricError: selection.geometricError,
                root,
                asset: model.asset,
                attributions: [...model.attributions],
            };
            if (generation !== this.generation || !this.desiredTiles.has(selection.url)) {
                root.setEnabled(false);
                this.retainedTiles.set(selection.url, result);
                this.loadedSelections.set(selection.url, selection);
                this.trimRetainedTiles();
                return undefined;
            }
            // Requests decide whether to activate before their downloads start.
            // A parent or child can become resident while this GLB decodes;
            // committing the old decision would draw both levels at once.
            if (activate && selection.refine !== "ADD"
                && (selection.ancestors?.some(url => this.loadedTiles.has(url))
                    || (selection.hasRefinement !== false && this.hasVisibleDescendant(selection.url)))) activate = false;
            if (!activate) {
                root.setEnabled(false);
                this.retainedTiles.set(selection.url, result);
                this.loadedSelections.set(selection.url, selection);
                return result;
            }
            root.setEnabled(true);
            this.loadedTiles.set(selection.url, result);
            this.loadedSelections.set(selection.url, selection);
            this.trimVisibleHistory(this.desiredTiles);
            this.coverageKey = ""; this.coverageVersion++;
            this.updateAttribution();
            return result;
        }).catch((error: unknown) => {
            if (!dispatched && error instanceof DOMException && error.name === "AbortError") return undefined;
            if (wanted()) {
                this.unusableModelURLs.add(selection.url);
                this.recordModelFailure(selection);
            }
            throw error;
        });

        return request;
    }

    private createTileRoot(
        selection: TileSelection,
        origin: Google3DTilesOrigin,
        rtcCenter: Vector3 | undefined,
    ): TransformNode {
        const originEcef = geographicToECEF(origin);
        const centerEcef = rtcCenter ?? Vector3.Zero();
        const east = new Vector3(
            -Math.sin(origin.longitude * RADIANS_PER_DEGREE),
            Math.cos(origin.longitude * RADIANS_PER_DEGREE),
            0,
        );
        const north = new Vector3(
            -Math.sin(origin.latitude * RADIANS_PER_DEGREE)
                * Math.cos(origin.longitude * RADIANS_PER_DEGREE),
            -Math.sin(origin.latitude * RADIANS_PER_DEGREE)
                * Math.sin(origin.longitude * RADIANS_PER_DEGREE),
            Math.cos(origin.latitude * RADIANS_PER_DEGREE),
        );
        const up = new Vector3(
            Math.cos(origin.latitude * RADIANS_PER_DEGREE)
                * Math.cos(origin.longitude * RADIANS_PER_DEGREE),
            Math.cos(origin.latitude * RADIANS_PER_DEGREE)
                * Math.sin(origin.longitude * RADIANS_PER_DEGREE),
            Math.sin(origin.latitude * RADIANS_PER_DEGREE),
        );

        const globe = this.tileSet.isGlobe ? this.tileSet as GlobeSet : undefined;
        const scale = globe ? globe.metresToWorld : this.tileSet.tileScale;
        const originOnMap = globe ? Vector3.Zero() : this.tileSet.ourTileMath.EPSG_to_Game(
            new Vector2(origin.longitude, origin.latitude), EPSG_Type.EPSG_4326,
        );
        const ecefToLocal = Matrix.FromValues(
            east.x, up.x, north.x, 0,
            east.y, up.y, north.y, 0,
            east.z, up.z, north.z, 0,
            -Vector3.Dot(originEcef, east), -Vector3.Dot(originEcef, up),
            -Vector3.Dot(originEcef, north), 1,
        );
        // Undo Babylon's glTF handedness conversion, then convert glTF Y-up
        // to tile Z-up before RTC translation and the accumulated tile matrix.
        let transform = Matrix.Scaling(this.tileSet.scene.useRightHandedSystem ? 1 : -1, 1, 1)
            .multiply(Matrix.RotationX(Math.PI / 2))
            .multiply(Matrix.Translation(centerEcef.x, centerEcef.y, centerEcef.z))
            .multiply(selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity())
            .multiply(ecefToLocal)
            .multiply(Matrix.Scaling(scale, scale * this.exaggeration, scale))
            .multiply(Matrix.Translation(originOnMap.x, 0, originOnMap.z));

        if (globe) {
            const normal = globe.getSurfaceNormal(origin.latitude, origin.longitude);
            const longitude = origin.longitude * RADIANS_PER_DEGREE;
            const globeEast = new Vector3(-Math.cos(longitude), 0, -Math.sin(longitude));
            const globeNorth = Vector3.Cross(globeEast, normal).normalize();
            const surface = globe.getSurfacePosition(origin.latitude, origin.longitude, ((origin.height ?? 0) + this.heightOffset) * scale);
            // Replace the planar translation with a metre-scaled tangent frame.
            // Google already contains absolute terrain heights; do not add DEM elevation.
            transform = transform.multiply(Matrix.Translation(-originOnMap.x, 0, -originOnMap.z))
                .multiply(Matrix.FromValues(
                    globeEast.x, globeEast.y, globeEast.z, 0,
                    normal.x, normal.y, normal.z, 0,
                    globeNorth.x, globeNorth.y, globeNorth.z, 0,
                    surface.x, surface.y, surface.z, 1,
                ));
        }

        const root = new TransformNode(
            `Google 3D Tile ${selection.depth}`,
            this.tileSet.scene,
        );
        root.setPreTransformMatrix(transform);
        return root;
    }

    private disposeTile(url: string): void {
        const loaded = this.loadedTiles.get(url);
        if (!loaded) {
            return;
        }
        loaded.asset.dispose();
        loaded.root.dispose(false, false);
        this.loadedTiles.delete(url);
    }

    private disposeLoadedTiles(): void {
        this.originGeneration++;
        for (const cancel of this.pendingModelUploads) cancel();
        for (const { controller } of this.activeModelFetches.values()) controller.abort();
        this.frontierCache = undefined;
        for (const tile of this.retainedTiles.values()) {
            tile.asset.dispose(); tile.root.dispose(false, false);
        }
        this.retainedTiles.clear();
        this.loadedSelections.clear();
        this.coverageKey = ""; this.coverageVersion++;
        for (const url of Array.from(this.loadedTiles.keys())) {
            this.disposeTile(url);
        }
    }

    private updateAttribution(): void {
        const attribution = this.tileSet.ourAttribution;
        if (!this.googleAttributionAdded) {
            attribution.addAttribution("GOOGLE");
            this.googleAttributionAdded = true;
        }
        attribution.setGoogleAttributions?.(this.getAttributions());
    }

    private getTileSetBounds(coverageRadius = this.coverageRadius): GeographicBounds {
        this.tileSet.assertRasterSetup("calculate Google 3D Tiles bounds");
        let south = 90;
        let north = -90;
        const longitudes: Array<[number, number]> = [];
        let circle: GeographicBounds["circle"];

        for (const tile of this.tileSet.ourTiles) {
            const west = this.tileSet.ourTileMath.tile_to_lon(tile.tileCoords.x, tile.tileCoords.z);
            const east = this.tileSet.ourTileMath.tile_to_lon(tile.tileCoords.x + 1, tile.tileCoords.z);
            const tileNorth = this.tileSet.ourTileMath.tile_to_lat(tile.tileCoords.y, tile.tileCoords.z);
            const tileSouth = this.tileSet.ourTileMath.tile_to_lat(tile.tileCoords.y + 1, tile.tileCoords.z);

            south = Math.min(south, tileSouth);
            north = Math.max(north, tileNorth);
            if (east - west >= 360) {
                longitudes.push([-180, 180]);
            } else {
                const normalizedWest = normalizeLongitude(west);
                const normalizedEast = normalizeLongitude(east);
                if (normalizedWest <= normalizedEast) longitudes.push([normalizedWest, normalizedEast]);
                else longitudes.push([normalizedWest, 180], [-180, normalizedEast]);
            }
        }

        if (coverageRadius) {
            const camera = this.tileSet.scene.activeCamera;
            camera?.getViewMatrix();
            const eye = camera && this.tileSet.isGlobe
                ? (this.tileSet as GlobeSet).getSurfaceCoordinates(camera.globalPosition) : undefined;
            const center = eye ? { x: eye.longitude, y: eye.latitude } : this.tileSet.centerCoords;
            const latitude = center.y * RADIANS_PER_DEGREE;
            const longitude = center.x * RADIANS_PER_DEGREE;
            circle = {
                center: geographicToECEF({ latitude: center.y, longitude: center.x }),
                east: new Vector3(-Math.sin(longitude), Math.cos(longitude), 0),
                north: new Vector3(-Math.sin(latitude) * Math.cos(longitude),
                    -Math.sin(latitude) * Math.sin(longitude), Math.cos(latitude)),
                radius: coverageRadius,
            };
            const angular = coverageRadius / WGS84_SEMI_MAJOR_AXIS / RADIANS_PER_DEGREE;
            south = Math.max(-90, center.y - angular); north = Math.min(90, center.y + angular);
            const longitudeRadius = Math.min(180, angular / Math.max(0.01, Math.cos(center.y * RADIANS_PER_DEGREE)));
            const west = normalizeLongitude(center.x - longitudeRadius), east = normalizeLongitude(center.x + longitudeRadius);
            longitudes.length = 0;
            if (west <= east) longitudes.push([west, east]);
            else longitudes.push([west, 180], [-180, east]);
        }
        const origin = this.getOrigin();
        const latitude = origin.latitude * RADIANS_PER_DEGREE;
        const longitude = origin.longitude * RADIANS_PER_DEGREE;
        const originECEF = geographicToECEF({ ...origin, height: 0 });
        const axes = [
            new Vector3(-Math.sin(longitude), Math.cos(longitude), 0),
            new Vector3(-Math.sin(latitude) * Math.cos(longitude), -Math.sin(latitude) * Math.sin(longitude), Math.cos(latitude)),
            new Vector3(Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)),
        ];
        const minimum = [0, 0, -12000];
        const maximum = [0, 0, 12000];
        for (const [west, east] of longitudes) {
            for (const lat of [south, north]) for (const lon of [west, east]) for (const height of [-12000, 12000]) {
                const point = geographicToECEF({ latitude: lat, longitude: lon, height }).subtract(originECEF);
                axes.forEach((axis, index) => {
                    const projected = Vector3.Dot(point, axis);
                    minimum[index] = Math.min(minimum[index], projected);
                    maximum[index] = Math.max(maximum[index], projected);
                });
            }
        }
        return { south, north, longitudes, circle, localVolume: north - south < 30
            && longitudes.every(([west, east]) => east - west < 30)
            ? { origin: originECEF, axes, minimum, maximum } : undefined };
    }
}

class NativeTilesetRequestError extends Error {
    constructor(public readonly type: "network" | "http" | "response", public readonly status: number | undefined,
        public readonly attempts: number) {
        super(`Unable to load Google 3D Tileset (${type}${status === undefined ? "" : ` ${status}`}; ${attempts} attempts).`);
    }
}

/** Short retries recover a missing ancestor without repeating the whole frontier pass. */
async function defaultTilesetLoader(url: string, wanted?: () => boolean, retried?: () => void): Promise<Google3DTileset> {
    const delays = [150, 450];
    for (let attempt = 0; ; attempt++) {
        let response: Response | undefined;
        try {
            response = await fetch(url);
            if (!response.ok) throw new NativeTilesetRequestError("http", response.status, attempt + 1);
            const tileset = await response.json() as Google3DTileset;
            if (!tileset?.root) throw new NativeTilesetRequestError("response", response.status, attempt + 1);
            return tileset;
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            const transient = error instanceof TypeError || error instanceof NativeTilesetRequestError
                && error.type === "http" && error.status !== undefined
                && (error.status === 408 || error.status === 429 || error.status >= 500 && error.status <= 599);
            if (!transient || attempt >= delays.length) throw error instanceof NativeTilesetRequestError ? error
                : new NativeTilesetRequestError(response ? "response" : "network", response?.status, attempt + 1);
            if (wanted && !wanted()) throw new DOMException("Google hierarchy work is no longer needed.", "AbortError");
            await new Promise(resolve => setTimeout(resolve, delays[attempt]));
            // Movement or a successor pass may remove this branch during backoff.
            if (wanted && !wanted()) throw new DOMException("Google hierarchy work is no longer needed.", "AbortError");
            retried?.();
        }
    }
}

/** Remove deep coastal photogrammetry skirts and their attached fins. */
export function removeCoastalSkirtTriangles(mesh: Mesh, metresToWorld: number, globeRadius?: number): number {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    const indices = mesh.getIndices();
    if (!positions || !indices || positions.length < 9 || indices.length < 3 || metresToWorld <= 0
        || !mesh.subMeshes.length || (mesh.geometry?.meshes.length ?? 0) !== 1) return 0;
    const subMeshes = [...mesh.subMeshes].sort((a, b) => a.indexStart - b.indexStart);
    let nextIndex = 0;
    for (const subMesh of subMeshes) {
        if (subMesh.indexStart !== nextIndex || subMesh.indexCount % 3) return 0;
        nextIndex += subMesh.indexCount;
    }
    if (nextIndex !== indices.length) return 0;
    const matrix = mesh.computeWorldMatrix(true).m;
    if (safeToSkipGoogleCoastalRepair(positions, matrix, metresToWorld, globeRadius)) return 0;
    const heights = new Float32Array(positions.length / 3);
    let minimumHeight = Infinity, maximumHeight = -Infinity;
    for (let i = 0; i < heights.length; i++) {
        const offset = i * 3;
        const x = positions[offset] * matrix[0] + positions[offset + 1] * matrix[4]
            + positions[offset + 2] * matrix[8] + matrix[12];
        const y = positions[offset] * matrix[1] + positions[offset + 1] * matrix[5]
            + positions[offset + 2] * matrix[9] + matrix[13];
        const z = positions[offset] * matrix[2] + positions[offset + 1] * matrix[6]
            + positions[offset + 2] * matrix[10] + matrix[14];
        heights[i] = (globeRadius === undefined ? y : Math.hypot(x, y, z) - globeRadius) / metresToWorld;
        // Compare stored Float32 values, exactly as the quantile below does.
        minimumHeight = Math.min(minimumHeight, heights[i]); maximumHeight = Math.max(maximumHeight, heights[i]);
    }
    // A supported water surface is [-15,30] and its skirt cutoff is surface-25.
    // These ranges cannot put any stored vertex below that cutoff. NaN bounds
    // deliberately fall through to retain the previous nonfinite behavior.
    if (minimumHeight >= 5 || maximumHeight < -15 || maximumHeight - minimumHeight <= 25) return 0;
    const ordered = Float32Array.from(heights).sort();
    // A small primitive's lower fifth can be its one deep skirt vertex.
    // Its median is a better estimate of the water surface in that case.
    const lowSurface = ordered[Math.floor(ordered.length * (ordered.length < 10 ? 0.5 : 0.2))];
    // Restrict the repair to nearly level coastal geometry. The lower fifth
    // represents the sea/ground surface even when buildings dominate a tile.
    if (lowSurface < -15 || lowSurface > 30) return 0;
    const cutoff = lowSurface - 25;
    const worldEdgeSquared = (left: number, right: number) => {
        const l = left * 3, r = right * 3;
        const dx = positions[l] - positions[r], dy = positions[l + 1] - positions[r + 1],
            dz = positions[l + 2] - positions[r + 2];
        const wx = dx * matrix[0] + dy * matrix[4] + dz * matrix[8];
        const wy = dx * matrix[1] + dy * matrix[5] + dz * matrix[9];
        const wz = dx * matrix[2] + dy * matrix[6] + dz * matrix[10];
        return (wx * wx + wy * wy + wz * wz) / (metresToWorld * metresToWorld);
    };
    let kept: number[] | undefined;
    const skirtPeaks = new Set<number>();
    const updatedRanges: Array<{ subMesh: typeof subMeshes[number]; start: number; count: number }> = [];
    for (const subMesh of subMeshes) {
        const start = kept?.length ?? subMesh.indexStart;
        for (let i = subMesh.indexStart; i < subMesh.indexStart + subMesh.indexCount; i += 3) {
            const a = indices[i], b = indices[i + 1], c = indices[i + 2];
            const deepSkirt = heights[a] < cutoff || heights[b] < cutoff || heights[c] < cutoff;
            if (deepSkirt) for (const vertex of [a, b, c])
                if (heights[vertex] > lowSurface + 40) skirtPeaks.add(vertex);
            // Flat geometry alone cannot identify water: roofs, pavement and
            // genuine water fill can have identical heights and edge lengths.
            if (!deepSkirt) {
                if (kept) kept.push(a, b, c);
            } else {
                if (!kept) kept = Array.from(indices).slice(0, i);
            }
        }
        updatedRanges.push({ subMesh, start, count: (kept?.length ??
            subMesh.indexStart + subMesh.indexCount) - start });
    }
    if (!kept) return 0;
    if (skirtPeaks.size) {
        // A clipped deep skirt can leave its upper triangular lip behind.
        // Remove only tall faces attached to a discarded skirt peak; this
        // preserves unrelated building walls in the same photogrammetry tile.
        const cleaned: number[] = [];
        for (const range of updatedRanges) {
            const start = cleaned.length;
            for (let i = range.start; i < range.start + range.count; i += 3) {
                const a = kept[i], b = kept[i + 1], c = kept[i + 2];
                const low = Math.min(heights[a], heights[b], heights[c]);
                const high = Math.max(heights[a], heights[b], heights[c]);
                const attachedLip = (skirtPeaks.has(a) || skirtPeaks.has(b) || skirtPeaks.has(c))
                    && low < lowSurface + 15 && high > lowSurface + 40
                    && high - low > 40
                    && Math.max(worldEdgeSquared(a, b), worldEdgeSquared(b, c), worldEdgeSquared(c, a)) > 40 * 40;
                if (!attachedLip) cleaned.push(a, b, c);
            }
            range.start = start;
            range.count = cleaned.length - start;
        }
        kept = cleaned;
    }
    const removed = (indices.length - kept.length) / 3;
    // Update the ranges before Babylon validates them against the shorter
    // index buffer. Preserve each primitive's material and vertex span.
    for (const { subMesh, start, count } of updatedRanges) {
        subMesh.indexStart = start;
        subMesh.indexCount = count;
    }
    mesh.setIndices(kept, null, false, true);
    return removed;
}

async function defaultModelTileLoader(
    url: string,
    scene: Scene,
    stats?: Google3DTiles["stats"],
    signal?: AbortSignal,
    onFetched?: () => void,
    decodeSlot?: (work: () => Promise<LoadedGoogleModelTile>) => Promise<LoadedGoogleModelTile | undefined>,
    fastStaticModels = false,
    atlasMaximum?: number,
    lightweightUnlitMaterials = false,
): Promise<LoadedGoogleModelTile | undefined> {
    const fetchStarted = performance.now();
    const response = await fetch(url, { signal });
    if (stats) stats.modelFetchHeaderMs += performance.now() - fetchStarted;
    if (response.status === 204 || response.status === 404) {
        onFetched?.();
        return undefined;
    }
    if (!response.ok) {
        throw new Error(`Unable to load Google 3D model tile (${response.status} ${response.statusText}).`);
    }

    const bodyStarted = performance.now();
    const buffer = await response.arrayBuffer();
    if (stats) {
        stats.modelFetchBodyMs += performance.now() - bodyStarted;
        // Only aggregate public freshness numbers; no URLs, validators, or raw headers.
        try {
            const control = response.headers?.get?.("cache-control") ?? "", maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(control);
            const seconds = maxAge ? Number(maxAge[1]) : 0;
            if (seconds > 0 && !/\bno-store\b/i.test(control)) {
                if (!stats.modelResponsePositiveMaxAgeCount) stats.modelResponseMaxAgeMinSeconds = seconds;
                stats.modelResponsePositiveMaxAgeCount++;
                stats.modelResponseMaxAgeMinSeconds = Math.min(stats.modelResponseMaxAgeMinSeconds, seconds);
                stats.modelResponseMaxAgeMaxSeconds = Math.max(stats.modelResponseMaxAgeMaxSeconds, seconds);
            }
        } catch { /* Unreadable headers do not change loading. */ }
        try {
            const entries = performance.getEntriesByName?.(url, "resource") ?? [];
            const entry = entries[entries.length - 1] as PerformanceResourceTiming | undefined;
            if (!entry || entry.startTime < fetchStarted - 1) stats.modelResourceTimingUnavailableCount++;
            else if (!(entry.transferSize || entry.encodedBodySize || entry.decodedBodySize)) stats.modelResourceTimingOpaqueCount++;
            else {
                stats.modelResourceTimingReadableCount++;
                stats.modelResourceTransferBytes += entry.transferSize; stats.modelResourceEncodedBytes += entry.encodedBodySize;
                if (!entry.transferSize) stats.modelResourceZeroTransferCount++;
            }
        } catch { stats.modelResourceTimingUnavailableCount++; }
    }
    if (stats) { stats.modelFetchMs += performance.now() - fetchStarted; stats.modelFetchCount++; stats.modelFetchBytes += buffer.byteLength; }
    onFetched?.();
    signal?.throwIfAborted();
    const decode = async (): Promise<LoadedGoogleModelTile> => {
        const decodeStarted = performance.now();
        if (stats) {
            stats.modelDecodeActive++;
            stats.peakModelDecodeActive = Math.max(stats.peakModelDecodeActive, stats.modelDecodeActive);
        }
        try {
            if (fastStaticModels) {
                const timing: GoogleFastModelTiming | undefined = stats ? (phase, milliseconds) => { stats[fastTimingFields[phase]] += milliseconds; } : undefined;
                let resized = false;
                const atlasOptions: GoogleFastModelAtlasOptions | undefined = atlasMaximum === undefined ? undefined : {
                    maxSize: atlasMaximum, decoded: value => {
                        if (!stats) return;
                        stats.coveragePreviewSourceMaxSize = Math.max(stats.coveragePreviewSourceMaxSize, value.sourceWidth ?? 0, value.sourceHeight ?? 0);
                        if (value.resized) {
                            stats.coveragePreviewTextures++;
                            stats.coveragePreviewDecodedMaxSize = Math.max(stats.coveragePreviewDecodedMaxSize, value.width, value.height);
                            resized = true;
                        }
                    },
                };
                const fast = await tryLoadGoogle3DFastModel(buffer, scene, signal, timing, atlasOptions, lightweightUnlitMaterials);
                if (fast) {
                    if (signal?.aborted) { fast.asset.dispose(); signal.throwIfAborted(); }
                    if (stats) { stats.fastModelCount++; if (resized) stats.coveragePreviewModels++;
                        stats.lightweightMaterialCount += fast.asset.materials.filter(material => material.getClassName() === "StandardMaterial").length;
                        if (attachGoogleStaticAssetContainer(fast.asset)) stats.staticContainerModels++; }
                    return fast;
                }
            }
            const metadata = parseGoogleGLBMetadata(buffer);
            // Babylon uses the file name in embedded-texture cache keys. Each
            // GLB has a different image atlas, even when all images are called image0.
            await import("@babylonjs/loaders/glTF/index.js");
            if (stats) stats.genericModelCount++;
            const asset = await LoadAssetContainerAsync(new Uint8Array(buffer), scene, {
                pluginExtension: ".glb", name: `google-photorealistic-tile-${nextModelFileId++}.glb`,
            });
            if (attachGoogleStaticAssetContainer(asset) && stats) stats.staticContainerModels++;
            if (signal?.aborted) {
                asset.dispose();
                signal.throwIfAborted();
            }
            return {
                asset,
                attributions: metadata.attributions,
                rtcCenter: metadata.rtcCenter,
                renderable: asset.meshes.some(mesh => mesh.getTotalVertices() > 0),
            };
        } finally {
            if (stats) {
                stats.modelDecodeActive--;
                stats.modelDecodeMs += performance.now() - decodeStarted;
                stats.modelDecodeCount++;
            }
        }
    };
    return decodeSlot ? decodeSlot(decode) : decode();
}

/** Extracts Google attribution and CESIUM_RTC metadata from a GLB JSON chunk. */
export function parseGoogleGLBMetadata(buffer: ArrayBuffer): GoogleGLBMetadata {
    const empty: GoogleGLBMetadata = { attributions: [] };
    if (buffer.byteLength < 20) {
        return empty;
    }

    const header = new DataView(buffer, 0, 12);
    if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2) {
        return empty;
    }

    const totalLength = header.getUint32(8, true);
    let offset = 12;
    const decoder = new TextDecoder();
    while (offset + 8 <= buffer.byteLength && offset < totalLength) {
        const chunkLength = new DataView(buffer, offset, 4).getUint32(0, true);
        const chunkType = new DataView(buffer, offset + 4, 4).getUint32(0, true);
        const chunkStart = offset + 8;
        const chunkEnd = chunkStart + chunkLength;
        if (chunkEnd > buffer.byteLength) {
            return empty;
        }
        if (chunkType === 0x4e4f534a) {
            try {
                const json = JSON.parse(
                    decoder.decode(new Uint8Array(buffer, chunkStart, chunkLength)).replace(/\0+$/, ""),
                ) as {
                    asset?: { copyright?: unknown };
                    extensions?: { CESIUM_RTC?: { center?: unknown } };
                };
                const copyright = json.asset?.copyright;
                const attributions = typeof copyright === "string"
                    ? copyright.split(";").map((part) => part.trim()).filter(Boolean)
                    : [];
                const center = json.extensions?.CESIUM_RTC?.center;
                const rtcCenter = Array.isArray(center)
                    && center.length === 3
                    && center.every((value) => typeof value === "number" && Number.isFinite(value))
                    ? new Vector3(center[0], center[1], center[2])
                    : undefined;
                return { attributions, rtcCenter };
            } catch {
                return empty;
            }
        }
        offset = chunkEnd;
    }
    return empty;
}

function getTileContents(tile: Google3DTile): Google3DTileContent[] {
    const contents: Google3DTileContent[] = [];
    if (tile.content) {
        contents.push(tile.content);
    }
    if (tile.contents) {
        contents.push(...tile.contents);
    }
    return contents.filter((content, index) => {
        if (!getContentURIOrUndefined(content)) {
            return false;
        }
        return contents.findIndex((candidate) => {
            return getContentURIOrUndefined(candidate) === getContentURIOrUndefined(content);
        }) === index;
    });
}

function getTileTransform(tile: Google3DTile): Matrix | undefined {
    if (!tile.transform || tile.transform.length !== 16) {
        return undefined;
    }
    if (!tile.transform.every((value) => Number.isFinite(value))) {
        return undefined;
    }
    return Matrix.FromArray(tile.transform);
}

function getContentURI(content: Google3DTileContent): string {
    const uri = getContentURIOrUndefined(content);
    if (!uri) {
        throw new Error("Google 3D Tiles content did not contain a uri or url.");
    }
    return uri;
}

function getContentURIOrUndefined(content: Google3DTileContent): string | undefined {
    return typeof content.uri === "string" ? content.uri : typeof content.url === "string" ? content.url : undefined;
}

function isTilesetContent(content: Google3DTileContent): boolean {
    const uri = getContentURI(content).split("?", 1)[0].toLowerCase();
    return content.mimeType === "application/json" || uri.endsWith(".json");
}

/** Ground footprint distance, ignoring roof height and vertical box extent. */
function horizontalBoundsDistance(volume: Google3DBoundingVolume, transform: Matrix,
    eye: Vector3, east: Vector3, north: Vector3): number {
    const project = (point: Vector3): [number, number] => {
        const delta = point.subtract(eye);
        return [Vector3.Dot(delta, east), Vector3.Dot(delta, north)];
    };
    if (volume.sphere) {
        const center = project(Vector3.TransformCoordinates(Vector3.FromArray(volume.sphere), transform));
        const scale = Math.max(...[Vector3.Right(), Vector3.Up(), Vector3.Forward()]
            .map(axis => Vector3.TransformNormal(axis, transform).length()));
        return Math.max(0, Math.hypot(...center) - volume.sphere[3] * scale);
    }
    const points: Array<[number, number]> = [];
    if (volume.box) {
        const center = Vector3.TransformCoordinates(Vector3.FromArray(volume.box), transform);
        const axes = [3, 6, 9].map(offset => Vector3.TransformNormal(Vector3.FromArray(volume.box!, offset), transform));
        for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1])
            points.push(project(center.add(axes[0].scale(x)).addInPlace(axes[1].scale(y)).addInPlace(axes[2].scale(z))));
    } else if (volume.region) {
        const [west, south, right, top, low, high] = volume.region;
        for (const latitude of [south, top]) for (const longitude of [west, right]) for (const height of [low, high])
            points.push(project(geographicToECEF({ latitude: latitude / RADIANS_PER_DEGREE,
                longitude: longitude / RADIANS_PER_DEGREE, height })));
    } else return 0;
    points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (a: number[], b: number[], c: number[]) =>
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const lower: Array<[number, number]> = [], upper: Array<[number, number]> = [];
    for (const point of points) {
        while (lower.length > 1 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
        lower.push(point);
    }
    for (let i = points.length - 1; i >= 0; i--) {
        const point = points[i];
        while (upper.length > 1 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
        upper.push(point);
    }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    if (hull.length < 2) return Math.hypot(...(hull[0] ?? points[0]));
    let inside = hull.length > 2, distance = Infinity;
    for (let i = 0; i < hull.length; i++) {
        const a = hull[i], b = hull[(i + 1) % hull.length];
        if (cross(a, b, [0, 0]) < -1e-7) inside = false;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const squared = dx * dx + dy * dy;
        const t = squared ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / squared)) : 0;
        distance = Math.min(distance, Math.hypot(a[0] + t * dx, a[1] + t * dy));
    }
    return inside ? 0 : distance;
}

function boundingVolumeIntersects(
    boundingVolume: Google3DBoundingVolume | undefined,
    bounds: GeographicBounds,
    transform: Matrix,
): boolean {
    const region = boundingVolume?.region;
    if (!region || region.length < 4) {
        const box = boundingVolume?.box;
        const sphere = boundingVolume?.sphere;
        if (!box && !sphere) return true;
        const values = box ?? sphere!;
        if (values.length !== (box ? 12 : 4) || !values.every(Number.isFinite)) return true;
        const center = Vector3.TransformCoordinates(Vector3.FromArray(values), transform);
        const halfAxes = box ? [3, 6, 9].map(offset =>
            Vector3.TransformNormal(Vector3.FromArray(box, offset), transform)) : undefined;
        let radius: number;
        if (box) {
            // Sum half-axis lengths conservatively encloses a transformed box,
            // including nonuniform scaling and shear.
            radius = halfAxes!.reduce((sum, axis) => sum + axis.length(), 0);
        } else {
            const m = transform.m;
            const norm1 = Math.max(...[0, 4, 8].map(i => Math.abs(m[i]) + Math.abs(m[i + 1]) + Math.abs(m[i + 2])));
            const normInf = Math.max(...[0, 1, 2].map(i => Math.abs(m[i]) + Math.abs(m[i + 4]) + Math.abs(m[i + 8])));
            radius = Math.abs(sphere![3]) * Math.sqrt(norm1 * normInf);
        }
        if (bounds.circle) {
            const circle = bounds.circle;
            const relativeCenter = center.subtract(circle.center);
            const distance = Math.hypot(Vector3.Dot(relativeCenter, circle.east),
                Vector3.Dot(relativeCenter, circle.north));
            const extent = halfAxes ? halfAxes.reduce((sum, axis) =>
                sum + Math.hypot(Vector3.Dot(axis, circle.east), Vector3.Dot(axis, circle.north)), 0) : radius;
            if (distance - extent > circle.radius) return false;
        }
        if (bounds.localVolume) {
            const volume = bounds.localVolume;
            const relativeCenter = center.subtract(volume.origin);
            return volume.axes.every((axis, index) => {
                const projected = Vector3.Dot(relativeCenter, axis);
                const extent = halfAxes ? halfAxes.reduce((sum, halfAxis) =>
                    sum + Math.abs(Vector3.Dot(halfAxis, axis)), 0) : radius;
                return projected + extent >= volume.minimum[index]
                    && projected - extent <= volume.maximum[index];
            });
        }
        const distance = center.length();
        if (radius >= distance) return true;
        // Convert the angular cap's geocentric latitude to geodetic latitude.
        // Padding by the ellipsoid flattening bounds the angular distortion.
        const latitude = Math.atan2(center.z, Math.hypot(center.x, center.y)
            * (1 - WGS84_FIRST_ECCENTRICITY_SQUARED));
        const angle = Math.asin(radius / distance) * 1.01;
        const south = Math.max(-Math.PI / 2, latitude - angle);
        const north = Math.min(Math.PI / 2, latitude + angle);
        const longitude = Math.atan2(center.y, center.x);
        const longitudeRadius = south <= -Math.PI / 2 || north >= Math.PI / 2
            ? Math.PI : Math.asin(Math.min(1, Math.sin(angle) / Math.cos(latitude)));
        return boundingVolumeIntersects({ region: [longitude - longitudeRadius, south,
            longitude + longitudeRadius, north] }, bounds, Matrix.Identity());
    }

    const regionSouth = region[1] / RADIANS_PER_DEGREE;
    const regionNorth = region[3] / RADIANS_PER_DEGREE;
    if (regionNorth < bounds.south || regionSouth > bounds.north) {
        return false;
    }

    // A region whose east/west edges span a full turn is the common global
    // root volume. Normalizing both endpoints to -180 would otherwise turn it
    // into a zero-width slice at the antimeridian.
    if (Math.abs(region[2] - region[0]) >= 2 * Math.PI - 1e-10) {
        return true;
    }

    const west = normalizeLongitude(region[0] / RADIANS_PER_DEGREE);
    const east = normalizeLongitude(region[2] / RADIANS_PER_DEGREE);
    const regionLongitudes = west <= east
        ? [[west, east] as [number, number]]
        : [[west, 180] as [number, number], [-180, east] as [number, number]];
    return regionLongitudes.some(([regionWest, regionEast]) => {
        return bounds.longitudes.some(([boundsWest, boundsEast]) => {
            return regionEast >= boundsWest && regionWest <= boundsEast;
        });
    });
}

function normalizeLongitude(longitude: number): number {
    const normalized = ((longitude + 180) % 360 + 360) % 360 - 180;
    return normalized === -180 ? -180 : normalized;
}

function longitudeIntervals(west: number, east: number): Array<[number, number]> {
    if (!Number.isFinite(west) || !Number.isFinite(east) || Math.abs(east - west) >= 360) return [[-180, 180]];
    const left = normalizeLongitude(west), right = normalizeLongitude(east);
    return left <= right ? [[left, right]] : [[left, 180], [-180, right]];
}

/** A loose envelope is enough to avoid work for distant coverage changes. */
function geographicEnvelope(selection: TileSelection): GeographicBounds | undefined {
    const volume = selection.boundingVolume;
    if (!volume) return undefined;
    if (volume.region?.length === 6 && volume.region.every(Number.isFinite)) {
        const [west, south, east, north] = volume.region;
        return { south: south / RADIANS_PER_DEGREE, north: north / RADIANS_PER_DEGREE,
            longitudes: longitudeIntervals(west / RADIANS_PER_DEGREE, east / RADIANS_PER_DEGREE) };
    }
    const box = volume.box, sphere = volume.sphere;
    const values = box ?? sphere;
    if (!values || values.length !== (box ? 12 : 4) || !values.every(Number.isFinite)) return undefined;
    const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
    const center = Vector3.TransformCoordinates(Vector3.FromArray(values), transform);
    let radius: number;
    if (box) radius = [3, 6, 9].reduce((sum, offset) =>
        sum + Vector3.TransformNormal(Vector3.FromArray(box, offset), transform).length(), 0);
    else {
        const m = transform.m;
        const norm1 = Math.max(...[0, 4, 8].map(i => Math.abs(m[i]) + Math.abs(m[i + 1]) + Math.abs(m[i + 2])));
        const normInf = Math.max(...[0, 1, 2].map(i => Math.abs(m[i]) + Math.abs(m[i + 4]) + Math.abs(m[i + 8])));
        radius = Math.abs(sphere![3]) * Math.sqrt(norm1 * normInf);
    }
    const distance = center.length();
    if (!Number.isFinite(distance) || !Number.isFinite(radius) || radius >= distance) return undefined;
    const latitude = Math.atan2(center.z, Math.hypot(center.x, center.y)
        * (1 - WGS84_FIRST_ECCENTRICITY_SQUARED));
    const angle = Math.asin(radius / distance) * 1.01;
    const south = Math.max(-Math.PI / 2, latitude - angle);
    const north = Math.min(Math.PI / 2, latitude + angle);
    const longitude = Math.atan2(center.y, center.x);
    const longitudeRadius = south <= -Math.PI / 2 || north >= Math.PI / 2
        ? Math.PI : Math.asin(Math.min(1, Math.sin(angle) / Math.cos(latitude)));
    return { south: south / RADIANS_PER_DEGREE, north: north / RADIANS_PER_DEGREE,
        longitudes: longitudeIntervals((longitude - longitudeRadius) / RADIANS_PER_DEGREE,
            (longitude + longitudeRadius) / RADIANS_PER_DEGREE) };
}

function validateOrigin(origin: Google3DTilesOrigin): Google3DTilesOrigin {
    if (!Number.isFinite(origin.latitude) || origin.latitude < -90 || origin.latitude > 90) {
        throw new RangeError("origin.latitude must be between -90 and 90 degrees.");
    }
    if (!Number.isFinite(origin.longitude) || origin.longitude < -180 || origin.longitude > 180) {
        throw new RangeError("origin.longitude must be between -180 and 180 degrees.");
    }
    if (origin.height !== undefined && !Number.isFinite(origin.height)) {
        throw new RangeError("origin.height must be finite.");
    }
    return { ...origin, height: origin.height ?? 0 };
}

function geographicToECEF(origin: Google3DTilesOrigin): Vector3 {
    const latitude = origin.latitude * RADIANS_PER_DEGREE;
    const longitude = origin.longitude * RADIANS_PER_DEGREE;
    const sinLatitude = Math.sin(latitude);
    const cosLatitude = Math.cos(latitude);
    const radius = WGS84_SEMI_MAJOR_AXIS
        / Math.sqrt(1 - WGS84_FIRST_ECCENTRICITY_SQUARED * sinLatitude * sinLatitude);
    const height = origin.height ?? 0;
    return new Vector3(
        (radius + height) * cosLatitude * Math.cos(longitude),
        (radius + height) * cosLatitude * Math.sin(longitude),
        (radius * (1 - WGS84_FIRST_ECCENTRICITY_SQUARED) + height)
            * sinLatitude,
    );
}

/** Reject footprints inside a box's loose geographic envelope but outside its projected shape. */
function compileBoxFootprintIntersection(volume: Google3DBoundingVolume, transform?: number[]):
    (south: number, west: number, north: number, east: number) => boolean {
    const box = volume.box;
    if (!box || box.length !== 12 || !box.every(Number.isFinite)) return () => true;
    const matrix = transform ? Matrix.FromArray(transform) : Matrix.Identity();
    const center = Vector3.TransformCoordinates(Vector3.FromArray(box), matrix);
    const longitude = Math.atan2(center.y, center.x);
    const latitude = Math.atan2(center.z, Math.hypot(center.x, center.y)
        * (1 - WGS84_FIRST_ECCENTRICITY_SQUARED));
    const east = new Vector3(-Math.sin(longitude), Math.cos(longitude), 0);
    const north = new Vector3(-Math.sin(latitude) * Math.cos(longitude),
        -Math.sin(latitude) * Math.sin(longitude), Math.cos(latitude));
    const project = (point: Vector3): [number, number] => {
        const offset = point.subtract(center);
        return [Vector3.Dot(offset, east), Vector3.Dot(offset, north)];
    };
    const halfAxes = [3, 6, 9].map(index => {
        const axis = Vector3.TransformNormal(Vector3.FromArray(box, index), matrix);
        return [Vector3.Dot(axis, east), Vector3.Dot(axis, north)] as [number, number];
    });
    return (south, west, north, east) => {
        const corners: Array<[number, number]> = [];
        for (const height of [-12000, 12000]) for (const lat of [south, north]) for (const lon of [west, east])
            corners.push(project(geographicToECEF({ latitude: lat, longitude: lon, height })));
        const directions = [...halfAxes,
            [corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]],
            [corners[2][0] - corners[0][0], corners[2][1] - corners[0][1]],
            [corners[4][0] - corners[0][0], corners[4][1] - corners[0][1]]];
        for (const [dx, dy] of directions) {
            const ax = -dy, ay = dx;
            const length = Math.hypot(ax, ay);
            if (length < 1e-9) continue;
            const extent = halfAxes.reduce((sum, [x, y]) => sum + Math.abs(ax * x + ay * y), 0) + length;
            let minimum = Infinity, maximum = -Infinity;
            for (const [x, y] of corners) {
                const projected = ax * x + ay * y;
                minimum = Math.min(minimum, projected);
                maximum = Math.max(maximum, projected);
            }
            if (minimum > extent || maximum < -extent) return false;
        }
        return true;
    };
}

// Intersect a geographic vertical segment with the tile's oriented volume.
// Unlike a longitude/latitude AABB, this respects rotated Google tile edges.
function compileVerticalIntersection(volume: Google3DBoundingVolume, transform?: number[]): (latitude: number, longitude: number) => boolean {
    if (volume.region) {
        const region = volume.region;
        return (latitude, longitude) => {
            const lon = longitude * RADIANS_PER_DEGREE, lat = latitude * RADIANS_PER_DEGREE;
            return lat >= region[1] && lat <= region[3]
                && (region[0] <= region[2] ? lon >= region[0] && lon <= region[2] : lon >= region[0] || lon <= region[2]);
        };
    }
    const inverse = transform ? Matrix.Invert(Matrix.FromArray(transform)) : undefined;
    const axes = volume.box?.length === 12 ? [3, 6, 9].map(offset => {
        const axis = Vector3.FromArray(volume.box!, offset);
        const length = axis.length();
        return { axis: length ? axis.scale(1 / length) : axis, length };
    }) : undefined;
    const box = volume.box, sphere = volume.sphere;
    return (latitude, longitude) => {
        const start = geographicToECEF({ latitude, longitude, height: -12000 });
        const end = geographicToECEF({ latitude, longitude, height: 12000 });
        if (inverse) {
            Vector3.TransformCoordinatesToRef(start, inverse, start);
            Vector3.TransformCoordinatesToRef(end, inverse, end);
        }
        const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
        if (axes && box) {
            let near = 0, far = 1;
            const x = start.x - box[0], y = start.y - box[1], z = start.z - box[2];
            for (const {axis, length} of axes) {
                if (length === 0) return false;
                const position = x * axis.x + y * axis.y + z * axis.z;
                const velocity = dx * axis.x + dy * axis.y + dz * axis.z;
                if (Math.abs(velocity) < 1e-10) {
                    if (Math.abs(position) > length) return false;
                } else {
                    const a = (-length - position) / velocity, b = (length - position) / velocity;
                    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
                    if (near > far) return false;
                }
            }
            return true;
        }
        if (sphere?.length === 4) {
            const x = sphere[0] - start.x, y = sphere[1] - start.y, z = sphere[2] - start.z;
            const t = Math.max(0, Math.min(1, (x * dx + y * dy + z * dz) / (dx * dx + dy * dy + dz * dz)));
            return (dx * t - x) ** 2 + (dy * t - y) ** 2 + (dz * t - z) ** 2 <= sphere[3] ** 2;
        }
        return false;
    };
}
