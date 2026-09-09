import { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { Matrix, Vector2, Vector3 } from "@babylonjs/core/Maths/math.js";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";

import { EPSG_Type } from "../core/TileMath.js";

import type TileSet from "../core/TileSet.js";

/** Google Maps Platform Map Tiles API Photorealistic 3D Tiles endpoint. */
export const GOOGLE_3D_TILES_ROOT_URL =
    "https://tile.googleapis.com/v1/3dtiles/root.json";

const WGS84_SEMI_MAJOR_AXIS = 6378137;
const WGS84_FIRST_ECCENTRICITY_SQUARED = 6.6943799901413165e-3;
const RADIANS_PER_DEGREE = Math.PI / 180;

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
}

export type GoogleTilesetLoader = (url: string) => Promise<Google3DTileset>;

export type GoogleModelTileLoader = (
    url: string,
    scene: Scene,
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
}

interface TileSelection {
    url: string;
    depth: number;
    transform?: number[];
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
    public origin?: Google3DTilesOrigin;

    private readonly tilesetLoader: GoogleTilesetLoader;
    private readonly modelTileLoader: GoogleModelTileLoader;
    private rootTileset: Google3DTileset | undefined;
    private rootRequestKey = "";
    private session: string | undefined;
    private readonly externalTilesets = new Map<string, Promise<LoadedTileset>>();
    private readonly loadedTiles = new Map<string, LoadedGoogle3DTile>();
    private generation = 0;
    private desiredTiles = new Map<string, TileSelection>();
    private originStateKey = "";
    private googleAttributionAdded = false;

