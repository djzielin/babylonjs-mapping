import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Plane } from "@babylonjs/core/Maths/math.plane.js";
import { Frustum } from "@babylonjs/core/Maths/math.frustum.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Ray } from "@babylonjs/core/Culling/ray.js";
import { Observable, type Observer } from "@babylonjs/core/Misc/observable.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Vector2 } from "@babylonjs/core/Maths/math.vector.js";

import type GlobeSet from "../core/GlobeSet.js";
import { EPSG_Type } from "../core/TileMath.js";
import type TileSet from "../core/TileSet.js";
import {
    createTileDrawables, createGoogleTileMeshes, decodeGoogleTile, glbAttributions, parseGLB, warmGoogleTileDecoder,
    type DecodedGooglePrimitive, type DecodedGoogleTile,
} from "./GoogleTileContent.js";
import { ecefToGeodetic, geodeticToECEF, GoogleTileFrame, Y_UP_TO_Z_UP, type GeodeticPosition } from "./GoogleTileFrame.js";
import { createGoogleTileMaterial } from "./GoogleTileMaterial.js";
import { TileWorkerPool } from "../shared/TileWorkerPool.js";
import { supportsBC1 } from "../shared/TileTextures.js";
import { TileBatch, supportsTileBatch, type TileDrawable } from "../shared/TileBatch.js";
import { MotionTracker, selectionViewProjection, VIEW_MARGIN, ViewChange, type ViewTolerance, widenedViewProjection } from "../shared/ViewMargin.js";
import { RayMesh } from "../shared/RayMesh.js";
import { globeWaterShader, WATER_COLOR } from "../core/GlobeWaterShader.js";
import type MapLayerRenderer from "../core/MapLayerRenderer.js";
import type { ThinEngine } from "@babylonjs/core/Engines/thinEngine.js";

/** Google Maps Platform Map Tiles API Photorealistic 3D Tiles endpoint. */
export const GOOGLE_3D_TILES_ROOT_URL = "https://tile.googleapis.com/v1/3dtiles/root.json";

export interface Google3DTileset {
    asset?: { version?: string; [key: string]: unknown };
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
    /** 3D Tiles oriented box: centre followed by three half-axis vectors (12 values). */
    box?: number[];
    /** Centre x/y/z followed by radius. */
    sphere?: number[];
    /** West, south, east, north (radians), minimum and maximum height (metres). */
    region?: number[];
    [key: string]: unknown;
}

export interface Google3DTileContent {
    uri?: string;
    url?: string;
    [key: string]: unknown;
}

/** WGS84 position; heights are metres above the ellipsoid. */
export type Google3DTilesOrigin = GeodeticPosition;

export interface Google3DTilesOptions {
    /** Google Maps Platform key with the Map Tiles API enabled. */
    apiKey: string;
    rootUrl?: string;
    /**
     * Target screen-space error in pixels. Tiles refine until their geometric
     * error projects to less than this. Lower is sharper and loads more.
     * Default 8.
     */
    maximumScreenSpaceError?: number;
    /**
     * Ground distance in metres within which `maximumScreenSpaceError` applies.
     * Beyond it the target grows linearly with distance, reaching
     * `distantErrorScale` times the target at `distantErrorScale` times this
     * radius. Distant ground covers few pixels and sits in haze, so this
     * saves memory at the cost of distant detail. Default: unlimited.
     */
    detailRadius?: number;
    /** Largest multiple of `maximumScreenSpaceError` used for distant tiles. Default 1 (no ramp). */
    distantErrorScale?: number;
    /** Ground distance in metres beyond which no tiles are drawn. Default: unlimited. */
    maximumRadius?: number;
    /**
     * Error scale for the surroundings out of view (default 2: coarser). In
     * a headset, where the head turns anywhere at once, 1 loads them at the
     * view's detail.
     */
    surroundErrorScale?: number;
    /**
     * Load the surroundings every traversal, after the view, instead of only
     * once the view has settled (default false). For headsets, whose view
     * never quite settles.
     */
    alwaysLoadSurroundings?: boolean;
    /**
     * Approximate GPU memory for cached tiles, in megabytes. Default: no
     * limit. Either way, tiles nothing has needed for `cacheSeconds` are released.
     */
    memoryBudgetMB?: number;
    /** Seconds an unneeded tile stays cached. Default 300. */
    cacheSeconds?: number;
    /** Concurrent network requests. Default 32. */
    maxConcurrentRequests?: number;
    /**
     * Requests per second this client makes to the Map Tiles API at most.
     * The API's per-minute quota is the key's project's, shared by every
     * client: a page that loads a city in a burst can spend it for all.
     * Default 100.
     */
    requestsPerSecond?: number;
    /**
     * Requests that may start at once after a quiet spell, beyond the steady
     * rate: a per-minute quota lets a new view load in a rush. Default: one second's worth.
     */
    requestBurst?: number;
    /**
     * A localStorage key under which to keep the API session for a few hours,
     * so a reload or a later visit asks for the very same tile URLs and the
     * browser's HTTP cache (Google allows four hours) answers them instead of
     * the API. Only the session token is stored, never content. Default: none.
     */
    sessionKey?: string;
    /**
     * Compress textures to BC1 in the streaming workers where the GPU supports
     * it: an eighth of the memory and upload bandwidth, so far more detail fits
     * in the budget. Default true.
     */
    compressTextures?: boolean;
    /** Main-thread time spent creating GPU resources per frame. Default 4 ms. */
    uploadBudgetMs?: number;
    /**
     * Fixed geographic anchor. Flat tile sets default to their centre. Globes
     * default to following the camera, which keeps nearby geometry exact.
     */
    origin?: Google3DTilesOrigin;
    /** Metres added to Google's ellipsoid heights. */
    heightOffset?: number;
    /**
     * Geoid height (ellipsoid minus mean sea level) in metres, e.g. EGM96's.
     * On a globe whose heights are above sea level, such as one with
     * `GlobeSurface` terrain, tiles then sit on the same sea level wherever
     * they are anchored.
     */
    geoid?: (latitude: number, longitude: number) => number;
    /** Camera used for level-of-detail selection. Defaults to the scene's active camera. */
    camera?: Camera;
    /** Network transport, for tests or custom caching. Defaults to `fetch`. */
    fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

/** A snapshot of streaming activity. */
export interface Google3DTilesStats {
    /** Tiles drawn in the latest update. */
    rendered: number;
    /** Tiles with GPU resources, including cached ones. */
    resident: number;
    /** Approximate GPU bytes held by resident tiles. */
    residentBytes: number;
    /** Tiles needed by the current view that are not ready yet. */
    pending: number;
    /** Tiles downloading or decoding. */
    requestsInFlight: number;
    /** Decoded tiles waiting for GPU upload. */
    uploading: number;
    totalRequests: number;
    totalDownloadedBytes: number;
    failedRequests: number;
    /** Tiles that have appeared on screen; its rate while the view moves is level-of-detail churn. */
    totalShown: number;
}

interface TileContentResources {
    textures: BaseTexture[];
    byteLength: number;
    attributions: string[];
    rtcCenter?: Vector3;
    /** Each primitive is a batch drawable (WebGL) or a scene mesh (other engines). */
    primitives: { nodeMatrix: Matrix; drawable?: TileDrawable; mesh?: Mesh }[];
}

const enum State { None, Queued, Loading, Decoded, Ready, Failed, Empty }

/** Bounding volume in ECEF metres: centre and three half axes. */
interface TileBox {
    center: Vector3;
    axes: [Vector3, Vector3, Vector3];
    /** Unit axes and half lengths, for distance queries. */
    units: [Vector3, Vector3, Vector3];
    lengths: [number, number, number];
    radius: number;
}

function makeBox(center: Vector3, axes: [Vector3, Vector3, Vector3]): TileBox {
    const lengths = axes.map(axis => axis.length()) as [number, number, number];
    const units = axes.map((axis, i) => lengths[i] > 0 ? axis.scale(1 / lengths[i]) : Vector3.Zero()) as [Vector3, Vector3, Vector3];
    return { center, axes, units, lengths, radius: Math.hypot(...lengths) };
}

class TileNode {
    public children: TileNode[] = [];
    /** Content and subtree URIs, resolved and authenticated when requested. */
    public contentUri?: { uri: string; base: string };
    public tilesetUri?: { uri: string; base: string };
    public contentState = State.None;
    public tilesetState = State.None;
    public content?: TileContentResources;
    public decoded?: DecodedGoogleTile;
    public abort?: AbortController;
    public priority = 0;
    public lastVisit = -1;
    /** When a traversal last reached this tile (performance.now()). */
    public seenAt = 0;
    public wantedIn = -1;
    public lastUsed = -1;
    /**
     * Whether the view refined past this tile when it last saw it, for
     * hysteresis. Kept while the tile is out of view, as long as the view
     * keeps reaching it (see viewedIn).
     */
    public refined = false;
    /** Latest traversal whose view reached this tile, visible or not. */
    public viewedIn = -1;
    /** The pass that wanted this tile loaded. */
    public wantedBy = Pass.View;
    /** Latest traversal that found this tile outside the view. */
    public culledIn = -1;
    public retryAt = 0;
    public rendered = false;
    /** Still drawn, fading out under the tiles that replaced it. */
    public leaving = false;
    public drawnIn = -1;
    /** Camera distance at the latest traversal, for front-to-back drawing. */
    public distance = 0;

