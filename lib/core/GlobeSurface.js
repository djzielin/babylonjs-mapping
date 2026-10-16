import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { Frustum } from "@babylonjs/core/Maths/math.frustum.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import { Scene } from "@babylonjs/core/scene.js";
import { TileBatch, supportsTileBatch } from "../shared/TileBatch.js";
import { globeWaterShader, WATER_COLOR } from "./GlobeWaterShader.js";
import { DEEPEST_DARKENING } from "./GlobeAtmosphere.js";
import { MotionTracker, selectionViewProjection, VIEW_MARGIN, ViewChange, widenedViewProjection } from "../shared/ViewMargin.js";
import { createDecodedTexture, supportsBC1 } from "../shared/TileTextures.js";
import { TileWorkerPool } from "../shared/TileWorkerPool.js";
import { gridTriangles, RayMesh } from "../shared/RayMesh.js";
/**
 * Mapzen Terrarium elevation on AWS Open Data: global land to zoom 15, no
 * key. Its sea floor is ETOPO1, about 1.8 km per sample.
 */
export const TERRARIUM_ELEVATION = {
    url: (x, y, z) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
    maxZoom: 15,
    attribution: "Mapzen, AWS",
};
/**
 * Esri World Elevation TopoBathy 3D: land and sea floor from many surveys
 * (GEBCO in the open ocean; multibeam and lidar down to metres along many
 * coasts), as LERC tiles, no key. See Esri's terms of use for the service.
 */
export function esriTopoBathyElevation() {
    return {
        url: (x, y, z) => `https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/TopoBathy3D/ImageServer/tile/${z}/${y}/${x}`,
        maxZoom: 16,
        format: "lerc",
        attribution: "Esri, GEBCO, NOAA, USGS",
    };
}
/** Esri World Imagery: global satellite and aerial imagery, no key. */
export function esriImagery() {
    return {
        url: (x, y, z) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
        // Deeper levels exist only in places; elsewhere Esri serves placeholder images.
        maxZoom: 18,
        attribution: "Esri, Maxar, Earthstar Geographics",
    };
}
/** Mapbox Satellite, as 512-pixel tiles. */
export function mapboxImagery(accessToken) {
    return {
        url: (x, y, z) => `https://api.mapbox.com/v4/mapbox.satellite/${z}/${x}/${y}@2x.jpg90?access_token=${encodeURIComponent(accessToken)}`,
        maxZoom: 21,
        tileSize: 512,
        attribution: "© Mapbox © Maxar",
    };
}
/**
 * Google Maps satellite imagery, the same imagery that textures Google's
 * photorealistic 3D tiles. `session` comes from `RasterGoogleSatellite.openSession`.
 */
