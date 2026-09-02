import { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { Vector3 } from "@babylonjs/core/Maths/math.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
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
}
export type GoogleTilesetLoader = (url: string) => Promise<Google3DTileset>;
export type GoogleModelTileLoader = (url: string, scene: Scene) => Promise<LoadedGoogleModelTile | undefined>;
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
    origin?: Google3DTilesOrigin;
    private readonly tilesetLoader;
    private readonly modelTileLoader;
    private rootTileset;
    private rootRequestKey;
    private session;
    private readonly externalTilesets;
    private readonly loadedTiles;
    private readonly inFlightTiles;
    private desiredTiles;
    private originStateKey;
    private googleAttributionAdded;
    constructor(tileSet: TileSet, options?: Google3DTilesOptions);
    /** Content currently attached to the Babylon scene. */
    get loadedModelTiles(): readonly LoadedGoogle3DTile[];
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
    /** Loads content that overlaps the current TileSet. */
    load(): Promise<readonly LoadedGoogle3DTile[]>;
    /** Alias matching the building-provider lifecycle used by older examples. */
    generateBuildings(): Promise<readonly LoadedGoogle3DTile[]>;
    /** Disposes loaded GLB assets and clears the provider's request caches. */
    dispose(): void;
    private validateOptions;
    private getOrigin;
    private getOriginStateKey;
    private getRootTilesetURL;
    private loadRootTileset;
    private authenticateURL;
    private loadExternalTileset;
    private collectTileContent;
    private loadTile;
    private createTileRoot;
    private disposeTile;
    private disposeLoadedTiles;
    private updateAttribution;
    private getTileSetBounds;
}
/** Extracts Google attribution and CESIUM_RTC metadata from a GLB JSON chunk. */
export declare function parseGoogleGLBMetadata(buffer: ArrayBuffer): GoogleGLBMetadata;
