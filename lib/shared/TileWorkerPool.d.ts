import { HostThrottle } from "./HostThrottle.js";
import type { DecodedGoogleTile } from "../google/GoogleTileContent.js";
import type { DecodedImage } from "./TileTextures.js";
/** Encoding of an elevation tile. */
export type HeightFormat = "terrarium" | "lerc";
/** Result of a worker load: decoded data, or the HTTP status that prevented it. */
export type TileWorkerLoad<T> = ({
    byteLength: number;
} & T) | {
    status: number;
};
export type GoogleTileLoad = TileWorkerLoad<{
    tile: DecodedGoogleTile;
}>;
/**
 * A pool of workers that turn tile URLs into upload-ready data: glTF tiles
 * into geometry and textures, raster tiles into textures and Terrarium tiles
 * into heights. Requests go to the least busy worker; each worker overlaps
 * many downloads while decoding one tile at a time.
 */
export declare class TileWorkerPool {
    readonly compress: boolean;
    private static readonly pools;
    /** Shared by every pool: servers see one client per page. */
    static readonly throttle: HostThrottle;
    /** One pool per compression mode, shared by every layer on the page. */
    static shared(compress: boolean): TileWorkerPool;
    private readonly workers;
    private readonly pending;
    private nextId;
    /** Largest per-worker total of texture compression time, for profiling. */
    encodeMs: number;
    pixelMs: number;
    /** True where module workers from Blob URLs and worker image decoding exist. */
    static get isSupported(): boolean;
    /**
     * @param compress Encode textures as BC1 (S3TC) mip chains: an eighth of
     * the GPU memory and upload bandwidth of RGBA. Requires the GPU to support
     * S3TC; otherwise textures arrive as bitmaps.
     */
    constructor(compress: boolean, size?: number);
    /** Most cores, leaving one for the main thread and one for the browser. */
    static get defaultSize(): number;
    /** Load and decode a glTF (GLB) tile. */
    load(url: string, signal?: AbortSignal): Promise<GoogleTileLoad>;
    /** Load a raster image tile as a clamped texture source. */
    loadImage(url: string, signal?: AbortSignal): Promise<TileWorkerLoad<{
        image: DecodedImage;
    }>>;
    /** Load a Terrarium elevation tile as a square grid of heights in metres. */
    /**
     * Load an elevation tile as a square grid of heights in metres: a
     * Terrarium PNG (samples at pixel centres) or a LERC float raster
     * (samples at pixel corners).
     */
    loadHeights(url: string, signal?: AbortSignal, format?: HeightFormat): Promise<TileWorkerLoad<{
        heights: Float32Array;
        size: number;
        corners: boolean;
    }>>;
    private lercDecoder?;
    /** The LERC decoder is fetched from this package only when first needed. */
    private loadLercDecoder;
    private request;
    private post;
    dispose(): void;
    private receive;
}
