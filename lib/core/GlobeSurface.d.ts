import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import type { Ray } from "@babylonjs/core/Culling/ray.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import type GlobeSet from "./GlobeSet.js";
import type MapLayerRenderer from "./MapLayerRenderer.js";
import { TileBatch } from "../shared/TileBatch.js";
import { type HeightFormat } from "../shared/TileWorkerPool.js";
/** A Web Mercator (XYZ) imagery source. */
export interface GlobeImagery {
    /** URL of tile `x`, `y` at zoom `z`. */
    url(x: number, y: number, z: number): string;
    /** Deepest zoom the provider serves. */
    maxZoom: number;
    /** Image width in pixels: 256, or 512 for high-DPI tiles. */
    tileSize?: number;
    /** Credit to display while the imagery is visible. */
    attribution?: string;
}
/** A Web Mercator source of elevation tiles, heights in metres above sea level. */
export interface GlobeElevation {
    url(x: number, y: number, z: number): string;
    maxZoom: number;
    /** Terrarium-encoded PNGs (the default) or LERC float rasters. */
    format?: HeightFormat;
    /** Credit to display while the terrain is visible. */
    attribution?: string;
}
/**
 * Mapzen Terrarium elevation on AWS Open Data: global land to zoom 15, no
 * key. Its sea floor is ETOPO1, about 1.8 km per sample.
 */
export declare const TERRARIUM_ELEVATION: GlobeElevation;
/**
 * Esri World Elevation TopoBathy 3D: land and sea floor from many surveys
 * (GEBCO in the open ocean; multibeam and lidar down to metres along many
 * coasts), as LERC tiles, no key. See Esri's terms of use for the service.
 */
export declare function esriTopoBathyElevation(): GlobeElevation;
/** Esri World Imagery: global satellite and aerial imagery, no key. */
export declare function esriImagery(): GlobeImagery;
/** Mapbox Satellite, as 512-pixel tiles. */
export declare function mapboxImagery(accessToken: string): GlobeImagery;
/**
 * Google Maps satellite imagery, the same imagery that textures Google's
 * photorealistic 3D tiles. `session` comes from `RasterGoogleSatellite.openSession`.
 */
export declare function googleImagery(apiKey: string, session: string): GlobeImagery;
/** GEBCO's shaded relief of the sea floor and land, from its WMS service. 512-pixel tiles. */
export declare function gebcoImagery(): GlobeImagery;
export interface GlobeSurfaceOptions {
    /**
     * Imagery source, or sources in order of preference: when one refuses
     * requests (an exhausted quota or a bad key), the surface moves to the next.
     */
    imagery: GlobeImagery | GlobeImagery[];
    /** Elevation source; Terrarium by default, `null` for a smooth globe. */
    elevation?: GlobeElevation | null;
    /**
     * Load the sea floor and draw it whenever the camera is below sea level,
     * the only place it can be seen. Defaults to true.
     */
    bathymetry?: boolean;
    /** Exaggerate elevations by this factor. Defaults to 1. */
    verticalScale?: number;
    /** Largest on-screen size of one imagery texel, in pixels. Defaults to 1.25. */
    maximumScreenSpaceError?: number;
    /**
     * Approximate GPU memory for cached tiles, in megabytes. Default: no
     * limit. Either way, tiles nothing has needed for `cacheSeconds` are released.
     */
    memoryBudgetMB?: number;
    /** Seconds an unneeded tile stays cached. Default 300. */
    cacheSeconds?: number;
    /** Simultaneous downloads. Defaults to 24. */
    maxConcurrentRequests?: number;
    /** Encode imagery as BC1 where supported: an eighth of the memory. Defaults to true. */
    compressTextures?: boolean;
    /** Main-thread milliseconds per frame for creating GPU resources. Defaults to 3. */
    uploadBudgetMs?: number;
    /** Camera that drives detail; the scene's active camera by default. */
    camera?: Camera;
    /** See `GlobeSurface.coverage`. */
    coverage?: GlobeSurfaceCoverage;
}
/** Where finer content (such as photorealistic 3D tiles) hides the surface. */
export interface GlobeSurfaceCoverage {
    /** Metres around the point beneath the camera. */
    radius: number;
    /** Deepest imagery zoom loaded inside that radius. */
    maxZoom: number;
}
export interface GlobeSurfaceStats {
    rendered: number;
    resident: number;
    residentBytes: number;
    /** Tiles the view needs that have not arrived. */
    pending: number;
    requestsInFlight: number;
    totalRequests: number;
    totalDownloadedBytes: number;
    failedRequests: number;
    /** Tiles that have appeared on screen; its rate while the view moves is level-of-detail churn. */
    totalShown: number;
}
/**
 * The globe's ground: satellite imagery draped over terrain, streamed as a
 * quadtree of Web Mercator tiles. Each frame selects the coarsest tiles whose
 * texels stay within `maximumScreenSpaceError` pixels on screen, so detail
 * follows the view from the horizon to the ground beneath the camera, and
 * draws them all in one pass. Downloading and decoding (including BC1
 * texture compression) run in workers.
 *
 * Heights are Terrarium elevations above mean sea level, applied along the
 * GlobeSet's radial up direction.
 */
