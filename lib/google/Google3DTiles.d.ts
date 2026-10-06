import { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { Vector3 } from "@babylonjs/core/Maths/math.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type TileSet from "../core/TileSet.js";
/** Google Maps Platform Map Tiles API Photorealistic 3D Tiles endpoint. */
export declare const GOOGLE_3D_TILES_ROOT_URL = "https://tile.googleapis.com/v1/3dtiles/root.json";
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
export type GoogleModelTileLoader = (url: string, scene: Scene, signal?: AbortSignal) => Promise<LoadedGoogleModelTile | undefined>;
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
    hierarchyFailureSamples: Array<{
        type: "network" | "http" | "response" | "loader";
        status?: number;
        attempts: number;
    }>;
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
    geometricErrorHistogram: Array<{
        geometricError?: number;
        selectedTiles: number;
        loadedTiles: number;
        coreTiles: number;
        nearTiles: number;
        immediateTiles: number;
    }>;
    /** Complete visible frontier at the requested quality, without download, source, or budget limits. */
    detailComplete: boolean;
    /** Immediate frontier is visible at the display limit or the best available source quality, without budget limits. */
    immediateQualityComplete: boolean;
    immediateSelectedTiles: number;
    immediateLoadedTiles: number;
    immediateQualityMissingTiles: number;
    qualityLimitedSamples: Array<{
        groundDistance: number;
        geometricError: number;
        depth: number;
        sourceLeaf: boolean;
    }>;
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
    coverageRegion?: {
        south: number;
        north: number;
        west: number;
        east: number;
    };
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
    readonly tileSet: TileSet;
    apiKey: string;
    rootUrl: string;
    maxDepth: number;
    maxTiles: number;
    exaggeration: number;
    coverageRadius?: number;
    /** Center of the latest geographic frontier admitted during the active load. */
    selectedCoverageCenter?: {
        latitude: number;
        longitude: number;
    };
    coverageRegion?: Google3DTilesOptions["coverageRegion"];
    maximumGeometricError: number;
    maximumScreenSpaceError?: number;
    maximumDisplayGeometricError?: number;
    maximumInitialErrorRatio?: number;
    cullToCamera: boolean;
    fullRadiusDemand: boolean;
    /** Completion of the latest load, suitable for gating staged startup. */
    lastLoadResult?: Google3DLoadResult;
    /** Maximum hierarchy branches inspected in parallel during frontier selection. */
    maxPendingHierarchy: number;
    referenceImageHeight: number;
    referenceFovY: number;
    maxConcurrentModelDecodes: number;
    maxConcurrentRequests: number;
    maxBufferedModels: number;
    startupTraversalSliceMs: number;
    fastStaticModels: boolean;
    lightweightUnlitMaterials: boolean;
    heightOffset: number;
    readonly stats: {
        hierarchyRequests: number;
        hierarchyRetries: number;
        rootResponseFingerprint: number;
        modelRequests: number;
        reusedModels: number;
        networkQueueRebuilds: number;
        networkPriorityEvaluations: number;
        hierarchyQueuePriorityChecks: number;
        hierarchyQueuePriorityChanges: number;
        obsoleteModelRequests: number;
        obsoleteHierarchyRequests: number;
        detailLimitedTiles: number;
        sourceLimitedTiles: number;
        visibleDetailLimitedTiles: number;
        offscreenDetailLimitedTiles: number;
        visibleSourceLimitedTiles: number;
        offscreenSourceLimitedTiles: number;
        rootMs: number;
        frontierTraversalMs: number;
        frontierBudgetScanMs: number;
        frontierBudgetScanCount: number;
        frontierYieldCount: number;
        frontierCommitMs: number;
        replacementMs: number;
        modelWaitMs: number;
        loadMs: number;
        modelFetchMs: number;
        modelDecodeMs: number;
        modelIntegrationMs: number;
        modelIntegrationMaxMs: number;
        modelFetchHeaderMs: number;
        modelFetchBodyMs: number;
        fastParseMs: number;
        fastCreationMs: number;
        fastMaterialMs: number;
        fastGeometryMs: number;
        fastAtlasUpdateMs: number;
        fastAtlasReadyMs: number;
        fastAtlasBitmapMs: number;
        modelResponsePositiveMaxAgeCount: number;
        modelResponseMaxAgeMinSeconds: number;
        modelResponseMaxAgeMaxSeconds: number;
        modelResourceTimingReadableCount: number;
        modelResourceTimingUnavailableCount: number;
        modelResourceTimingOpaqueCount: number;
        modelResourceZeroTransferCount: number;
        modelResourceTransferBytes: number;
        modelResourceEncodedBytes: number;
        coveragePreviewCandidateModels: number;
        coveragePreviewModels: number;
        coveragePreviewTextures: number;
        coveragePreviewSelectedMaxSize: number;
        coveragePreviewSourceMaxSize: number;
        coveragePreviewDecodedMaxSize: number;
        modelFetchCount: number;
        modelFetchBytes: number;
        staticContainerModels: number;
        fastModelCount: number;
        genericModelCount: number;
        lightweightMaterialCount: number;
        modelDecodeCount: number;
        modelDecodeActive: number;
        peakModelDecodeActive: number;
        modelDecodeQueued: number;
        peakModelDecodeQueued: number;
        reusedDownloadedModels: number;
        coastalSkirtTrianglesRemoved: number;
        peakHierarchyActive: number;
        peakModelActive: number;
        peakNetworkActive: number;
    };
    origin?: Google3DTilesOrigin;
    private readonly tilesetLoader;
    private static readonly startupWorkBudgets;
    private readonly modelTileLoader;
    private readonly usesDefaultModelLoader;
    private rootTileset;
    private rootRequestKey;
    private rootRequest?;
    private session;
    private readonly externalTilesets;
    private readonly hierarchyPriorities;
    private readonly externalTilesetDemand;
    private preparationEpoch;
    private readonly preparationWaiters;
    private readonly dirtyCoverageEntries;
    private readonly attributionCounts;
    private readonly loadedTiles;
    private retainedTiles;
    private generation;
    private frontierGeneration;
    private desiredTiles;
    private originStateKey;
    private originGeneration;
    private readonly pendingModelUploads;
    private publicationGate?;
    private publicationQueued;
    private preparationQueued;
    private googleAttributionAdded;
    private attributionCacheValid;
    private attributionCache;
    private pendingModels;
    private readonly unusableModelURLs;
    private readonly prefetchModels;
    private activeModelFetches;
    private lastModelAbortEye?;
    private selectionEye?;
    private requestEye?;
    private requestPriorityRevision;
    private lastPriorityUpdateAt;
    private readonly movementWaiters;
    private frustumCache?;
    private frontierCache?;
    private networkActive;
    private networkActiveOffscreen;
    private networkActiveHierarchy;
    private networkActiveModel;
    private networkQueuedHierarchy;
    private networkQueuedModel;
    private networkDispatchCount;
    private networkWaiters;
    private networkPendingInsertions;
    private networkEnqueueSequence;
    private networkQueueRevision;
    private readonly networkQueues;
    private modelDecodeActive;
    private modelDecodeWaiters;
    private pendingModelReuseBlocked;
    private pendingReuseBounds?;
    private loadingStage;
    private stageDetailRadius;
    private stageCoverageGeometricError;
    private stageCoverageNearGeometricError?;
    private stageCoverageNearRadius;
    private stageCoverageCoreGeometricError?;
    private stageCoverageCoreRadius;
    private stageCoverageAtlasMaxSize?;
    private coverageQualityEye?;
    private readonly coverageDistances;
    private loadingPhase;
    private frontierProgress?;
    private replacementGroupsPending;
    private canReusePendingModel;
    private canDecodeModel;
    private drainModelDecode;
    private modelDecodeSlot;
    private networkDrainQueued;
    private networkQueueName;
    private networkQueueFor;
    private rebuildNetworkQueues;
    private cancelNetworkWaiter;
    private drainNetwork;
    private networkSlot;
    constructor(tileSet: TileSet, options?: Google3DTilesOptions);
    /** Content currently attached to the Babylon scene. */
    get loadedModelTiles(): readonly LoadedGoogle3DTile[];
    /** Current queue occupancy, including work that can delay a startup-stage barrier. */
    get loadingProgress(): {
        stage: Google3DLoadingStage;
        phase: "root" | "idle" | "frontier" | "replacement" | "models";
        queuedFrontier: number;
        pendingHierarchy: number;
        replacementGroups: number;
        pendingModels: number;
        hierarchyActive: number;
        modelActive: number;
        hierarchyQueued: number;
        modelQueued: number;
        decodeActive: number;
        decodeQueued: number;
        uploadQueued: number;
        publicationQueued: number;
        preparationQueued: number;
    };
    /** Current camera-facing resident quality, sampled independently of the last completed traversal. */
    measureVisibleQuality(): {
        visibleTiles: number;
        underDetailedTiles: number;
        missingVisibleTiles: number;
        worstErrorRatio: number;
        worstDepth: number;
        worstGeometricError: number;
    };
    /** Probe the current ground view independently of a possibly stale frontier. */
    sampleVisibleSurfaceCoverage(): {
        sampled: number;
        missing: number;
    };
    private coverageKey;
    private coverageVersion;
    get coverageRevision(): number;
    private changedCoverageURLs?;
    private changedCoverageRevision;
    private changedCoverageBounds;
    /** Conservatively test whether changed model bounds can affect a geographic tile. */
    coverageChangesIntersect(urls: readonly string[], south: number, west: number, north: number, east: number): boolean;
    private coverageIndex;
    private indexedCoverage;
    private broadCoverage;
    private coverageTests;
    private footprintEnvelopes;
    private footprintTests;
    private loadedSelections;
    /** Whether loaded model bounds cover this position at an optional source-error limit. */
    coversLocation(latitude: number, longitude: number, maximumGeometricError?: number): boolean;
    /** Skip a fallback tile only when one resident model covers its whole sampled footprint. */
    coversAreaCompletely(south: number, west: number, north: number, east: number, maximumGeometricError?: number): boolean;
    /** Whether a resident model overlaps a geographic building footprint. */
    overlapsFootprint(south: number, west: number, north: number, east: number, maximumGeometricError?: number): boolean;
    private coverageQualityMatches;
    private coverageTest;
    private footprintTest;
    /** The last root tileset response, if load() has been called. */
    get tileset(): Google3DTileset | undefined;
    /** The session token discovered in the tileset's child URIs. */
    get sessionToken(): string | undefined;
    /** Returns attribution sources sorted by frequency, then alphabetically. */
    getAttributions(): string[];
    /**
     * Resolves a Google 3D Tiles URI and adds the API key and session token.
     * Child URIs returned by Google are path/query components rather than
     * complete URLs, so callers should pass the URL of the response containing
     * the URI as baseUrl.
     */
    getTileURL(uri: string, baseUrl?: string): string;
    /** Cancel queued work while retaining the visible scene and hierarchy cache. */
    cancelPendingLoad(preserveDownloadedModels?: boolean): void;
    /** The active frontier can follow camera movement without discarding its work. */
    get selectingFrontier(): boolean;
    /** Reorder queued downloads immediately when the camera moves, without cancelling active requests. */
    reprioritizeRequests(): void;
    /** Warm only the full-radius baseline JSON hierarchy. No GLBs, publication, stage, or readiness changes. */
    prepareCoverageHierarchy(selectionRadius?: number | undefined, options?: Google3DLoadOptions, signal?: AbortSignal): Promise<void>;
    /** Warm nearby detail JSON while baseline models load, retaining the same full-radius baseline policy. */
    prepareImmediateHierarchy(selectionRadius?: number | undefined, options?: Google3DLoadOptions, signal?: AbortSignal): Promise<void>;
    private prepareHierarchy;
    private startupWorkBudget;
    private configurePublication;
    private awaitPublication;
    /**
     * Loads content overlapping selectionRadius while reusing the hierarchy and resident models.
     * Startup can await load(radius, {stage: "coverage"}), then load(radius,
     * {stage: "immediate", detailRadius: 750}), then load(radius) for normal refinement.
     * Both startup passes select the complete disk, so nearby replacement cannot remove distant coverage.
     */
    load(selectionRadius?: number | undefined, options?: Google3DLoadOptions): Promise<readonly LoadedGoogle3DTile[]>;
    private usesCoverageQuality;
    private coverageGeometricError;
    private horizontalTileDistance;
    private preserveResidentDetail;
    private acceptableDisplayQuality;
    private acceptableInitialQuality;
    private trimVisibleHistory;
    private trimRetainedTiles;
    /** Prepare a bounded surrounding ring after visible loading has finished. */
    prefetchSurroundings(): Promise<void>;
    /** Alias matching the building-provider lifecycle used by older examples. */
    generateBuildings(): Promise<readonly LoadedGoogle3DTile[]>;
    /** Disposes loaded GLB assets and clears the provider's request caches. */
    dispose(): void;
    private validateOptions;
    private getOrigin;
    private getOriginStateKey;
    private getRootTilesetURL;
    private loadRootTileset;
    private requestTileset;
    private recordHierarchyFailure;
    private authenticateURL;
    private loadExternalTileset;
    private cameraEye;
    private tilePriority;
    private requestPriority;
    private allowedGeometricError;
    /** A complete renderable frontier: refine the largest projected error first.
     * A budget limit leaves a parent in place instead of dropping its siblings.
     */
    private selectFrontier;
    private collectTileContent;
    private retireTile;
    private indexLoadedDescendants;
    private hasVisibleDescendant;
    /** Commit disjoint replacement subtrees only after every new model is ready. */
    private loadReplacementGroups;
    private loadTile;
    private recordModelFailure;
    private loadTileAsset;
    private createTileRoot;
    private disposeTile;
    private disposeLoadedTiles;
    private updateAttribution;
    private getTileSetBounds;
}
/** Remove deep coastal photogrammetry skirts and their attached fins. */
export declare function removeCoastalSkirtTriangles(mesh: Mesh, metresToWorld: number, globeRadius?: number): number;
/** Extracts Google attribution and CESIUM_RTC metadata from a GLB JSON chunk. */
export declare function parseGoogleGLBMetadata(buffer: ArrayBuffer): GoogleGLBMetadata;