export function googleImagery(apiKey, session) {
    return {
        url: (x, y, z) => `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(apiKey)}`,
        maxZoom: 21,
        attribution: "Google",
    };
}
/** GEBCO's shaded relief of the sea floor and land, from its WMS service. 512-pixel tiles. */
export function gebcoImagery() {
    const half = 20037508.342789244;
    return {
        url: (x, y, z) => {
            const span = 2 * half / 2 ** z, west = -half + x * span, north = half - y * span;
            return `https://wms.gebco.net/mapserv?service=WMS&version=1.3.0&request=GetMap&layers=GEBCO_LATEST_2&styles=default`
                + `&crs=EPSG:3857&bbox=${west},${north - span},${west + span},${north}&width=512&height=512&format=image/jpeg`;
        },
        // The grid is 15 arc-seconds, about 450 m.
        maxZoom: 10,
        tileSize: 512,
        attribution: "GEBCO Compilation Group",
    };
}
var State;
(function (State) {
    State[State["None"] = 0] = "None";
    State[State["Loading"] = 1] = "Loading";
    State[State["Decoded"] = 2] = "Decoded";
    State[State["Ready"] = 3] = "Ready";
    State[State["Failed"] = 4] = "Failed";
})(State || (State = {}));
const FLOOR = "globeSeaFloor";
/** Web Mercator's width in metres. */
const MERCATOR_METRES = 2 * Math.PI * 6378137;
/** Repeat length of the sea floor's procedural detail, in Web Mercator metres. */
const DETAIL_PERIOD = 32768;
// The sea floor, coloured by depth and shaded from its own slope. Positions
// are camera-relative as in TileBatch; land is left to the sea-level surface.
// The sea floor as seen through water. Sunlight reaching the floor loses red
// first, then green, with depth (compressed, so the abyss stays legible);
// sediment covers the flats, rock the slopes, and caustics dance in the
// shallows. Detail coordinates are ground metres (see detailCoordinates).
Effect.ShadersStore[`${FLOOR}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute float height;
attribute vec3 normal;
attribute vec2 detail;
uniform mat4 tileWorld;
uniform mat4 tileViewProjection;
varying vec3 vRelative;
varying vec3 vNormal;
varying float vHeight;
varying vec2 vDetail;
void main(void) {
    vec4 relative = tileWorld * vec4(position, 1.0);
    gl_Position = tileViewProjection * relative;
    vRelative = relative.xyz;
    vNormal = normal;
    vHeight = height;
    vDetail = detail;
}`;
Effect.ShadersStore[`${FLOOR}FragmentShader`] = `
precision highp float;
uniform vec3 fogColor;
uniform float fogDensity;
uniform vec3 up;
uniform vec3 sun;
uniform float time;
uniform float unitMetres;
varying vec3 vRelative;
varying vec3 vNormal;
varying float vHeight;
varying vec2 vDetail;
const float PERIOD = ${DETAIL_PERIOD.toFixed(1)};
const float TAU = 6.2831853;

float hash(vec2 cell) {
    return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}
// Value noise on a lattice of 'size' metres that repeats every PERIOD.
float noise(vec2 p, float size) {
    vec2 q = p / size, cell = floor(q), f = q - cell, n = vec2(PERIOD / size);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(mod(cell, n)), b = hash(mod(cell + vec2(1.0, 0.0), n));
    float c = hash(mod(cell + vec2(0.0, 1.0), n)), d = hash(mod(cell + 1.0, n));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Interfering ripples focused into bright filaments; the wave vectors are
// whole cycles per PERIOD, so the pattern repeats with the detail coordinates.
float caustics(vec2 p, float t) {
    // Warped so the net is irregular, scaled to sub-metre cells.
    p = p * 2.5 + vec2(noise(p, 6.0), noise(p + 17.0, 6.0)) * 3.0;
    float w = 0.0;
    w += sin(TAU * dot(p, vec2(25013.0, 8573.0)) / PERIOD + t * 1.3);
    w += sin(TAU * dot(p, vec2(-11113.0, 22717.0)) / PERIOD + t * 1.1);
    w += sin(TAU * dot(p, vec2(-17827.0, -18979.0)) / PERIOD + t * 0.9);
    w += 0.6 * sin(TAU * dot(p, vec2(37831.0, -28411.0)) / PERIOD - t * 1.7);
    return pow(max(0.0, 1.0 - abs(w) * 0.5), 10.0) * (0.4 + 1.2 * noise(p, 40.0));
}

void main(void) {
    if (vHeight > -0.5) discard;
    float depth = -vHeight;
    float distance = length(vRelative);
    vec3 n = normalize(vNormal);
    float slope = 1.0 - clamp(dot(n, up), 0.0, 1.0);
    // Detail fades with distance before it can alias.
    float metres = distance * unitMetres;
    float near = 1.0 - smoothstep(4000.0, 20000.0, metres);
    float close = 1.0 - smoothstep(15.0, 60.0, metres);
    float grain = noise(vDetail, 900.0) * 0.4 + noise(vDetail, 140.0) * 0.25 * near + noise(vDetail, 24.0) * 0.2 * near
        + noise(vDetail, 3.0) * 0.15 * close;

    float abyss = smoothstep(80.0, 3000.0, depth);
    vec3 sand = vec3(0.88, 0.80, 0.62), ooze = vec3(0.56, 0.55, 0.50), rock = vec3(0.34, 0.32, 0.30);
    vec3 albedo = mix(mix(sand, ooze, abyss), rock, smoothstep(0.06, 0.32, slope + (grain - 0.5) * 0.12));
    albedo *= 0.78 + 0.44 * grain;

    // Wave-built sand ripples, a few decimetres apart, where the floor is flat and shallow.
    float flat_ = (1.0 - smoothstep(0.02, 0.1, slope)) * (1.0 - smoothstep(10.0, 40.0, depth)) * close;
    vec2 rp = vDetail + vec2(noise(vDetail, 5.0), noise(vDetail + 31.0, 5.0)) * 1.5;
    float ripple = sin(TAU * dot(rp, vec2(2.1, 0.7)));
    n = normalize(n + flat_ * 0.25 * ripple * normalize(cross(up, vec3(0.0, 1.0, 0.0)) + vec3(1e-6)));
    float diffuse = max(dot(n, sun), 0.0);
    float compressed = min(${DEEPEST_DARKENING.toFixed(1)}, 40.0 * log(1.0 + depth / 40.0));
    vec3 transmit = exp(-vec3(0.034, 0.011, 0.0062) * compressed);
    vec3 color = albedo * (0.32 + 0.85 * diffuse) * transmit;
    // Light scattered down through the water, bluest near the surface.
    color += vec3(0.010, 0.045, 0.075) * (1.0 - 0.75 * abyss);
    color += caustics(vDetail, time) * exp(-depth / 12.0) * diffuse * close * transmit * 0.18;

    // Between the floor and the eye the water absorbs red within metres,
    // green within hundreds; the distance is compressed so distant walls
    // still show through as faint blue shapes. The water's own colour
    // (the scene's fog colour) fills in what is absorbed.
    float path = 60.0 * log(1.0 + metres / 60.0);
    vec3 seen = exp(-vec3(0.02, 0.0062, 0.0042) * path);
    gl_FragColor = vec4(mix(fogColor, color, seen), 1.0);
}`;
/** Grid cells along each tile edge. */
const GRID = 32;
const VERTICES = (GRID + 1) * (GRID + 1) + 4 * (GRID + 1);
const MAX_LATITUDE = 85.05112878;
const DEGREES = Math.PI / 180;
const EARTH_RADIUS = 6378137;
/** Levels that are always resident, so a view never shows holes. */
const BASE_ZOOM = 2;
const ELEVATION_CACHE = 96;
/** Deepest Terrarium level whose sea floor is global bathymetry everywhere. */
const SEA_FLOOR_ZOOM = 10;
/** Deepest level drawn beneath the sea, where tiles carry no imagery: 32 m between vertices. */
const UNDERWATER_MAX_ZOOM = 17;
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
/** Statuses that say the source will not serve this client: no key, a bad key, or no quota left. */
const REFUSED_STATUS = new Set([401, 403, 429]);
const REFUSALS_TO_SWITCH = 6;
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
var Pass;
(function (Pass) {
    Pass[Pass["View"] = 0] = "View";
    Pass[Pass["Margin"] = 1] = "Margin";
    Pass[Pass["Prefetch"] = 2] = "Prefetch";
})(Pass || (Pass = {}));
/** Added to priorities by pass (lower loads sooner): the margin after everything visible, prefetches last. */
const PASS_PRIORITY = [0, MARGIN_PRIORITY, PREFETCH_PRIORITY];
/** Fractions of the memory budget the needed tiles may fill before margin, and prefetch, loads stop. */
const MARGIN_BUDGET = 0.9;
const PREFETCH_BUDGET = 0.75;
class SurfaceNode {
    z;
    x;
    y;
    parent;
    children;
    state = 0 /* State.None */;
    /** World-space bounding sphere, refined once heights are known. */
    center = new Vector3();
    radius = 0;
    /** Radius that also encloses the sea floor, for views from beneath the sea. */
    floorRadius = 0;
    /** Lowest sea floor in metres, or the sea surface where there is none. */
    floorMin;
    minHeight;
    maxHeight;
    /** Cosine of the tile's latitude nearest the equator: the scale of its widest texels. */
    widestCos;
    distance = 0;
    priority = 0;
    lastVisit = -1;
    /** When a traversal last reached this tile (performance.now()). */
    seenAt = 0;
    wantedIn = -1;
    lastUsed = -1;
    /**
     * Whether the view refined past this tile when it last saw it, for
     * hysteresis. Kept while the tile is out of view, as long as the view
     * keeps reaching it (see viewedIn).
     */
    refined = false;
    /** Latest traversal whose view reached this tile, visible or not. */
    viewedIn = -1;
    /** The pass that wanted this tile loaded. */
    wantedBy = 0 /* Pass.View */;
    /** Latest traversal that found this tile outside the view. */
    culledIn = -1;
    drawnIn = -1;
    /** Still drawn, fading out under the tiles that replaced it. */
    leaving = false;
    retryAt = 0;
    failures = 0;
    abort;
    decoded;
    drawable;
    /** The sea floor beneath this tile, where it has any. */
    floor;
    texture;
    /** Grid heights in metres including the sea floor, for height queries. */
    heights;
    bytes = 0;
    constructor(z, x, y, parent) {
        this.z = z;
        this.x = x;
        this.y = y;
        this.parent = parent;
        this.minHeight = parent?.minHeight ?? 0;
        this.maxHeight = parent?.maxHeight ?? 0;
        this.floorMin = parent?.floorMin ?? 0;
        const north = tileLatitude(y, z), south = tileLatitude(y + 1, z);
        this.widestCos = north > 0 && south < 0 ? 1 : Math.cos(Math.min(Math.abs(north), Math.abs(south)) * DEGREES);
    }
}
function tileLatitude(y, z) {
    return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) / DEGREES;
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
    globe;
    maximumScreenSpaceError;
    memoryBudgetMB;
    cacheSeconds;
    maxConcurrentRequests;
    uploadBudgetMs;
    camera;
    /**
     * Limit detail where something finer covers the ground, e.g. Google's
     * photorealistic tiles within their loading radius: the surface beneath
     * stays coarse instead of downloading imagery nobody sees.
     */
    coverage;
    /** Draw the surface. Streaming pauses while disabled, except for `prefetchCamera`. */
    enabled = true;
    /**
     * Also load what this camera would see, after everything the visible
     * view needs: e.g. the end of a flight, so it arrives already sharp.
     * It is never drawn from.
     */
    prefetchCamera;
    /**
     * How far the view may turn (degrees) or move (fraction of its height)
     * before tiles are selected again; meanwhile the view is drawn widened
     * by the angle. Default 0: every change. For a headset, whose pose
     * changes every frame, a few degrees saves most of the selection work.
     */
    get viewTolerance() { return this.viewChange.tolerance; }
    set viewTolerance(tolerance) { this.viewChange.tolerance = tolerance; }
    viewChange = new ViewChange();
    /**
     * Colour of the sea. Imagery of water differs between levels of detail
     * and sources, so water at sea level is drawn in this colour, reflecting
     * the sky toward the horizon, instead.
     */
    waterColor = WATER_COLOR.clone();
    onUpdatedObservable = new Observable();
    /** Raised when refused requests move the surface to its next imagery source. */
    onImageryChangedObservable = new Observable();
    scene;
    sources;
    imagery;
    /** Refusals from the current source since its last success. */
    refusals = 0;
    elevation;
    bathymetry;
    verticalScale;
    workers;
    batch;
    floorBatch;
    uvBuffer;
    indexBuffer;
    indexCount;
    root;
    /** Fills beyond Web Mercator's latitude limit, drawn after the tiles. */
    caps;
    renderObserver;
    elevationTiles = new Map();
    resident = new Set();
    uploads = [];
    rendered = [];
    traversedAt = 0;
    motion = new MotionTracker();
    sweptAt = 0;
    /** Tiles replaced by others, drawn until those have faded in. */
    leaving = [];
    wanted = [];
    updateId = 0;
    requestsInFlight = 0;
    residentBytes = 0;
    totals = { requests: 0, bytes: 0, failures: 0, shown: 0 };
    lastViewKey = "";
    abandonedAt = 0;
    traversedForContentAt = 0;
    gridTriangles = gridTriangles(GRID);
    contentChanged = true;
    disposed = false;
    // Per-traversal camera state, in world units.
    eye = new Vector3();
    ground = new Vector3();
    planes = [];
    sseFactor = 1;
    horizonDistance = Infinity;
    occluderRadius = 0;
    underwater = false;
    /** Visiting for `prefetchCamera`. */
    pass = 0 /* Pass.View */;
    /** Resident bytes the last traversal visited. */
    neededBytes = 0;
    fogDensity = 0;
    constructor(globe, options) {
        this.globe = globe;
        if (!supportsTileBatch(globe.scene))
            throw new Error("GlobeSurface requires a WebGL engine.");
        this.scene = globe.scene;
        this.sources = Array.isArray(options.imagery) ? [...options.imagery] : [options.imagery];
        if (!this.sources.length)
            throw new RangeError("At least one imagery source is required.");
        this.imagery = { tileSize: 256, ...this.sources[0] };
        this.elevation = options.elevation === undefined ? TERRARIUM_ELEVATION : options.elevation;
        this.bathymetry = options.bathymetry ?? true;
        this.verticalScale = options.verticalScale ?? 1;
        this.maximumScreenSpaceError = options.maximumScreenSpaceError ?? 1.25;
        this.memoryBudgetMB = options.memoryBudgetMB ?? Infinity;
        this.cacheSeconds = options.cacheSeconds ?? 300;
        this.maxConcurrentRequests = options.maxConcurrentRequests ?? 24;
        this.uploadBudgetMs = options.uploadBudgetMs ?? 3;
        this.camera = options.camera;
        this.coverage = options.coverage;
        if (!(this.maximumScreenSpaceError > 0))
            throw new RangeError("maximumScreenSpaceError must be positive.");
        const engine = this.scene.getEngine();
        this.workers = TileWorkerPool.shared(options.compressTextures !== false && supportsBC1(engine));
        this.batch = new TileBatch("globe surface", this.scene, globeWaterShader(this.globe, () => this.scene.activeCamera, this.waterColor));
        const up = new Vector3(), east = new Vector3(), sun = new Vector3();
        this.floorBatch = new TileBatch("globe sea floor", this.scene, {
            name: FLOOR, attributes: ["height", "normal", "detail"], uniforms: ["up", "sun", "time", "unitMetres"],
            bind: effect => {
                const camera = this.camera ?? this.scene.activeCamera;
                if (!camera)
                    return;
                camera.globalPosition.normalizeToRef(up);
                // A high afternoon sun from the south-east of wherever the camera is.
                Vector3.CrossToRef(up, Vector3.UpReadOnly, east).normalize();
                sun.copyFrom(up).addInPlace(east.scale(0.6)).addInPlace(Vector3.Cross(east, up).scaleInPlace(-0.35)).normalize();
                effect.setVector3("up", up);
                effect.setVector3("sun", sun);
                effect.setFloat("time", performance.now() / 1000 % 3600);
                effect.setFloat("unitMetres", 1 / this.globe.metresToWorld);
            },
        });
        const { uvs, indices } = gridTopology();
        this.uvBuffer = new VertexBuffer(engine, uvs, VertexBuffer.UVKind, false, false, 2);
        this.indexBuffer = engine.createIndexBuffer(indices);
        this.indexCount = indices.length;
        this.root = new SurfaceNode(0, 0, 0);
        this.root.maxHeight = this.elevation ? 8848 : 0;
        if (this.elevation && this.bathymetry)
            this.root.floorMin = -11000;
        this.bound(this.root);
        this.caps = [this.createCap(true), this.createCap(false)];
        this.renderObserver = this.scene.onBeforeRenderObservable.add(() => this.update());
        engine.onContextRestoredObservable.add(() => {
            for (const node of [...this.resident])
                this.unload(node);
            this.contentChanged = true;
        });
    }
    /** The mesh that draws the surface, for rendering groups and layers. */
    get mesh() {
        return this.batch;
    }
    /** Draw beneath finer map layers; see MapLayerRenderer. */
    addToLayers(renderer, level) {
        renderer.add(this.batch, level);
        renderer.add(this.floorBatch, level);
    }
    /** Credits for the imagery and terrain in use. */
    get attribution() {
        const credits = [this.imagery.attribution, this.elevation?.attribution && `Terrain: ${this.elevation.attribution}`].filter(Boolean);
        return credits.length ? credits.join(" · ") : undefined;
    }
    /** The imagery source in use. */
    get currentImagery() {
        return this.sources.find(source => source.url === this.imagery.url);
    }
    get stats() {
        return {
            rendered: this.rendered.length,
            resident: this.resident.size,
            residentBytes: this.residentBytes,
            pending: this.wanted.length,
            requestsInFlight: this.requestsInFlight,
            totalRequests: this.totals.requests,
            totalDownloadedBytes: this.totals.bytes,
            failedRequests: this.totals.failures,
            totalShown: this.totals.shown,
        };
    }
    /** True once everything the current view needs is drawn. */
    get isIdle() {
        return this.updateId > 0 && !this.wanted.length && !this.uploads.length;
    }
    /** Resolve once the current view has finished loading. */
    whenIdle() {
        if (this.isIdle)
            return Promise.resolve();
        return new Promise(resolve => {
            const observer = this.onUpdatedObservable.add(() => {
                if (!this.isIdle)
                    return;
                this.onUpdatedObservable.remove(observer);
                resolve();
            });
        });
    }
    /**
     * Height of the ground or sea floor in metres above sea level, from the finest
     * tile resident at that location, or undefined where none is.
     */
    getHeight(latitude, longitude) {
        if (Math.abs(latitude) > MAX_LATITUDE)
            return undefined;
        const fx = ((longitude + 180) / 360) % 1, sin = Math.sin(latitude * DEGREES);
        const fy = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
        let node = this.root, found;
        while (node) {
            if (node.heights)
                found = node;
            const n = 2 ** (node.z + 1);
            const cx = Math.min(n - 1, Math.floor((fx < 0 ? fx + 1 : fx) * n)), cy = Math.min(n - 1, Math.floor(fy * n));
            node = node.children?.[(cy - node.y * 2) * 2 + (cx - node.x * 2)];
        }
        if (!found)
            return undefined;
        const n = 2 ** found.z;
        const u = Math.min(GRID, Math.max(0, ((fx < 0 ? fx + 1 : fx) * n - found.x) * GRID));
        const v = Math.min(GRID, Math.max(0, (fy * n - found.y) * GRID));
        return bilinear(found.heights, GRID + 1, u, v);
    }
    /** Nearest intersection of a world-space ray with the drawn surface, in world units. */
    intersectRay(ray) {
        let nearest;
        const local = ray.origin.clone();
        for (const node of this.rendered) {
            if (!ray.intersectsSphere({ center: node.center, radius: node.radius }))
                continue;
            node.center.scaleToRef(-1, local).addInPlace(ray.origin);
            const originalOrigin = ray.origin;
            ray.origin = local;
            const hit = RayMesh.for(node.drawable.localPositions, this.gridTriangles).intersect(ray);
            if (hit !== undefined && (nearest === undefined || hit < nearest))
                nearest = hit;
            ray.origin = originalOrigin;
        }
        return nearest;
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.scene.onBeforeRenderObservable.remove(this.renderObserver);
        for (const node of [...this.resident])
            this.unload(node);
        for (const node of this.loadingNodes())
            node.abort?.abort();
        const engine = this.scene.getEngine();
        this.uvBuffer.dispose();
        engine._releaseBuffer(this.indexBuffer);
        for (const cap of this.caps) {
            TileBatch.release(engine, cap.drawable);
            cap.texture.dispose();
        }
        this.batch.dispose(false, true);
        this.floorBatch.dispose(false, true);
        this.onUpdatedObservable.clear();
        this.onImageryChangedObservable.clear();
    }
    update() {
        if (this.disposed)
            return;
        const camera = this.camera ?? this.scene.activeCamera;
        if (!camera)
            return;
        const ahead = this.prefetchCamera !== camera ? this.prefetchCamera : undefined;
        const position = camera.globalPosition;
        this.motion.update(position, Math.abs(position.length() - this.globe.radius));
        if (!this.enabled && this.rendered.length)
            this.show([]);
        if (!this.enabled && !ahead)
            return;
        this.uploadDecoded();
        const engine = this.scene.getEngine();
        const viewKey = `${this.enabled}/${this.viewChange.update(camera, Math.abs(position.length() - this.globe.radius))}/${this.viewChange.projection(camera)}`
            + `/${ahead?.uniqueId}/${ahead?.getViewMatrix().updateFlag}/${engine.getRenderWidth()}x${engine.getRenderHeight()}`
            + `/${this.maximumScreenSpaceError}/${this.coverage?.radius}/${this.coverage?.maxZoom}`;
        // A new view at once; new content (tiles arriving every frame while
        // loading) at most ten times a second.
        const now = performance.now();
        if (viewKey !== this.lastViewKey || this.contentChanged && now - this.traversedForContentAt > CONTENT_TRAVERSAL_MS) {
            this.lastViewKey = viewKey;
            this.contentChanged = false;
            this.traversedForContentAt = now;
            this.traverse(this.enabled ? camera : undefined, ahead);
        }
        else if (this.leaving.some(node => performance.now() - (node.drawable?.fadeStart ?? -Infinity) >= this.batch.fadeDuration)) {
            // Retire tiles whose fade has finished.
            this.show(this.rendered);
        }
        this.schedule();
        this.evict();
    }
    traverse(camera, ahead) {
        this.updateId++;
        this.traversedAt = performance.now();
        const render = [];
        this.wanted = [];
        if (camera) {
            this.prepare(camera);
            this.visit(this.root, render);
            this.show(render);
            // Load, without drawing, what lies just beyond the edges of the view.
            this.planes = Frustum.GetPlanes(widenedViewProjection(camera, VIEW_MARGIN * (1 + 2 * this.viewChange.widening * Math.PI / 180 / camera.fov)));
            this.pass = 1 /* Pass.Margin */;
            this.visit(this.root, []);
            this.pass = 0 /* Pass.View */;
        }
        if (ahead) {
            // Wanted after the visible view; drawn nowhere. The scene's fog
            // belongs to the visible view, so none limits the prefetch.
            this.prepare(ahead);
            this.fogDensity = 0;
            this.pass = 2 /* Pass.Prefetch */;
            this.visit(this.root, []);
            this.pass = 0 /* Pass.View */;
        }
        // What this traversal needs; everything else resident may be evicted.
        this.neededBytes = 0;
        for (const node of this.resident)
            if (node.lastVisit === this.updateId)
                this.neededBytes += node.bytes;
        this.onUpdatedObservable.notifyObservers(this);
    }
    /** Per-traversal state for `camera`. */
    prepare(camera) {
        const engine = this.scene.getEngine();
        const radius = this.globe.radius;
        this.eye.copyFrom(camera.globalPosition);
        const dc = this.eye.length();
        this.underwater = dc < radius;
        const scene = this.scene;
        this.fogDensity = scene.fogEnabled && scene.fogMode === Scene.FOGMODE_EXP2 ? scene.fogDensity : 0;
        this.eye.scaleToRef(radius / dc, this.ground);
        this.sseFactor = engine.getRenderHeight() / (2 * Math.tan(camera.fov / 2));
        // The sea surface hides everything below it, except from beneath.
        this.occluderRadius = radius * (1 - 1e-7);
        this.horizonDistance = dc > this.occluderRadius ? Math.sqrt(dc * dc - this.occluderRadius ** 2) : Infinity;
        this.planes = Frustum.GetPlanes(selectionViewProjection(camera, this.viewChange.widening));
    }
    /**
     * Select what to draw beneath `node`. Returns true when the node's area is
     * fully drawable (or invisible), so its parent may be replaced.
     */
    visit(node, render) {
        // The visible view's distance and priority win over a prefetch's.
        const seen = this.pass !== 0 /* Pass.View */ && node.lastVisit === this.updateId;
        node.lastVisit = this.updateId;
        node.seenAt = this.traversedAt;
        const sticky = node.refined && node.viewedIn >= this.updateId - 1;
        if (this.pass === 0 /* Pass.View */)
            node.viewedIn = this.updateId;
        const radius = this.underwater ? node.floorRadius : node.radius;
        const distance = Math.max(this.globe.metresToWorld, Vector3.Distance(node.center, this.eye) - radius);
        if (!seen)
            node.distance = distance;
        if (!this.isVisible(node, radius, distance)) {
            node.culledIn = this.updateId;
            return true;
        }
        // Lost in the fog: exp(-(density * distance)^2) is below 0.01%.
        if (distance * this.fogDensity > 3)
            return true;
        const texel = 2 * Math.PI * this.globe.radius * node.widestCos / (2 ** node.z * this.imagery.tileSize);
        // The blurriest first: how far this tile's texels, and so roughly its
        // drawn parent's, exceed the target on screen (lower loads sooner).
        if (!seen)
            node.priority = Math.log2(this.maximumScreenSpaceError * distance / (texel * this.sseFactor)) + PASS_PRIORITY[this.pass];
        const hysteresis = this.band(node, sticky);
        const error = texel * this.sseFactor / distance;
        let finest = node.z >= this.imagery.maxZoom;
        // The sea floor has no imagery: refine only as far as its elevation has detail.
        if (this.underwater && node.z >= Math.min(UNDERWATER_MAX_ZOOM, (this.elevation?.maxZoom ?? 0) + 3))
            finest = true;
        if (!finest && this.coverage && node.z >= this.coverage.maxZoom
            && Vector3.Distance(node.center, this.ground) + node.radius < this.coverage.radius * this.globe.metresToWorld)
            finest = true;
        const refine = !finest && (node.z < BASE_ZOOM || error > this.maximumScreenSpaceError * hysteresis);
        if (this.pass === 0 /* Pass.View */)
            node.refined = refine;
        // Held in the dead band, a drawn tile stays while its children load:
        // once they are all here the band closes and they replace it, rather
        // than the coarse tile staying until the view changes.
        if (!refine && !finest && this.pass === 0 /* Pass.View */ && error > this.maximumScreenSpaceError) {
            node.children ??= this.split(node);
            for (const child of node.children) {
                if (child.state !== 0 /* State.None */ || child.wantedIn === this.updateId)
                    continue;
                child.priority = node.priority + PASS_PRIORITY[1 /* Pass.Margin */];
                this.want(child, 1 /* Pass.Margin */);
            }
        }
        if (refine) {
            node.children ??= this.split(node);
            const start = render.length;
            let covered = true;
            for (const child of node.children) {
                // A child the provider cannot serve leaves this level as the finest.
                if (child.state === 4 /* State.Failed */ && child.retryAt === Infinity) {
                    covered = false;
                    break;
                }
                covered = this.visit(child, render) && covered;
            }
            // Load the siblings just out of view too, so turning toward them
            // does not drop the whole parent to its coarse level meanwhile.
            if (this.pass === 0 /* Pass.View */)
                for (const child of node.children) {
                    if (child.culledIn !== this.updateId || child.state !== 0 /* State.None */ || child.wantedIn === this.updateId)
                        continue;
                    child.priority = node.priority + PASS_PRIORITY[1 /* Pass.Margin */];
                    this.want(child, 1 /* Pass.Margin */);
                }
            if (covered)
                return true;
            this.want(node);
            if (node.state !== 3 /* State.Ready */)
                return this.keepDrawn(node, render);
            render.length = start;
            this.draw(node, render);
            return true;
        }
        this.want(node);
        if (node.state !== 3 /* State.Ready */)
            return this.keepDrawn(node, render);
        this.draw(node, render);
        return true;
    }
    /**
     * Keep drawing the tiles that showed `node`'s area last time while its
     * replacement loads, rather than falling back to a coarser ancestor.
     * False when nothing beneath it was drawn: an ancestor covered it then.
     */
    /** The dead band: what multiple of the target error `node` must exceed to refine. */
    band(node, sticky) {
        if (sticky)
            return COARSEN_REFINED;
        if (node.drawnIn !== this.updateId - 1)
            return 1;
        // With the finer tiles already here, holding the coarse one only
        // leaves a blurred patch among sharp neighbours.
        const ready = !!node.children?.length && node.children.every(child => child.state === 3 /* State.Ready */);
        return ready ? 1 : REFINE_DRAWN;
    }
    keepDrawn(node, render) {
        if (this.pass !== 0 /* Pass.View */)
            return false;
        const start = render.length;
        const stack = [...node.children ?? []];
        while (stack.length) {
            const n = stack.pop();
            if (n.lastVisit < this.updateId - 1)
                continue;
            if (n.drawnIn === this.updateId - 1 && !n.leaving && n.state === 3 /* State.Ready */) {
                if (n.lastUsed !== this.updateId)
                    this.draw(n, render);
            }
            else if (n.children)
                stack.push(...n.children);
        }
        return render.length > start;
    }
    isVisible(node, radius, distance) {
        for (const plane of this.planes)
            if (plane.dotCoordinate(node.center) < -radius)
                return false;
        // Behind the horizon of the sea-level sphere.
        const top = node.center.length() + radius;
        return distance <= this.horizonDistance + Math.sqrt(Math.max(0, top * top - this.occluderRadius ** 2));
    }
    want(node, pass = this.pass) {
        if (node.wantedIn === this.updateId)
            return;
        node.wantedIn = this.updateId;
        node.wantedBy = pass;
        if (node.state !== 3 /* State.Ready */ && !(node.state === 4 /* State.Failed */ && node.retryAt === Infinity))
            this.wanted.push(node);
    }
    draw(node, render) {
        node.lastUsed = this.updateId;
        render.push(node);
    }
    /**
     * Show `render`. Tiles that change level cross-fade with the ones they
     * replace; tiles merely entering or leaving the view appear and vanish at once.
     */
    show(render) {
        const stamp = this.updateId, now = performance.now();
        const fades = this.batch.fadeDuration > 0 && !this.underwater && this.motion.slow;
        const shown = new Set(this.rendered);
        for (const node of render) {
            const drawable = node.drawable;
            if (node.leaving) {
                node.leaving = false;
                drawable.fadeStart = undefined;
                drawable.fadeOut = false;
            }
            else if (!shown.has(node)) {
                this.totals.shown++;
                drawable.fadeStart = fades && node.culledIn !== stamp - 1 ? now : undefined;
                drawable.fadeOut = false;
            }
            node.drawnIn = stamp;
        }
        if (fades)
            for (const node of this.rendered) {
                if (node.drawnIn === stamp || node.leaving || !node.drawable || node.culledIn === stamp)
                    continue;
                // Kept (and safe from eviction) until its replacement has faded in.
                node.leaving = true;
                node.drawable.fadeStart = now;
                node.drawable.fadeOut = true;
                this.leaving.push(node);
            }
        this.leaving = this.leaving.filter(node => {
            const keep = node.leaving && !!node.drawable && now - node.drawable.fadeStart < this.batch.fadeDuration && node.culledIn !== stamp;
            if (keep)
                node.drawnIn = stamp;
            else
                node.leaving = false;
            return keep;
        });
        this.rendered = render;
        // Nearest first, so early depth testing rejects most hidden fragments.
        // From beneath the sea, land above it lies outside Snell's window:
        // the surface mirrors the water instead, so only the floor is drawn.
        this.batch.items = this.underwater ? []
            : [...render, ...this.leaving].sort((a, b) => a.distance - b.distance).map(node => node.drawable);
        if (!this.underwater)
            for (const cap of this.caps)
                this.batch.items.push(cap.drawable);
        // The sea surface faces up, so from beneath it the floor shows through.
        this.floorBatch.items = this.underwater
            ? [...render].sort((a, b) => a.distance - b.distance).flatMap(node => node.floor ? [node.floor] : []) : [];
    }
    /**
     * A flat disc of polar ice beyond the Mercator limit, at the height of
     * the surrounding land: sea level in the Arctic, the plateau in Antarctica.
     */
    createCap(north) {
        const engine = this.scene.getEngine();
        const segments = 128;
        const height = north || !this.elevation ? 0 : 2800;
        const sign = north ? 1 : -1;
        const r = this.globe.radius + height * this.verticalScale * this.globe.metresToWorld;
        const pole = new Vector3(0, sign * r, 0);
        const positions = new Float32Array((segments + 2) * 3);
        const latitude = sign * MAX_LATITUDE * DEGREES;
        for (let k = 0; k <= segments; k++) {
            const longitude = (k / segments * 360 - 180) * DEGREES;
            const horizontal = r * Math.cos(latitude);
            positions.set([-horizontal * Math.sin(longitude), r * Math.sin(latitude) - pole.y, horizontal * Math.cos(longitude)], k * 3);
        }
        const indices = [];
        const center = segments + 1;
        // Front faces point away from the globe; see gridTopology.
        for (let k = 0; k < segments; k++)
            indices.push(...(north ? [center, k, k + 1] : [k, center, k + 1]));
        const uvs = new Float32Array((segments + 2) * 2).fill(0.5);
        const color = north ? [178, 190, 204, 255] : [226, 232, 240, 255];
        const internal = engine.createRawTexture(new Uint8Array(color), 1, 1, Constants.TEXTUREFORMAT_RGBA, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE);
        const texture = new BaseTexture(engine, internal);
        return {
            texture,
            drawable: {
                positions: new VertexBuffer(engine, positions, VertexBuffer.PositionKind, false, false, 3),
                uvs: new VertexBuffer(engine, uvs, VertexBuffer.UVKind, false, false, 2),
                indexBuffer: engine.createIndexBuffer(new Uint16Array(indices)),
                indexCount: indices.length,
                texture,
                world: Matrix.Translation(pole.x, pole.y, pole.z),
            },
        };
    }
    split(node) {
        const children = [];
        for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++) {
                const child = new SurfaceNode(node.z + 1, node.x * 2 + dx, node.y * 2 + dy, node);
                this.bound(child);
                children.push(child);
            }
        return children;
    }
    /** Bounding sphere from a coarse sample of the tile at its height extremes. */
    bound(node) {
        const center = this.position(node, 0.5, 0.5, (node.minHeight + node.maxHeight) / 2);
        node.center.copyFrom(center);
        let radius = 0, floorRadius = 0;
        for (let j = 0; j <= 4; j++)
            for (let i = 0; i <= 4; i++) {
                for (const height of [node.minHeight, node.maxHeight])
                    radius = Math.max(radius, Vector3.Distance(this.position(node, i / 4, j / 4, height), center));
                floorRadius = Math.max(floorRadius, Vector3.Distance(this.position(node, i / 4, j / 4, node.floorMin), center));
            }
        node.radius = radius;
        node.floorRadius = Math.max(radius, floorRadius);
    }
    /** World position at fraction (u, v) of a tile, `height` metres above sea level. */
    position(node, u, v, height, result = new Vector3()) {
        const n = 2 ** node.z;
        const longitude = ((node.x + u) / n * 360 - 180) * DEGREES;
        const latitude = tileLatitude(node.y + v, node.z) * DEGREES;
        const r = this.globe.radius + height * this.verticalScale * this.globe.metresToWorld;
        const horizontal = r * Math.cos(latitude);
        return result.set(-horizontal * Math.sin(longitude), r * Math.sin(latitude), horizontal * Math.cos(longitude));
    }
    /** Start the most important wanted requests that fit the concurrency limit. */
    schedule() {
        if (this.requestsInFlight >= this.maxConcurrentRequests || this.uploads.length >= 64 || !this.wanted.length)
            return;
        const now = performance.now();
        // Tiles the view does not draw may displace stale tiles, but never
        // what this traversal needs: past that each load would evict another
        // wanted tile, which would be loaded again, forever.
        const budget = this.memoryBudgetMB * 1024 * 1024;
        const allowed = [true, this.neededBytes < budget * MARGIN_BUDGET, this.neededBytes < budget * PREFETCH_BUDGET];
        const candidates = this.wanted.filter(node => (node.state === 0 /* State.None */ || node.state === 4 /* State.Failed */ && node.retryAt <= now)
            && allowed[node.wantedBy]);
        candidates.sort((a, b) => a.priority - b.priority);
        for (const node of candidates) {
            if (this.requestsInFlight >= this.maxConcurrentRequests)
                break;
            void this.load(node);
        }
        // Abandon downloads the camera has moved away from, once a second.
        if (now - this.abandonedAt > 1000) {
            this.abandonedAt = now;
            for (const node of this.loadingNodes())
                if (node.lastVisit < this.updateId - 60)
                    node.abort?.abort();
        }
    }
    /** Loading tiles, among the recently visited: what the camera left long ago has nothing loading. */
    *loadingNodes() {
        const stack = [this.root];
        while (stack.length) {
            const node = stack.pop();
            if (node.state === 1 /* State.Loading */)
                yield node;
            if (node.children && node.lastVisit >= this.updateId - 120)
                stack.push(...node.children);
        }
    }
    async load(node) {
        node.state = 1 /* State.Loading */;
        const abort = node.abort = new AbortController();
        this.requestsInFlight++;
        this.totals.requests++;
        const source = this.imagery;
        try {
            const [imagery, heights] = await Promise.all([
                this.workers.loadImage(source.url(node.x, node.y, node.z), abort.signal),
                this.heightsFor(node),
            ]);
            if ("status" in imagery) {
                node.state = 4 /* State.Failed */;
                this.totals.failures++;
                node.failures++;
                if (source === this.imagery && REFUSED_STATUS.has(imagery.status) && ++this.refusals >= REFUSALS_TO_SWITCH)
                    this.nextImagery();
                // Back off: a struggling server should not be asked again at once.
                node.retryAt = source !== this.imagery ? 0
                    : TRANSIENT_STATUS.has(imagery.status) ? performance.now() + Math.min(60_000, 1000 * 2 ** node.failures) : Infinity;
                this.contentChanged = true;
                return;
            }
            if (source === this.imagery)
                this.refusals = 0;
            node.failures = 0;
            this.totals.bytes += imagery.byteLength;
            if (this.disposed) {
                imagery.image.bitmap?.close();
                return;
            }
            node.decoded = { image: imagery.image, heights };
            node.state = 2 /* State.Decoded */;
            this.uploads.push(node);
        }
        catch (error) {
            node.state = 0 /* State.None */;
            if (!abort.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
                node.state = 4 /* State.Failed */;
                node.failures++;
                node.retryAt = performance.now() + Math.min(60_000, 2000 * 2 ** node.failures);
                this.totals.failures++;
            }
        }
        finally {
            node.abort = undefined;
            this.requestsInFlight--;
        }
    }
    /** Move to the next imagery source; tiles that failed retry from it at once. */
    nextImagery() {
        const index = this.sources.indexOf(this.currentImagery);
        if (index + 1 >= this.sources.length)
            return;
        this.imagery = { tileSize: 256, ...this.sources[index + 1] };
        this.refusals = 0;
        const stack = [this.root];
        while (stack.length) {
            const node = stack.pop();
            if (node.state === 4 /* State.Failed */) {
                node.retryAt = 0;
                node.failures = 0;
            }
            // Requests still queued for the old source would only be refused too.
            node.abort?.abort();
            if (node.children)
                stack.push(...node.children);
        }
        this.onImageryChangedObservable.notifyObservers(this.sources[index + 1]);
    }
    /**
     * Grid heights for a tile, sampled from the elevation tile three levels
     * up (32 samples per tile). Terrarium's finer levels hold land models that
     * flatten many coastal waters to exactly zero; there the sea floor comes
     * from the coarser global bathymetry instead.
     */
    async heightsFor(node) {
        const heights = new Float32Array((GRID + 1) * (GRID + 1));
        if (!this.elevation)
            return heights;
        const z = Math.max(0, Math.min(this.elevation.maxZoom, node.z - 3));
        const [tile, sea] = await Promise.all([
            this.elevationTile(node, z),
            this.bathymetry && z > SEA_FLOOR_ZOOM && (this.elevation.format ?? "terrarium") === "terrarium"
                ? this.elevationTile(node, SEA_FLOOR_ZOOM) : undefined,
        ]);
        if (!tile)
            return heights;
        for (let j = 0, i = 0; j <= GRID; j++)
            for (let k = 0; k <= GRID; k++, i++) {
                let h = tile.sample(k / GRID, j / GRID);
                if (h === 0 && sea)
                    h = Math.min(0, sea.sample(k / GRID, j / GRID));
                heights[i] = this.bathymetry ? h : Math.max(0, h);
            }
        return heights;
    }
    /** The elevation tile at zoom `z` covering a node, with a sampler in the node's (u, v). */
    async elevationTile(node, z) {
        const scale = 2 ** (node.z - z);
        const x = Math.floor(node.x / scale), y = Math.floor(node.y / scale);
        const key = `${z}/${x}/${y}`;
        let entry = this.elevationTiles.get(key);
        if (!entry) {
            const promise = this.workers.loadHeights(this.elevation.url(x, y, z), undefined, this.elevation.format).then(load => "status" in load ? undefined : load, () => undefined);
            entry = { promise, used: 0 };
            this.elevationTiles.set(key, entry);
            if (this.elevationTiles.size > ELEVATION_CACHE) {
                const oldest = [...this.elevationTiles].sort((a, b) => a[1].used - b[1].used)[0][0];
                this.elevationTiles.delete(oldest);
            }
        }
        entry.used = performance.now();
        const tile = await entry.promise;
        if (!tile) {
            // Without data (e.g. a failed request), the next tile retries.
            if (this.elevationTiles.get(key) === entry)
                this.elevationTiles.delete(key);
            return undefined;
        }
        const { size, heights, corners } = tile;
        // Terrarium pixels are areas, their centres half a pixel in; LERC
        // samples sit on the corners, edges shared with the next tile.
        const cells = corners ? size - 1 : size, inset = corners ? 0 : 0.5;
        const u0 = (node.x - x * scale) / scale * cells - inset, v0 = (node.y - y * scale) / scale * cells - inset, span = cells / scale;
        return {
            sample: (u, v) => bilinear(heights, size, Math.min(size - 1, Math.max(0, u0 + u * span)), Math.min(size - 1, Math.max(0, v0 + v * span))),
        };
    }
    /** Create GPU resources for decoded tiles, within the frame's upload budget. */
    uploadDecoded() {
        if (!this.uploads.length)
            return;
        const start = performance.now();
        const engine = this.scene.getEngine();
        // Nearest first: the tiles most likely to be on screen.
        this.uploads.sort((a, b) => a.priority - b.priority);
        while (this.uploads.length && performance.now() - start < this.uploadBudgetMs) {
            const node = this.uploads.shift();
            const decoded = node.decoded;
            node.decoded = undefined;
            if (node.lastVisit < this.updateId - 120) {
                // No longer needed: drop the decoded data unuploaded.
                decoded.image.bitmap?.close();
                node.state = 0 /* State.None */;
                continue;
            }
            const { texture, byteLength } = createDecodedTexture(decoded.image, engine, `globe surface ${node.z}/${node.x}/${node.y}`);
            const positions = this.buildPositions(node, decoded.heights, true);
            node.texture = texture;
            node.heights = decoded.heights;
            node.drawable = {
                positions: new VertexBuffer(engine, positions, VertexBuffer.PositionKind, false, false, 3),
                uvs: this.uvBuffer,
                indexBuffer: this.indexBuffer,
                indexCount: this.indexCount,
                texture,
                world: Matrix.Translation(node.center.x, node.center.y, node.center.z),
                localPositions: positions,
            };
            node.bytes = byteLength + positions.byteLength + decoded.heights.byteLength;
            if (decoded.heights.some(h => h < -0.5)) {
                const floor = this.buildPositions(node, decoded.heights, false);
                const heights = new Float32Array(VERTICES);
                heights.set(decoded.heights);
                // Skirts take the colour of the edge they hang from.
                let at = decoded.heights.length;
                for (const index of edgeIndices())
                    heights[at++] = decoded.heights[index];
                const normals = gridNormals(floor);
                const detail = detailCoordinates(node);
                node.floor = {
                    positions: new VertexBuffer(engine, floor, VertexBuffer.PositionKind, false, false, 3),
                    attributes: {
                        height: new VertexBuffer(engine, heights, "height", false, false, 1),
                        normal: new VertexBuffer(engine, normals, VertexBuffer.NormalKind, false, false, 3),
                        detail: new VertexBuffer(engine, detail, "detail", false, false, 2),
                    },
                    indexBuffer: this.indexBuffer,
                    indexCount: this.indexCount,
                    world: node.drawable.world,
                };
                node.bytes += floor.byteLength + heights.byteLength + normals.byteLength + detail.byteLength;
            }
            this.residentBytes += node.bytes;
            this.resident.add(node);
            node.state = 3 /* State.Ready */;
            this.contentChanged = true;
        }
    }
    /**
     * Grid vertices relative to the tile's centre, followed by a skirt that
     * hangs from each edge to hide cracks between tiles of different levels.
     * Fixes the node's exact bounds and height range.
     */
    buildPositions(node, raw, seaSurface) {
        const heights = seaSurface ? raw.map(h => Math.max(0, h)) : raw;
        let min = Infinity, max = -Infinity;
        for (const h of heights) {
            if (h < min)
                min = h;
            if (h > max)
                max = h;
        }
        if (seaSurface) {
            node.floorMin = Math.min(...raw);
            node.minHeight = min;
            node.maxHeight = max;
            this.position(node, 0.5, 0.5, (min + max) / 2, node.center);
        }
        const center = node.center;
        const positions = new Float32Array(VERTICES * 3);
        const point = new Vector3();
        let radius = 0, at = 0;
        const put = (u, v, height) => {
            this.position(node, u, v, height, point).subtractInPlace(center);
            positions[at++] = point.x;
            positions[at++] = point.y;
            positions[at++] = point.z;
            radius = Math.max(radius, point.length());
        };
        for (let j = 0; j <= GRID; j++)
            for (let i = 0; i <= GRID; i++)
                put(i / GRID, j / GRID, heights[j * (GRID + 1) + i]);
        // Deep enough to cover a coarser neighbour's interpolation error.
        const tileMetres = 2 * Math.PI * EARTH_RADIUS * node.widestCos / 2 ** node.z;
        const skirt = Math.max(2, Math.min(5000, tileMetres / GRID + (max - min) / 8));
        for (const [i0, j0, di, dj] of [[0, 0, 1, 0], [GRID, 0, 0, 1], [GRID, GRID, -1, 0], [0, GRID, 0, -1]])
            for (let k = 0; k <= GRID; k++) {
                const i = i0 + di * k, j = j0 + dj * k;
                const h = heights[j * (GRID + 1) + i];
                // The sea surface's skirts stop at sea level rather than hang into the water.
                put(i / GRID, j / GRID, seaSurface && this.bathymetry ? Math.max(Math.min(h, 0), h - skirt) : h - skirt);
            }
        if (seaSurface)
            node.radius = node.floorRadius = radius;
        else
            node.floorRadius = Math.max(node.radius, radius);
        return positions;
    }
    unload(node) {
        if (node.state !== 3 /* State.Ready */)
            return;
        const engine = this.scene.getEngine();
        TileBatch.release(engine, node.drawable, true);
        if (node.floor)
            TileBatch.release(engine, node.floor, true);
        node.texture.dispose();
        node.drawable = node.floor = node.texture = node.heights = undefined;
        node.state = 0 /* State.None */;
        this.resident.delete(node);
        this.residentBytes -= node.bytes;
        node.bytes = 0;
    }
    /**
     * Evict tiles until the cache fits the memory budget, least recently drawn
     * first. Drawn tiles and the always-resident base levels are kept.
     */
    evict() {
        const now = performance.now();
        if (now - this.sweptAt > 1000) {
            // Release what nothing has needed for a while, whatever the budget.
            this.sweptAt = now;
            for (const node of this.resident)
                if (node.drawnIn !== this.updateId && node.lastVisit !== this.updateId && node.z > BASE_ZOOM
                    && now - node.seenAt > this.cacheSeconds * 1000)
                    this.unload(node);
        }
        const budget = this.memoryBudgetMB * 1024 * 1024;
        if (this.residentBytes <= budget)
            return;
        const candidates = [...this.resident].filter(node => node.drawnIn !== this.updateId && node.z > BASE_ZOOM)
            .sort((a, b) => Number(a.lastVisit === this.updateId) - Number(b.lastVisit === this.updateId) || a.lastUsed - b.lastUsed);
        for (const node of candidates) {
            if (this.residentBytes <= budget * 0.9)
                break;
            this.unload(node);
        }
    }
}
/**
 * Per-vertex ground coordinates for procedural detail: Web Mercator metres,
 * less a whole number of DETAIL_PERIODs chosen per tile so float32 keeps
 * centimetres. Patterns that repeat every DETAIL_PERIOD therefore match
 * across tile edges and stay fixed to the ground.
 */
