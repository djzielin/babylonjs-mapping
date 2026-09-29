import { SceneWorkBudget } from "../shared/SceneWorkBudget.js";
import { PriorityQueue } from "../shared/PriorityQueue.js";
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

export interface Google3DTilesOptions {
    /** Google Maps Platform API key. It is appended to every request. */
    apiKey?: string;
    /** Root tileset URL, primarily useful for compatible test endpoints. */
    rootUrl?: string;
    /** Maximum number of hierarchy levels visited for one load. */
    maxDepth?: number;
    /** Maximum number of GLB content tiles kept in the scene. */
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
}

interface NetworkWaiter {
    priority: number | (() => number);
    kind: "hierarchy" | "model";
    resume: (offscreen: boolean) => void;
    sequence: number;
    distance?: number;
}

class ChangedTileMap<T> extends Map<string, T> {
    constructor(private readonly changed: (url: string) => void) { super(); }

    public override set(url: string, value: T): this {
        if (this.get(url) !== value) this.changed(url);
        return super.set(url, value);
    }

    public override delete(url: string): boolean {
        const removed = super.delete(url);
        if (removed) this.changed(url);
        return removed;
    }

    public override clear(): void {
        for (const url of this.keys()) this.changed(url);
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
    /** Maximum hierarchy branches inspected in parallel during frontier selection. */
    public maxPendingHierarchy = 16;
    public referenceImageHeight: number;
    public referenceFovY: number;
    public heightOffset = 0;
    public readonly stats = { hierarchyRequests: 0, modelRequests: 0, reusedModels: 0,
        detailLimitedTiles: 0, sourceLimitedTiles: 0,
        visibleDetailLimitedTiles: 0, offscreenDetailLimitedTiles: 0,
        visibleSourceLimitedTiles: 0, offscreenSourceLimitedTiles: 0,
        rootMs: 0, frontierTraversalMs: 0,
        frontierBudgetScanMs: 0, frontierBudgetScanCount: 0, frontierYieldCount: 0,
        frontierCommitMs: 0, replacementMs: 0, modelWaitMs: 0, loadMs: 0,
        modelFetchMs: 0, modelDecodeMs: 0, modelIntegrationMs: 0, modelIntegrationMaxMs: 0,
        modelFetchCount: 0, modelDecodeCount: 0, modelDecodeActive: 0, peakModelDecodeActive: 0,
        modelDecodeQueued: 0, peakModelDecodeQueued: 0, reusedDownloadedModels: 0,
        coastalSkirtTrianglesRemoved: 0,
        peakHierarchyActive: 0, peakModelActive: 0, peakNetworkActive: 0 };
    public origin?: Google3DTilesOrigin;

    private readonly tilesetLoader: GoogleTilesetLoader;
    private readonly modelTileLoader: GoogleModelTileLoader;
    private readonly usesDefaultModelLoader: boolean;
    private rootTileset: Google3DTileset | undefined;
    private rootRequestKey = "";
    private rootRequest?: { key: string; promise: Promise<Google3DTileset> };
    private session: string | undefined;
    private readonly externalTilesets = new Map<string, Promise<LoadedTileset>>();
    private readonly dirtyCoverageEntries = new Set<string>();
    private readonly loadedTiles = new ChangedTileMap<LoadedGoogle3DTile>(url => {
        this.dirtyCoverageEntries.add(url);
        this.attributionCacheValid = false;
    });
    private retainedTiles = new Map<string, LoadedGoogle3DTile>();
    private generation = 0;
    private frontierGeneration = -1;
    private desiredTiles = new Map<string, TileSelection>();
    private originStateKey = "";
    private googleAttributionAdded = false;
    private attributionCacheValid = false;
    private attributionCache: string[] = [];
    private pendingModels = new Map<string, { generation: number; request: Promise<LoadedGoogle3DTile | undefined> }>();
    private readonly unusableModelURLs = new Set<string>();
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
        reuse?: () => boolean; resume: (ready: boolean) => void; distance?: number; evaluatedAt?: number }> = [];
    private pendingModelReuseBlocked = false;
    private pendingReuseBounds?: { revision: number; bounds: GeographicBounds };

    private canReusePendingModel(selection: TileSelection, origin: Google3DTilesOrigin): boolean {
        if (this.pendingModelReuseBlocked || this.getOriginStateKey(origin) !== this.originStateKey) return false;
        if (this.pendingReuseBounds?.revision !== this.requestPriorityRevision)
            this.pendingReuseBounds = { revision: this.requestPriorityRevision, bounds: this.getTileSetBounds() };
        const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
        return boundingVolumeIntersects(selection.boundingVolume, this.pendingReuseBounds.bounds, transform);
    }

