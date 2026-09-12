import { Frustum, Matrix, Vector2, Vector3 } from "@babylonjs/core/Maths/math.js";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { EPSG_Type } from "../core/TileMath.js";
/** Google Maps Platform Map Tiles API Photorealistic 3D Tiles endpoint. */
export const GOOGLE_3D_TILES_ROOT_URL = "https://tile.googleapis.com/v1/3dtiles/root.json";
const WGS84_SEMI_MAJOR_AXIS = 6378137;
const WGS84_FIRST_ECCENTRICITY_SQUARED = 6.6943799901413165e-3;
const RADIANS_PER_DEGREE = Math.PI / 180;
let nextModelFileId = 0;
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
    drainNetwork() {
        if (this.networkDrainQueued)
            return;
        this.networkDrainQueued = true;
        queueMicrotask(() => {
            this.networkDrainQueued = false;
            this.networkWaiters.sort((a, b) => a.priority - b.priority);
            while (this.networkActive < 24 && this.networkWaiters.length) {
                this.networkActive++;
                this.networkWaiters.shift().resume();
            }
        });
    }
    async networkSlot(work, priority = 0) {
        await new Promise(resolve => {
            this.networkWaiters.push({ priority, resume: resolve });
            this.drainNetwork();
        });
        try {
            return await work();
        }
        finally {
            this.networkActive--;
            this.drainNetwork();
        }
    }
    constructor(tileSet, options = {}) {
        this.tileSet = tileSet;
        this.apiKey = "";
        this.maximumGeometricError = 0;
        this.cullToCamera = false;
        this.heightOffset = 0;
        this.stats = { hierarchyRequests: 0, modelRequests: 0, reusedModels: 0, detailLimitedTiles: 0, sourceLimitedTiles: 0 };
        this.rootRequestKey = "";
        this.externalTilesets = new Map();
        this.loadedTiles = new Map();
        this.retainedTiles = new Map();
        this.generation = 0;
        this.desiredTiles = new Map();
        this.originStateKey = "";
        this.googleAttributionAdded = false;
        this.pendingModels = new Map();
        this.networkActive = 0;
        this.networkWaiters = [];
        this.networkDrainQueued = false;
        this.coverageKey = "";
        this.coverageVersion = 0;
        this.coverageIndex = new Map();
        this.broadCoverage = [];
        this.loadedSelections = new Map();
        this.rootUrl = options.rootUrl ?? GOOGLE_3D_TILES_ROOT_URL;
        this.maxDepth = options.maxDepth ?? 20;
        this.maxTiles = options.maxTiles ?? 64;
        this.exaggeration = options.exaggeration ?? 1;
        this.coverageRadius = options.coverageRadius;
        this.coverageRegion = options.coverageRegion;
        this.maximumGeometricError = options.maximumGeometricError ?? 0;
        this.maximumScreenSpaceError = options.maximumScreenSpaceError;
        this.maximumDisplayGeometricError = options.maximumDisplayGeometricError;
        this.cullToCamera = options.cullToCamera ?? false;
        this.heightOffset = options.heightOffset ?? 0;
        this.origin = options.origin;
        this.apiKey = options.apiKey ?? "";
        this.tilesetLoader = options.tilesetLoader ?? defaultTilesetLoader;
        this.modelTileLoader = options.modelTileLoader ?? defaultModelTileLoader;
    }
    /** Content currently attached to the Babylon scene. */
    get loadedModelTiles() {
        return Array.from(this.loadedTiles.values());
    }
    get coverageRevision() { return this.coverageVersion; }
    /** Whether loaded model bounds cover this geographic position. */
    coversLocation(latitude, longitude) {
        const key = `${this.generation}/${this.loadedTiles.size}`;
        if (this.coverageKey !== key) {
            this.coverageKey = key;
            this.coverageIndex.clear();
            this.broadCoverage = [];
            for (const url of this.loadedTiles.keys()) {
                const selection = this.loadedSelections.get(url) ?? this.desiredTiles.get(url);
                if (!selection?.boundingVolume)
                    continue;
                const volume = selection.boundingVolume;
                let west, east, south, north;
                if (volume.region) {
                    [west, south, east, north] = volume.region.map(value => value / RADIANS_PER_DEGREE);
                }
                else {
                    const values = volume.box ?? volume.sphere;
                    if (!values)
                        continue;
                    const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
                    const center = Vector3.TransformCoordinates(Vector3.FromArray(values), transform);
                    if (center.length() < WGS84_SEMI_MAJOR_AXIS / 2) {
                        this.broadCoverage.push(selection);
                        continue;
                    }
                    const radius = volume.box ? [3, 6, 9].reduce((sum, offset) => sum + Vector3.TransformNormal(Vector3.FromArray(values, offset), transform).length(), 0) : values[3];
                    const lat = Math.atan2(center.z, Math.hypot(center.x, center.y) * (1 - WGS84_FIRST_ECCENTRICITY_SQUARED)) / RADIANS_PER_DEGREE;
                    const lon = Math.atan2(center.y, center.x) / RADIANS_PER_DEGREE;
                    const delta = radius / 6300000 / RADIANS_PER_DEGREE + 0.0001;
                    south = lat - delta;
                    north = lat + delta;
                    const longitudeDelta = delta / Math.max(0.01, Math.cos(Math.max(Math.abs(south), Math.abs(north)) * RADIANS_PER_DEGREE));
                    west = lon - longitudeDelta;
                    east = lon + longitudeDelta;
                }
                if (east < west || (Math.ceil((east - west) * 1000) + 1) * (Math.ceil((north - south) * 1000) + 1) > 4096 || west < -180 || east > 180) {
                    this.broadCoverage.push(selection);
                    continue;
                }
                for (let x = Math.floor(west * 1000); x <= Math.floor(east * 1000); x++)
                    for (let y = Math.floor(south * 1000); y <= Math.floor(north * 1000); y++) {
                        const cell = `${x}/${y}`;
                        const entries = this.coverageIndex.get(cell) ?? [];
                        entries.push(selection);
                        this.coverageIndex.set(cell, entries);
                    }
            }
        }
        const nearby = this.coverageIndex.get(`${Math.floor(longitude * 1000)}/${Math.floor(latitude * 1000)}`) ?? [];
        for (const selection of nearby)
            if (verticalIntersectsVolume(latitude, longitude, selection.boundingVolume, selection.transform))
                return true;
        return this.broadCoverage.some(selection => verticalIntersectsVolume(latitude, longitude, selection.boundingVolume, selection.transform));
    }
    /** The last root tileset response, if load() has been called. */
    get tileset() {
        return this.rootTileset;
    }
    /** The session token discovered in the tileset's child URIs. */
    get sessionToken() {
        return this.session;
    }
    /** Returns attribution sources sorted by frequency, then alphabetically. */
    getAttributions() {
        const counts = new Map();
        for (const tile of this.loadedTiles.values()) {
            for (const attribution of new Set(tile.attributions)) {
                counts.set(attribution, (counts.get(attribution) ?? 0) + 1);
            }
        }
        return Array.from(counts.entries())
            .sort(([leftName, leftCount], [rightName, rightCount]) => {
            return rightCount - leftCount || leftName.localeCompare(rightName);
        })
            .map(([name]) => name);
    }
    /**
     * Resolves a Google 3D Tiles URI and adds the API key and session token.
     * Child URIs returned by Google are path/query components rather than
     * complete URLs, so callers should pass the URL of the response containing
     * the URI as baseUrl.
     */
    getTileURL(uri, baseUrl = this.rootUrl) {
        return this.authenticateURL(uri, baseUrl);
    }
    /** Cancel queued work while retaining the visible scene and hierarchy cache. */
    cancelPendingLoad() { this.generation++; }
    /** Loads content that overlaps the current TileSet. */
    async load() {
        this.tileSet.assertRasterSetup("load Google 3D Tiles");
        this.validateOptions();
        this.selectionEye = this.cameraEye();
        const residentAtStart = new Set([...this.loadedTiles.keys(), ...this.retainedTiles.keys()]);
        const generation = ++this.generation;
        const origin = this.getOrigin();
        const originStateKey = this.getOriginStateKey(origin);
        if (this.originStateKey !== "" && this.originStateKey !== originStateKey) {
            this.disposeLoadedTiles();
        }
        this.originStateKey = originStateKey;
        await this.loadRootTileset(generation);
        if (generation !== this.generation)
            return [];
        if (!this.rootTileset) {
            throw new Error("Google 3D Tiles root tileset was not loaded.");
        }
        const desiredTiles = new Map();
        this.desiredTiles = desiredTiles;
        const modelRequests = [];
        const residentAncestors = new Set();
        for (const [url, selection] of this.loadedSelections)
            if (this.loadedTiles.has(url))
                for (const ancestor of selection.ancestors ?? [])
                    residentAncestors.add(ancestor);
        const startModel = (selection) => {
            modelRequests.push(this.loadTile(selection, origin, generation).catch((error) => {
                console.warn("Unable to load a Google 3D Tile.");
            }));
        };
        if (this.maximumScreenSpaceError) {
            await this.selectFrontier(desiredTiles, generation, selection => {
                desiredTiles.set(selection.url, selection);
                if (residentAncestors.has(selection.url) && selection.geometricError !== undefined
                    && selection.geometricError > this.allowedGeometricError(selection.boundingVolume, selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity()))
                    return;
                const overlapsExisting = selection.ancestors?.some(url => this.loadedTiles.has(url))
                    || residentAncestors.has(selection.url);
                // New, disjoint coverage can appear immediately. Overlapping
                // refinements still commit as a complete replacement subtree.
                modelRequests.push(this.loadTile(selection, origin, generation, !overlapsExisting).catch(() => undefined));
            });
            if (Array.from(desiredTiles.keys()).some(url => !this.loadedTiles.has(url))) {
                await this.loadReplacementGroups(desiredTiles, origin, generation);
            }
        }
        else
            await this.collectTileContent(this.rootTileset.root, this.getRootTilesetURL(), 0, this.getTileSetBounds(), desiredTiles, Matrix.Identity(), "REPLACE", generation, startModel);
        if (generation !== this.generation)
            return [];
        this.desiredTiles = desiredTiles;
        await Promise.all(modelRequests);
        if (generation !== this.generation)
            return [];
        this.stats.reusedModels += Array.from(desiredTiles.keys()).filter(url => residentAtStart.has(url) && this.loadedTiles.has(url)).length;
        // Keep the previous view visible while its replacement is streaming.
        for (const url of Array.from(this.loadedTiles.keys())) {
            if (!desiredTiles.has(url)) {
                const previous = this.loadedSelections.get(url);
                if (this.maximumScreenSpaceError && previous) {
                    const transform = previous.transform ? Matrix.FromArray(previous.transform) : Matrix.Identity();
                    if (boundingVolumeIntersects(previous.boundingVolume, this.getTileSetBounds(), transform))
                        continue;
                }
                const tile = this.loadedTiles.get(url);
                tile.root.setEnabled(false);
                this.loadedTiles.delete(url);
                this.retainedTiles.set(url, tile);
            }
        }
        // Turning does not remove resident geometry. Evict only offscreen history
        // once two view budgets are resident; a separate cache preserves recent turns.
        if (this.loadedTiles.size > this.maxTiles * 2) {
            const candidates = Array.from(this.loadedSelections).filter(([url, selection]) => this.loadedTiles.has(url) && !desiredTiles.has(url)
                && this.allowedGeometricError(selection.boundingVolume, selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity()) < 0);
            candidates.sort((a, b) => this.tilePriority(b[1].boundingVolume, b[1].transform ? Matrix.FromArray(b[1].transform) : Matrix.Identity())
                - this.tilePriority(a[1].boundingVolume, a[1].transform ? Matrix.FromArray(a[1].transform) : Matrix.Identity()));
            for (const [url] of candidates) {
                if (this.loadedTiles.size <= this.maxTiles * 2)
                    break;
                this.retireTile(url);
            }
        }
        // Bound GPU memory while retaining the most recently visited detail.
        this.trimRetainedTiles();
        this.coverageKey = "";
        this.coverageVersion++;
        this.updateAttribution();
        return this.loadedModelTiles;
    }
    trimRetainedTiles() {
        while (this.retainedTiles.size > Math.max(128, Math.min(256, this.maxTiles))) {
            const url = Array.from(this.retainedTiles.keys()).find(url => !this.pendingModels.has(url) && !this.desiredTiles.has(url));
            if (!url)
                break;
            const tile = this.retainedTiles.get(url);
            tile.asset.dispose();
            tile.root.dispose(false, false);
            this.retainedTiles.delete(url);
            this.loadedSelections.delete(url);
        }
    }
    /** Prepare a bounded surrounding ring after visible loading has finished. */
    async prefetchSurroundings() {
        if (!this.rootTileset || !this.maximumScreenSpaceError)
            return;
        const generation = this.generation;
        const origin = this.getOrigin();
        const selections = new Map();
        const requests = [];
        let models = 0;
        await this.selectFrontier(selections, generation, selection => {
            if (generation !== this.generation || this.loadedTiles.has(selection.url) || this.retainedTiles.has(selection.url) || models >= 128)
                return;
            const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
            if (this.allowedGeometricError(selection.boundingVolume, transform) >= 0)
                return;
            models++;
            requests.push(this.loadTile(selection, origin, generation, false).catch(() => undefined));
        }, true);
        await Promise.all(requests);
        this.trimRetainedTiles();
    }
    /** Alias matching the building-provider lifecycle used by older examples. */
    async generateBuildings() {
        return this.load();
    }
    /** Disposes loaded GLB assets and clears the provider's request caches. */
    dispose() {
        ++this.generation;
        this.tileSet.ourAttribution.setGoogleAttributions?.([]);
        this.desiredTiles.clear();
        this.disposeLoadedTiles();
        this.rootTileset = undefined;
        this.rootRequestKey = "";
        this.session = undefined;
        this.externalTilesets.clear();
        this.originStateKey = "";
    }
    validateOptions() {
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
        if (!Number.isFinite(this.heightOffset))
            throw new RangeError("heightOffset must be finite.");
        if (!Number.isFinite(this.maximumGeometricError) || this.maximumGeometricError < 0)
            throw new RangeError("maximumGeometricError must be non-negative and finite.");
        if (!this.rootUrl.trim()) {
            throw new Error("rootUrl must not be empty.");
        }
    }
    getOrigin() {
        if (this.origin) {
            return validateOrigin(this.origin);
        }
        return validateOrigin({
            latitude: this.tileSet.centerCoords.y,
            longitude: this.tileSet.centerCoords.x,
            height: 0,
        });
    }
    getOriginStateKey(origin) {
        return [
            origin.latitude,
            origin.longitude,
            origin.height ?? 0,
            this.heightOffset,
            this.tileSet.isGlobe ? this.tileSet.metresToWorld : this.tileSet.tileScale,
            this.exaggeration,
        ].join(":");
    }
    getRootTilesetURL() {
        return this.authenticateURL(this.rootUrl, this.rootUrl, false);
    }
    async loadRootTileset(generation) {
        const rootUrl = this.getRootTilesetURL();
        const requestKey = `${rootUrl}|${this.apiKey}`;
        if (this.rootTileset && this.rootRequestKey === requestKey) {
            return;
        }
        this.stats.hierarchyRequests++;
        const tileset = await this.tilesetLoader(rootUrl);
        if (generation !== this.generation)
            return;
        this.rootTileset = tileset;
        if (!this.rootTileset || !this.rootTileset.root) {
            throw new Error("Google 3D Tiles root response did not contain a root tile.");
        }
        this.rootRequestKey = requestKey;
        this.session = undefined;
        this.externalTilesets.clear();
    }
    authenticateURL(uri, baseUrl, includeSession = true) {
        const url = new URL(uri, baseUrl);
        const uriSession = url.searchParams.get("session");
        if (uriSession) {
            this.session = uriSession;
        }
        else if (includeSession && (new URL(baseUrl).searchParams.get("session") || this.session)) {
            url.searchParams.set("session", new URL(baseUrl).searchParams.get("session") || this.session);
        }
        url.searchParams.set("key", this.apiKey);
        return url.toString();
    }
    async loadExternalTileset(uri, baseUrl, priority = 0, generation = this.generation) {
        const url = this.authenticateURL(uri, baseUrl);
        const cached = this.externalTilesets.get(url);
        if (cached) {
            return cached.catch(error => {
                if (generation === this.generation && error instanceof DOMException && error.name === "AbortError")
                    return this.loadExternalTileset(uri, baseUrl, priority, generation);
                throw error;
            });
        }
        const request = this.networkSlot(() => {
            if (generation !== this.generation)
                throw new DOMException("Superseded tile selection", "AbortError");
            this.stats.hierarchyRequests++;
            return this.tilesetLoader(url);
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
    cameraEye() {
        const camera = this.tileSet.scene.activeCamera;
        if (camera && this.tileSet.isGlobe) {
            camera.getViewMatrix();
            const globe = this.tileSet;
            const location = globe.getSurfaceCoordinates(camera.globalPosition);
            return geographicToECEF({ latitude: location.latitude, longitude: location.longitude,
                height: location.elevation / globe.metresToWorld - this.heightOffset });
        }
        return geographicToECEF({ latitude: this.tileSet.centerCoords.y, longitude: this.tileSet.centerCoords.x });
    }
    tilePriority(volume, transform) {
        if (!volume)
            return 0;
        const eye = this.selectionEye ?? this.cameraEye();
        const values = volume.box ?? volume.sphere;
        if (!values)
            return 0;
        const center = Vector3.TransformCoordinates(Vector3.FromArray(values), transform);
        if (volume.box) {
            const axes = [3, 6, 9].map(offset => Vector3.TransformNormal(Vector3.FromArray(values, offset), transform));
            const delta = eye.subtract(center), closest = center.clone();
            const orthogonal = axes.every((axis, i) => axes.every((other, j) => i === j
                || Math.abs(Vector3.Dot(axis, other)) <= 1e-6 * axis.length() * other.length()));
            if (orthogonal) {
                for (const axis of axes)
                    if (axis.lengthSquared())
                        closest.addInPlace(axis.scale(Math.max(-1, Math.min(1, Vector3.Dot(delta, axis) / axis.lengthSquared()))));
                return Vector3.Distance(eye, closest);
            }
            return Math.max(0, Vector3.Distance(eye, center) - axes.reduce((sum, axis) => sum + axis.length(), 0));
        }
        const scale = Math.max(...[Vector3.Right(), Vector3.Up(), Vector3.Forward()].map(axis => Vector3.TransformNormal(axis, transform).length()));
        return Math.max(0, Vector3.Distance(eye, center) - volume.sphere[3] * scale);
    }
    allowedGeometricError(volume, transform, surroundings = false) {
        const camera = this.tileSet.scene.activeCamera;
        if (!this.maximumScreenSpaceError || !this.tileSet.isGlobe || !camera || !volume)
            return this.maximumGeometricError;
        const globe = this.tileSet;
        const eye = this.selectionEye ?? this.cameraEye();
        let center;
        let radius = 0;
        if (volume.box) {
            center = Vector3.TransformCoordinates(Vector3.FromArray(volume.box), transform);
            const axes = [3, 6, 9].map(offset => Vector3.TransformNormal(Vector3.FromArray(volume.box, offset), transform));
            const orthogonal = axes.every((axis, i) => axes.every((other, j) => i === j
                || Math.abs(Vector3.Dot(axis, other)) <= 1e-6 * axis.length() * other.length()));
            radius = orthogonal ? Math.hypot(...axes.map(axis => axis.length()))
                : axes.reduce((sum, axis) => sum + axis.length(), 0);
        }
        else if (volume.sphere) {
            center = Vector3.TransformCoordinates(Vector3.FromArray(volume.sphere), transform);
            radius = volume.sphere[3] * Math.max(...[Vector3.Right(), Vector3.Up(), Vector3.Forward()].map(axis => Vector3.TransformNormal(axis, transform).length()));
        }
        else if (volume.region) {
            const [west, south, east, north, low, high] = volume.region;
            center = geographicToECEF({ latitude: (south + north) / 2 / RADIANS_PER_DEGREE,
                longitude: (west + east) / 2 / RADIANS_PER_DEGREE, height: (low + high) / 2 });
            for (const latitude of [south, north])
                for (const longitude of [west, east])
                    radius = Math.max(radius, Vector3.Distance(center, geographicToECEF({ latitude: latitude / RADIANS_PER_DEGREE, longitude: longitude / RADIANS_PER_DEGREE, height: high })));
        }
        else
            return this.maximumGeometricError;
        // Globe-spanning hierarchy volumes contain the Earth centre and have no
        // meaningful surface latitude. Refine them before doing camera projection.
        if (center.length() <= radius + WGS84_SEMI_MAJOR_AXIS * 0.1)
            return 0;
        const longitude = Math.atan2(center.y, center.x);
        const horizontal = Math.hypot(center.x, center.y);
        let latitude = Math.atan2(center.z, horizontal * (1 - WGS84_FIRST_ECCENTRICITY_SQUARED));
        let altitude = 0;
        for (let i = 0; i < 5; i++) {
            const normal = WGS84_SEMI_MAJOR_AXIS / Math.sqrt(1 - WGS84_FIRST_ECCENTRICITY_SQUARED * Math.sin(latitude) ** 2);
            altitude = horizontal / Math.max(1e-12, Math.cos(latitude)) - normal;
            latitude = Math.atan2(center.z, horizontal * (1 - WGS84_FIRST_ECCENTRICITY_SQUARED * normal / (normal + altitude)));
        }
        const world = globe.getSurfacePosition(latitude / RADIANS_PER_DEGREE, longitude / RADIANS_PER_DEGREE, (altitude + this.heightOffset) * globe.metresToWorld);
        // Keep broad coverage behind the camera, but spend detail on the visible view.
        const planes = Frustum.GetPlanes(camera.getTransformationMatrix());
        const visible = !planes.some(plane => plane.dotCoordinate(world) < -radius * globe.metresToWorld);
        if (this.cullToCamera && !visible && !surroundings)
            return -1;
        let distance = Math.max(1, Vector3.Distance(eye, center) - radius);
        if (volume.box) {
            // A sphere around a long city block greatly exaggerates proximity.
            // Measure distance to its oriented box for the refinement decision.
            const axes = [3, 6, 9].map(offset => Vector3.TransformNormal(Vector3.FromArray(volume.box, offset), transform));
            const orthogonal = axes.every((axis, i) => axes.every((other, j) => i === j
                || Math.abs(Vector3.Dot(axis, other)) < 1e-6 * axis.length() * other.length()));
            if (orthogonal) {
                const delta = eye.subtract(center);
                const closest = center.clone();
                for (const axis of axes) {
                    const lengthSquared = axis.lengthSquared();
                    if (lengthSquared)
                        closest.addInPlace(axis.scale(Math.max(-1, Math.min(1, Vector3.Dot(delta, axis) / lengthSquared))));
                }
                distance = Math.max(1, Vector3.Distance(eye, closest));
            }
        }
        return this.maximumScreenSpaceError * (visible ? 1 : 4) * 2 * distance * Math.tan(camera.fov / 2)
            / this.tileSet.scene.getEngine().getRenderHeight();
    }
    /** A complete renderable frontier: refine the largest projected error first.
     * A budget limit leaves a parent in place instead of dropping its siblings.
     */
    async selectFrontier(desired, generation, onStable, surroundings = false) {
        const bounds = this.getTileSetBounds();
        const budget = surroundings ? Math.min(512, this.maxTiles) : this.maxTiles;
        const camera = this.tileSet.scene.activeCamera;
        const key = JSON.stringify([bounds, this.selectionEye?.asArray(),
            camera && Array.from(camera.getViewMatrix().m), camera && Array.from(camera.getProjectionMatrix().m),
            this.tileSet.scene.getEngine().getRenderHeight(), budget, this.maxDepth,
            this.maximumScreenSpaceError, this.maximumDisplayGeometricError, this.cullToCamera,
            this.maximumGeometricError, this.originStateKey, this.rootRequestKey, surroundings, this.coverageRegion]);
        if (this.frontierCache?.key === key) {
            for (const selection of this.frontierCache.selections) {
                desired.set(selection.url, selection);
                if (!this.loadedTiles.has(selection.url))
                    onStable(selection);
            }
            return;
        }
        const requiredBounds = this.coverageRegion && {
            south: this.coverageRegion.south, north: this.coverageRegion.north,
            longitudes: [[this.coverageRegion.west, this.coverageRegion.east]],
        };
        const required = (volume, transform) => !!requiredBounds && boundingVolumeIntersects(volume, requiredBounds, transform);
        let hierarchyFailed = false;
        let lastYield = performance.now();
        const firstContent = async (tile, responseUrl, depth, parentTransform, parentRefine, ancestors = []) => {
            if (performance.now() - lastYield > 6) {
                lastYield = performance.now();
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            if (generation !== this.generation || depth > this.maxDepth)
                return [];
            const transform = getTileTransform(tile)?.multiply(parentTransform) ?? parentTransform;
            if (!boundingVolumeIntersects(tile.boundingVolume, bounds, transform))
                return [];
            let allowed = this.allowedGeometricError(tile.boundingVolume, transform, surroundings);
            const inRegion = required(tile.boundingVolume, transform);
            if (allowed < 0 && !inRegion)
                return [];
            if (inRegion)
                allowed = allowed < 0 ? this.maximumDisplayGeometricError ?? 33
                    : Math.min(allowed, this.maximumDisplayGeometricError ?? 33);
            const refine = tile.refine?.toUpperCase() ?? parentRefine;
            const contents = getTileContents(tile);
            const selections = contents.filter(content => !isTilesetContent(content)).map(content => ({
                url: this.authenticateURL(getContentURI(content), responseUrl), depth, ancestors, geometricError: tile.geometricError,
                boundingVolume: tile.boundingVolume,
                transform: transform.isIdentity() ? undefined : Array.from(transform.m),
            }));
            const node = { tile, responseUrl, depth, transform, refine, selections, ancestors,
                priority: (tile.geometricError ?? Infinity) / Math.max(allowed, 1e-12) };
            if (selections.length)
                return [node];
            return children(node);
        };
        const children = async (node) => {
            if (node.depth >= this.maxDepth)
                return [];
            const branches = (node.tile.children ?? []).map(child => firstContent(child, node.responseUrl, node.depth + 1, node.transform, node.refine, node.ancestors.concat(node.selections.map(selection => selection.url))));
            for (const content of getTileContents(node.tile).filter(isTilesetContent)) {
                branches.push(this.loadExternalTileset(getContentURI(content), node.responseUrl, this.tilePriority(node.tile.boundingVolume, node.transform), generation).then(external => firstContent(external.tileset.root, external.url, node.depth + 1, node.transform, node.refine, node.ancestors.concat(node.selections.map(selection => selection.url)))));
            }
            return (await Promise.all(branches)).reduce((all, branch) => all.concat(branch), []);
        };
        const initial = await firstContent(this.rootTileset.root, this.getRootTilesetURL(), 0, Matrix.Identity(), "REPLACE");
        const frontier = new Set(initial);
        let count = initial.reduce((sum, node) => sum + node.selections.length, 0);
        if (count > budget)
            throw new Error("The first renderable Google tile level exceeds the configured tile budget.");
        const queue = [...initial];
        const settled = new Set();
        const renderable = (node) => this.maximumDisplayGeometricError === undefined
            || (node.tile.geometricError ?? 0) <= this.maximumDisplayGeometricError;
        const settle = (node) => {
            if (settled.has(node))
                return;
            settled.add(node);
            if (renderable(node))
                node.selections.forEach(onStable);
        };
        const commits = [];
        const committed = new Set();
        let checkedSettled = -1;
        const flushReplacements = () => {
            if (surroundings || checkedSettled === settled.size)
                return;
            checkedSettled = settled.size;
            const groups = new Map();
            for (const node of frontier)
                for (const selection of node.selections) {
                    const ancestor = [...(selection.ancestors ?? []), selection.url].find(url => this.loadedTiles.has(url));
                    if (!ancestor || committed.has(ancestor))
                        continue;
                    const members = groups.get(ancestor) ?? [];
                    if (!members.includes(node))
                        members.push(node);
                    groups.set(ancestor, members);
                }
            for (const [ancestor, members] of groups) {
                if (!members.every(node => settled.has(node) && renderable(node))
                    || members.some(node => node.selections.some(selection => selection.url === ancestor)))
                    continue;
                committed.add(ancestor);
                const batch = new Map();
                for (const node of members)
                    for (const selection of node.selections)
                        batch.set(selection.url, selection);
                commits.push(this.loadReplacementGroups(batch, this.getOrigin(), generation));
            }
        };
        const pending = new Map();
        while ((queue.length || pending.size) && generation === this.generation) {
            if (count >= budget) {
                queue.splice(0).forEach(settle);
            }
            const distances = new Map(queue.map(node => [node, this.tilePriority(node.tile.boundingVolume, node.transform)]));
            const front = surroundings ? new Map(queue.map(node => [node, this.allowedGeometricError(node.tile.boundingVolume, node.transform) >= 0])) : undefined;
            queue.sort((a, b) => {
                const bandA = Math.floor(Math.log2(1 + distances.get(a) / 250));
                const bandB = Math.floor(Math.log2(1 + distances.get(b) / 250));
                const backgroundOrder = front ? Number(front.get(a)) - Number(front.get(b)) : 0;
                // Reserve part of the frontier for usable city-wide coverage
                // after the first nearby detail patch has been selected.
                const coverageOrder = count >= Math.min(128, budget / 4) ? Number(!renderable(b) && required(b.tile.boundingVolume, b.transform))
                    - Number(!renderable(a) && required(a.tile.boundingVolume, a.transform)) : 0;
                return coverageOrder || backgroundOrder || bandA - bandB || b.priority - a.priority || distances.get(a) - distances.get(b);
            });
            while (queue.length && pending.size < 16) {
                const node = queue.shift();
                if (node.priority <= 1) {
                    settle(node);
                    continue;
                }
                pending.set(node, children(node).then(next => ({ node, next }), () => ({ node, next: undefined })));
            }
            flushReplacements();
            if (!pending.size)
                continue;
            const { node, next } = await Promise.race(Array.from(pending.values()));
            pending.delete(node);
            if (generation !== this.generation)
                return;
            if (!next) {
                hierarchyFailed = true;
                settle(node);
                continue;
            }
            const extra = next.reduce((sum, child) => sum + child.selections.length, 0)
                - (node.refine === "ADD" ? 0 : node.selections.length);
            if (!next.length) {
                const contents = getTileContents(node.tile);
                const leaf = !(node.tile.children?.length) && !contents.some(isTilesetContent);
                const visibleEmptyChild = node.tile.children?.some(child => {
                    if (getTileContents(child).length || child.children?.length)
                        return false;
                    const transform = getTileTransform(child)?.multiply(node.transform) ?? node.transform;
                    return boundingVolumeIntersects(child.boundingVolume, bounds, transform)
                        && this.allowedGeometricError(child.boundingVolume, transform, surroundings) >= 0;
                });
                if (node.depth >= this.maxDepth || leaf || visibleEmptyChild)
                    settle(node);
                else {
                    frontier.delete(node);
                    count -= node.selections.length;
                }
                continue;
            }
            if (count + extra > budget) {
                settle(node);
                continue;
            }
            if (node.refine !== "ADD")
                frontier.delete(node);
            else
                settle(node);
            next.forEach(child => { frontier.add(child); queue.push(child); });
            count += extra;
        }
        if (generation !== this.generation)
            return;
        flushReplacements();
        await Promise.all(commits);
        if (generation !== this.generation)
            return;
        if (!surroundings)
            this.stats.detailLimitedTiles = Array.from(frontier).filter(node => node.priority > 1
                && node.depth < this.maxDepth && ((node.tile.children?.length ?? 0) > 0 || getTileContents(node.tile).some(isTilesetContent))).length;
        if (!surroundings)
            this.stats.sourceLimitedTiles = Array.from(frontier).filter(node => node.priority > 1
                && !(node.tile.children?.length) && !getTileContents(node.tile).some(isTilesetContent)).length;
        for (const node of frontier)
            if (renderable(node))
                for (const selection of node.selections)
                    desired.set(selection.url, selection);
        if (!hierarchyFailed && !surroundings)
            this.frontierCache = { key, selections: Array.from(desired.values()) };
    }
    async collectTileContent(tile, responseUrl, depth, bounds, desiredTiles, parentTransform = Matrix.Identity(), parentRefine = "REPLACE", generation = this.generation, onSelection) {
        if (generation !== this.generation || desiredTiles.size >= this.maxTiles) {
            return 0;
        }
        const contents = getTileContents(tile);
        const tileTransform = getTileTransform(tile);
        const accumulatedTransform = tileTransform
            ? tileTransform.multiply(parentTransform)
            : parentTransform;
        if (!boundingVolumeIntersects(tile.boundingVolume, bounds, accumulatedTransform))
            return 0;
        const refine = tile.refine?.toUpperCase() ?? parentRefine;
        let descendantCount = 0;
        const allowedError = this.allowedGeometricError(tile.boundingVolume, accumulatedTransform);
        if (allowedError < 0)
            return 0;
        const sufficientDetail = contents.some(content => !isTilesetContent(content))
            && tile.geometricError !== undefined && tile.geometricError <= allowedError;
        if (depth < this.maxDepth && !sufficientDetail) {
            const childCounts = await Promise.all((tile.children ?? []).map(child => this.collectTileContent(child, responseUrl, depth + 1, bounds, desiredTiles, accumulatedTransform, refine, generation, onSelection)));
            descendantCount += childCounts.reduce((sum, count) => sum + count, 0);
            if (desiredTiles.size < this.maxTiles) {
                for (const content of contents) {
                    if (!isTilesetContent(content)) {
                        continue;
                    }
                    try {
                        const external = await this.loadExternalTileset(getContentURI(content), responseUrl, this.tilePriority(tile.boundingVolume, accumulatedTransform), generation);
                        descendantCount += await this.collectTileContent(external.tileset.root, external.url, depth + 1, bounds, desiredTiles, accumulatedTransform, refine, generation, onSelection);
                    }
                    catch (error) {
                        if (generation === this.generation)
                            console.warn("Unable to load a Google 3D Tiles child tileset:", error);
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
            || (descendantCount === 0 && tile.children?.some(child => !getTileContents(child).length && !child.children?.length
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
                    boundingVolume: tile.boundingVolume,
                    transform: accumulatedTransform.isIdentity()
                        ? undefined
                        : Array.from(accumulatedTransform.m),
                });
                onSelection?.(desiredTiles.get(url));
                descendantCount++;
            }
        }
        return descendantCount;
    }
    retireTile(url) {
        const tile = this.loadedTiles.get(url);
        if (!tile)
            return;
        tile.root.setEnabled(false);
        this.loadedTiles.delete(url);
        this.retainedTiles.set(url, tile);
        this.trimRetainedTiles();
        this.coverageKey = "";
        this.coverageVersion++;
    }
    /** Commit disjoint replacement subtrees only after every new model is ready. */
    async loadReplacementGroups(desired, origin, generation) {
        const groups = new Map();
        for (const selection of Array.from(desired.values())) {
            const finerVisible = Array.from(this.loadedSelections).filter(([url, old]) => this.loadedTiles.has(url)
                && old.ancestors?.includes(selection.url));
            const transform = selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity();
            if (finerVisible.length && selection.geometricError !== undefined
                && selection.geometricError > this.allowedGeometricError(selection.boundingVolume, transform)) {
                // The budget is not permission to visibly coarsen resident detail.
                desired.delete(selection.url);
                for (const [url, old] of finerVisible)
                    desired.set(url, old);
                continue;
            }
            const ancestor = selection.ancestors?.find(url => this.loadedTiles.has(url));
            const key = ancestor ?? selection.url;
            let group = groups.get(key);
            if (!group) {
                group = { next: [], previous: new Set() };
                groups.set(key, group);
            }
            group.next.push(selection);
            if (ancestor)
                group.previous.add(ancestor);
            for (const [url, old] of this.loadedSelections) {
                if (this.loadedTiles.has(url) && old.ancestors?.includes(selection.url))
                    group.previous.add(url);
            }
        }
        await Promise.all(Array.from(groups.values()).map(async (group) => {
            const models = await Promise.all(group.next.map(selection => this.loadTile(selection, origin, generation, false).catch(() => undefined)));
            if (generation !== this.generation)
                return;
            if (models.some(model => !model)) {
                // Failed refinement must not remove valid coverage.
                for (const url of group.previous) {
                    const old = this.loadedSelections.get(url);
                    if (old)
                        desired.set(url, old);
                }
                return;
            }
            for (let i = 0; i < models.length; i++) {
                const model = models[i];
                this.retainedTiles.delete(model.url);
                this.loadedTiles.set(model.url, model);
                this.loadedSelections.set(model.url, group.next[i]);
                model.root.setEnabled(true);
            }
            for (const url of group.previous)
                if (!desired.has(url))
                    this.retireTile(url);
            this.coverageKey = "";
            this.coverageVersion++;
            this.updateAttribution();
        }));
    }
    loadTile(selection, origin, generation, activate = true) {
        const existing = this.pendingModels.get(selection.url);
        if (existing?.generation === generation)
            return existing.request;
        if (existing) {
            // Camera movement can still need a download started by the previous view.
            return existing.request.catch(() => undefined).then(() => {
                if (generation !== this.generation)
                    return undefined;
                return this.loadTile(selection, origin, generation, activate);
            });
        }
        const request = this.loadTileAsset(selection, origin, generation, activate);
        const entry = { generation, request };
        this.pendingModels.set(selection.url, entry);
        void request.then(() => {
            if (this.pendingModels.get(selection.url) === entry)
                this.pendingModels.delete(selection.url);
        }, () => {
            if (this.pendingModels.get(selection.url) === entry)
                this.pendingModels.delete(selection.url);
        });
        return request;
    }
    async loadTileAsset(selection, origin, generation, activate = true) {
        const loaded = this.loadedTiles.get(selection.url);
        if (loaded) {
            return loaded;
        }
        const retained = this.retainedTiles.get(selection.url);
        if (retained) {
            if (activate) {
                this.retainedTiles.delete(selection.url);
                this.loadedTiles.set(selection.url, retained);
                this.loadedSelections.set(selection.url, selection);
                this.coverageKey = "";
                this.coverageVersion++;
                retained.root.setEnabled(true);
            }
            return retained;
        }
        const request = this.networkSlot(async () => {
            if (generation !== this.generation)
                return undefined;
            this.stats.modelRequests++;
            return this.modelTileLoader(selection.url, this.tileSet.scene);
        }, this.tilePriority(selection.boundingVolume, selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity())).then((model) => {
            if (!model) {
                return undefined;
            }
            if (this.getOriginStateKey(origin) !== this.originStateKey) {
                model.asset.dispose();
                return undefined;
            }
            const root = this.createTileRoot(selection, origin, model.rtcCenter);
            // Preserve the source image resolution while keeping oblique views
            // sharp and mip transitions smooth. Babylon clamps to hardware caps.
            for (const texture of model.asset.textures) {
                texture.anisotropicFilteringLevel = this.tileSet.scene.getEngine().getCaps().maxAnisotropy;
                if (texture instanceof Texture)
                    texture.updateSamplingMode(Texture.TRILINEAR_SAMPLINGMODE);
            }
            model.asset.addAllToScene();
            for (const node of model.asset.rootNodes) {
                node.parent = root;
            }
            const result = {
                url: selection.url,
                depth: selection.depth,
                root,
                asset: model.asset,
                attributions: [...model.attributions],
            };
            if (generation !== this.generation || !this.desiredTiles.has(selection.url)) {
                root.setEnabled(false);
                this.retainedTiles.set(selection.url, result);
                this.trimRetainedTiles();
                return undefined;
            }
            if (!activate) {
                root.setEnabled(false);
                this.retainedTiles.set(selection.url, result);
                return result;
            }
            this.loadedTiles.set(selection.url, result);
            this.loadedSelections.set(selection.url, selection);
            this.coverageKey = "";
            this.coverageVersion++;
            this.updateAttribution();
            return result;
        });
        return request;
    }
    createTileRoot(selection, origin, rtcCenter) {
        const originEcef = geographicToECEF(origin);
        const centerEcef = rtcCenter ?? Vector3.Zero();
        const east = new Vector3(-Math.sin(origin.longitude * RADIANS_PER_DEGREE), Math.cos(origin.longitude * RADIANS_PER_DEGREE), 0);
        const north = new Vector3(-Math.sin(origin.latitude * RADIANS_PER_DEGREE)
            * Math.cos(origin.longitude * RADIANS_PER_DEGREE), -Math.sin(origin.latitude * RADIANS_PER_DEGREE)
            * Math.sin(origin.longitude * RADIANS_PER_DEGREE), Math.cos(origin.latitude * RADIANS_PER_DEGREE));
        const up = new Vector3(Math.cos(origin.latitude * RADIANS_PER_DEGREE)
            * Math.cos(origin.longitude * RADIANS_PER_DEGREE), Math.cos(origin.latitude * RADIANS_PER_DEGREE)
            * Math.sin(origin.longitude * RADIANS_PER_DEGREE), Math.sin(origin.latitude * RADIANS_PER_DEGREE));
        const globe = this.tileSet.isGlobe ? this.tileSet : undefined;
        const scale = globe ? globe.metresToWorld : this.tileSet.tileScale;
        const originOnMap = globe ? Vector3.Zero() : this.tileSet.ourTileMath.EPSG_to_Game(new Vector2(origin.longitude, origin.latitude), EPSG_Type.EPSG_4326);
        const ecefToLocal = Matrix.FromValues(east.x, up.x, north.x, 0, east.y, up.y, north.y, 0, east.z, up.z, north.z, 0, -Vector3.Dot(originEcef, east), -Vector3.Dot(originEcef, up), -Vector3.Dot(originEcef, north), 1);
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
                .multiply(Matrix.FromValues(globeEast.x, globeEast.y, globeEast.z, 0, normal.x, normal.y, normal.z, 0, globeNorth.x, globeNorth.y, globeNorth.z, 0, surface.x, surface.y, surface.z, 1));
        }
        const root = new TransformNode(`Google 3D Tile ${selection.depth}`, this.tileSet.scene);
        root.setPreTransformMatrix(transform);
        return root;
    }
    disposeTile(url) {
        const loaded = this.loadedTiles.get(url);
        if (!loaded) {
            return;
        }
        loaded.asset.dispose();
        loaded.root.dispose(false, false);
        this.loadedTiles.delete(url);
    }
    disposeLoadedTiles() {
        this.frontierCache = undefined;
        for (const tile of this.retainedTiles.values()) {
            tile.asset.dispose();
            tile.root.dispose(false, false);
        }
        this.retainedTiles.clear();
        this.loadedSelections.clear();
        this.coverageKey = "";
        this.coverageVersion++;
        for (const url of Array.from(this.loadedTiles.keys())) {
            this.disposeTile(url);
        }
    }
    updateAttribution() {
        const attribution = this.tileSet.ourAttribution;
        if (!this.googleAttributionAdded) {
            attribution.addAttribution("GOOGLE");
            this.googleAttributionAdded = true;
        }
        attribution.setGoogleAttributions?.(this.getAttributions());
    }
    getTileSetBounds() {
        this.tileSet.assertRasterSetup("calculate Google 3D Tiles bounds");
        let south = 90;
        let north = -90;
        const longitudes = [];
        for (const tile of this.tileSet.ourTiles) {
            const west = this.tileSet.ourTileMath.tile_to_lon(tile.tileCoords.x, tile.tileCoords.z);
            const east = this.tileSet.ourTileMath.tile_to_lon(tile.tileCoords.x + 1, tile.tileCoords.z);
            const tileNorth = this.tileSet.ourTileMath.tile_to_lat(tile.tileCoords.y, tile.tileCoords.z);
            const tileSouth = this.tileSet.ourTileMath.tile_to_lat(tile.tileCoords.y + 1, tile.tileCoords.z);
            south = Math.min(south, tileSouth);
            north = Math.max(north, tileNorth);
            if (east - west >= 360) {
                longitudes.push([-180, 180]);
            }
            else {
                const normalizedWest = normalizeLongitude(west);
                const normalizedEast = normalizeLongitude(east);
                if (normalizedWest <= normalizedEast)
                    longitudes.push([normalizedWest, normalizedEast]);
                else
                    longitudes.push([normalizedWest, 180], [-180, normalizedEast]);
            }
        }
        if (this.coverageRadius) {
            const center = this.tileSet.centerCoords;
            const angular = this.coverageRadius / WGS84_SEMI_MAJOR_AXIS / RADIANS_PER_DEGREE;
            south = Math.max(-90, center.y - angular);
            north = Math.min(90, center.y + angular);
            const longitudeRadius = Math.min(180, angular / Math.max(0.01, Math.cos(center.y * RADIANS_PER_DEGREE)));
            const west = normalizeLongitude(center.x - longitudeRadius), east = normalizeLongitude(center.x + longitudeRadius);
            longitudes.length = 0;
            if (west <= east)
                longitudes.push([west, east]);
            else
                longitudes.push([west, 180], [-180, east]);
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
            for (const lat of [south, north])
                for (const lon of [west, east])
                    for (const height of [-12000, 12000]) {
                        const point = geographicToECEF({ latitude: lat, longitude: lon, height }).subtract(originECEF);
                        axes.forEach((axis, index) => {
                            const projected = Vector3.Dot(point, axis);
                            minimum[index] = Math.min(minimum[index], projected);
                            maximum[index] = Math.max(maximum[index], projected);
                        });
                    }
        }
        return { south, north, longitudes, localVolume: north - south < 30
                && longitudes.every(([west, east]) => east - west < 30)
                ? { origin: originECEF, axes, minimum, maximum } : undefined };
    }
}
async function defaultTilesetLoader(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Unable to load Google 3D Tileset (${response.status} ${response.statusText}).`);
    }
    return response.json();
}
async function defaultModelTileLoader(url, scene) {
    const response = await fetch(url);
    if (response.status === 204 || response.status === 404) {
        return undefined;
    }
    if (!response.ok) {
        throw new Error(`Unable to load Google 3D model tile (${response.status} ${response.statusText}).`);
    }
    const buffer = await response.arrayBuffer();
    const metadata = parseGoogleGLBMetadata(buffer);
    // Babylon uses the file name in embedded-texture cache keys. Each
    // GLB has a different image atlas, even when all images are called image0.
    const file = new File([buffer], `google-photorealistic-tile-${nextModelFileId++}.glb`, { type: "model/gltf-binary" });
    await import("@babylonjs/loaders/glTF/index.js");
    const asset = await SceneLoader.LoadAssetContainerAsync("", file, scene, undefined, ".glb");
    return {
        asset,
        attributions: metadata.attributions,
        rtcCenter: metadata.rtcCenter,
    };
}
/** Extracts Google attribution and CESIUM_RTC metadata from a GLB JSON chunk. */
export function parseGoogleGLBMetadata(buffer) {
    const empty = { attributions: [] };
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
                const json = JSON.parse(decoder.decode(new Uint8Array(buffer, chunkStart, chunkLength)).replace(/\0+$/, ""));
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
            }
            catch {
                return empty;
            }
        }
        offset = chunkEnd;
    }
    return empty;
}
function getTileContents(tile) {
    const contents = [];
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
function getTileTransform(tile) {
    if (!tile.transform || tile.transform.length !== 16) {
        return undefined;
    }
    if (!tile.transform.every((value) => Number.isFinite(value))) {
        return undefined;
    }
    return Matrix.FromArray(tile.transform);
}
function getContentURI(content) {
    const uri = getContentURIOrUndefined(content);
    if (!uri) {
        throw new Error("Google 3D Tiles content did not contain a uri or url.");
    }
    return uri;
}
function getContentURIOrUndefined(content) {
    return typeof content.uri === "string" ? content.uri : typeof content.url === "string" ? content.url : undefined;
}
function isTilesetContent(content) {
    const uri = getContentURI(content).split("?", 1)[0].toLowerCase();
    return content.mimeType === "application/json" || uri.endsWith(".json");
}
function boundingVolumeIntersects(boundingVolume, bounds, transform) {
    const region = boundingVolume?.region;
    if (!region || region.length < 4) {
        const box = boundingVolume?.box;
        const sphere = boundingVolume?.sphere;
        if (!box && !sphere)
            return true;
        const values = box ?? sphere;
        if (values.length !== (box ? 12 : 4) || !values.every(Number.isFinite))
            return true;
        const center = Vector3.TransformCoordinates(Vector3.FromArray(values), transform);
        const halfAxes = box ? [3, 6, 9].map(offset => Vector3.TransformNormal(Vector3.FromArray(box, offset), transform)) : undefined;
        let radius;
        if (box) {
            // Sum half-axis lengths conservatively encloses a transformed box,
            // including nonuniform scaling and shear.
            radius = halfAxes.reduce((sum, axis) => sum + axis.length(), 0);
        }
        else {
            const m = transform.m;
            const norm1 = Math.max(...[0, 4, 8].map(i => Math.abs(m[i]) + Math.abs(m[i + 1]) + Math.abs(m[i + 2])));
            const normInf = Math.max(...[0, 1, 2].map(i => Math.abs(m[i]) + Math.abs(m[i + 4]) + Math.abs(m[i + 8])));
            radius = Math.abs(sphere[3]) * Math.sqrt(norm1 * normInf);
        }
        if (bounds.localVolume) {
            const volume = bounds.localVolume;
            const relativeCenter = center.subtract(volume.origin);
            return volume.axes.every((axis, index) => {
                const projected = Vector3.Dot(relativeCenter, axis);
                const extent = halfAxes ? halfAxes.reduce((sum, halfAxis) => sum + Math.abs(Vector3.Dot(halfAxis, axis)), 0) : radius;
                return projected + extent >= volume.minimum[index]
                    && projected - extent <= volume.maximum[index];
            });
        }
        const distance = center.length();
        if (radius >= distance)
            return true;
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
        ? [[west, east]]
        : [[west, 180], [-180, east]];
    return regionLongitudes.some(([regionWest, regionEast]) => {
        return bounds.longitudes.some(([boundsWest, boundsEast]) => {
            return regionEast >= boundsWest && regionWest <= boundsEast;
        });
    });
}
function normalizeLongitude(longitude) {
    const normalized = ((longitude + 180) % 360 + 360) % 360 - 180;
    return normalized === -180 ? -180 : normalized;
}
function validateOrigin(origin) {
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
function geographicToECEF(origin) {
    const latitude = origin.latitude * RADIANS_PER_DEGREE;
    const longitude = origin.longitude * RADIANS_PER_DEGREE;
    const sinLatitude = Math.sin(latitude);
    const cosLatitude = Math.cos(latitude);
    const radius = WGS84_SEMI_MAJOR_AXIS
        / Math.sqrt(1 - WGS84_FIRST_ECCENTRICITY_SQUARED * sinLatitude * sinLatitude);
    const height = origin.height ?? 0;
    return new Vector3((radius + height) * cosLatitude * Math.cos(longitude), (radius + height) * cosLatitude * Math.sin(longitude), (radius * (1 - WGS84_FIRST_ECCENTRICITY_SQUARED) + height)
        * sinLatitude);
}
// Intersect a geographic vertical segment with the tile's oriented volume.
// Unlike a longitude/latitude AABB, this respects rotated Google tile edges.
function verticalIntersectsVolume(latitude, longitude, volume, transform) {
    if (volume.region) {
        const region = volume.region;
        const lon = longitude * RADIANS_PER_DEGREE, lat = latitude * RADIANS_PER_DEGREE;
        return lat >= region[1] && lat <= region[3]
            && (region[0] <= region[2] ? lon >= region[0] && lon <= region[2] : lon >= region[0] || lon <= region[2]);
    }
    let start = geographicToECEF({ latitude, longitude, height: -12000 });
    let end = geographicToECEF({ latitude, longitude, height: 12000 });
    if (transform) {
        const inverse = Matrix.Invert(Matrix.FromArray(transform));
        start = Vector3.TransformCoordinates(start, inverse);
        end = Vector3.TransformCoordinates(end, inverse);
    }
    const direction = end.subtract(start);
    if (volume.box?.length === 12) {
        const box = volume.box, center = Vector3.FromArray(box);
        let near = 0, far = 1;
        for (let i = 3; i < 12; i += 3) {
            const axis = Vector3.FromArray(box, i), length = axis.length();
            if (length === 0)
                return false;
            axis.scaleInPlace(1 / length);
            const position = Vector3.Dot(start.subtract(center), axis);
            const velocity = Vector3.Dot(direction, axis);
            if (Math.abs(velocity) < 1e-10) {
                if (Math.abs(position) > length)
                    return false;
            }
            else {
                const a = (-length - position) / velocity, b = (length - position) / velocity;
                near = Math.max(near, Math.min(a, b));
                far = Math.min(far, Math.max(a, b));
                if (near > far)
                    return false;
            }
        }
        return true;
    }
    if (volume.sphere?.length === 4) {
        const center = Vector3.FromArray(volume.sphere);
        const t = Math.max(0, Math.min(1, Vector3.Dot(center.subtract(start), direction) / direction.lengthSquared()));
        return Vector3.DistanceSquared(start.add(direction.scale(t)), center) <= volume.sphere[3] ** 2;
    }
    return false;
}
//# sourceMappingURL=Google3DTiles.js.map