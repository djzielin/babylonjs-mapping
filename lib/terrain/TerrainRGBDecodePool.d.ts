import type { ElevationGrid } from "./TerrainRGB.js";
import type { TerrainRGBEncoding } from "./TerrainRGBDecode.js";
/** Keep image decoding and pixel readback off the render thread. */
export declare class TerrainRGBDecodePool {
    private static shared?;
    static get(): TerrainRGBDecodePool | undefined;
    private workers;
    private queue;
    private failed;
    decode(blob: Blob, encoding: TerrainRGBEncoding): Promise<ElevationGrid>;
    private drain;
    private fail;
}