    constructor(
        public readonly parent: TileNode | undefined,
        public readonly depth: number,
        public readonly geometricError: number,
        public readonly box: TileBox,
    ) {}
}

const HORIZON_RADIUS = 6356752 - 500;
// Metres from the frame's anchor within which surfaceHeight() trusts the tiles' placement.
const SURFACE_QUERY_RANGE = 30_000;
// Coarsest geometric error, in metres, of tiles surfaceHeight() measures: coarser ones are not where the ground is.
const SURFACE_QUERY_ERROR = 100;
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
/** How many times the view's target error a tile may be and still stand in while its children load. */
const COARSE_FALLBACK = 8;
/** Added to prefetched tiles' priority: they load after every visible tile (lower is sooner). */
const PREFETCH_PRIORITY = 100;
/** Added to the priority of tiles just beyond the view: after everything visible, before prefetches. */
const MARGIN_PRIORITY = 50;
/**
 * Level-of-detail dead band, as fractions of the target error. A tile being
 * drawn refines only once clearly too coarse, and a refined one coarsens
 * only once far finer than needed, so moving about, e.g. orbiting, leaves
 * the drawn tiles alone instead of swapping those near a threshold.
 */
const REFINE_DRAWN = 2;
/** Least time between selections redone only because tiles arrived. */
const CONTENT_TRAVERSAL_MS = 100;
const COARSEN_REFINED = 0.35;
/**
 * Traversals: the view itself; the margin around it, loaded but not drawn
 * so turning finds tiles ready; and a prefetch for where the camera is going.
 */
const enum Pass { View, Margin, Prefetch, Around }
/**
 * Added to priorities by pass (lower loads sooner): the margin after
 * everything visible, prefetches next, and last the surroundings, all the
 * way round the camera, so turning to look elsewhere finds them loaded.
 */
const PASS_PRIORITY = [0, MARGIN_PRIORITY, PREFETCH_PRIORITY, 2 * PREFETCH_PRIORITY];
/** Fractions of the memory budget the needed tiles may fill before margin, prefetch and surrounding loads stop. */
const MARGIN_BUDGET = 0.9;
const PREFETCH_BUDGET = 0.75;
const AROUND_BUDGET = 0.6;
/**
 * Detail of the surroundings, as a multiple of the target error: half the
 * view's, so turning needs at most one more level, while memory stays near
 * that of the view itself.
 */
/** Default error scale for the surroundings: coarser than the view. */
const AROUND_ERROR_SCALE = 2;
/** Fraction of the concurrent requests the surroundings may use, keeping the rest free for the view. */
const AROUND_REQUESTS = 0.5;
/**
 * Least time between selections of the surroundings, half of a selection's
 * work: in between, the last one's tiles stay needed and keep loading.
 */
const AROUND_INTERVAL_MS = 400;
/** Subtree JSON outranks content this many levels deeper: each subtree gates everything beneath it. */
const TILESET_PRIORITY_BOOST = 4;

/**
 * Streams Google Photorealistic 3D Tiles into a `TileSet` or `GlobeSet`.
 *
 * Each frame the tile hierarchy is traversed from the camera: tiles refine
 * while their projected geometric error exceeds `maximumScreenSpaceError`,
 * and a tile is replaced only once all of its visible children can be drawn,
 * so the surface never shows holes or overlapping levels. Network requests
 * are prioritised coarse-to-fine and near-to-far, decoding happens in
 * workers, GPU uploads are spread across frames, and least-recently-used
 * tiles are evicted to respect the memory budget.
 */
export default class Google3DTiles {
    public readonly rootUrl: string;
    public maximumScreenSpaceError: number;
    public detailRadius: number;
    public distantErrorScale: number;
    public maximumRadius: number;
    public surroundErrorScale: number;
    public alwaysLoadSurroundings: boolean;
    public memoryBudgetMB: number;
    public cacheSeconds: number;
    public maxConcurrentRequests: number;
    public uploadBudgetMs: number;
    public heightOffset: number;
    public geoid?: (latitude: number, longitude: number) => number;
    public camera?: Camera;
    /**
     * On a globe, the colour of the sea. Google's imagery of water changes
     * from one level of detail to the next, so water at sea level is drawn
     * in this colour, reflecting the sky toward the horizon, instead.
     */
    public readonly waterColor = WATER_COLOR.clone();
    /** Draw tiles. Streaming pauses while disabled, except for `prefetchCamera`. */
    public enabled = true;
    /**
     * Also load what this camera would see, after everything the visible
     * view needs: e.g. the end of a flight, so it arrives already sharp.
     * It is never drawn from.
     */
    public prefetchCamera?: Camera;
    /**
     * How far the view may turn (degrees) or move (fraction of its height)
     * before tiles are selected again; meanwhile the view is drawn widened
     * by the angle. Default 0: every change. For a headset, whose pose
     * changes every frame, a few degrees saves most of the selection work.
     */
    public get viewTolerance(): ViewTolerance { return this.viewChange.tolerance; }
    public set viewTolerance(tolerance: ViewTolerance) { this.viewChange.tolerance = tolerance; }
    private readonly viewChange = new ViewChange();
    /** Fires after each traversal with the number of tiles drawn. */
    public readonly onUpdatedObservable = new Observable<Google3DTiles>();
    /** Fires when the set of attribution sources changes. */
    public readonly onAttributionsChangedObservable = new Observable<readonly string[]>();

    private readonly apiKey: string;
    private readonly fetcher: (url: string, init?: RequestInit) => Promise<Response>;
    private readonly workers?: TileWorkerPool;
    private readonly scene: Scene;
    /** Draws all tiles on WebGL; other engines get one scene mesh per primitive. */
    private readonly batch?: TileBatch;
    private meshMaterial?: Material;
    private layers?: { renderer: MapLayerRenderer; level: number };
    private readonly frame = new GoogleTileFrame();
    private readonly fixedOrigin?: Google3DTilesOrigin;
    private readonly renderObserver: Observer<Scene>;
    private root?: TileNode;
    private rootState = State.None;
    private session?: string;
    /** True while using a session kept from an earlier page: tile URLs are rewritten to it. */
    private keptSession = false;
    private readonly sessionKey?: string;
    /** Visiting for `prefetchCamera`. */
    private pass = Pass.View;
    /** Resident bytes the last traversal visited. */
    private neededBytes = 0;
    private readonly prefetchFrame = new GoogleTileFrame();
    private updateId = 0;
    private rendered: TileNode[] = [];
    private wanted: TileNode[] = [];
    private readonly resident = new Set<TileNode>();
    private readonly uploads: TileNode[] = [];
    private requestsInFlight = 0;
    private residentBytes = 0;
    private totals = { requests: 0, bytes: 0, failures: 0, shown: 0 };
    private lastViewKey = "";
    private contentChanged = true;
    private attributionKey = "";
    private attributions: string[] = [];
    private disposed = false;
    private evictedIn = -1;
    private traversedAt = 0;
    private readonly motion = new MotionTracker();
    private abandonedAt = 0;
    private traversedForContentAt = 0;
    private sweptAt = 0;
    /** The last selection of the surroundings: when, what it visited, and what it wanted. */
    private around = { at: -Infinity, visited: [] as TileNode[], wanted: [] as TileNode[] };
    /** Tiles replaced by others, drawn until those have faded in. */
    private leaving: TileNode[] = [];

