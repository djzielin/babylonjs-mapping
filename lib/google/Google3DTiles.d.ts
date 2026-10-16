import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Ray } from "@babylonjs/core/Culling/ray.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import type TileSet from "../core/TileSet.js";
import { type GeodeticPosition } from "./GoogleTileFrame.js";
import { type ViewTolerance } from "../shared/ViewMargin.js";
import type MapLayerRenderer from "../core/MapLayerRenderer.js";
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
    readonly tileSet: TileSet;
    readonly rootUrl: string;
    maximumScreenSpaceError: number;
    detailRadius: number;
    distantErrorScale: number;
    maximumRadius: number;
    surroundErrorScale: number;
    alwaysLoadSurroundings: boolean;
    memoryBudgetMB: number;
    cacheSeconds: number;
    maxConcurrentRequests: number;
    uploadBudgetMs: number;
    heightOffset: number;
    geoid?: (latitude: number, longitude: number) => number;
    camera?: Camera;
    /**
     * On a globe, the colour of the sea. Google's imagery of water changes
     * from one level of detail to the next, so water at sea level is drawn
     * in this colour, reflecting the sky toward the horizon, instead.
     */
    readonly waterColor: import("@babylonjs/core").Color3;
    /** Draw tiles. Streaming pauses while disabled, except for `prefetchCamera`. */
    enabled: boolean;
    /**
     * Also load what this camera would see, after everything the visible
     * view needs: e.g. the end of a flight, so it arrives already sharp.
     * It is never drawn from.
     */
    prefetchCamera?: Camera;
    /**
     * How far the view may turn (degrees) or move (fraction of its height)
     * before tiles are selected again; meanwhile the view is drawn widened
     * by the angle. Default 0: every change. For a headset, whose pose
     * changes every frame, a few degrees saves most of the selection work.
     */
    get viewTolerance(): ViewTolerance;
    set viewTolerance(tolerance: ViewTolerance);
    private readonly viewChange;
    /** Fires after each traversal with the number of tiles drawn. */
    readonly onUpdatedObservable: Observable<Google3DTiles>;
    /** Fires when the set of attribution sources changes. */
    readonly onAttributionsChangedObservable: Observable<readonly string[]>;
    private readonly apiKey;
    private readonly fetcher;
    private readonly workers?;
    private readonly scene;
    /** Draws all tiles on WebGL; other engines get one scene mesh per primitive. */
    private readonly batch?;
    private meshMaterial?;
    private layers?;
    private readonly frame;
    private readonly fixedOrigin?;
    private readonly renderObserver;
    private root?;
    private rootState;
    private session?;
    /** Visiting for `prefetchCamera`. */
    private pass;
    /** Resident bytes the last traversal visited. */
    private neededBytes;
    private readonly prefetchFrame;
    private updateId;
    private rendered;
    private wanted;
    private readonly resident;
    private readonly uploads;
    private requestsInFlight;
    private residentBytes;
    private totals;
    private lastViewKey;
    private contentChanged;
    private attributionKey;
    private attributions;
    private disposed;
    private evictedIn;
    private traversedAt;
    private readonly motion;
    private abandonedAt;
    private traversedForContentAt;
    private sweptAt;
    /** Tiles replaced by others, drawn until those have faded in. */
    private leaving;
    private readonly eye;
    private readonly nadir;
    private planes;
    private sseFactor;
    private horizonDistance;
    constructor(tileSet: TileSet, options: Google3DTilesOptions);
    private get globe();
    /** Current streaming counters. */
    get stats(): Google3DTilesStats;
    /** True when every tile wanted by the current view is drawn. */
    get isIdle(): boolean;
    /** Resolve once the current view has finished loading. */
    whenIdle(): Promise<void>;
    /** Data providers for the tiles currently drawn, most prominent first. */
    getAttributions(): readonly string[];
    /**
     * Draw the tiles as `level` of a `MapLayerRenderer`, so coarser map layers
     * fill in only where photorealistic coverage ends.
     */
    addToLayers(renderer: MapLayerRenderer, level: number): void;
    /**
     * Distance along a world-space ray to the drawn photorealistic surface,
     * in world units, or undefined when the ray misses. Useful for camera
     * collision and click-to-fly. Tiles coarser than `maximumError` metres of
     * geometric error are skipped: the coarsest stand hundreds of metres off
     * the ground.
     */
    intersectRay(ray: Ray, maximumError?: number): number | undefined;
    /** Fix the geographic anchor that is placed exactly on the map. */
    setOrigin(origin: Google3DTilesOrigin): void;
    dispose(): void;
    /**
     * ECEF metres to world as the tiles are currently placed, or undefined
     * before they are. Overlays placed through it (see `GlobeEarthFrame`)
     * line up with the tiles exactly.
     */
    get ecefToWorld(): Matrix | undefined;
    /** ECEF metres of a point `height` metres above sea level, in the tiles' vertical datum. */
    toECEF(latitude: number, longitude: number, height: number, result?: Vector3): Vector3;
    /**
     * Height in metres above sea level of the first tile surface below `top`
     * metres (roofs, bridge decks, treetops, the ground) at a location, among
     * the tiles drawn; undefined where there is none, or only coarse tiles
     * whose surface is too approximate to measure.
     */
    surfaceHeight(latitude: number, longitude: number, top?: number): number | undefined;
    private worldAnchorFor;
    private applyAnchor;
    private placeContent;
    private localToWorld;
    /**
     * Keep the anchor near the camera on a globe. Re-anchoring keeps the
     * surface under the camera fixed, so it is invisible; when the camera is
     * high enough that the residual sphere/ellipsoid mismatch is sub-pixel,
     * the anchor snaps back onto the globe's own coordinates.
     */
    private followCamera;
    private authenticate;
    private loadRoot;
    private buildNode;
    private loadTileset;
    private fetchJSON;
    /** One network request with brief retries for transient failures. */
    private request;
    private loadContent;
    /** Download and decode in a worker, retrying transient HTTP failures. Undefined for empty tiles. */
    private decodeInWorker;
    private decodeHere;
    private failContent;
    /** Create GPU resources for decoded tiles within the per-frame budget. */
    private upload;
    private unload;
    private reloadContent;
    private abortAll;
    private update;
    private leavingSince;
    private traverse;
    /** An exact frame anchored beneath a camera, e.g. one far from the drawn view. */
    private frameAt;
    private prepareCamera;
    /**
     * Select what to draw beneath `node`. Returns true when the node's area is
     * fully drawable (or needs nothing), so its parent may be replaced.
     */
    private visit;
    /**
     * Keep drawing the tiles that showed `node`'s area last time while its
     * replacement loads, rather than falling back to a coarser ancestor.
     * False when nothing beneath it was drawn: an ancestor covered it then.
     */
    /** The dead band: what multiple of the target error `node` must exceed to refine. */
    private band;
    private keepDrawn;
    private isVisible;
    private draw;
    private want;
    /**
     * Show `render`, hiding tiles that left it. Tiles that change level
     * cross-fade with the ones they replace; tiles merely entering or
     * leaving the view appear and vanish at once.
     */
    private show;
    /** Start the most important wanted requests that fit the concurrency limit. */
    private schedule;
    private loadingNodes;
    /**
     * Evict tiles until the cache fits the memory budget: first those the
     * current view does not touch (least recently drawn first), then coarse
     * fallbacks hidden behind fully loaded children. Drawn tiles are never
     * evicted, so a view larger than the budget overshoots it instead of
     * thrashing.
     */
    private evict;
    private updateAttributions;
}
/** Attribution sources and CESIUM_RTC centre from a GLB, without decoding geometry. */
export declare function parseGoogleGLBMetadata(buffer: ArrayBuffer): {
    attributions: string[];
    rtcCenter?: Vector3;
};