    private canDecodeModel(generation: number, reuse?: () => boolean): boolean {
        return generation === this.generation || !!reuse?.();
    }

    private drainModelDecode(): void {
        // A cancelled view must release its downloaded buffers even while both
        // decoder slots are busy with work from the previous generation.
        this.modelDecodeWaiters = this.modelDecodeWaiters.filter(waiter => {
            if (this.canDecodeModel(waiter.generation, waiter.reuse)) return true;
            waiter.resume(false);
            return false;
        });
        this.stats.modelDecodeQueued = this.modelDecodeWaiters.length;
        if (this.modelDecodeActive >= 2 || !this.modelDecodeWaiters.length) return;
        for (const waiter of this.modelDecodeWaiters) {
            if (waiter.evaluatedAt === this.requestPriorityRevision) continue;
            waiter.distance = waiter.priority();
            waiter.evaluatedAt = this.requestPriorityRevision;
        }
        this.modelDecodeWaiters.sort((a, b) => a.distance! - b.distance!);
        while (this.modelDecodeActive < 2 && this.modelDecodeWaiters.length) {
            const next = this.modelDecodeWaiters.shift()!;
            this.stats.modelDecodeQueued = this.modelDecodeWaiters.length;
            if (!this.canDecodeModel(next.generation, next.reuse)) { next.resume(false); continue; }
            this.modelDecodeActive++;
            next.resume(true);
        }
    }

