import type { Scene } from "@babylonjs/core/scene.js";
import type { LoadedGoogleModelTile } from "./Google3DTiles.js";
export type GoogleFastModelTiming = (phase: "parse" | "creation" | "material" | "geometry" | "atlasUpdate" | "atlasReady" | "atlasBitmap", milliseconds: number) => void;
export interface GoogleFastModelAtlasOptions {
    maxSize?: number;
    decoded?: (value: {
        sourceWidth?: number;
        sourceHeight?: number;
        width: number;
        height: number;
        resized: boolean;
    }) => void;
}
/** Dimensions only; unknown or incomplete JPEG/PNG headers retain full-source decoding. */
export declare function googleAtlasDimensions(bytes: Uint8Array, mimeType: string | undefined): {
    width: number;
    height: number;
} | undefined;
/** Static Google format only. Unsupported content and allocation/decode errors return to the native loader. */
export declare function tryLoadGoogle3DFastModel(buffer: ArrayBuffer, scene: Scene, signal?: AbortSignal, timing?: GoogleFastModelTiming, atlasOptions?: GoogleFastModelAtlasOptions, lightweightUnlitMaterials?: boolean): Promise<LoadedGoogleModelTile | undefined>;