export default class GlobeSurface {
    readonly globe: GlobeSet;
    maximumScreenSpaceError: number;
    memoryBudgetMB: number;
    cacheSeconds: number;
    maxConcurrentRequests: number;
    uploadBudgetMs: number;
    camera?: Camera;
    /**
     * Limit detail where something finer covers the ground, e.g. Google's
     * photorealistic tiles within their loading radius: the surface beneath
     * stays coarse instead of downloading imagery nobody sees.
     */
    coverage?: GlobeSurfaceCoverage;
    /** Draw the surface. Streaming pauses while disabled, except for `prefetchCamera`. */
    enabled: boolean;
    /**
     * Also load what this camera would see, after everything the visible
     * view needs: e.g. the end of a flight, so it arrives already sharp.
     * It is never drawn from.
     */
    prefetchCamera?: Camera;
    /**
     * Colour of the sea. Imagery of water differs between levels of detail
     * and sources, so water at sea level is drawn in this colour, reflecting
     * the sky toward the horizon, instead.
     */
    readonly waterColor: import("@babylonjs/core").Color3;
    readonly onUpdatedObservable: Observable<GlobeSurface>;
    /** Raised when refused requests move the surface to its next imagery source. */
    readonly onImageryChangedObservable: Observable<GlobeImagery>;
    private readonly scene;
    private readonly sources;
    private imagery;
    /** Refusals from the current source since its last success. */
    private refusals;
    private readonly elevation;
    private readonly bathymetry;
    private readonly verticalScale;
    private readonly workers;
    private readonly batch;
    private readonly floorBatch;
    private readonly uvBuffer;
    private readonly indexBuffer;
    private readonly indexCount;
    private readonly root;
    /** Fills beyond Web Mercator's latitude limit, drawn after the tiles. */
    private readonly caps;
    private readonly renderObserver;
    private readonly elevationTiles;
    private readonly resident;
    private readonly uploads;
    private rendered;
    private traversedAt;
    private readonly motion;
    private sweptAt;
    /** Tiles replaced by others, drawn until those have faded in. */
    private leaving;
    private wanted;
    private updateId;
    private requestsInFlight;
    private residentBytes;
    private totals;
    private lastViewKey;
    private contentChanged;
    private disposed;
    private readonly eye;
    private readonly ground;
    private planes;
    private sseFactor;
    private horizonDistance;
    private occluderRadius;
    private underwater;
    /** Visiting for `prefetchCamera`. */
    private pass;
    /** Resident bytes the last traversal visited. */
    private neededBytes;
    private fogDensity;
    constructor(globe: GlobeSet, options: GlobeSurfaceOptions);
    /** The mesh that draws the surface, for rendering groups and layers. */
    get mesh(): TileBatch;
    /** Draw beneath finer map layers; see MapLayerRenderer. */
    addToLayers(renderer: MapLayerRenderer, level: number): void;
    /** Credits for the imagery and terrain in use. */
    get attribution(): string | undefined;
    /** The imagery source in use. */
    get currentImagery(): GlobeImagery;
    get stats(): GlobeSurfaceStats;
    /** True once everything the current view needs is drawn. */
    get isIdle(): boolean;
    /** Resolve once the current view has finished loading. */
    whenIdle(): Promise<void>;
    /**
     * Height of the ground or sea floor in metres above sea level, from the finest
     * tile resident at that location, or undefined where none is.
     */
    getHeight(latitude: number, longitude: number): number | undefined;
    /** Nearest intersection of a world-space ray with the drawn surface, in world units. */
    intersectRay(ray: Ray): number | undefined;
    dispose(): void;
    private update;
    private traverse;
    /** Per-traversal state for `camera`. */
    private prepare;
    /**
     * Select what to draw beneath `node`. Returns true when the node's area is
     * fully drawable (or invisible), so its parent may be replaced.
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
    private want;
    private draw;
    /**
     * Show `render`. Tiles that change level cross-fade with the ones they
     * replace; tiles merely entering or leaving the view appear and vanish at once.
     */
    private show;
    /**
     * A flat disc of polar ice beyond the Mercator limit, at the height of
     * the surrounding land: sea level in the Arctic, the plateau in Antarctica.
     */
    private createCap;
    private split;
    /** Bounding sphere from a coarse sample of the tile at its height extremes. */
    private bound;
    /** World position at fraction (u, v) of a tile, `height` metres above sea level. */
    private position;
    /** Start the most important wanted requests that fit the concurrency limit. */
    private schedule;
    private loadingNodes;
    private load;
    /** Move to the next imagery source; tiles that failed retry from it at once. */
    private nextImagery;
    /**
     * Grid heights for a tile, sampled from the elevation tile three levels
     * up (32 samples per tile). Terrarium's finer levels hold land models that
     * flatten many coastal waters to exactly zero; there the sea floor comes
     * from the coarser global bathymetry instead.
     */
    private heightsFor;
    /** The elevation tile at zoom `z` covering a node, with a sampler in the node's (u, v). */
    private elevationTile;
    /** Create GPU resources for decoded tiles, within the frame's upload budget. */
    private uploadDecoded;
    /**
     * Grid vertices relative to the tile's centre, followed by a skirt that
     * hangs from each edge to hide cracks between tiles of different levels.
     * Fixes the node's exact bounds and height range.
     */
    private buildPositions;
    private unload;
    /**
     * Evict tiles until the cache fits the memory budget, least recently drawn
     * first. Drawn tiles and the always-resident base levels are kept.
     */
    private evict;
}