    // Per-traversal camera state, in ECEF metres.
    private readonly eye = new Vector3();
    private readonly nadir = new Vector3();
    private planes: { normal: Vector3; d: number }[] = [];
    private sseFactor = 1;
    private horizonDistance = Infinity;

    public constructor(public readonly tileSet: TileSet, options: Google3DTilesOptions) {
        if (!options.apiKey?.trim()) throw new Error("Google3DTiles requires an API key.");
        this.apiKey = options.apiKey.trim();
        this.rootUrl = options.rootUrl ?? GOOGLE_3D_TILES_ROOT_URL;
        this.sessionKey = options.sessionKey;
        TileWorkerPool.throttle.setRate(this.rootUrl, options.requestsPerSecond ?? 100, options.requestBurst);
        this.maximumScreenSpaceError = options.maximumScreenSpaceError ?? 8;
        this.detailRadius = options.detailRadius ?? Infinity;
        this.distantErrorScale = options.distantErrorScale ?? 1;
        this.maximumRadius = options.maximumRadius ?? Infinity;
        this.surroundErrorScale = options.surroundErrorScale ?? AROUND_ERROR_SCALE;
        this.alwaysLoadSurroundings = options.alwaysLoadSurroundings ?? false;
        this.memoryBudgetMB = options.memoryBudgetMB ?? Infinity;
        this.cacheSeconds = options.cacheSeconds ?? 300;
        this.maxConcurrentRequests = options.maxConcurrentRequests ?? 32;
        this.uploadBudgetMs = options.uploadBudgetMs ?? 4;
        this.heightOffset = options.heightOffset ?? 0;
        this.geoid = options.geoid;
        this.camera = options.camera;
        this.fixedOrigin = options.origin;
        this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
        // Workers fetch and decode tiles themselves; a custom transport keeps
        // everything on the main thread so it sees every request.
        if (!options.fetch && TileWorkerPool.isSupported)
            this.workers = TileWorkerPool.shared(options.compressTextures !== false && supportsBC1(tileSet.scene.getEngine()));
        if (!(this.maximumScreenSpaceError > 0)) throw new RangeError("maximumScreenSpaceError must be positive.");
        if (!(this.distantErrorScale >= 1)) throw new RangeError("distantErrorScale must be at least 1.");

        this.scene = tileSet.scene;
        // A finite radius ends on a circle, not on the ragged outline of coarse tiles.
        if (supportsTileBatch(this.scene))
            this.batch = new TileBatch("google photorealistic 3d tiles", this.scene,
                this.globe && globeWaterShader(this.globe, () => this.scene.activeCamera, this.waterColor), { clip: Number.isFinite(this.maximumRadius) });
        tileSet.ourAttribution.addAttribution("GOOGLE");
        this.renderObserver = this.scene.onBeforeRenderObservable.add(() => this.update());
        this.scene.getEngine().onContextRestoredObservable.add(() => this.reloadContent());
        if (!this.workers) warmGoogleTileDecoder();
        void this.loadRoot();
    }

    private get globe(): GlobeSet | undefined {
        return this.tileSet.isGlobe ? this.tileSet as GlobeSet : undefined;
    }

    /** Current streaming counters. */
    public get stats(): Google3DTilesStats {
        return {
            rendered: this.rendered.length,
            resident: this.resident.size,
            residentBytes: this.residentBytes,
            pending: this.wanted.length,
            requestsInFlight: this.requestsInFlight,
            uploading: this.uploads.length,
            totalRequests: this.totals.requests,
            totalDownloadedBytes: this.totals.bytes,
            failedRequests: this.totals.failures,
            totalShown: this.totals.shown,
        };
    }

    /** Tiles the prefetch camera wants that have not loaded, as of the last selection. */
    public get prefetchPending(): number {
        return this.wanted.reduce((count, node) => count + (node.wantedBy === Pass.Prefetch ? 1 : 0), 0);
    }

    /** Tiles the visible view itself still needs: not those around it, nor a prefetch's. */
    public get viewPending(): number {
        return this.wanted.reduce((count, node) => count + (node.wantedBy === Pass.View ? 1 : 0), 0);
    }

    /** True when every tile wanted by the current view is drawn. */
    public get isIdle(): boolean {
        return this.rootState === State.Ready && this.updateId > 0 && !this.wanted.length && !this.uploads.length;
    }

    /** Resolve once the current view has finished loading. */
    public whenIdle(): Promise<void> {
        if (this.isIdle) return Promise.resolve();
        return new Promise(resolve => {
            const observer = this.onUpdatedObservable.add(() => {
                if (!this.isIdle) return;
                this.onUpdatedObservable.remove(observer);
                resolve();
            });
        });
    }

    /** Data providers for the tiles currently drawn, most prominent first. */
    public getAttributions(): readonly string[] {
        return this.attributions;
    }

    /**
     * Draw the tiles as `level` of a `MapLayerRenderer`, so coarser map layers
     * fill in only where photorealistic coverage ends.
     */
    public addToLayers(renderer: MapLayerRenderer, level: number): void {
        this.layers = { renderer, level };
        if (this.batch) renderer.add(this.batch, level);
        for (const node of this.resident) for (const { mesh } of node.content!.primitives) if (mesh) renderer.add(mesh, level);
    }

    /**
     * Distance along a world-space ray to the drawn photorealistic surface,
     * in world units, or undefined when the ray misses. Useful for camera
     * collision and click-to-fly. Tiles coarser than `maximumError` metres of
     * geometric error are skipped: the coarsest stand hundreds of metres off
     * the ground.
     */
    public intersectRay(ray: Ray, maximumError = Infinity): number | undefined {
        let nearest: number | undefined;
        const inverse = new Matrix();
        for (const node of this.rendered) {
            if (node.geometricError > maximumError) continue;
            for (const { drawable, mesh } of node.content!.primitives) {
                if (mesh) {
                    if (!ray.intersectsSphere(mesh.getBoundingInfo().boundingSphere)) continue;
                    const hit = ray.intersectsMesh(mesh, false);
                    if (hit.hit && (nearest === undefined || hit.distance < nearest)) nearest = hit.distance;
                    continue;
                }
                const box = node.box;
                const center = this.frame.toWorld(box.center);
                const radius = box.radius * this.frame.world.scale;
                if (!ray.intersectsSphere({ center, radius } as never)) continue;
                drawable!.world.invertToRef(inverse);
                const local = Ray.Transform(ray, inverse);
                // Ray.Transform normalises the direction: local distances are in tile units.
                const unitsPerWorld = Vector3.TransformNormal(ray.direction, inverse).length() / ray.direction.length();
                const hit = RayMesh.for(drawable!.localPositions!, drawable!.localIndices!).intersect(local);
                if (hit === undefined) continue;
                const distance = hit / unitsPerWorld;
                if (nearest === undefined || distance < nearest) nearest = distance;
            }
        }
        return nearest;
    }

    /** Fix the geographic anchor that is placed exactly on the map. */
    public setOrigin(origin: Google3DTilesOrigin): void {
        this.applyAnchor(origin, this.worldAnchorFor(origin));
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.scene.onBeforeRenderObservable.remove(this.renderObserver);
        for (const node of [...this.resident]) this.unload(node);
        for (const node of this.uploads) node.decoded?.images.forEach(image => image.bitmap?.close());
        this.uploads.length = 0;
        this.abortAll(this.root);
        this.batch?.material?.dispose();
        this.batch?.dispose();
        this.meshMaterial?.dispose();
        this.onUpdatedObservable.clear();
        this.onAttributionsChangedObservable.clear();
    }

    // ---------------------------------------------------------------- frame

    /**
     * ECEF metres to world as the tiles are currently placed, or undefined
     * before they are. Overlays placed through it (see `GlobeEarthFrame`)
     * line up with the tiles exactly.
     */
    public get ecefToWorld(): Matrix | undefined {
        return this.frame.revision ? this.frame.matrix : undefined;
    }

