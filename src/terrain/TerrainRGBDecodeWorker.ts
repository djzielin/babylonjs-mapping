import { decodeTerrainRGB, repairIsolatedTerrainSpikes, TERRAIN_REPAIR_VERSION, type TerrainRGBEncoding } from "./TerrainRGBDecode.js";

self.onmessage = async (event: MessageEvent<{ blob: Blob; encoding: TerrainRGBEncoding; sourceZoom: number }>) => {
    let bitmap: ImageBitmap | undefined;
    try {
        bitmap = await createImageBitmap(event.data.blob, {
            colorSpaceConversion: "none", premultiplyAlpha: "none",
        });
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        const decoded = decodeTerrainRGB(context.getImageData(0, 0, bitmap.width, bitmap.height).data, event.data.encoding);
        const data = repairIsolatedTerrainSpikes(decoded, bitmap.width, bitmap.height, event.data.sourceZoom) ?? decoded;
        self.postMessage({ data, width: bitmap.width, height: bitmap.height, repairVersion: TERRAIN_REPAIR_VERSION }, { transfer: [data.buffer] });
    } catch (error) {
        self.postMessage({ error: String(error) });
    } finally {
        bitmap?.close();
    }
};
