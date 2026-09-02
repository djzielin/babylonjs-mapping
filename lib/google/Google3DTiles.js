import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.js";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
/** Google Maps Platform Map Tiles API Photorealistic 3D Tiles endpoint. */
export const GOOGLE_3D_TILES_ROOT_URL = "https://tile.googleapis.com/v1/3dtiles/root.json";
const WGS84_SEMI_MAJOR_AXIS = 6378137;
const WGS84_FIRST_ECCENTRICITY_SQUARED = 6.6943799901413165e-3;
const RADIANS_PER_DEGREE = Math.PI / 180;
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
    constructor(tileSet, options = {}) {
        this.tileSet = tileSet;
        this.apiKey = "";
        this.rootRequestKey = "";
        this.externalTilesets = new Map();
        this.loadedTiles = new Map();
        this.inFlightTiles = new Map();
        this.desiredTiles = new Map();
        this.originStateKey = "";
        this.googleAttributionAdded = false;
        this.rootUrl = options.rootUrl ?? GOOGLE_3D_TILES_ROOT_URL;
        this.maxDepth = options.maxDepth ?? 6;
        this.maxTiles = options.maxTiles ?? 64;
        this.exaggeration = options.exaggeration ?? 1;
        this.origin = options.origin;
        this.apiKey = options.apiKey ?? "";
        this.tilesetLoader = options.tilesetLoader ?? defaultTilesetLoader;
        this.modelTileLoader = options.modelTileLoader ?? defaultModelTileLoader;
    }
    /** Content currently attached to the Babylon scene. */
    get loadedModelTiles() {
        return Array.from(this.loadedTiles.values());
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
    /** Loads content that overlaps the current TileSet. */
    async load() {
        this.tileSet.assertRasterSetup("load Google 3D Tiles");
        this.validateOptions();
        const origin = this.getOrigin();
        const originStateKey = this.getOriginStateKey(origin);
        if (this.originStateKey !== "" && this.originStateKey !== originStateKey) {
            this.disposeLoadedTiles();
        }
        this.originStateKey = originStateKey;
        await this.loadRootTileset();
        if (!this.rootTileset) {
            throw new Error("Google 3D Tiles root tileset was not loaded.");
        }
        const desiredTiles = new Map();
        await this.collectTileContent(this.rootTileset.root, this.getRootTilesetURL(), 0, this.getTileSetBounds(), desiredTiles);
        this.desiredTiles = desiredTiles;
        for (const url of Array.from(this.loadedTiles.keys())) {
            if (!desiredTiles.has(url)) {
                this.disposeTile(url);
            }
        }
        await Promise.all(Array.from(desiredTiles.values(), (selection) => {
            return this.loadTile(selection, origin).catch((error) => {
                console.warn(`Unable to load Google 3D Tile ${selection.url}:`, error);
                return undefined;
            });
        }));
        this.updateAttribution();
        return this.loadedModelTiles;
    }
    /** Alias matching the building-provider lifecycle used by older examples. */
    async generateBuildings() {
        return this.load();
    }
    /** Disposes loaded GLB assets and clears the provider's request caches. */
    dispose() {
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
            this.tileSet.tileScale,
            this.exaggeration,
        ].join(":");
    }
    getRootTilesetURL() {
        return this.authenticateURL(this.rootUrl, this.rootUrl, false);
    }
    async loadRootTileset() {
        const rootUrl = this.getRootTilesetURL();
        const requestKey = `${rootUrl}|${this.apiKey}`;
        if (this.rootTileset && this.rootRequestKey === requestKey) {
            return;
        }
        this.rootTileset = await this.tilesetLoader(rootUrl);
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
        else if (includeSession && this.session) {
            url.searchParams.set("session", this.session);
        }
        url.searchParams.set("key", this.apiKey);
        return url.toString();
    }
    async loadExternalTileset(uri, baseUrl) {
        const url = this.authenticateURL(uri, baseUrl);
        const cached = this.externalTilesets.get(url);
        if (cached) {
            return cached;
        }
        const request = this.tilesetLoader(url).then((tileset) => {
            if (!tileset || !tileset.root) {
                throw new Error(`Google 3D Tiles response did not contain a root tile: ${url}`);
            }
            return { tileset, url };
        });
        this.externalTilesets.set(url, request);
        return request;
    }
    async collectTileContent(tile, responseUrl, depth, bounds, desiredTiles, parentTransform = Matrix.Identity()) {
        if (desiredTiles.size >= this.maxTiles || !boundingVolumeIntersects(tile.boundingVolume, bounds)) {
            return 0;
        }
        const contents = getTileContents(tile);
        const tileTransform = getTileTransform(tile);
        const accumulatedTransform = tileTransform
            ? tileTransform.multiply(parentTransform)
            : parentTransform;
        let descendantCount = 0;
        if (depth < this.maxDepth) {
            for (const child of tile.children ?? []) {
                descendantCount += await this.collectTileContent(child, responseUrl, depth + 1, bounds, desiredTiles, accumulatedTransform);
                if (desiredTiles.size >= this.maxTiles) {
                    break;
                }
            }
            if (desiredTiles.size < this.maxTiles) {
                for (const content of contents) {
                    if (!isTilesetContent(content)) {
                        continue;
                    }
                    try {
                        const external = await this.loadExternalTileset(getContentURI(content), responseUrl);
                        descendantCount += await this.collectTileContent(external.tileset.root, external.url, depth + 1, bounds, desiredTiles, accumulatedTransform);
                    }
                    catch (error) {
                        console.warn("Unable to load a Google 3D Tiles child tileset:", error);
                    }
                    if (desiredTiles.size >= this.maxTiles) {
                        break;
                    }
                }
            }
        }
        const keepContent = depth >= this.maxDepth
            || descendantCount === 0
            || tile.refine?.toUpperCase() === "ADD";
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
                    transform: accumulatedTransform.isIdentity()
                        ? undefined
                        : Array.from(accumulatedTransform.m),
                });
                descendantCount++;
            }
        }
        return descendantCount;
    }
    async loadTile(selection, origin) {
        const loaded = this.loadedTiles.get(selection.url);
        if (loaded) {
            return loaded;
        }
        const inFlight = this.inFlightTiles.get(selection.url);
        if (inFlight) {
            return inFlight;
        }
        const request = this.modelTileLoader(selection.url, this.tileSet.scene).then((model) => {
            if (!model) {
                return undefined;
            }
            if (!this.desiredTiles.has(selection.url)) {
                model.asset.dispose();
                return undefined;
            }
            const root = this.createTileRoot(selection, origin, model.rtcCenter);
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
            this.loadedTiles.set(selection.url, result);
            return result;
        }).finally(() => {
            this.inFlightTiles.delete(selection.url);
        });
        this.inFlightTiles.set(selection.url, request);
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
        // Babylon's glTF loader adds a right-to-left-handed conversion that
        // negates source X. The first column therefore maps imported X back to
        // ECEF -X; the other columns map imported Y/Z directly to ECEF Y/Z.
        const importedX = new Vector3(-east.x, -up.x, -north.x);
        const importedY = new Vector3(east.y, up.y, north.y);
        const importedZ = new Vector3(east.z, up.z, north.z);
        const scale = this.tileSet.tileScale;
        const centerMinusOrigin = centerEcef.subtract(originEcef);
        const translation = new Vector3(Vector3.Dot(centerMinusOrigin, east) * scale, Vector3.Dot(centerMinusOrigin, up) * scale, Vector3.Dot(centerMinusOrigin, north) * scale);
        const coordinateTransform = Matrix.FromValues(importedX.x, importedX.y, importedX.z, 0, importedY.x, importedY.y, importedY.z, 0, importedZ.x, importedZ.y, importedZ.z, 0, translation.x, translation.y, translation.z, 1);
        const verticalTransform = Matrix.Scaling(1, this.exaggeration, 1);
        let transform = coordinateTransform.multiply(verticalTransform);
        if (selection.transform) {
            // 3D Tiles matrices use the same column-major array layout as
            // Babylon's Matrix. Convert imported Babylon coordinates back to
            // the source right-handed frame before applying the tile matrix.
            // This keeps tile transforms correct when a non-identity transform
            // is present in a nested tileset.
            transform = Matrix.Scaling(-1, 1, 1)
                .multiply(Matrix.FromArray(selection.transform))
                .multiply(coordinateTransform)
                .multiply(verticalTransform);
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
            longitudes.push([west, east]);
        }
        return { south, north, longitudes };
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
    const file = new File([buffer], "google-photorealistic-tile.glb", { type: "model/gltf-binary" });
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
function boundingVolumeIntersects(boundingVolume, bounds) {
    const region = boundingVolume?.region;
    if (!region || region.length < 4) {
        // Box/sphere volumes need a 3D frustum test. Keeping them eligible is
        // conservative and still lets the maxTiles guard protect the caller.
        return true;
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
//# sourceMappingURL=Google3DTiles.js.map