    /** ECEF metres of a point `height` metres above sea level, in the tiles' vertical datum. */
    public toECEF(latitude: number, longitude: number, height: number, result = new Vector3()): Vector3 {
        return geodeticToECEF(latitude, longitude, height + (this.geoid?.(latitude, longitude) ?? 0) - this.heightOffset, result);
    }

    /**
     * Height in metres above sea level of the first tile surface below `top`
     * metres (roofs, bridge decks, treetops, the ground) at a location, among
     * the tiles drawn; undefined where there is none, or only coarse tiles
     * whose surface is too approximate to measure.
     */
    public surfaceHeight(latitude: number, longitude: number, top = 9000): number | undefined {
        const matrix = this.ecefToWorld;
        if (!matrix) return undefined;
        // Far from the anchor, as just after a jump and before the tiles follow
        // the camera, tiles stand off the sphere and any hit would be wrong.
        const ground = this.toECEF(latitude, longitude, 0);
        if (Vector3.Distance(ground, this.frame.anchorECEF) > SURFACE_QUERY_RANGE) return undefined;
        const origin = Vector3.TransformCoordinates(this.toECEF(latitude, longitude, top), matrix);
        const below = Vector3.TransformCoordinates(this.toECEF(latitude, longitude, top - 1), matrix);
        const step = Vector3.Distance(origin, below);
        const hit = this.intersectRay(new Ray(origin, below.subtractInPlace(origin).normalize()), SURFACE_QUERY_ERROR);
        return hit === undefined ? undefined : top - hit / step;
    }

    private worldAnchorFor(origin: Google3DTilesOrigin) {
        const height = (origin.height ?? 0) + this.heightOffset - (this.geoid?.(origin.latitude, origin.longitude) ?? 0);
        const globe = this.globe;
        if (globe) {
            const scale = globe.metresToWorld;
            const up = globe.getSurfaceNormal(origin.latitude, origin.longitude);
            const lambda = origin.longitude * Math.PI / 180;
            const east = new Vector3(-Math.cos(lambda), 0, -Math.sin(lambda));
            const north = Vector3.Cross(east, up).normalize();
            return { position: globe.getSurfacePosition(origin.latitude, origin.longitude, height * scale), east, north, up, scale };
        }
        const scale = this.tileSet.tileScale;
        const position = this.tileSet.ourTileMath.EPSG_to_Game(new Vector2(origin.longitude, origin.latitude), EPSG_Type.EPSG_4326);
        position.y = height * scale;
        return { position, east: new Vector3(1, 0, 0), north: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0), scale };
    }

    private applyAnchor(origin: Google3DTilesOrigin, world: ReturnType<Google3DTiles["worldAnchorFor"]>): void {
        this.frame.set(origin, world);
        for (const node of this.resident) this.placeContent(node);
        this.lastViewKey = "";
    }

    private placeContent(node: TileNode): void {
        for (const primitive of node.content!.primitives) {
            const world = this.localToWorld(node, primitive.nodeMatrix);
            if (primitive.drawable) primitive.drawable.world = world;
            else primitive.mesh!.freezeWorldMatrix(world);
        }
    }

    private localToWorld(node: TileNode, nodeMatrix: Matrix, rtcCenter = node.content?.rtcCenter ?? node.decoded?.rtcCenter): Matrix {
        const matrix = nodeMatrix.multiply(Y_UP_TO_Z_UP);
        if (rtcCenter) matrix.multiplyToRef(Matrix.Translation(rtcCenter.x, rtcCenter.y, rtcCenter.z), matrix);
        return matrix.multiply(this.frame.matrix);
    }

    /**
     * Keep the anchor near the camera on a globe. Re-anchoring keeps the
     * surface under the camera fixed, so it is invisible; when the camera is
     * high enough that the residual sphere/ellipsoid mismatch is sub-pixel,
     * the anchor snaps back onto the globe's own coordinates.
     */
    private followCamera(camera: Camera): void {
        const globe = this.globe;
        if (!globe || this.fixedOrigin) return;
        const position = camera.globalPosition;
        if (position.lengthSquared() === 0) return;
        const surface = globe.getSurfaceCoordinates(position);
        const altitude = Math.max(1, surface.elevation / globe.metresToWorld);
        if (this.frame.revision === 0) {
            this.applyAnchor({ latitude: surface.latitude, longitude: surface.longitude }, this.worldAnchorFor(surface));
            return;
        }
        const nadirWorld = position.normalizeToNew().scaleInPlace(globe.radius);
        const nadirECEF = this.frame.toECEF(nadirWorld);
        const geodetic = ecefToGeodetic(nadirECEF.x, nadirECEF.y, nadirECEF.z);
        const travelled = Vector3.Distance(nadirECEF, this.frame.anchorECEF);
        const exact = globe.getSurfacePosition(geodetic.latitude, geodetic.longitude);
        const drift = Vector3.Distance(exact, nadirWorld) / globe.metresToWorld;
        // Chained re-anchoring keeps visible tiles still, but its error grows
        // with distance: snap to the exact anchor whenever nobody can see it
        // happen (nothing drawn, a long way travelled, or a tiny correction).
        if (!this.rendered.length || travelled > Math.max(50_000, altitude * 20) || drift > 1 && drift / altitude < 1e-4) {
            this.applyAnchor({ latitude: surface.latitude, longitude: surface.longitude }, this.worldAnchorFor(surface));
        } else if (travelled > Math.max(2000, altitude * 2)) {
            const anchor = { latitude: geodetic.latitude, longitude: geodetic.longitude, height: 0 };
            const world = this.frame.toWorld(geodeticToECEF(anchor.latitude, anchor.longitude, 0));
            const up = world.normalizeToNew();
            const lambda = Math.atan2(-up.x, up.z);
            const east = new Vector3(-Math.cos(lambda), 0, -Math.sin(lambda));
            this.applyAnchor(anchor, { position: world, up, east, north: Vector3.Cross(east, up).normalize(), scale: globe.metresToWorld });
        }
    }

    // ------------------------------------------------------------ hierarchy

    private authenticate(uri: string, base: string): string {
        const url = new URL(uri, base);
        const session = this.keptSession ? this.session
            : url.searchParams.get("session") ?? new URL(base).searchParams.get("session") ?? this.session;
        if (session) {
            this.session ??= session;
            url.searchParams.set("session", session);
        }
        url.searchParams.set("key", this.apiKey);
        return url.toString();
    }

    /** A kept session the API refuses has expired: forget it, and use this page's own from now on. */
    private checkSession(error: unknown): void {
        if (!this.keptSession || !/HTTP 40[0-3]\b/.test(String((error as Error)?.message ?? error))) return;
        this.keptSession = false;
        this.session = undefined;
        writeSession(this.sessionKey, undefined);
    }

    private async loadRoot(): Promise<void> {
        this.rootState = State.Loading;
        try {
            const kept = readSession(this.sessionKey);
            const url = this.authenticate(this.rootUrl, this.rootUrl);
            const tileset = await this.fetchJSON(url);
            if (this.disposed) return;
            if (kept) {
                this.session = kept;
                this.keptSession = true;
            } else {
                // The session the root began, kept for the next page.
                this.session = sessionOf(tileset) ?? this.session;
                writeSession(this.sessionKey, this.session);
            }
            this.root = this.buildNode(tileset.root, undefined, 0, url, Matrix.Identity());
            this.rootState = State.Ready;
            this.contentChanged = true;
        } catch (error) {
            this.rootState = State.Failed;
            console.warn("Google 3D Tiles root could not be loaded:", redact(error));
            if (!this.disposed) setTimeout(() => void this.loadRoot(), 3000);
        }
    }