function detailCoordinates(node) {
    const detail = new Float32Array(VERTICES * 2);
    const scale = MERCATOR_METRES / 2 ** node.z;
    const baseX = Math.floor(node.x * scale / DETAIL_PERIOD) * DETAIL_PERIOD;
    const baseY = Math.floor(node.y * scale / DETAIL_PERIOD) * DETAIL_PERIOD;
    let at = 0;
    const put = (i, j) => {
        detail[at++] = (node.x + i / GRID) * scale - baseX;
        detail[at++] = (node.y + j / GRID) * scale - baseY;
    };
    for (let j = 0; j <= GRID; j++)
        for (let i = 0; i <= GRID; i++)
            put(i, j);
    for (const index of edgeIndices())
        put(index % (GRID + 1), Math.floor(index / (GRID + 1)));
    return detail;
}
/** Grid indices along the four edges, in skirt order. */
function edgeIndices() {
    const edges = [];
    for (const [i0, j0, di, dj] of [[0, 0, 1, 0], [GRID, 0, 0, 1], [GRID, GRID, -1, 0], [0, GRID, 0, -1]])
        for (let k = 0; k <= GRID; k++)
            edges.push((j0 + dj * k) * (GRID + 1) + i0 + di * k);
    return edges;
}
/** Smooth vertex normals from central differences across the grid; skirts copy their edge. */
function gridNormals(positions) {
    const normals = new Float32Array(VERTICES * 3);
    const p = (i, j, out) => out.fromArray(positions, (Math.min(GRID, Math.max(0, j)) * (GRID + 1) + Math.min(GRID, Math.max(0, i))) * 3);
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), d = new Vector3(), n = new Vector3();
    for (let j = 0; j <= GRID; j++)
        for (let i = 0; i <= GRID; i++) {
            p(i + 1, j, a).subtractInPlace(p(i - 1, j, b));
            p(i, j + 1, c).subtractInPlace(p(i, j - 1, d));
            // East x south points up in Babylon's left-handed frame.
            Vector3.CrossToRef(a, c, n);
            n.normalize().toArray(normals, (j * (GRID + 1) + i) * 3);
        }
    let at = (GRID + 1) * (GRID + 1) * 3;
    for (const index of edgeIndices()) {
        normals.copyWithin(at, index * 3, index * 3 + 3);
        at += 3;
    }
    return normals;
}
/** Shared texture coordinates and triangles of every tile: the grid, then the skirts. */
function gridTopology() {
    const uvs = new Float32Array(VERTICES * 2);
    let at = 0;
    for (let j = 0; j <= GRID; j++)
        for (let i = 0; i <= GRID; i++) {
            uvs[at++] = i / GRID;
            uvs[at++] = j / GRID;
        }
    const edges = [];
    for (const [i0, j0, di, dj] of [[0, 0, 1, 0], [GRID, 0, 0, 1], [GRID, GRID, -1, 0], [0, GRID, 0, -1]])
        for (let k = 0; k <= GRID; k++) {
            const i = i0 + di * k, j = j0 + dj * k;
            edges.push(j * (GRID + 1) + i);
            uvs[at++] = i / GRID;
            uvs[at++] = j / GRID;
        }
    const indices = [];
    for (let j = 0; j < GRID; j++)
        for (let i = 0; i < GRID; i++) {
            const a = j * (GRID + 1) + i, b = a + 1, c = a + GRID + 1, d = c + 1;
            // Front faces point away from the globe.
            indices.push(a, c, b, b, c, d);
        }
    // Skirts are seen from either side.
    const skirtBase = (GRID + 1) * (GRID + 1);
    for (let k = 0; k < edges.length - 1; k++) {
        if ((k + 1) % (GRID + 1) === 0)
            continue;
        const top0 = edges[k], top1 = edges[k + 1], bottom0 = skirtBase + k, bottom1 = skirtBase + k + 1;
        indices.push(top0, bottom0, top1, top1, bottom0, bottom1, top0, top1, bottom0, top1, bottom1, bottom0);
    }
    return { uvs, indices: new Uint16Array(indices) };
}
function bilinear(grid, size, x, y) {
    const x0 = Math.min(size - 2, Math.floor(x)), y0 = Math.min(size - 2, Math.floor(y));
    const tx = x - x0, ty = y - y0, i = y0 * size + x0;
    return (grid[i] * (1 - tx) + grid[i + 1] * tx) * (1 - ty) + (grid[i + size] * (1 - tx) + grid[i + size + 1] * tx) * ty;
}
//# sourceMappingURL=GlobeSurface.js.map