    private async modelDecodeSlot<T>(work: () => Promise<T>, priority: () => number,
        generation: number, reuse?: () => boolean): Promise<T | undefined> {
        const ready = await new Promise<boolean>(resume => {
            this.modelDecodeWaiters.push({ priority, generation, reuse, resume });
            this.stats.modelDecodeQueued = this.modelDecodeWaiters.length;
            this.stats.peakModelDecodeQueued = Math.max(this.stats.peakModelDecodeQueued, this.stats.modelDecodeQueued);
            this.drainModelDecode();
        });
        if (!ready) return undefined;
        try {
            if (!this.canDecodeModel(generation, reuse)) return undefined;
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
            const buckets = {
                visibleHierarchy: [] as NetworkWaiter[], visibleModel: [] as NetworkWaiter[],
                offscreenHierarchy: [] as NetworkWaiter[], offscreenModel: [] as NetworkWaiter[],
            };
            for (const waiter of this.networkWaiters) {
                waiter.distance = typeof waiter.priority === "function" ? waiter.priority() : waiter.priority;
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
            this.networkQueueFor(waiter).push(waiter);
        }
        this.networkPendingInsertions = [];
    }

    private drainNetwork(): void {
        if (this.networkDrainQueued) return;
        this.networkDrainQueued = true;
        queueMicrotask(() => {
            this.networkDrainQueued = false;
            if (this.networkActive >= 48) return;
            // Reclassify on camera changes. Between turns, enqueue and dispatch
            // use heaps rather than sorting the entire backlog per free slot.
            this.rebuildNetworkQueues();
            const { visibleHierarchy, visibleModel, offscreenHierarchy, offscreenModel } = this.networkQueues;
            const best = (hierarchy: PriorityQueue<NetworkWaiter>, model: PriorityQueue<NetworkWaiter>) => {
                const a = hierarchy.peek(), b = model.peek();
                return !b || a && (a.distance! < b.distance!
                    || a.distance === b.distance && a.sequence < b.sequence) ? hierarchy : model;
            };
            let visible = visibleHierarchy.length + visibleModel.length;
            let offscreen = offscreenHierarchy.length + offscreenModel.length;
            while (this.networkActive < 48 && this.networkWaiters.size) {
                // Give the full disk a small guaranteed share under a long
                // visible backlog, while leaving nearly every released slot
                // for the camera-facing quality deficit.
                const fairBackground = visible > 0 && offscreen > 0
                    && this.networkActiveOffscreen < 4 && this.networkDispatchCount % 8 === 7;
                let queue = fairBackground ? best(offscreenHierarchy, offscreenModel)
                    : visible ? best(visibleHierarchy, visibleModel)
                    : best(offscreenHierarchy, offscreenModel);
                let next = queue.peek()!;
                if (this.usesDefaultModelLoader && next.kind === "model") {
                    const outstanding = this.networkActiveModel + this.modelDecodeActive + this.modelDecodeWaiters.length;
                    if (outstanding >= 16) {
                        const worstDecode = this.modelDecodeWaiters.reduce((worst, waiter) =>
                            Math.max(worst, waiter.evaluatedAt === this.requestPriorityRevision
                                ? waiter.distance! : waiter.priority()), -Infinity);
                        // A newly visible quality deficit can exceed the normal
                        // buffer cap after a turn, without unbounded growth.
                        if (outstanding >= 24 || next.distance! >= worstDecode) {
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
                // the current priority order and can fill all 48 slots.
                if (isOffscreen && visible === 0 && this.networkActive >= 46) break;
                queue.shift();
                this.networkWaiters.delete(next);
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
        kind: "hierarchy" | "model" = "hierarchy"): Promise<T> {
        const offscreen = await new Promise<boolean>(resolve => {
            const waiter: NetworkWaiter = { priority, kind, resume: resolve,
                sequence: this.networkEnqueueSequence++ };
            this.networkWaiters.add(waiter);
            this.networkPendingInsertions.push(waiter);
            this.drainNetwork();
        });
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
        try { return await work(releaseSlot); }
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
        this.heightOffset = options.heightOffset ?? 0;
        this.origin = options.origin;
        this.apiKey = options.apiKey ?? "";
        this.tilesetLoader = options.tilesetLoader ?? defaultTilesetLoader;
        this.usesDefaultModelLoader = !options.modelTileLoader;
        this.modelTileLoader = options.modelTileLoader ?? ((url, scene, signal) => defaultModelTileLoader(url, scene, this.stats, signal));
    }

    /** Content currently attached to the Babylon scene. */
    public get loadedModelTiles(): readonly LoadedGoogle3DTile[] {
        return Array.from(this.loadedTiles.values());
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

    /** Whether loaded model bounds cover this geographic position. */
    public coversLocation(latitude: number, longitude: number): boolean {
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
        for (const selection of nearby) if (this.coverageTest(selection)(latitude, longitude)) return true;
        for (const selection of this.broadCoverage.values())
            if (this.coverageTest(selection)(latitude, longitude)) return true;
        return false;
    }

    /** Skip a fallback tile only when one resident model covers its whole sampled footprint. */
    public coversAreaCompletely(south: number, west: number, north: number, east: number): boolean {
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
            const test = this.coverageTest(selection);
            return latitudes.every(lat => longitudes.every(lon => test(lat, lon)));
        };
        return nearby.some(covers) || Array.from(this.broadCoverage.values()).some(covers);
    }

    /** Whether a resident model overlaps a geographic building footprint. */
    public overlapsFootprint(south: number, west: number, north: number, east: number): boolean {
        if (!this.loadedTiles.size || south > north || ![south, west, north, east].every(Number.isFinite)) return false;
        // coversLocation also rebuilds the resident-only spatial index after a
        // replacement commits. A point query alone misses narrow tile edges
        // that pass between the building footprint's sample points.
        this.coversLocation((south + north) / 2, (west + east) / 2);
        const queryLongitudes = longitudeIntervals(west, east);
        const seen = new Set<TileSelection>();
        const overlaps = (selection: TileSelection): boolean => {
            if (seen.has(selection)) return false;
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
        const minX = Math.floor(west * 1000), maxX = Math.floor(east * 1000);
        const minY = Math.floor(south * 1000), maxY = Math.floor(north * 1000);
        if ((maxX - minX + 1) * (maxY - minY + 1) <= 4096) {
            for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++)
                for (const selection of this.coverageIndex.get(`${x}/${y}`) ?? []) if (overlaps(selection)) return true;
        } else {
            for (const selection of this.loadedSelections.values())
                if (this.loadedTiles.has(selection.url) && overlaps(selection)) return true;
        }
        for (const selection of this.broadCoverage.values()) if (overlaps(selection)) return true;
        return false;
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
        const counts = new Map<string, number>();
        for (const tile of this.loadedTiles.values()) {
            for (const attribution of new Set(tile.attributions)) {
                counts.set(attribution, (counts.get(attribution) ?? 0) + 1);
            }
        }

        this.attributionCache = Array.from(counts.entries())
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
        this.pendingModelReuseBlocked = !preserveDownloadedModels;
        this.generation++;
        this.drainModelDecode();
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

    /** Loads content that overlaps the current TileSet. */
    public async load(selectionRadius = this.coverageRadius): Promise<readonly LoadedGoogle3DTile[]> {
        const loadStarted = performance.now();
        this.tileSet.assertRasterSetup("load Google 3D Tiles");
        this.validateOptions();

        this.selectionEye = this.cameraEye();
        this.requestEye = this.selectionEye;
        this.requestPriorityRevision++;
        this.pendingModelReuseBlocked = false;
        const residentAtStart = new Set([...this.loadedTiles.keys(), ...this.retainedTiles.keys()]);
        const generation = ++this.generation;
        this.drainModelDecode();
        this.unusableModelURLs.clear();
        const origin = this.getOrigin();
        const originStateKey = this.getOriginStateKey(origin);
        if (this.originStateKey !== "" && this.originStateKey !== originStateKey) {
            this.disposeLoadedTiles();
        }
        this.originStateKey = originStateKey;

        const residentAncestors = new Set<string>();
        for (const [url, selection] of this.loadedSelections) if (this.loadedTiles.has(url))
            for (const ancestor of selection.ancestors ?? []) residentAncestors.add(ancestor);
        // The new view can use prefetched coverage before hierarchy traversal
        // finishes. Keep it visible until the selected finer subtree commits.
        let promoted = false;
        for (const [url, tile] of this.retainedTiles) {
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
        if (generation !== this.generation) return [];
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
        if (this.maximumScreenSpaceError) {
            this.frontierGeneration = generation;
            try { await this.selectFrontier(desiredTiles, generation, selection => {
                desiredTiles.set(selection.url, selection);
                // A nearby offscreen parent may already be prefetched. Show it
                // immediately on a turn while its complete detail subtree loads.
                for (const ancestor of [...(selection.ancestors ?? [])].reverse()) {
                    // Resident children can finish after residentAncestors was
                    // captured at the start of this pass. Promoting their
                    // coarse parent now would draw both replacement levels.
                    if (residentAncestors.has(ancestor) || this.hasVisibleDescendant(ancestor)) continue;
                    const coarse = this.retainedTiles.get(ancestor);
                    const coarseSelection = this.loadedSelections.get(ancestor);
                    if (!coarse || !coarseSelection || !this.acceptableDisplayQuality(coarseSelection)
                        || !this.acceptableInitialQuality(coarseSelection)) continue;
                    this.retainedTiles.delete(ancestor);
                    this.loadedTiles.set(ancestor, coarse);
                    coarse.root.setEnabled(true);
                    this.coverageKey = ""; this.coverageVersion++;
                    break;
                }
                if (residentAncestors.has(selection.url) && selection.geometricError !== undefined
                    && selection.geometricError > this.allowedGeometricError(selection.boundingVolume,
                        selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity())) return;
                const overlapsExisting = selection.ancestors?.some(url => this.loadedTiles.has(url))
                    || residentAncestors.has(selection.url);
                // New, disjoint coverage can appear immediately. Overlapping
                // refinements still commit as a complete replacement subtree.
                modelRequests.push(this.loadTile(selection, origin, generation,
                    !overlapsExisting && this.acceptableInitialQuality(selection)).catch(() => undefined));
            }, false, selectionRadius); }
            finally { if (this.frontierGeneration === generation) this.frontierGeneration = -1; }
            if (Array.from(desiredTiles.keys()).some(url => !this.loadedTiles.has(url))) {
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
        if (generation !== this.generation) return [];
        this.desiredTiles = desiredTiles;

        const modelWaitStarted = performance.now();
        await Promise.all(modelRequests);
        this.stats.modelWaitMs = performance.now() - modelWaitStarted;
        if (generation !== this.generation) return [];
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
                if (this.maximumScreenSpaceError && previous) {
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
        return this.loadedModelTiles;
    }

    private acceptableDisplayQuality(selection: TileSelection): boolean {
        return this.maximumDisplayGeometricError === undefined || selection.geometricError === undefined
            || selection.geometricError <= this.maximumDisplayGeometricError;
    }

    private acceptableInitialQuality(selection: TileSelection): boolean {
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
            requests.push(this.loadTile(selection, origin, generation, false).catch(() => undefined));
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
        this.pendingModelReuseBlocked = true;
        ++this.generation;
        this.drainModelDecode();
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

    private async loadRootTileset(generation: number): Promise<void> {
        const rootUrl = this.getRootTilesetURL();
        const requestKey = `${rootUrl}|${this.apiKey}`;
        if (this.rootTileset && this.rootRequestKey === requestKey) {
            return;
        }
        let request = this.rootRequest;
        if (!request || request.key !== requestKey) {
            this.stats.hierarchyRequests++;
            request = { key: requestKey, promise: this.tilesetLoader(rootUrl) };
            this.rootRequest = request;
        }
        let tileset: Google3DTileset;
        try { tileset = await request.promise; }
        catch (error) {
            if (this.rootRequest === request) this.rootRequest = undefined;
            throw error;
        }
        if (generation !== this.generation || this.rootRequest !== request) return;
        if (!tileset?.root) {
            this.rootRequest = undefined;
            throw new Error("Google 3D Tiles root response did not contain a root tile.");
        }
        this.rootTileset = tileset;
        this.rootRequestKey = requestKey;
        this.rootRequest = undefined;
        this.session = undefined;
        this.externalTilesets.clear();
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

    private async loadExternalTileset(uri: string, baseUrl: string, priority: number | (() => number) = 0, generation = this.generation): Promise<LoadedTileset> {
        const url = this.authenticateURL(uri, baseUrl);
        const cached = this.externalTilesets.get(url);
        if (cached) {
            return cached.catch(error => {
                if (generation === this.generation && error instanceof DOMException && error.name === "AbortError")
                    return this.loadExternalTileset(uri, baseUrl, priority, generation);
                throw error;
            });
        }

        // Keep queued hierarchy fetches across camera generations. Their
        // priority follows the current eye, and a later selection reuses the
        // same promise instead of requesting the same subtree again on turns.
        const request = this.networkSlot(() => {
            this.stats.hierarchyRequests++; return this.tilesetLoader(url);
        }, priority).then((tileset) => {
            if (!tileset || !tileset.root) {
                throw new Error("Google 3D Tiles response did not contain a root tile.");
            }
            return { tileset, url };
        }).catch((error) => {
            this.externalTilesets.delete(url);
            throw error;
        });
        this.externalTilesets.set(url, request);
        return request;
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
        if (!values) return 0;
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
        surroundings = false, eye = this.selectionEye ?? this.cameraEye(), forPriority = false): number {
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
        if (this.cullToCamera && !visible && !surroundings && (!this.fullRadiusDemand || forPriority)) return -1;
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
            this.maximumGeometricError, this.originStateKey, this.rootRequestKey, surroundings, this.coverageRegion]);
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
        const workBudget = SceneWorkBudget.forScene(this.tileSet.scene);
        const firstContent = async (tile: Google3DTile, responseUrl: string, depth: number,
            parentTransform: Matrix, parentRefine: string, ancestors: string[] = []): Promise<FrontierTile[]> => {
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
            if (inRegion) allowed = allowed < 0 ? this.maximumDisplayGeometricError ?? 33
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
            return children(node);
        };
        const children = async (node: FrontierTile): Promise<FrontierTile[]> => {
            if (node.depth >= this.maxDepth) return [];
            const branches = (node.tile.children ?? []).map(child => firstContent({
                ...child,
                boundingVolume: child.boundingVolume ?? node.tile.boundingVolume,
                geometricError: child.geometricError ?? node.tile.geometricError,
            }, node.responseUrl,
                node.depth + 1, node.transform, node.refine, node.ancestors.concat(node.selections.map(selection => selection.url))));
            for (const content of getTileContents(node.tile).filter(isTilesetContent)) {
                branches.push(this.loadExternalTileset(getContentURI(content), node.responseUrl,
                    () => this.requestPriority(node.tile.boundingVolume, node.transform, node.tile.geometricError,
                        node.ancestors.some(url => this.loadedTiles.has(url))), generation).then(external => firstContent(external.tileset.root,
                        external.url, node.depth + 1, node.transform, node.refine, node.ancestors.concat(node.selections.map(selection => selection.url)))));
            }
            return (await Promise.all(branches)).reduce((all, branch) => all.concat(branch), [] as FrontierTile[]);
        };
        const initial = await firstContent(this.rootTileset!.root, this.getRootTilesetURL(), 0, Matrix.Identity(), "REPLACE");
        const frontier = new Set(initial);
        let count = initial.reduce((sum, node) => sum + node.selections.length, 0);
        if (count > budget) throw new Error("The first renderable Google tile level exceeds the configured tile budget.");
        let preferCoverage = false;
        const settled = new Set<FrontierTile>();
        const fallback = new WeakSet<FrontierTile>();
        const renderable = (node: FrontierTile) => this.maximumDisplayGeometricError === undefined
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
        type Expansion = { kind: "expand" | "seed"; node: FrontierTile; next: FrontierTile[] | undefined };
        const pending = new Map<FrontierTile, Promise<Expansion>>();
        let evictions = new PriorityQueue<FrontierTile>((a, b) => compare(b, a));
        const evictionQueued = new Set<FrontierTile>();
        const offerEviction = (node: FrontierTile) => {
            if (frontier.has(node) && !evictionQueued.has(node)) {
                evictions.push(node); evictionQueued.add(node);
            }
        };
        const rebuildEvictions = () => {
            evictions = new PriorityQueue<FrontierTile>((a, b) => compare(b, a));
            evictionQueued.clear();
            for (const node of frontier) offerEviction(node);
        };
        const takeWorst = (): FrontierTile | undefined => {
            while (evictions.length) {
                const node = evictions.shift()!;
                evictionQueued.delete(node);
                if (frontier.has(node) && node.refine !== "ADD" && !pending.has(node)
                    && priority(node).background) return node;
            }
            return undefined;
        };
        initial.forEach(offerEviction);
        const seedQueue = new PriorityQueue<FrontierTile>(compare);
        const seedPending = new Map<FrontierTile, Promise<Expansion>>();
        let rootSeed: Promise<FrontierTile[]> | undefined;
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
            const pendingLimit = performance.now() - this.lastPriorityUpdateAt < 500
                ? Math.min(16, this.maxPendingHierarchy) : this.maxPendingHierarchy;
            if (queueRevision !== this.requestPriorityRevision) {
                queueRevision = this.requestPriorityRevision;
                queue.rebuild();
                seedQueue.rebuild();
                rebuildEvictions();
            }
            const eye = this.requestEye ?? this.selectionEye ?? this.cameraEye();
            if (!surroundings && coverageRadius
                && Vector3.Distance(eye, seededAt) >= 250) {
                bounds = this.getTileSetBounds(coverageRadius);
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
                for (const node of frontier) {
                    if (boundingVolumeIntersects(node.tile.boundingVolume, bounds, node.transform)) continue;
                    frontier.delete(node); track(node, false);
                    count -= node.selections.length;
                    settled.delete(node);
                    for (const selection of node.selections) {
                        activeURLs.delete(selection.url);
                        desired.delete(selection.url);
                    }
                }
                representedURLs.clear();
                for (const node of frontier) for (const selection of node.selections) {
                    representedURLs.add(selection.url);
                    for (const ancestor of selection.ancestors ?? []) representedURLs.add(ancestor);
                }
                rootSeed = firstContent(this.rootTileset!.root, this.getRootTilesetURL(),
                    0, Matrix.Identity(), "REPLACE").catch(() => []);
            }
            if (count >= budget && queue.length) {
                const scanStarted = performance.now();
                const worstResident = takeWorst();
                if (worstResident) offerEviction(worstResident);
                const refinable: FrontierTile[] = [];
                // Yielding every 32 items stalls each budgeted expansion for
                // a render frame, though a complete scan is normally sub-ms.
                while (queue.length) {
                    const node = queue.shift()!;
                    if (!frontier.has(node)) continue;
                    if (worstResident && node !== worstResident && compare(node, worstResident) < 0)
                        refinable.push(node);
                    else settle(node, true);
                }
                refinable.forEach(node => queue.push(node));
                this.stats.frontierBudgetScanMs += performance.now() - scanStarted;
                this.stats.frontierBudgetScanCount++;
            }
            const coverage = count >= Math.min(128, budget / 4);
            if (coverage !== preferCoverage) { preferCoverage = coverage; queue.rebuild(); rebuildEvictions(); }
            while (seedQueue.length && pending.size + seedPending.size < pendingLimit) {
                const node = seedQueue.shift()!;
                const pause = workBudget.checkpoint(() => priority(node).distance, 0);
                if (pause) await pause;
                if (generation !== this.generation) return;
                if (!boundingVolumeIntersects(node.tile.boundingVolume, bounds, node.transform)) continue;
                const url = node.selections[0]?.url;
                if (!url) continue;
                if (representedURLs.has(url)) {
                    seedPending.set(node, children(node).then(next => ({ kind: "seed", node, next }),
                        () => ({ kind: "seed", node, next: undefined })));
                    continue;
                }
                if (count + node.selections.length > budget) {
                    // Resident far coverage remains drawn even when its demand
                    // slot is given to a newly entered, more urgent branch.
                    const victim = takeWorst();
                    if (victim) offerEviction(victim);
                    if (!victim || compare(node, victim) >= 0
                        || count - victim.selections.length + node.selections.length > budget) continue;
                    frontier.delete(victim); track(victim, false); settled.delete(victim);
                    count -= victim.selections.length;
                    for (const selection of victim.selections) {
                        activeURLs.delete(selection.url);
                        desired.delete(selection.url);
                    }
                }
                frontier.add(node); offerEviction(node); track(node, true); count += node.selections.length;
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
                if (node.priority <= 1 && renderable(node)) { settle(node); continue; }
                pending.set(node, children(node).then(next => ({ kind: "expand", node, next }),
                    () => ({ kind: "expand", node, next: undefined })));
            }
            flushReplacements();
            if (!pending.size && !seedPending.size && !rootSeed) continue;
            let wakeMovement!: () => void;
            const movement = new Promise<{ kind: "movement" }>(resolve => {
                wakeMovement = () => resolve({ kind: "movement" });
                this.movementWaiters.add(wakeMovement);
            });
            const result = await Promise.race([
                ...pending.values(), ...seedPending.values(),
                ...(rootSeed ? [rootSeed.then(next => ({ kind: "root" as const, next }))] : []),
                movement,
            ]);
            this.movementWaiters.delete(wakeMovement);
            if (generation !== this.generation) return;
            if (result.kind === "movement") continue;
            if (result.kind === "root") {
                rootSeed = undefined;
                result.next.forEach(enqueueSeed);
                continue;
            }
            const { node, next } = result;
            if (result.kind === "seed") {
                seedPending.delete(node);
                if (next) next.forEach(enqueueSeed);
                else hierarchyFailed = true;
                continue;
            }
            pending.delete(node);
            offerEviction(node);
            if (!frontier.has(node)) continue;
            if (!next) { hierarchyFailed = true; settle(node, true); continue; }
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
                    const scanStarted = performance.now();
                    let freed = 0;
                    const chosen: FrontierTile[] = [];
                    const inspected: FrontierTile[] = [];
                    while (count + extra - freed > budget) {
                        const victim = takeWorst();
                        if (!victim) break;
                        inspected.push(victim);
                        if (victim === node) continue;
                        if (compare(node, victim) >= 0) break;
                        chosen.push(victim);
                        freed += victim.selections.length;
                    }
                    this.stats.frontierBudgetScanMs += performance.now() - scanStarted;
                    this.stats.frontierBudgetScanCount++;
                    if (count + extra - freed > budget) inspected.forEach(offerEviction);
                    else inspected.filter(victim => !chosen.includes(victim)).forEach(offerEviction);
                    if (count + extra - freed > budget) { settle(node, true); continue; }
                    for (const victim of chosen) {
                        frontier.delete(victim); track(victim, false); settled.delete(victim);
                        count -= victim.selections.length;
                        for (const selection of victim.selections) {
                            activeURLs.delete(selection.url);
                            desired.delete(selection.url);
                        }
                    }
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
                    frontier.add(child); offerEviction(child); track(child, true); queue.push(child);
                    for (const selection of child.selections) {
                        activeURLs.add(selection.url);
                        representedURLs.add(selection.url);
                        for (const ancestor of selection.ancestors ?? []) representedURLs.add(ancestor);
                    }
                });
                count += extra;
        }
        if (generation !== this.generation) return;
        flushReplacements();
        this.stats.frontierTraversalMs = performance.now() - frontierStarted;
        const commitStarted = performance.now();
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
            for (const node of frontier) {
                if (node.priority <= 1) continue;
                const external = getTileContents(node.tile).some(isTilesetContent);
                const hasChildren = !!node.tile.children?.length;
                const offscreen = this.cullToCamera && this.allowedGeometricError(
                    node.tile.boundingVolume, node.transform, false, eye, true) < 0;
                if (node.depth < this.maxDepth && (hasChildren || external)) {
                    this.stats.detailLimitedTiles++;
                    if (offscreen) this.stats.offscreenDetailLimitedTiles++;
                    else this.stats.visibleDetailLimitedTiles++;
                } else if (!hasChildren && !external) {
                    this.stats.sourceLimitedTiles++;
                    if (offscreen) this.stats.offscreenSourceLimitedTiles++;
                    else this.stats.visibleSourceLimitedTiles++;
                }
            }
        }
        for (const node of frontier) if (renderable(node)) for (const selection of node.selections) desired.set(selection.url, selection);
        if (reseeded) for (const [url, selection] of desired) {
            const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
            if (!boundingVolumeIntersects(selection.boundingVolume, bounds, transform)) desired.delete(url);
        }
        if (!hierarchyFailed && !surroundings && !reseeded) this.frontierCache = { key, selections: Array.from(desired.values()) };
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
        for (const selection of Array.from(desired.values())) {
            const finerVisible = (descendants.get(selection.url) ?? []).filter(([url]) => this.loadedTiles.has(url));
            const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
            if (finerVisible.length && selection.geometricError !== undefined
                && selection.geometricError > this.allowedGeometricError(selection.boundingVolume, transform)) {
                // The budget is not permission to visibly coarsen resident detail.
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
            const models = await Promise.all(group.next.map(selection => this.loadTile(selection, origin, generation, false).catch(() => undefined)));
            if (generation !== this.generation) return;
            // Traversal can replace this demand while models are still
            // decoding. An obsolete partial batch cannot replace coverage.
            if (group.next.some(selection => !desired.has(selection.url))) return;
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
        }));
    }

    private loadTile(selection: TileSelection, origin: Google3DTilesOrigin, generation: number, activate = true): Promise<LoadedGoogle3DTile | undefined> {
        if (generation === this.generation && this.unusableModelURLs.has(selection.url)) return Promise.resolve(undefined);
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

    private async loadTileAsset(
        selection: TileSelection,
        origin: Google3DTilesOrigin,
        generation: number,
        activate = true,
    ): Promise<LoadedGoogle3DTile | undefined> {
        const loaded = this.loadedTiles.get(selection.url);
        if (loaded) {
            return loaded;
        }

        const retained = this.retainedTiles.get(selection.url);
        if (retained) {
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
        const request = this.networkSlot(async releaseSlot => {
            if (generation !== this.generation) return undefined;
            this.stats.modelRequests++;
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
                        fetched, work => this.modelDecodeSlot(work, priority, generation,
                            () => this.canReusePendingModel(selection, origin)))
                    : await this.modelTileLoader(selection.url, this.tileSet.scene, controller.signal);
            }
            finally {
                if (this.activeModelFetches.get(selection.url)?.controller === controller)
                    this.activeModelFetches.delete(selection.url);
            }
        }, priority, "model").then(async (model) => {
            if (!model) {
                return undefined;
            }
            if (model.renderable === false) {
                if (generation === this.generation) this.unusableModelURLs.add(selection.url);
                model.asset.dispose();
                return undefined;
            }
            const integrationStarted = performance.now();
            if (this.getOriginStateKey(origin) !== this.originStateKey) {
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
                mipmapsReady = new Promise(resolve => engine.onEndFrameObservable.addOnce(() => {
                    try {
                        for (const texture of webGpuMipTextures) {
                            const internal = texture.getInternalTexture();
                            if (internal?.generateMipMaps)
                                (engine as typeof engine & { _generateMipmaps(texture: typeof internal): void })
                                    ._generateMipmaps(internal);
                        }
                        resolve(true);
                    } catch { resolve(false); }
                }));
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
                if (generation === this.generation) this.unusableModelURLs.add(selection.url);
                model.asset.dispose();
                root.dispose();
                return undefined;
            }

            const result: LoadedGoogle3DTile = {
                url: selection.url,
                depth: selection.depth,
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

async function defaultTilesetLoader(url: string): Promise<Google3DTileset> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Unable to load Google 3D Tileset (${response.status} ${response.statusText}).`);
    }
    return response.json() as Promise<Google3DTileset>;
}

/** Remove coastal photogrammetry skirts and oversized water fill polygons. */
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
    const heights = new Float32Array(positions.length / 3);
    for (let i = 0; i < heights.length; i++) {
        const offset = i * 3;
        const x = positions[offset] * matrix[0] + positions[offset + 1] * matrix[4]
            + positions[offset + 2] * matrix[8] + matrix[12];
        const y = positions[offset] * matrix[1] + positions[offset + 1] * matrix[5]
            + positions[offset + 2] * matrix[9] + matrix[13];
        const z = positions[offset] * matrix[2] + positions[offset + 1] * matrix[6]
            + positions[offset + 2] * matrix[10] + matrix[14];
        heights[i] = (globeRadius === undefined ? y : Math.hypot(x, y, z) - globeRadius) / metresToWorld;
    }
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
            // Google sometimes fills stretches of coastal water with single flat
            // triangles hundreds of metres wide. At street LOD these show as hard
            // dark blocks over the satellite water. The ready raster remains below.
            const nearSurface = [a, b, c].every(index => Math.abs(heights[index] - lowSurface) < 5);
            let oversizedFill = false;
            if (nearSurface) {
                // Water fill can be just two triangles in a four-vertex mesh.
                // Even a 25-80 m patch stands out as a dark block over the
                // ready satellite water, so do not require a large mesh here.
                oversizedFill = Math.max(worldEdgeSquared(a, b), worldEdgeSquared(b, c),
                    worldEdgeSquared(c, a)) > 25 * 25;
            }
            if (!deepSkirt && !oversizedFill) {
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
): Promise<LoadedGoogleModelTile | undefined> {
    const fetchStarted = performance.now();
    const response = await fetch(url, { signal });
    if (response.status === 204 || response.status === 404) {
        onFetched?.();
        return undefined;
    }
    if (!response.ok) {
        throw new Error(`Unable to load Google 3D model tile (${response.status} ${response.statusText}).`);
    }

    const buffer = await response.arrayBuffer();
    if (stats) { stats.modelFetchMs += performance.now() - fetchStarted; stats.modelFetchCount++; }
    onFetched?.();
    signal?.throwIfAborted();
    const decode = async (): Promise<LoadedGoogleModelTile> => {
        const decodeStarted = performance.now();
        if (stats) {
            stats.modelDecodeActive++;
            stats.peakModelDecodeActive = Math.max(stats.peakModelDecodeActive, stats.modelDecodeActive);
        }
        try {
            const metadata = parseGoogleGLBMetadata(buffer);
            // Babylon uses the file name in embedded-texture cache keys. Each
            // GLB has a different image atlas, even when all images are called image0.
            await import("@babylonjs/loaders/glTF/index.js");
            const asset = await LoadAssetContainerAsync(new Uint8Array(buffer), scene, {
                pluginExtension: ".glb", name: `google-photorealistic-tile-${nextModelFileId++}.glb`,
            });
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