    private buildNode(tile: Google3DTile, parent: TileNode | undefined, depth: number, baseUrl: string, parentTransform: Matrix): TileNode {
        const transform = tile.transform?.length === 16 ? Matrix.FromArray(tile.transform).multiply(parentTransform) : parentTransform;
        const node = new TileNode(parent, depth, tile.geometricError ?? parent?.geometricError ?? 0,
            boxOf(tile.boundingVolume, transform) ?? parent?.box ?? { ...makeBox(Vector3.Zero(), [Vector3.Zero(), Vector3.Zero(), Vector3.Zero()]), radius: Infinity });
        for (const content of [tile.content, ...(tile.contents ?? [])]) {
            const uri = content?.uri ?? content?.url;
            if (typeof uri !== "string") continue;
            if (/\.json(?:[?#]|$)/i.test(uri)) node.tilesetUri ??= { uri, base: baseUrl };
            else node.contentUri ??= { uri, base: baseUrl };
        }
        if (!node.contentUri) node.contentState = State.Empty;
        for (const child of tile.children ?? []) node.children.push(this.buildNode(child, node, depth + 1, baseUrl, transform));
        return node;
    }

    private async loadTileset(node: TileNode): Promise<void> {
        node.tilesetState = State.Loading;
        this.requestsInFlight++;
        try {
            const url = this.authenticate(node.tilesetUri!.uri, node.tilesetUri!.base);
            const tileset = await this.fetchJSON(url);
            if (this.disposed) return;
            node.children.push(this.buildNode(tileset.root, node, node.depth + 1, url, Matrix.Identity()));
            node.tilesetState = State.Ready;
        } catch (error) {
            node.tilesetState = State.None;
            node.retryAt = performance.now() + 2000;
            this.totals.failures++;
            this.checkSession(error);
            if (!isAbort(error)) console.warn("Google 3D Tiles subtree failed:", redact(error));
        } finally {
            this.requestsInFlight--;
            this.contentChanged = true;
        }
    }

    private async fetchJSON(url: string): Promise<Google3DTileset> {
        const response = await this.request(url);
        const tileset = await response.json() as Google3DTileset;
        if (!tileset?.root) throw new Error("Google 3D Tiles response did not contain a root tile.");
        return tileset;
    }

    /** One network request with brief retries for transient failures. */
    private async request(url: string, signal?: AbortSignal): Promise<Response> {
        for (let attempt = 0; ; attempt++) {
            this.totals.requests++;
            // The shared throttle holds requests while Google has asked clients to slow down.
            const host = await TileWorkerPool.throttle.acquire(url, signal);
            let response: Response | undefined;
            try {
                // A hung request fails after 30 s instead of stalling its subtree.
                const timeout = AbortSignal.timeout(30_000);
                response = await this.fetcher(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
            } finally {
                TileWorkerPool.throttle.release(host, response?.status, response?.headers.get("Retry-After"));
            }
            if (response.ok || response.status === 204 || response.status === 404) return response;
            if (!TRANSIENT_STATUS.has(response.status) || attempt >= 2) throw new Error(`HTTP ${response.status}`);
            await retryDelay(attempt, signal);
        }
    }

    // ---------------------------------------------------------------- content

    private async loadContent(node: TileNode): Promise<void> {
        node.contentState = State.Loading;
        const abort = node.abort = new AbortController();
        this.requestsInFlight++;
        try {
            const url = this.authenticate(node.contentUri!.uri, node.contentUri!.base);
            const decoded = this.workers ? await this.decodeInWorker(url, abort.signal) : await this.decodeHere(url, abort.signal);
            if (this.disposed) {
                decoded?.images.forEach(image => image.bitmap?.close());
                return;
            }
            if (!decoded) {
                node.contentState = State.Empty;
                return;
            }
            node.decoded = decoded;
            node.contentState = State.Decoded;
            this.uploads.push(node);
        } catch (error) {
            this.failContent(node, error);
        } finally {
            this.requestsInFlight--;
            node.abort = undefined;
            this.contentChanged = true;
        }
    }

    /** Download and decode in a worker, retrying transient HTTP failures. Undefined for empty tiles. */
    private async decodeInWorker(url: string, signal: AbortSignal): Promise<DecodedGoogleTile | undefined> {
        for (let attempt = 0; ; attempt++) {
            this.totals.requests++;
            const result = await this.workers!.load(url, signal);
            if ("tile" in result) {
                this.totals.bytes += result.byteLength;
                return result.tile;
            }
            if (result.status === 204 || result.status === 404) return undefined;
            if (!TRANSIENT_STATUS.has(result.status) || attempt >= 2) throw new Error(`HTTP ${result.status}`);
            await retryDelay(attempt, signal);
        }
    }

    private async decodeHere(url: string, signal: AbortSignal): Promise<DecodedGoogleTile | undefined> {
        const response = await this.request(url, signal);
        if (response.status === 204 || response.status === 404) return undefined;
        const buffer = await response.arrayBuffer();
        this.totals.bytes += buffer.byteLength;
        return decodeGoogleTile(buffer, signal);
    }

    private failContent(node: TileNode, error: unknown): void {
        node.abort = undefined;
        if (isAbort(error)) { node.contentState = State.None; return; }
        this.totals.failures++;
        node.contentState = State.None;
        node.retryAt = performance.now() + Math.max(3000, TileWorkerPool.throttle.pausedFor(this.rootUrl));
        this.checkSession(error);
        console.warn("Google 3D tile failed:", redact(error));
    }

    /** Create GPU resources for decoded tiles within the per-frame budget. */
    private upload(): void {
        if (!this.uploads.length) return;
        // Nearest-needed first: the traversal refreshed priorities.
        this.uploads.sort((a, b) => a.priority - b.priority);
        const deadline = performance.now() + this.uploadBudgetMs;
        let created = 0;
        while (this.uploads.length && (created === 0 || performance.now() < deadline)) {
            const node = this.uploads.shift()!;
            const decoded = node.decoded!;
            node.decoded = undefined;
            if (node.lastVisit < this.updateId - 120) {
                // No longer needed: drop it rather than spend GPU memory.
                for (const image of decoded.images) image.bitmap?.close();
                node.contentState = State.None;
                continue;
            }
            const localToWorld = (primitive: DecodedGooglePrimitive) => this.localToWorld(node, primitive.nodeMatrix, decoded.rtcCenter);
            let resources: { textures: BaseTexture[]; byteLength: number };
            let primitives: TileContentResources["primitives"];
            if (this.batch) {
                const created = createTileDrawables(decoded, this.scene.getEngine(), "google 3d tile", localToWorld);
                resources = created;
                primitives = created.drawables.map((drawable, i) => ({ drawable, nodeMatrix: decoded.primitives[i].nodeMatrix }));
            } else {
                this.meshMaterial ??= createGoogleTileMaterial(this.scene);
                const created = createGoogleTileMeshes(decoded, this.scene, this.meshMaterial, "google 3d tile", localToWorld);
                for (const mesh of created.meshes) {
                    mesh.setEnabled(false);
                    this.layers?.renderer.add(mesh, this.layers.level);
                }
                resources = created;
                primitives = created.meshes.map((mesh, i) => ({ mesh, nodeMatrix: decoded.primitives[i].nodeMatrix }));
            }
            node.content = {
                textures: resources.textures, byteLength: resources.byteLength, primitives,
                attributions: decoded.attributions, rtcCenter: decoded.rtcCenter,
            };
            node.contentState = State.Ready;
            this.resident.add(node);
            this.residentBytes += resources.byteLength;
            this.contentChanged = true;
            created++;
        }
    }

    private unload(node: TileNode): void {
        const content = node.content;
        if (!content) return;
        const engine = this.scene.getEngine() as ThinEngine;
        for (const { drawable, mesh } of content.primitives) {
            if (drawable) TileBatch.release(engine, drawable);
            mesh?.dispose(false, false);
        }
        for (const texture of content.textures) texture.dispose();
        this.residentBytes -= content.byteLength;
        this.resident.delete(node);
        node.content = undefined;
        node.rendered = false;
        node.contentState = State.None;
    }

    private reloadContent(): void {
        for (const node of [...this.resident]) this.unload(node);
        this.contentChanged = true;
    }

    private abortAll(node?: TileNode): void {
        if (!node) return;
        node.abort?.abort();
        for (const child of node.children) this.abortAll(child);
    }

    // -------------------------------------------------------------- traversal

    private update(): void {
        if (this.disposed) return;
        this.upload();
        const camera = this.camera ?? this.scene.activeCamera;
        if (!camera || !this.root) return;
        const ahead = this.prefetchCamera !== camera ? this.prefetchCamera : undefined;
        const position = camera.globalPosition;
        this.motion.update(position, this.globe ? position.length() - this.globe.radius : position.y);
        if (!this.enabled && this.rendered.length) this.show([]);
        if (!this.enabled && !ahead) return;
        // Only a drawn view needs the frame to follow; a prefetch has its own.
        if (this.enabled || this.frame.revision === 0) this.followCamera(camera);
        if (this.frame.revision === 0) this.setOrigin(this.fixedOrigin ?? { latitude: this.tileSet.centerCoords.y, longitude: this.tileSet.centerCoords.x });

        const engine = this.scene.getEngine();
        const viewKey = `${this.enabled}/${this.viewChange.update(camera, this.globe ? position.length() - this.globe.radius : position.y)}/${this.viewChange.projection(camera)}/${this.frame.revision}`
            + `/${ahead?.uniqueId}/${ahead?.getViewMatrix().updateFlag}/${engine.getRenderWidth()}x${engine.getRenderHeight()}`
            // Quality changes too: a governor may change them while the view holds still.
            + `/${this.maximumScreenSpaceError}/${this.detailRadius}/${this.distantErrorScale}/${this.maximumRadius}/${this.surroundErrorScale}/${this.alwaysLoadSurroundings}`;
        // A new view at once; new content (tiles arriving every frame while
        // loading) at most ten times a second.
        const now = performance.now();
        if (viewKey !== this.lastViewKey || this.contentChanged && now - this.traversedForContentAt > CONTENT_TRAVERSAL_MS) {
            this.lastViewKey = viewKey;
            this.contentChanged = false;
            this.traversedForContentAt = now;
            this.traverse(this.enabled ? camera : undefined, ahead);
        } else if (this.leaving.length && performance.now() - this.leavingSince() >= this.batch!.fadeDuration) {
            // Retire tiles whose fade has finished.
            this.show(this.rendered);
        }
        this.schedule();
        this.evict();
    }

    private leavingSince(): number {
        let first = Infinity;
        for (const node of this.leaving) first = Math.min(first, node.content?.primitives[0]?.drawable?.fadeStart ?? -Infinity);
        return first;
    }

    private traverse(camera: Camera | undefined, ahead: Camera | undefined): void {
        this.updateId++;
        this.traversedAt = performance.now();
        const render: TileNode[] = [];
        this.wanted = [];
        if (camera) {
            this.prepareCamera(camera);
            this.visit(this.root!, render);
            this.show(render);
            if (this.batch) {
                this.frame.toWorld(this.nadir, this.batch.clipCenter);
                this.batch.clipRadius = this.maximumRadius * this.frame.world.scale;
            }
            // Load, without drawing, what lies just beyond the edges of the view.
            this.prepareCamera(camera, this.frame, "margin");
            this.pass = Pass.Margin;
            this.visit(this.root!, []);
            this.pass = Pass.View;
            // Once the view is complete, its surroundings in every direction.
            // (Wanted tiles are those not yet ready; only failures may remain.)
            const settled = this.uploads.length === 0 && this.wanted.every(node => node.contentState === State.Failed || node.tilesetState === State.Failed);
            if ((settled || this.alwaysLoadSurroundings) && !ahead) this.surroundings(camera);
        }
        if (ahead) {
            // Wanted after the visible view; drawn nowhere.
            this.prepareCamera(ahead, this.frameAt(ahead));
            this.pass = Pass.Prefetch;
            this.visit(this.root!, []);
            this.pass = Pass.View;
        }
        // The blurriest first; subtrees gate everything beneath them, so they go before.
        const rank = (node: TileNode) => node.priority - (node.tilesetUri && node.tilesetState === State.None && !node.children.length ? TILESET_PRIORITY_BOOST : 0);
        this.wanted.sort((a, b) => rank(a) - rank(b));
        // What this traversal needs; everything else resident may be evicted.
        this.neededBytes = 0;
        for (const node of this.resident) if (node.lastVisit === this.updateId) this.neededBytes += node.content!.byteLength;
        this.updateAttributions();
        this.onUpdatedObservable.notifyObservers(this);
    }

    /** An exact frame anchored beneath a camera, e.g. one far from the drawn view. */
    private frameAt(camera: Camera): GoogleTileFrame {
        if (!this.globe) return this.frame;
        const surface = this.globe.getSurfaceCoordinates(camera.globalPosition);
        this.prefetchFrame.set({ latitude: surface.latitude, longitude: surface.longitude }, this.worldAnchorFor(surface));
        return this.prefetchFrame;
    }

    private prepareCamera(camera: Camera, frame = this.frame, extent: "view" | "margin" | "around" = "view"): void {
        frame.toECEF(camera.globalPosition, this.eye);
        // Ground distances are measured from the ellipsoid point below the camera.
        const below = ecefToGeodetic(this.eye.x, this.eye.y, this.eye.z);
        geodeticToECEF(below.latitude, below.longitude, 0, this.nadir);
        const engine = this.scene.getEngine();
        this.sseFactor = engine.getRenderHeight() / (2 * Math.tan(camera.fov / 2));
        const dc = this.eye.length();
        this.horizonDistance = dc > HORIZON_RADIUS ? Math.sqrt(dc * dc - HORIZON_RADIUS * HORIZON_RADIUS) : Infinity;
        // World-space frustum planes expressed in ECEF: n' = L n, d' = n.t + d.
        if (extent === "around") { this.planes = []; return; }
        const widening = this.viewChange.widening;
        const transform = extent === "margin"
            ? widenedViewProjection(camera, VIEW_MARGIN * (1 + 2 * widening * Math.PI / 180 / camera.fov))
            : selectionViewProjection(camera, widening);
        const m = frame.matrix.m;
        this.planes = Frustum.GetPlanes(transform).map((plane: Plane) => {
            const n = plane.normal;
            return {
                normal: new Vector3(m[0] * n.x + m[1] * n.y + m[2] * n.z, m[4] * n.x + m[5] * n.y + m[6] * n.z, m[8] * n.x + m[9] * n.y + m[10] * n.z),
                d: n.x * m[12] + n.y * m[13] + n.z * m[14] + plane.d,
            };
        });
    }

    /** Want the tiles all around the camera, reusing a recent selection of them. */
    private surroundings(camera: Camera): void {
        const around = this.around;
        if (this.traversedAt - around.at >= AROUND_INTERVAL_MS) {
            around.at = this.traversedAt;
            around.visited = [];
            const start = this.wanted.length;
            this.prepareCamera(camera, this.frame, "around");
            this.pass = Pass.Around;
            this.visit(this.root!, []);
            this.pass = Pass.View;
            around.wanted = this.wanted.slice(start);
            return;
        }
        for (const node of around.visited) node.lastVisit = this.updateId;
        for (const node of around.wanted)
            this.want(node, node.tilesetUri && node.tilesetState === State.None && !node.children.length ? "tileset" : "content", Pass.Around);
    }

    /**
     * Select what to draw beneath `node`. Returns true when the node's area is
     * fully drawable (or needs nothing), so its parent may be replaced.
     */
    private visit(node: TileNode, render: TileNode[]): boolean {
        // The visible view's distance and priority win over a prefetch's.
        const seen = this.pass !== Pass.View && node.lastVisit === this.updateId;
        if (this.pass === Pass.Around && !seen) this.around.visited.push(node);
        node.lastVisit = this.updateId;
        node.seenAt = this.traversedAt;
        const sticky = node.refined && node.viewedIn >= this.updateId - 1;
        if (this.pass === Pass.View) node.viewedIn = this.updateId;
        const box = node.box;
        const ground = distanceToBox(box, this.nadir);
        if (ground > this.maximumRadius) return true;
        const distance = Math.max(1, distanceToBox(box, this.eye));
        if (!seen) node.distance = distance;
        // Outside the view: nothing to draw or load. Resident content stays
        // cached, so it reappears in the same frame the camera turns to it.
        if (!this.isVisible(box, distance)) { node.culledIn = this.updateId; return true; }
        const error = node.geometricError * this.sseFactor / distance;
        const target = this.maximumScreenSpaceError * Math.min(this.distantErrorScale, Math.max(1, ground / this.detailRadius))
            * (this.pass === Pass.Around ? this.surroundErrorScale : 1);
        // The blurriest first: how far this tile's error, and so roughly its
        // drawn parent's, exceeds the target on screen (lower loads sooner).
        if (!seen) node.priority = Math.log2(target / Math.max(error, 1e-6)) + PASS_PRIORITY[this.pass];

        // A tile without content of its own (often the link to another
        // tileset) has its detail in its children: always pass through it.
        let refine = error > target * this.band(node, sticky) || node.contentState === State.Empty;
        if (refine && node.tilesetUri && node.tilesetState !== State.Ready) {
            this.want(node, "tileset");
            refine = node.children.length > 0;
        }
        if (refine && !node.children.length) refine = false;
        if (this.pass === Pass.View) node.refined = refine;
        // Held in the dead band, a drawn tile stays while its children load:
        // once they are all here the band closes and they replace it, rather
        // than the coarse tile staying until the view changes.
        if (!refine && this.pass === Pass.View && error > target) {
            if (node.tilesetUri && node.tilesetState !== State.Ready) this.want(node, "tileset", Pass.Margin);
            for (const child of node.children) {
                if (child.contentState !== State.None || child.wantedIn === this.updateId) continue;
                child.priority = node.priority + PASS_PRIORITY[Pass.Margin];
                this.want(child, "content", Pass.Margin);
            }
        }

        if (refine) {
            const start = render.length;
            let covered = true;
            for (const child of node.children) covered = this.visit(child, render) && covered;
            // Load the siblings just out of view too: when the camera turns
            // to them they are ready, rather than dropping the whole parent
            // back to its coarse level while one child loads.
            if (this.pass === Pass.View) for (const child of node.children) {
                if (child.culledIn !== this.updateId || child.contentState !== State.None || child.wantedIn === this.updateId) continue;
                child.priority = node.priority + PASS_PRIORITY[Pass.Margin];
                this.want(child, "content", Pass.Margin);
            }
            if (covered || node.contentState === State.Empty) return covered;
            // Part of the area is still loading, typically a tile just come
            // into view. With this level here it covers the area until the
            // rest arrives; without, finer tiles already drawn stay, leaving
            // that part briefly empty rather than dropping further back.
            if (this.pass === Pass.View && render.length > start && node.drawnIn !== this.updateId - 1 && node.contentState !== State.Ready) {
                this.want(node, "content");
                return true;
            }
            // Children are still loading: draw this level meanwhile.
            this.want(node, "content");
            // Unless it is far too coarse: a tile many levels short of the view
            // is a pale, lumpy shell cut off at the layer's edge, and the
            // surface beneath shows the place better until the detail arrives.
            if (error > target * COARSE_FALLBACK) { this.keepDrawn(node, render); return false; }
            if (node.contentState !== State.Ready) return this.keepDrawn(node, render);
            render.length = start;
            this.draw(node, render);
            return true;
        }
        if (node.contentState === State.Empty) return !node.tilesetUri || node.tilesetState === State.Ready;
        this.want(node, "content");
        if (node.contentState !== State.Ready) return this.keepDrawn(node, render);
        this.draw(node, render);
        return true;
    }

    /**
     * Keep drawing the tiles that showed `node`'s area last time while its
     * replacement loads, rather than falling back to a coarser ancestor.
     * False when nothing beneath it was drawn: an ancestor covered it then.
     */
    /** The dead band: what multiple of the target error `node` must exceed to refine. */
    private band(node: TileNode, sticky: boolean): number {
        if (sticky) return COARSEN_REFINED;
        if (node.drawnIn !== this.updateId - 1) return 1;
        // The band spares loading near the threshold. With the finer tiles
        // already here, holding the coarse one only leaves a blurred patch
        // among sharp neighbours, for as long as the view stays put.
        const ready = node.children.length > 0 && node.children.every(child => child.contentState === State.Ready || child.contentState === State.Empty);
        return ready ? 1 : REFINE_DRAWN;
    }

    private keepDrawn(node: TileNode, render: TileNode[]): boolean {
        if (this.pass !== Pass.View) return false;
        const start = render.length;
        const stack = [...node.children];
        while (stack.length) {
            const n = stack.pop()!;
            if (n.lastVisit < this.updateId - 1) continue;
            if (n.rendered && !n.leaving && n.contentState === State.Ready) {
                if (n.lastUsed !== this.updateId) this.draw(n, render);
            } else stack.push(...n.children);
        }
        return render.length > start;
    }

    private isVisible(box: TileBox, distance: number): boolean {
        for (const plane of this.planes) {
            const s = Vector3.Dot(plane.normal, box.center) + plane.d;
            const r = Math.abs(Vector3.Dot(plane.normal, box.axes[0])) + Math.abs(Vector3.Dot(plane.normal, box.axes[1]))
                + Math.abs(Vector3.Dot(plane.normal, box.axes[2]));
            if (s < -r) return false;
        }
        // Beyond the horizon of a conservative, slightly small Earth.
        const top = box.center.length() + box.radius;
        return distance <= this.horizonDistance + Math.sqrt(Math.max(0, top * top - HORIZON_RADIUS * HORIZON_RADIUS));
    }

    private draw(node: TileNode, render: TileNode[]): void {
        node.lastUsed = this.updateId;
        render.push(node);
    }

    private want(node: TileNode, kind: "tileset" | "content", pass = this.pass): void {
        const state = kind === "tileset" ? node.tilesetState : node.contentState;
        if (state === State.Ready || state === State.Empty || node.wantedIn === this.updateId) return;
        node.wantedIn = this.updateId;
        node.wantedBy = pass;
        this.wanted.push(node);
    }

    /**
     * Show `render`, hiding tiles that left it. Tiles that change level
     * cross-fade with the ones they replace; tiles merely entering or
     * leaving the view appear and vanish at once.
     */
    private show(render: TileNode[]): void {
        const stamp = this.updateId;
        const now = performance.now();
        const fades = !!this.batch && this.batch.fadeDuration > 0 && this.motion.slow;
        const fade = (node: TileNode, start: number | undefined, out: boolean) => {
            for (const { drawable } of node.content!.primitives) if (drawable) { drawable.fadeStart = start; drawable.fadeOut = out; }
        };
        for (const node of render) {
            node.drawnIn = stamp;
            if (node.leaving) { node.leaving = false; fade(node, undefined, false); continue; }
            if (node.rendered) continue;
            node.rendered = true;
            this.totals.shown++;
            if (fades) fade(node, node.culledIn === stamp - 1 ? undefined : now, false);
            for (const { mesh } of node.content!.primitives) mesh?.setEnabled(true);
        }
        for (const node of this.rendered) {
            if (node.drawnIn === stamp || !node.rendered || node.leaving) continue;
            if (fades && node.culledIn !== stamp) {
                // Kept (and safe from eviction) until its replacement has faded in.
                node.leaving = true;
                fade(node, now, true);
                this.leaving.push(node);
                continue;
            }
            node.rendered = false;
            for (const { mesh } of node.content?.primitives ?? []) mesh?.setEnabled(false);
        }
        this.leaving = this.leaving.filter(node => {
            if (!node.leaving) return false;
            const start = node.content?.primitives[0]?.drawable?.fadeStart ?? -Infinity;
            if (now - start < this.batch!.fadeDuration && node.culledIn !== stamp) return true;
            node.leaving = false;
            node.rendered = false;
            return false;
        });
        this.rendered = render;
        if (this.batch) {
            // Nearest first, so early depth testing rejects most hidden fragments.
            const items: TileDrawable[] = [];
            for (const node of [...render, ...this.leaving].sort((a, b) => a.distance - b.distance))
                for (const { drawable } of node.content?.primitives ?? []) items.push(drawable!);
            this.batch.items = items;
        }
    }

    /** Start the most important wanted requests that fit the concurrency limit. */
    private schedule(): void {
        // Decoded tiles waiting for upload hold bitmaps in memory: keep that queue short.
        if (this.requestsInFlight >= this.maxConcurrentRequests || this.uploads.length >= 48 || !this.wanted.length) return;
        const now = performance.now();
        const needsTileset = (node: TileNode) => node.tilesetUri && node.tilesetState === State.None && !node.children.length;
        // Tiles the view does not draw may displace stale tiles, but never
        // what this traversal needs: past that each load would evict another
        // wanted tile, which would be loaded again, forever.
        const budget = this.memoryBudgetMB * 1024 * 1024;
        const allowed = [true, this.neededBytes < budget * MARGIN_BUDGET, this.neededBytes < budget * PREFETCH_BUDGET,
            this.neededBytes < budget * AROUND_BUDGET && this.requestsInFlight < this.maxConcurrentRequests * AROUND_REQUESTS];
        // Sorted once per traversal; started tiles drop out by their state.
        for (const node of this.wanted) {
            if (this.requestsInFlight >= this.maxConcurrentRequests) break;
            if (node.retryAt > now || !allowed[node.wantedBy]) continue;
            if (needsTileset(node)) void this.loadTileset(node);
            else if (node.contentState === State.None) void this.loadContent(node);
        }
        // Abandon downloads the camera has moved away from, once a second.
        if (now - this.abandonedAt > 1000) {
            this.abandonedAt = now;
            for (const node of this.loadingNodes()) if (node.lastVisit < this.updateId - 60) node.abort?.abort();
        }
    }

    private *loadingNodes(): Generator<TileNode> {
        const stack = this.root ? [this.root] : [];
        while (stack.length) {
            const node = stack.pop()!;
            if (node.contentState === State.Loading) yield node;
            if (node.lastVisit >= this.updateId - 120) stack.push(...node.children);
        }
    }

    /**
     * Evict tiles until the cache fits the memory budget: first those the
     * current view does not touch (least recently drawn first), then coarse
     * fallbacks hidden behind fully loaded children. Drawn tiles are never
     * evicted, so a view larger than the budget overshoots it instead of
     * thrashing.
     */
    private evict(): void {
        const now = performance.now();
        if (now - this.sweptAt > 1000) {
            // Release what nothing has needed for a while, whatever the budget.
            this.sweptAt = now;
            for (const node of this.resident)
                if (!node.rendered && node.lastVisit !== this.updateId && now - node.seenAt > this.cacheSeconds * 1000) this.unload(node);
        }
        const budget = this.memoryBudgetMB * 1024 * 1024;
        if (this.residentBytes <= budget || this.evictedIn === this.updateId) return;
        this.evictedIn = this.updateId;
        // Never what the visible view needs, drawn or about to be: evicting a
        // tile that fills a gap only to request it again leaves a lasting
        // hole. Past the budget, rather exceed it; first go tiles nothing
        // needs, then the surroundings and prefetch, oldest first.
        const candidates = [...this.resident].filter(node => !node.rendered && !(node.viewedIn === this.updateId && node.culledIn !== this.updateId))
            .sort((a, b) => Number(a.lastVisit === this.updateId) - Number(b.lastVisit === this.updateId) || a.lastUsed - b.lastUsed);
        for (const node of candidates) {
            if (this.residentBytes <= budget * 0.9) break;
            this.unload(node);
        }
    }

    private updateAttributions(): void {
        const counts = new Map<string, number>();
        for (const node of this.rendered)
            for (const source of node.content?.attributions ?? []) counts.set(source, (counts.get(source) ?? 0) + 1);
        const sorted = [...counts].sort((a, b) => b[1] - a[1]).map(([source]) => source);
        const key = sorted.join("\n");
        if (key === this.attributionKey) return;
        this.attributionKey = key;
        this.attributions = sorted;
        this.tileSet.ourAttribution.setGoogleAttributions(sorted);
        this.onAttributionsChangedObservable.notifyObservers(sorted);
    }
}

function boxOf(volume: Google3DBoundingVolume | undefined, transform: Matrix): TileBox | undefined {
    const transformDirection = (x: number, y: number, z: number) => Vector3.TransformNormal(new Vector3(x, y, z), transform);
    if (volume?.box?.length === 12) {
        const b = volume.box;
        return makeBox(Vector3.TransformCoordinates(new Vector3(b[0], b[1], b[2]), transform),
            [transformDirection(b[3], b[4], b[5]), transformDirection(b[6], b[7], b[8]), transformDirection(b[9], b[10], b[11])]);
    }
    if (volume?.sphere?.length === 4) {
        const s = volume.sphere;
        const r = s[3];
        return makeBox(Vector3.TransformCoordinates(new Vector3(s[0], s[1], s[2]), transform),
            [new Vector3(r, 0, 0), new Vector3(0, r, 0), new Vector3(0, 0, r)]);
    }
    if (volume?.region?.length === 6) {
        const [west, south, east, north, minimum, maximum] = volume.region;
        const corners: Vector3[] = [];
        for (const lat of [south, (south + north) / 2, north])
            for (const lon of [west, (west + east) / 2, east])
                for (const h of [minimum, maximum]) corners.push(geodeticToECEF(lat * 180 / Math.PI, lon * 180 / Math.PI, h));
        const min = corners.reduce((a, c) => Vector3.Minimize(a, c)), max = corners.reduce((a, c) => Vector3.Maximize(a, c));
        const half = max.subtract(min).scale(0.5);
        return makeBox(min.add(half), [new Vector3(half.x, 0, 0), new Vector3(0, half.y, 0), new Vector3(0, 0, half.z)]);
    }
    return undefined;
}

/** Distance from a point to an oriented box (zero inside). */
function distanceToBox(box: TileBox, point: Vector3): number {
    const dx = point.x - box.center.x, dy = point.y - box.center.y, dz = point.z - box.center.z;
    let squared = 0;
    for (let i = 0; i < 3; i++) {
        const u = box.units[i];
        const excess = Math.abs(dx * u.x + dy * u.y + dz * u.z) - box.lengths[i];
        if (excess > 0) squared += excess * excess;
    }
    return Math.sqrt(squared);
}

/** Worker pools shared by every tile set on the page. */

/** How long a kept session is used: within the lifetime Google gives its tiles' cache entries. */
const SESSION_KEEP_MS = 3 * 3600_000;

function readSession(key?: string): string | undefined {
    if (!key) return undefined;
    try {
        const kept = JSON.parse(globalThis.localStorage?.getItem(key) ?? "null") as { session?: string; at?: number } | null;
        return kept?.session && typeof kept.at === "number" && Date.now() - kept.at < SESSION_KEEP_MS ? kept.session : undefined;
    } catch {
        return undefined;
    }
}

function writeSession(key: string | undefined, session: string | undefined): void {
    if (!key) return;
    try {
        if (session) globalThis.localStorage?.setItem(key, JSON.stringify({ session, at: Date.now() }));
        else globalThis.localStorage?.removeItem(key);
    } catch {
        // Storage unavailable (private mode, blocked): tiles just are not reused across pages.
    }
}

/** The session in the first content URI of a tile set, if any. */
function sessionOf(tileset: Google3DTileset): string | undefined {
    const stack: Google3DTile[] = [tileset.root];
    while (stack.length) {
        const tile = stack.pop()!;
        for (const content of [tile.content, ...(tile.contents ?? [])]) {
            const uri = content?.uri ?? content?.url;
            if (typeof uri !== "string") continue;
            const session = new URL(uri, "https://x/").searchParams.get("session");
            if (session) return session;
        }
        stack.push(...(tile.children ?? []));
    }
    return undefined;
}

function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}

/** Error text without request URLs, which carry the API key. */
function redact(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "[request]");
}

/** Attribution sources and CESIUM_RTC centre from a GLB, without decoding geometry. */
export function parseGoogleGLBMetadata(buffer: ArrayBuffer): { attributions: string[]; rtcCenter?: Vector3 } {
    try {
        const { json } = parseGLB(buffer);
        const center = (json.extensions as { CESIUM_RTC?: { center?: number[] } } | undefined)?.CESIUM_RTC?.center;
        return {
            attributions: glbAttributions(json),
            rtcCenter: center?.length === 3 && center.every(Number.isFinite) ? Vector3.FromArray(center) : undefined,
        };
    } catch {
        return { attributions: [] };
    }
}

/** A short pause before retrying a transient failure; a slow-down is also waited out by the throttle. */
function retryDelay(attempt: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 300 * 3 ** attempt * (0.75 + Math.random() * 0.5));
        signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
}
