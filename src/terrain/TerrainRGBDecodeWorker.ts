import { decodeTerrainRGB, type TerrainRGBEncoding } from "./TerrainRGBDecode.js";

self.onmessage = async (event: MessageEvent<{ blob: Blob; encoding: TerrainRGBEncoding }>) => {
    let bitmap: ImageBitmap | undefined;
    try {
        bitmap = await createImageBitmap(event.data.blob, {
            colorSpaceConversion: "none", premultiplyAlpha: "none",
        });
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        const data = decodeTerrainRGB(context.getImageData(0, 0, bitmap.width, bitmap.height).data, event.data.encoding);
        self.postMessage({ data, width: bitmap.width, height: bitmap.height }, { transfer: [data.buffer] });
    } catch (error) {
        self.postMessage({ error: String(error) });
    } finally {
        bitmap?.close();
    }
};