    constructor(
        public readonly tileSet: TileSet,
        options: Google3DTilesOptions = {},
    ) {
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
    public get loadedModelTiles(): readonly LoadedGoogle3DTile[] {
        return Array.from(this.loadedTiles.values());
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
        const counts = new Map<string, number>();
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
    public getTileURL(uri: string, baseUrl = this.rootUrl): string {
        return this.authenticateURL(uri, baseUrl);
    }

    /** Loads content that overlaps the current TileSet. */
    public async load(): Promise<readonly LoadedGoogle3DTile[]> {
        this.tileSet.assertRasterSetup("load Google 3D Tiles");
        this.validateOptions();

        const generation = ++this.generation;
        const origin = this.getOrigin();
        const originStateKey = this.getOriginStateKey(origin);
        if (this.originStateKey !== "" && this.originStateKey !== originStateKey) {
            this.disposeLoadedTiles();
        }
        this.originStateKey = originStateKey;

        await this.loadRootTileset(generation);
        if (generation !== this.generation) return [];
        if (!this.rootTileset) {
            throw new Error("Google 3D Tiles root tileset was not loaded.");
        }

        const desiredTiles = new Map<string, TileSelection>();
        await this.collectTileContent(
            this.rootTileset.root,
            this.getRootTilesetURL(),
            0,
            this.getTileSetBounds(),
            desiredTiles,
            Matrix.Identity(),
            "REPLACE",
            generation,
        );
        if (generation !== this.generation) return [];
        this.desiredTiles = desiredTiles;

        for (const url of Array.from(this.loadedTiles.keys())) {
            if (!desiredTiles.has(url)) {
                this.disposeTile(url);
            }
        }

        await Promise.all(
            Array.from(desiredTiles.values(), (selection) => {
                return this.loadTile(selection, origin, generation).catch((error: unknown) => {
                    console.warn("Unable to load a Google 3D Tile:", error);
                    return undefined;
                });
            }),
        );

        if (generation !== this.generation) return [];
        this.updateAttribution();
        return this.loadedModelTiles;
    }

    /** Alias matching the building-provider lifecycle used by older examples. */
    public async generateBuildings(): Promise<readonly LoadedGoogle3DTile[]> {
        return this.load();
    }

    /** Disposes loaded GLB assets and clears the provider's request caches. */
    public dispose(): void {
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
            this.tileSet.tileScale,
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

        const tileset = await this.tilesetLoader(rootUrl);
        if (generation !== this.generation) return;
        this.rootTileset = tileset;
        if (!this.rootTileset || !this.rootTileset.root) {
            throw new Error("Google 3D Tiles root response did not contain a root tile.");
        }
        this.rootRequestKey = requestKey;
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

    private async loadExternalTileset(uri: string, baseUrl: string): Promise<LoadedTileset> {
        const url = this.authenticateURL(uri, baseUrl);
        const cached = this.externalTilesets.get(url);
        if (cached) {
            return cached;
        }

        const request = this.tilesetLoader(url).then((tileset) => {
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

    private async collectTileContent(
        tile: Google3DTile,
        responseUrl: string,
        depth: number,
        bounds: GeographicBounds,
        desiredTiles: Map<string, TileSelection>,
        parentTransform = Matrix.Identity(),
        parentRefine = "REPLACE",
        generation = this.generation,
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

        if (depth < this.maxDepth) {
            for (const child of tile.children ?? []) {
                descendantCount += await this.collectTileContent(
                    child,
                    responseUrl,
                    depth + 1,
                    bounds,
                    desiredTiles,
                    accumulatedTransform,
                    refine,
                    generation,
                );
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
                        const external = await this.loadExternalTileset(
                            getContentURI(content),
                            responseUrl,
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
                        );
                    } catch (error) {
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
            || refine === "ADD";
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

    private async loadTile(
        selection: TileSelection,
        origin: Google3DTilesOrigin,
        generation: number,
    ): Promise<LoadedGoogle3DTile | undefined> {
        const loaded = this.loadedTiles.get(selection.url);
        if (loaded) {
            return loaded;
        }

        const request = this.modelTileLoader(selection.url, this.tileSet.scene).then((model) => {
            if (!model) {
                return undefined;
            }
            if (generation !== this.generation || !this.desiredTiles.has(selection.url)) {
                model.asset.dispose();
                return undefined;
            }

            const root = this.createTileRoot(
                selection,
                origin,
                model.rtcCenter,
            );
            model.asset.addAllToScene();
            for (const node of model.asset.rootNodes) {
                node.parent = root;
            }

            const result: LoadedGoogle3DTile = {
                url: selection.url,
                depth: selection.depth,
                root,
                asset: model.asset,
                attributions: [...model.attributions],
            };
            this.loadedTiles.set(selection.url, result);
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

        const scale = this.tileSet.tileScale;
        const originOnMap = this.tileSet.ourTileMath.EPSG_to_Game(
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
        const transform = Matrix.Scaling(this.tileSet.scene.useRightHandedSystem ? 1 : -1, 1, 1)
            .multiply(Matrix.RotationX(Math.PI / 2))
            .multiply(Matrix.Translation(centerEcef.x, centerEcef.y, centerEcef.z))
            .multiply(selection.transform ? Matrix.FromArray(selection.transform) : Matrix.Identity())
            .multiply(ecefToLocal)
            .multiply(Matrix.Scaling(scale, scale * this.exaggeration, scale))
            .multiply(Matrix.Translation(originOnMap.x, 0, originOnMap.z));

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

    private getTileSetBounds(): GeographicBounds {
        this.tileSet.assertRasterSetup("calculate Google 3D Tiles bounds");
        let south = 90;
        let north = -90;
        const longitudes: Array<[number, number]> = [];

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

async function defaultTilesetLoader(url: string): Promise<Google3DTileset> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Unable to load Google 3D Tileset (${response.status} ${response.statusText}).`);
    }
    return response.json() as Promise<Google3DTileset>;
}

async function defaultModelTileLoader(
    url: string,
    scene: Scene,
): Promise<LoadedGoogleModelTile | undefined> {
    const response = await fetch(url);
    if (response.status === 204 || response.status === 404) {
        return undefined;
    }
    if (!response.ok) {
        throw new Error(`Unable to load Google 3D model tile (${response.status} ${response.statusText}).`);
    }

    const buffer = await response.arrayBuffer();
    const metadata = parseGoogleGLBMetadata(buffer);
    const file = new File(
        [buffer],
        "google-photorealistic-tile.glb",
        { type: "model/gltf-binary" },
    );
    await import("@babylonjs/loaders/glTF/index.js");
    const asset = await SceneLoader.LoadAssetContainerAsync("", file, scene, undefined, ".glb");
    return {
        asset,
        attributions: metadata.attributions,
        rtcCenter: metadata.rtcCenter,
    };
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
        let radius: number;
        if (box) {
            // Sum half-axis lengths conservatively encloses a transformed box,
            // including nonuniform scaling and shear.
            radius = [3, 6, 9].reduce((sum, offset) => sum +
                Vector3.TransformNormal(Vector3.FromArray(box, offset), transform).length(), 0);
        } else {
            const m = transform.m;
            const norm1 = Math.max(...[0, 4, 8].map(i => Math.abs(m[i]) + Math.abs(m[i + 1]) + Math.abs(m[i + 2])));
            const normInf = Math.max(...[0, 1, 2].map(i => Math.abs(m[i]) + Math.abs(m[i + 4]) + Math.abs(m[i + 8])));
            radius = Math.abs(sphere![3]) * Math.sqrt(norm1 * normInf);
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
