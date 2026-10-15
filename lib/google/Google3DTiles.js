import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Frustum } from "@babylonjs/core/Maths/math.frustum.js";
import { Ray } from "@babylonjs/core/Culling/ray.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import { Vector2 } from "@babylonjs/core/Maths/math.vector.js";
import { EPSG_Type } from "../core/TileMath.js";
import { createTileDrawables, createGoogleTileMeshes, decodeGoogleTile, glbAttributions, parseGLB, warmGoogleTileDecoder, } from "./GoogleTileContent.js";
import { ecefToGeodetic, geodeticToECEF, GoogleTileFrame, Y_UP_TO_Z_UP } from "./GoogleTileFrame.js";
import { createGoogleTileMaterial } from "./GoogleTileMaterial.js";
import { TileWorkerPool } from "../shared/TileWorkerPool.js";
import { supportsBC1 } from "../shared/TileTextures.js";
import { TileBatch, supportsTileBatch } from "../shared/TileBatch.js";
import { MotionTracker, widenedViewProjection } from "../shared/ViewMargin.js";
import { globeWaterShader, WATER_COLOR } from "../core/GlobeWaterShader.js";
/** Google Maps Platform Map Tiles API Photorealistic 3D Tiles endpoint. */
export const GOOGLE_3D_TILES_ROOT_URL = "https://tile.googleapis.com/v1/3dtiles/root.json";
var State;
(function (State) {
    State[State["None"] = 0] = "None";
    State[State["Queued"] = 1] = "Queued";
    State[State["Loading"] = 2] = "Loading";
    State[State["Decoded"] = 3] = "Decoded";
    State[State["Ready"] = 4] = "Ready";
    State[State["Failed"] = 5] = "Failed";
    State[State["Empty"] = 6] = "Empty";
})(State || (State = {}));
function makeBox(center, axes) {
    const lengths = axes.map(axis => axis.length());
    const units = axes.map((axis, i) => lengths[i] > 0 ? axis.scale(1 / lengths[i]) : Vector3.Zero());
    return { center, axes, units, lengths, radius: Math.hypot(...lengths) };
}
class TileNode {
    parent;
    depth;
    geometricError;
    box;
    children = [];
    /** Content and subtree URIs, resolved and authenticated when requested. */
    contentUri;
    tilesetUri;
    contentState = 0 /* State.None */;
    tilesetState = 0 /* State.None */;
    content;
    decoded;
    abort;
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
    retryAt = 0;
    rendered = false;
    /** Still drawn, fading out under the tiles that replaced it. */
    leaving = false;
    drawnIn = -1;
    /** Camera distance at the latest traversal, for front-to-back drawing. */
    distance = 0;
    constructor(parent, depth, geometricError, box) {
        this.parent = parent;
        this.depth = depth;
        this.geometricError = geometricError;
        this.box = box;
    }
}
const HORIZON_RADIUS = 6356752 - 500;
// Metres from the frame's anchor within which surfaceHeight() trusts the tiles' placement.
const SURFACE_QUERY_RANGE = 30_000;
// Coarsest geometric error, in metres, of tiles surfaceHeight() measures: coarser ones are not where the ground is.
const SURFACE_QUERY_ERROR = 100;
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
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
    Pass[Pass["Around"] = 3] = "Around";
})(Pass || (Pass = {}));
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
const AROUND_ERROR_SCALE = 2;
/** Fraction of the concurrent requests the surroundings may use, keeping the rest free for the view. */
const AROUND_REQUESTS = 0.5;
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
    tileSet;
    rootUrl;
    maximumScreenSpaceError;
    detailRadius;
    distantErrorScale;
    maximumRadius;
    memoryBudgetMB;
    cacheSeconds;
    maxConcurrentRequests;
    uploadBudgetMs;
    heightOffset;
    geoid;
    camera;
    /**
     * On a globe, the colour of the sea. Google's imagery of water changes
     * from one level of detail to the next, so water at sea level is drawn
     * in this colour, reflecting the sky toward the horizon, instead.
     */
    waterColor = WATER_COLOR.clone();
    /** Draw tiles. Streaming pauses while disabled, except for `prefetchCamera`. */
    enabled = true;
    /**
     * Also load what this camera would see, after everything the visible
     * view needs: e.g. the end of a flight, so it arrives already sharp.
     * It is never drawn from.
     */
    prefetchCamera;
    /** Fires after each traversal with the number of tiles drawn. */
    onUpdatedObservable = new Observable();
    /** Fires when the set of attribution sources changes. */
    onAttributionsChangedObservable = new Observable();
    apiKey;
    fetcher;
    workers;
    scene;
    /** Draws all tiles on WebGL; other engines get one scene mesh per primitive. */
    batch;
    meshMaterial;
    layers;
    frame = new GoogleTileFrame();
    fixedOrigin;
    renderObserver;
    root;
    rootState = 0 /* State.None */;
    session;
    /** Visiting for `prefetchCamera`. */
    pass = 0 /* Pass.View */;
    /** Resident bytes the last traversal visited. */
    neededBytes = 0;
    prefetchFrame = new GoogleTileFrame();
    updateId = 0;
    rendered = [];
    wanted = [];
    resident = new Set();
    uploads = [];
    requestsInFlight = 0;
    residentBytes = 0;
    totals = { requests: 0, bytes: 0, failures: 0, shown: 0 };
    lastViewKey = "";
    contentChanged = true;
    attributionKey = "";
    attributions = [];
    disposed = false;
    evictedIn = -1;
    traversedAt = 0;
    motion = new MotionTracker();
    sweptAt = 0;
    /** Tiles replaced by others, drawn until those have faded in. */
    leaving = [];
    // Per-traversal camera state, in ECEF metres.
    eye = new Vector3();
    nadir = new Vector3();
    planes = [];
    sseFactor = 1;
    horizonDistance = Infinity;
    constructor(tileSet, options) {
        this.tileSet = tileSet;
        if (!options.apiKey?.trim())
            throw new Error("Google3DTiles requires an API key.");
        this.apiKey = options.apiKey.trim();
        this.rootUrl = options.rootUrl ?? GOOGLE_3D_TILES_ROOT_URL;
        this.maximumScreenSpaceError = options.maximumScreenSpaceError ?? 8;
        this.detailRadius = options.detailRadius ?? Infinity;
        this.distantErrorScale = options.distantErrorScale ?? 1;
        this.maximumRadius = options.maximumRadius ?? Infinity;
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
        if (!(this.maximumScreenSpaceError > 0))
            throw new RangeError("maximumScreenSpaceError must be positive.");
        if (!(this.distantErrorScale >= 1))
            throw new RangeError("distantErrorScale must be at least 1.");
        this.scene = tileSet.scene;
        // A finite radius ends on a circle, not on the ragged outline of coarse tiles.
        if (supportsTileBatch(this.scene))
            this.batch = new TileBatch("google photorealistic 3d tiles", this.scene, this.globe && globeWaterShader(this.globe, () => this.scene.activeCamera, this.waterColor), { clip: Number.isFinite(this.maximumRadius) });
        tileSet.ourAttribution.addAttribution("GOOGLE");
        this.renderObserver = this.scene.onBeforeRenderObservable.add(() => this.update());
        this.scene.getEngine().onContextRestoredObservable.add(() => this.reloadContent());
        if (!this.workers)
            warmGoogleTileDecoder();
        void this.loadRoot();
    }
    get globe() {
        return this.tileSet.isGlobe ? this.tileSet : undefined;
    }
    /** Current streaming counters. */
    get stats() {
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
    /** True when every tile wanted by the current view is drawn. */
    get isIdle() {
        return this.rootState === 4 /* State.Ready */ && this.updateId > 0 && !this.wanted.length && !this.uploads.length;
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
    /** Data providers for the tiles currently drawn, most prominent first. */
    getAttributions() {
        return this.attributions;
    }
    /**
     * Draw the tiles as `level` of a `MapLayerRenderer`, so coarser map layers
     * fill in only where photorealistic coverage ends.
     */
    addToLayers(renderer, level) {
        this.layers = { renderer, level };
        if (this.batch)
            renderer.add(this.batch, level);
        for (const node of this.resident)
            for (const { mesh } of node.content.primitives)
                if (mesh)
                    renderer.add(mesh, level);
    }
    /**
     * Distance along a world-space ray to the drawn photorealistic surface,
     * in world units, or undefined when the ray misses. Useful for camera
     * collision and click-to-fly. Tiles coarser than `maximumError` metres of
     * geometric error are skipped: the coarsest stand hundreds of metres off
     * the ground.
     */
    intersectRay(ray, maximumError = Infinity) {
        let nearest;
        const inverse = new Matrix();
        for (const node of this.rendered) {
            if (node.geometricError > maximumError)
                continue;
            for (const { drawable, mesh } of node.content.primitives) {
                if (mesh) {
                    if (!ray.intersectsSphere(mesh.getBoundingInfo().boundingSphere))
                        continue;
                    const hit = ray.intersectsMesh(mesh, false);
                    if (hit.hit && (nearest === undefined || hit.distance < nearest))
                        nearest = hit.distance;
                    continue;
                }
                const box = node.box;
                const center = this.frame.toWorld(box.center);
                const radius = box.radius * this.frame.world.scale;
                if (!ray.intersectsSphere({ center, radius }))
                    continue;
                drawable.world.invertToRef(inverse);
                const local = Ray.Transform(ray, inverse);
                // Ray.Transform normalises the direction: local distances are in tile units.
                const unitsPerWorld = Vector3.TransformNormal(ray.direction, inverse).length() / ray.direction.length();
                const p = drawable.localPositions, indices = drawable.localIndices;
                const a = new Vector3(), b = new Vector3(), c = new Vector3();
                for (let i = 0; i < indices.length; i += 3) {
                    a.fromArray(p, indices[i] * 3);
                    b.fromArray(p, indices[i + 1] * 3);
                    c.fromArray(p, indices[i + 2] * 3);
                    const hit = local.intersectsTriangle(a, b, c);
                    if (!hit)
                        continue;
                    const distance = hit.distance / unitsPerWorld;
                    if (nearest === undefined || distance < nearest)
                        nearest = distance;
                }
            }
        }
        return nearest;
    }
    /** Fix the geographic anchor that is placed exactly on the map. */
    setOrigin(origin) {
        this.applyAnchor(origin, this.worldAnchorFor(origin));
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.scene.onBeforeRenderObservable.remove(this.renderObserver);
        for (const node of [...this.resident])
            this.unload(node);
        for (const node of this.uploads)
            node.decoded?.images.forEach(image => image.bitmap?.close());
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
    get ecefToWorld() {
        return this.frame.revision ? this.frame.matrix : undefined;
    }
    /** ECEF metres of a point `height` metres above sea level, in the tiles' vertical datum. */
    toECEF(latitude, longitude, height, result = new Vector3()) {
        return geodeticToECEF(latitude, longitude, height + (this.geoid?.(latitude, longitude) ?? 0) - this.heightOffset, result);
    }
    /**
     * Height in metres above sea level of the first tile surface below `top`
     * metres (roofs, bridge decks, treetops, the ground) at a location, among
     * the tiles drawn; undefined where there is none, or only coarse tiles
     * whose surface is too approximate to measure.
     */
    surfaceHeight(latitude, longitude, top = 9000) {
        const matrix = this.ecefToWorld;
        if (!matrix)
            return undefined;
        // Far from the anchor, as just after a jump and before the tiles follow
        // the camera, tiles stand off the sphere and any hit would be wrong.
        const ground = this.toECEF(latitude, longitude, 0);
        if (Vector3.Distance(ground, this.frame.anchorECEF) > SURFACE_QUERY_RANGE)
            return undefined;
        const origin = Vector3.TransformCoordinates(this.toECEF(latitude, longitude, top), matrix);
        const below = Vector3.TransformCoordinates(this.toECEF(latitude, longitude, top - 1), matrix);
        const step = Vector3.Distance(origin, below);
        const hit = this.intersectRay(new Ray(origin, below.subtractInPlace(origin).normalize()), SURFACE_QUERY_ERROR);
        return hit === undefined ? undefined : top - hit / step;
    }
    worldAnchorFor(origin) {
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
    applyAnchor(origin, world) {
        this.frame.set(origin, world);
        for (const node of this.resident)
            this.placeContent(node);
        this.lastViewKey = "";
    }
    placeContent(node) {
        for (const primitive of node.content.primitives) {
            const world = this.localToWorld(node, primitive.nodeMatrix);
            if (primitive.drawable)
                primitive.drawable.world = world;
            else
                primitive.mesh.freezeWorldMatrix(world);
        }
    }
    localToWorld(node, nodeMatrix, rtcCenter = node.content?.rtcCenter ?? node.decoded?.rtcCenter) {
        const matrix = nodeMatrix.multiply(Y_UP_TO_Z_UP);
        if (rtcCenter)
            matrix.multiplyToRef(Matrix.Translation(rtcCenter.x, rtcCenter.y, rtcCenter.z), matrix);
        return matrix.multiply(this.frame.matrix);
    }
    /**
     * Keep the anchor near the camera on a globe. Re-anchoring keeps the
     * surface under the camera fixed, so it is invisible; when the camera is
     * high enough that the residual sphere/ellipsoid mismatch is sub-pixel,
     * the anchor snaps back onto the globe's own coordinates.
     */
    followCamera(camera) {
        const globe = this.globe;
        if (!globe || this.fixedOrigin)
            return;
        const position = camera.globalPosition;
        if (position.lengthSquared() === 0)
            return;
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
        }
        else if (travelled > Math.max(2000, altitude * 2)) {
            const anchor = { latitude: geodetic.latitude, longitude: geodetic.longitude, height: 0 };
            const world = this.frame.toWorld(geodeticToECEF(anchor.latitude, anchor.longitude, 0));
            const up = world.normalizeToNew();
            const lambda = Math.atan2(-up.x, up.z);
            const east = new Vector3(-Math.cos(lambda), 0, -Math.sin(lambda));
            this.applyAnchor(anchor, { position: world, up, east, north: Vector3.Cross(east, up).normalize(), scale: globe.metresToWorld });
        }
    }
    // ------------------------------------------------------------ hierarchy
    authenticate(uri, base) {
        const url = new URL(uri, base);
        const session = url.searchParams.get("session") ?? new URL(base).searchParams.get("session") ?? this.session;
        if (session) {
            this.session ??= session;
            url.searchParams.set("session", session);
        }
        url.searchParams.set("key", this.apiKey);
        return url.toString();
    }
    async loadRoot() {
        this.rootState = 2 /* State.Loading */;
        try {
            const url = this.authenticate(this.rootUrl, this.rootUrl);
            const tileset = await this.fetchJSON(url);
            if (this.disposed)
                return;
            this.root = this.buildNode(tileset.root, undefined, 0, url, Matrix.Identity());
            this.rootState = 4 /* State.Ready */;
            this.contentChanged = true;
        }
        catch (error) {
            this.rootState = 5 /* State.Failed */;
            console.warn("Google 3D Tiles root could not be loaded:", redact(error));
            if (!this.disposed)
                setTimeout(() => void this.loadRoot(), 3000);
        }
    }
    buildNode(tile, parent, depth, baseUrl, parentTransform) {
        const transform = tile.transform?.length === 16 ? Matrix.FromArray(tile.transform).multiply(parentTransform) : parentTransform;
        const node = new TileNode(parent, depth, tile.geometricError ?? parent?.geometricError ?? 0, boxOf(tile.boundingVolume, transform) ?? parent?.box ?? { ...makeBox(Vector3.Zero(), [Vector3.Zero(), Vector3.Zero(), Vector3.Zero()]), radius: Infinity });
        for (const content of [tile.content, ...(tile.contents ?? [])]) {
            const uri = content?.uri ?? content?.url;
            if (typeof uri !== "string")
                continue;
            if (/\.json(?:[?#]|$)/i.test(uri))
                node.tilesetUri ??= { uri, base: baseUrl };
            else
                node.contentUri ??= { uri, base: baseUrl };
        }
        if (!node.contentUri)
            node.contentState = 6 /* State.Empty */;
        for (const child of tile.children ?? [])
            node.children.push(this.buildNode(child, node, depth + 1, baseUrl, transform));
        return node;
    }
    async loadTileset(node) {
        node.tilesetState = 2 /* State.Loading */;
        this.requestsInFlight++;
        try {
            const url = this.authenticate(node.tilesetUri.uri, node.tilesetUri.base);
            const tileset = await this.fetchJSON(url);
            if (this.disposed)
                return;
            node.children.push(this.buildNode(tileset.root, node, node.depth + 1, url, Matrix.Identity()));
            node.tilesetState = 4 /* State.Ready */;
        }
        catch (error) {
            node.tilesetState = 0 /* State.None */;
            node.retryAt = performance.now() + 2000;
            this.totals.failures++;
            if (!isAbort(error))
                console.warn("Google 3D Tiles subtree failed:", redact(error));
        }
        finally {
            this.requestsInFlight--;
            this.contentChanged = true;
        }
    }
    async fetchJSON(url) {
        const response = await this.request(url);
        const tileset = await response.json();
        if (!tileset?.root)
            throw new Error("Google 3D Tiles response did not contain a root tile.");
        return tileset;
    }
    /** One network request with brief retries for transient failures. */
    async request(url, signal) {
        for (let attempt = 0;; attempt++) {
            this.totals.requests++;
            // The shared throttle holds requests while Google has asked clients to slow down.
            const host = await TileWorkerPool.throttle.acquire(url, signal);
            let response;
            try {
                // A hung request fails after 30 s instead of stalling its subtree.
                const timeout = AbortSignal.timeout(30_000);
                response = await this.fetcher(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
            }
            finally {
                TileWorkerPool.throttle.release(host, response?.status, response?.headers.get("Retry-After"));
            }
            if (response.ok || response.status === 204 || response.status === 404)
                return response;
            if (!TRANSIENT_STATUS.has(response.status) || attempt >= 2)
                throw new Error(`HTTP ${response.status}`);
            await retryDelay(attempt, signal);
        }
    }
    // ---------------------------------------------------------------- content
    async loadContent(node) {
        node.contentState = 2 /* State.Loading */;
        const abort = node.abort = new AbortController();
        this.requestsInFlight++;
        try {
            const url = this.authenticate(node.contentUri.uri, node.contentUri.base);
            const decoded = this.workers ? await this.decodeInWorker(url, abort.signal) : await this.decodeHere(url, abort.signal);
            if (this.disposed) {
                decoded?.images.forEach(image => image.bitmap?.close());
                return;
            }
            if (!decoded) {
                node.contentState = 6 /* State.Empty */;
                return;
            }
            node.decoded = decoded;
            node.contentState = 3 /* State.Decoded */;
            this.uploads.push(node);
        }
        catch (error) {
            this.failContent(node, error);
        }
        finally {
            this.requestsInFlight--;
            node.abort = undefined;
            this.contentChanged = true;
        }
    }
    /** Download and decode in a worker, retrying transient HTTP failures. Undefined for empty tiles. */
    async decodeInWorker(url, signal) {
        for (let attempt = 0;; attempt++) {
            this.totals.requests++;
            const result = await this.workers.load(url, signal);
            if ("tile" in result) {
                this.totals.bytes += result.byteLength;
                return result.tile;
            }
            if (result.status === 204 || result.status === 404)
                return undefined;
            if (!TRANSIENT_STATUS.has(result.status) || attempt >= 2)
                throw new Error(`HTTP ${result.status}`);
            await retryDelay(attempt, signal);
        }
    }
    async decodeHere(url, signal) {
        const response = await this.request(url, signal);
        if (response.status === 204 || response.status === 404)
            return undefined;
        const buffer = await response.arrayBuffer();
        this.totals.bytes += buffer.byteLength;
        return decodeGoogleTile(buffer, signal);
    }
    failContent(node, error) {
        node.abort = undefined;
        if (isAbort(error)) {
            node.contentState = 0 /* State.None */;
            return;
        }
        this.totals.failures++;
        node.contentState = 0 /* State.None */;
        node.retryAt = performance.now() + Math.max(3000, TileWorkerPool.throttle.pausedFor(this.rootUrl));
        console.warn("Google 3D tile failed:", redact(error));
    }
    /** Create GPU resources for decoded tiles within the per-frame budget. */
    upload() {
        if (!this.uploads.length)
            return;
        // Nearest-needed first: the traversal refreshed priorities.
        this.uploads.sort((a, b) => a.priority - b.priority);
        const deadline = performance.now() + this.uploadBudgetMs;
        let created = 0;
        while (this.uploads.length && (created === 0 || performance.now() < deadline)) {
            const node = this.uploads.shift();
            const decoded = node.decoded;
            node.decoded = undefined;
            if (node.lastVisit < this.updateId - 120) {
                // No longer needed: drop it rather than spend GPU memory.
                for (const image of decoded.images)
                    image.bitmap?.close();
                node.contentState = 0 /* State.None */;
                continue;
            }
            const localToWorld = (primitive) => this.localToWorld(node, primitive.nodeMatrix, decoded.rtcCenter);
            let resources;
            let primitives;
            if (this.batch) {
                const created = createTileDrawables(decoded, this.scene.getEngine(), "google 3d tile", localToWorld);
                resources = created;
                primitives = created.drawables.map((drawable, i) => ({ drawable, nodeMatrix: decoded.primitives[i].nodeMatrix }));
            }
            else {
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
            node.contentState = 4 /* State.Ready */;
            this.resident.add(node);
            this.residentBytes += resources.byteLength;
            this.contentChanged = true;
            created++;
        }
    }
    unload(node) {
        const content = node.content;
        if (!content)
            return;
        const engine = this.scene.getEngine();
        for (const { drawable, mesh } of content.primitives) {
            if (drawable)
                TileBatch.release(engine, drawable);
            mesh?.dispose(false, false);
        }
        for (const texture of content.textures)
            texture.dispose();
        this.residentBytes -= content.byteLength;
        this.resident.delete(node);
        node.content = undefined;
        node.rendered = false;
        node.contentState = 0 /* State.None */;
    }
    reloadContent() {
        for (const node of [...this.resident])
            this.unload(node);
        this.contentChanged = true;
    }
    abortAll(node) {
        if (!node)
            return;
        node.abort?.abort();
        for (const child of node.children)
            this.abortAll(child);
    }
    // -------------------------------------------------------------- traversal
    update() {
        if (this.disposed)
            return;
        this.upload();
        const camera = this.camera ?? this.scene.activeCamera;
        if (!camera || !this.root)
            return;
        const ahead = this.prefetchCamera !== camera ? this.prefetchCamera : undefined;
        const position = camera.globalPosition;
        this.motion.update(position, this.globe ? position.length() - this.globe.radius : position.y);
        if (!this.enabled && this.rendered.length)
            this.show([]);
        if (!this.enabled && !ahead)
            return;
        // Only a drawn view needs the frame to follow; a prefetch has its own.
        if (this.enabled || this.frame.revision === 0)
            this.followCamera(camera);
        if (this.frame.revision === 0)
            this.setOrigin(this.fixedOrigin ?? { latitude: this.tileSet.centerCoords.y, longitude: this.tileSet.centerCoords.x });
        const view = camera.getViewMatrix();
        const engine = this.scene.getEngine();
        const viewKey = `${this.enabled}/${view.updateFlag}/${camera.getProjectionMatrix().updateFlag}/${this.frame.revision}`
            + `/${ahead?.uniqueId}/${ahead?.getViewMatrix().updateFlag}/${engine.getRenderWidth()}x${engine.getRenderHeight()}`;
        if (viewKey !== this.lastViewKey || this.contentChanged) {
            this.lastViewKey = viewKey;
            this.contentChanged = false;
            this.traverse(this.enabled ? camera : undefined, ahead);
        }
        else if (this.leaving.length && performance.now() - this.leavingSince() >= this.batch.fadeDuration) {
            // Retire tiles whose fade has finished.
            this.show(this.rendered);
        }
        this.schedule();
        this.evict();
    }
    leavingSince() {
        let first = Infinity;
        for (const node of this.leaving)
            first = Math.min(first, node.content?.primitives[0]?.drawable?.fadeStart ?? -Infinity);
        return first;
    }
    traverse(camera, ahead) {
        this.updateId++;
        this.traversedAt = performance.now();
        const render = [];
        this.wanted = [];
        if (camera) {
            this.prepareCamera(camera);
            this.visit(this.root, render);
            this.show(render);
            if (this.batch) {
                this.frame.toWorld(this.nadir, this.batch.clipCenter);
                this.batch.clipRadius = this.maximumRadius * this.frame.world.scale;
            }
            // Load, without drawing, what lies just beyond the edges of the view.
            this.prepareCamera(camera, this.frame, "margin");
            this.pass = 1 /* Pass.Margin */;
            this.visit(this.root, []);
            this.pass = 0 /* Pass.View */;
            // Once the view is complete, its surroundings in every direction.
            // (Wanted tiles are those not yet ready; only failures may remain.)
            const settled = this.uploads.length === 0 && this.wanted.every(node => node.contentState === 5 /* State.Failed */ || node.tilesetState === 5 /* State.Failed */);
            if (settled && !ahead) {
                this.prepareCamera(camera, this.frame, "around");
                this.pass = 3 /* Pass.Around */;
                this.visit(this.root, []);
                this.pass = 0 /* Pass.View */;
            }
        }
        if (ahead) {
            // Wanted after the visible view; drawn nowhere.
            this.prepareCamera(ahead, this.frameAt(ahead));
            this.pass = 2 /* Pass.Prefetch */;
            this.visit(this.root, []);
            this.pass = 0 /* Pass.View */;
        }
        // What this traversal needs; everything else resident may be evicted.
        this.neededBytes = 0;
        for (const node of this.resident)
            if (node.lastVisit === this.updateId)
                this.neededBytes += node.content.byteLength;
        this.updateAttributions();
        this.onUpdatedObservable.notifyObservers(this);
    }
    /** An exact frame anchored beneath a camera, e.g. one far from the drawn view. */
    frameAt(camera) {
        if (!this.globe)
            return this.frame;
        const surface = this.globe.getSurfaceCoordinates(camera.globalPosition);
        this.prefetchFrame.set({ latitude: surface.latitude, longitude: surface.longitude }, this.worldAnchorFor(surface));
        return this.prefetchFrame;
    }
    prepareCamera(camera, frame = this.frame, extent = "view") {
        frame.toECEF(camera.globalPosition, this.eye);
        // Ground distances are measured from the ellipsoid point below the camera.
        const below = ecefToGeodetic(this.eye.x, this.eye.y, this.eye.z);
        geodeticToECEF(below.latitude, below.longitude, 0, this.nadir);
        const engine = this.scene.getEngine();
        this.sseFactor = engine.getRenderHeight() / (2 * Math.tan(camera.fov / 2));
        const dc = this.eye.length();
        this.horizonDistance = dc > HORIZON_RADIUS ? Math.sqrt(dc * dc - HORIZON_RADIUS * HORIZON_RADIUS) : Infinity;
        // World-space frustum planes expressed in ECEF: n' = L n, d' = n.t + d.
        if (extent === "around") {
            this.planes = [];
            return;
        }
        const transform = extent === "margin" ? widenedViewProjection(camera) : camera.getViewMatrix().multiply(camera.getProjectionMatrix());
        const m = frame.matrix.m;
        this.planes = Frustum.GetPlanes(transform).map((plane) => {
            const n = plane.normal;
            return {
                normal: new Vector3(m[0] * n.x + m[1] * n.y + m[2] * n.z, m[4] * n.x + m[5] * n.y + m[6] * n.z, m[8] * n.x + m[9] * n.y + m[10] * n.z),
                d: n.x * m[12] + n.y * m[13] + n.z * m[14] + plane.d,
            };
        });
    }
    /**
     * Select what to draw beneath `node`. Returns true when the node's area is
     * fully drawable (or needs nothing), so its parent may be replaced.
     */
    visit(node, render) {
        // The visible view's distance and priority win over a prefetch's.
        const seen = this.pass !== 0 /* Pass.View */ && node.lastVisit === this.updateId;
        node.lastVisit = this.updateId;
        node.seenAt = this.traversedAt;
        const sticky = node.refined && node.viewedIn >= this.updateId - 1;
        if (this.pass === 0 /* Pass.View */)
            node.viewedIn = this.updateId;
        const box = node.box;
        const ground = distanceToBox(box, this.nadir);
        if (ground > this.maximumRadius)
            return true;
        const distance = Math.max(1, distanceToBox(box, this.eye));
        if (!seen)
            node.distance = distance;
        // Outside the view: nothing to draw or load. Resident content stays
        // cached, so it reappears in the same frame the camera turns to it.
        if (!this.isVisible(box, distance)) {
            node.culledIn = this.updateId;
            return true;
        }
        const error = node.geometricError * this.sseFactor / distance;
        const target = this.maximumScreenSpaceError * Math.min(this.distantErrorScale, Math.max(1, ground / this.detailRadius))
            * (this.pass === 3 /* Pass.Around */ ? AROUND_ERROR_SCALE : 1);
        // The blurriest first: how far this tile's error, and so roughly its
        // drawn parent's, exceeds the target on screen (lower loads sooner).
        if (!seen)
            node.priority = Math.log2(target / Math.max(error, 1e-6)) + PASS_PRIORITY[this.pass];
        let refine = error > target * this.band(node, sticky);
        if (refine && node.tilesetUri && node.tilesetState !== 4 /* State.Ready */) {
            this.want(node, "tileset");
            refine = node.children.length > 0;
        }
        if (refine && !node.children.length)
            refine = false;
        if (this.pass === 0 /* Pass.View */)
            node.refined = refine;
        if (refine) {
            const start = render.length;
            let covered = true;
            for (const child of node.children)
                covered = this.visit(child, render) && covered;
            // Load the siblings just out of view too: when the camera turns
            // to them they are ready, rather than dropping the whole parent
            // back to its coarse level while one child loads.
            if (this.pass === 0 /* Pass.View */)
                for (const child of node.children) {
                    if (child.culledIn !== this.updateId || child.contentState !== 0 /* State.None */ || child.wantedIn === this.updateId)
                        continue;
                    child.priority = node.priority + PASS_PRIORITY[1 /* Pass.Margin */];
                    this.want(child, "content", 1 /* Pass.Margin */);
                }
            if (covered || node.contentState === 6 /* State.Empty */)
                return covered;
            // Part of the area is still loading, typically a tile just come
            // into view. Finer tiles already drawn stay, leaving that part
            // briefly empty, rather than the whole area dropping back to
            // this coarse level until it arrives.
            if (this.pass === 0 /* Pass.View */ && render.length > start && node.drawnIn !== this.updateId - 1)
                return true;
            // Children are still loading: draw this level meanwhile.
            this.want(node, "content");
            if (node.contentState !== 4 /* State.Ready */)
                return this.keepDrawn(node, render);
            render.length = start;
            this.draw(node, render);
            return true;
        }
        if (node.contentState === 6 /* State.Empty */)
            return !node.tilesetUri || node.tilesetState === 4 /* State.Ready */;
        this.want(node, "content");
        if (node.contentState !== 4 /* State.Ready */)
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
        return node.drawnIn === this.updateId - 1 ? REFINE_DRAWN : 1;
    }
    keepDrawn(node, render) {
        if (this.pass !== 0 /* Pass.View */)
            return false;
        const start = render.length;
        const stack = [...node.children];
        while (stack.length) {
            const n = stack.pop();
            if (n.lastVisit < this.updateId - 1)
                continue;
            if (n.rendered && !n.leaving && n.contentState === 4 /* State.Ready */) {
                if (n.lastUsed !== this.updateId)
                    this.draw(n, render);
            }
            else
                stack.push(...n.children);
        }
        return render.length > start;
    }
    isVisible(box, distance) {
        for (const plane of this.planes) {
            const s = Vector3.Dot(plane.normal, box.center) + plane.d;
            const r = Math.abs(Vector3.Dot(plane.normal, box.axes[0])) + Math.abs(Vector3.Dot(plane.normal, box.axes[1]))
                + Math.abs(Vector3.Dot(plane.normal, box.axes[2]));
            if (s < -r)
                return false;
        }
        // Beyond the horizon of a conservative, slightly small Earth.
        const top = box.center.length() + box.radius;
        return distance <= this.horizonDistance + Math.sqrt(Math.max(0, top * top - HORIZON_RADIUS * HORIZON_RADIUS));
    }
    draw(node, render) {
        node.lastUsed = this.updateId;
        render.push(node);
    }
    want(node, kind, pass = this.pass) {
        const state = kind === "tileset" ? node.tilesetState : node.contentState;
        if (state === 4 /* State.Ready */ || state === 6 /* State.Empty */ || node.wantedIn === this.updateId)
            return;
        node.wantedIn = this.updateId;
        node.wantedBy = pass;
        this.wanted.push(node);
    }
    /**
     * Show `render`, hiding tiles that left it. Tiles that change level
     * cross-fade with the ones they replace; tiles merely entering or
     * leaving the view appear and vanish at once.
     */
    show(render) {
        const stamp = this.updateId;
        const now = performance.now();
        const fades = !!this.batch && this.batch.fadeDuration > 0 && this.motion.slow;
        const fade = (node, start, out) => {
            for (const { drawable } of node.content.primitives)
                if (drawable) {
                    drawable.fadeStart = start;
                    drawable.fadeOut = out;
                }
        };
        for (const node of render) {
            node.drawnIn = stamp;
            if (node.leaving) {
                node.leaving = false;
                fade(node, undefined, false);
                continue;
            }
            if (node.rendered)
                continue;
            node.rendered = true;
            this.totals.shown++;
            if (fades)
                fade(node, node.culledIn === stamp - 1 ? undefined : now, false);
            for (const { mesh } of node.content.primitives)
                mesh?.setEnabled(true);
        }
        for (const node of this.rendered) {
            if (node.drawnIn === stamp || !node.rendered || node.leaving)
                continue;
            if (fades && node.culledIn !== stamp) {
                // Kept (and safe from eviction) until its replacement has faded in.
                node.leaving = true;
                fade(node, now, true);
                this.leaving.push(node);
                continue;
            }
            node.rendered = false;
            for (const { mesh } of node.content?.primitives ?? [])
                mesh?.setEnabled(false);
        }
        this.leaving = this.leaving.filter(node => {
            if (!node.leaving)
                return false;
            const start = node.content?.primitives[0]?.drawable?.fadeStart ?? -Infinity;
            if (now - start < this.batch.fadeDuration && node.culledIn !== stamp)
                return true;
            node.leaving = false;
            node.rendered = false;
            return false;
        });
        this.rendered = render;
        if (this.batch) {
            // Nearest first, so early depth testing rejects most hidden fragments.
            const items = [];
            for (const node of [...render, ...this.leaving].sort((a, b) => a.distance - b.distance))
                for (const { drawable } of node.content?.primitives ?? [])
                    items.push(drawable);
            this.batch.items = items;
        }
    }
    /** Start the most important wanted requests that fit the concurrency limit. */
    schedule() {
        // Decoded tiles waiting for upload hold bitmaps in memory: keep that queue short.
        if (this.requestsInFlight >= this.maxConcurrentRequests || this.uploads.length >= 48 || !this.wanted.length)
            return;
        const now = performance.now();
        const needsTileset = (node) => node.tilesetUri && node.tilesetState === 0 /* State.None */ && !node.children.length;
        // Tiles the view does not draw may displace stale tiles, but never
        // what this traversal needs: past that each load would evict another
        // wanted tile, which would be loaded again, forever.
        const budget = this.memoryBudgetMB * 1024 * 1024;
        const allowed = [true, this.neededBytes < budget * MARGIN_BUDGET, this.neededBytes < budget * PREFETCH_BUDGET,
            this.neededBytes < budget * AROUND_BUDGET && this.requestsInFlight < this.maxConcurrentRequests * AROUND_REQUESTS];
        const candidates = this.wanted.filter(node => node.retryAt <= now && (needsTileset(node) || node.contentState === 0 /* State.None */)
            && allowed[node.wantedBy]);
        // Subtrees gate everything beneath them, so they go first.
        const rank = (node) => node.priority - (needsTileset(node) ? TILESET_PRIORITY_BOOST : 0);
        candidates.sort((a, b) => rank(a) - rank(b));
        for (const node of candidates) {
            if (this.requestsInFlight >= this.maxConcurrentRequests)
                break;
            if (needsTileset(node))
                void this.loadTileset(node);
            else
                void this.loadContent(node);
        }
        // Abandon downloads the camera has moved away from.
        if (this.updateId % 30 === 0)
            for (const node of this.loadingNodes()) {
                if (node.lastVisit < this.updateId - 60)
                    node.abort?.abort();
            }
    }
    *loadingNodes() {
        const stack = this.root ? [this.root] : [];
        while (stack.length) {
            const node = stack.pop();
            if (node.contentState === 2 /* State.Loading */)
                yield node;
            if (node.lastVisit >= this.updateId - 120)
                stack.push(...node.children);
        }
    }
    /**
     * Evict tiles until the cache fits the memory budget: first those the
     * current view does not touch (least recently drawn first), then coarse
     * fallbacks hidden behind fully loaded children. Drawn tiles are never
     * evicted, so a view larger than the budget overshoots it instead of
     * thrashing.
     */
    evict() {
        const now = performance.now();
        if (now - this.sweptAt > 1000) {
            // Release what nothing has needed for a while, whatever the budget.
            this.sweptAt = now;
            for (const node of this.resident)
                if (!node.rendered && node.lastVisit !== this.updateId && now - node.seenAt > this.cacheSeconds * 1000)
                    this.unload(node);
        }
        const budget = this.memoryBudgetMB * 1024 * 1024;
        if (this.residentBytes <= budget || this.evictedIn === this.updateId)
            return;
        this.evictedIn = this.updateId;
        const candidates = [...this.resident].filter(node => !node.rendered)
            .sort((a, b) => Number(a.lastVisit === this.updateId) - Number(b.lastVisit === this.updateId) || a.lastUsed - b.lastUsed);
        for (const node of candidates) {
            if (this.residentBytes <= budget * 0.9)
                break;
            this.unload(node);
        }
    }
    updateAttributions() {
        const counts = new Map();
        for (const node of this.rendered)
            for (const source of node.content?.attributions ?? [])
                counts.set(source, (counts.get(source) ?? 0) + 1);
        const sorted = [...counts].sort((a, b) => b[1] - a[1]).map(([source]) => source);
        const key = sorted.join("\n");
        if (key === this.attributionKey)
            return;
        this.attributionKey = key;
        this.attributions = sorted;
        this.tileSet.ourAttribution.setGoogleAttributions(sorted);
        this.onAttributionsChangedObservable.notifyObservers(sorted);
    }
}
function boxOf(volume, transform) {
    const transformDirection = (x, y, z) => Vector3.TransformNormal(new Vector3(x, y, z), transform);
    if (volume?.box?.length === 12) {
        const b = volume.box;
        return makeBox(Vector3.TransformCoordinates(new Vector3(b[0], b[1], b[2]), transform), [transformDirection(b[3], b[4], b[5]), transformDirection(b[6], b[7], b[8]), transformDirection(b[9], b[10], b[11])]);
    }
    if (volume?.sphere?.length === 4) {
        const s = volume.sphere;
        const r = s[3];
        return makeBox(Vector3.TransformCoordinates(new Vector3(s[0], s[1], s[2]), transform), [new Vector3(r, 0, 0), new Vector3(0, r, 0), new Vector3(0, 0, r)]);
    }
    if (volume?.region?.length === 6) {
        const [west, south, east, north, minimum, maximum] = volume.region;
        const corners = [];
        for (const lat of [south, (south + north) / 2, north])
            for (const lon of [west, (west + east) / 2, east])
                for (const h of [minimum, maximum])
                    corners.push(geodeticToECEF(lat * 180 / Math.PI, lon * 180 / Math.PI, h));
        const min = corners.reduce((a, c) => Vector3.Minimize(a, c)), max = corners.reduce((a, c) => Vector3.Maximize(a, c));
        const half = max.subtract(min).scale(0.5);
        return makeBox(min.add(half), [new Vector3(half.x, 0, 0), new Vector3(0, half.y, 0), new Vector3(0, 0, half.z)]);
    }
    return undefined;
}
/** Distance from a point to an oriented box (zero inside). */
function distanceToBox(box, point) {
    const dx = point.x - box.center.x, dy = point.y - box.center.y, dz = point.z - box.center.z;
    let squared = 0;
    for (let i = 0; i < 3; i++) {
        const u = box.units[i];
        const excess = Math.abs(dx * u.x + dy * u.y + dz * u.z) - box.lengths[i];
        if (excess > 0)
            squared += excess * excess;
    }
    return Math.sqrt(squared);
}
/** Worker pools shared by every tile set on the page. */
function isAbort(error) {
    return error instanceof DOMException && error.name === "AbortError";
}
/** Error text without request URLs, which carry the API key. */
function redact(error) {
    return (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "[request]");
}
/** Attribution sources and CESIUM_RTC centre from a GLB, without decoding geometry. */
export function parseGoogleGLBMetadata(buffer) {
    try {
        const { json } = parseGLB(buffer);
        const center = json.extensions?.CESIUM_RTC?.center;
        return {
            attributions: glbAttributions(json),
            rtcCenter: center?.length === 3 && center.every(Number.isFinite) ? Vector3.FromArray(center) : undefined,
        };
    }
    catch {
        return { attributions: [] };
    }
}
/** A short pause before retrying a transient failure; a slow-down is also waited out by the throttle. */
function retryDelay(attempt, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 300 * 3 ** attempt * (0.75 + Math.random() * 0.5));
        signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
}
//# sourceMappingURL=Google3DTiles.js.map