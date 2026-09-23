export type TerrainRGBEncoding = "terrarium" | "mapbox";

export function decodeTerrainRGB(pixels: ArrayLike<number>, encoding: TerrainRGBEncoding): Float32Array {
    if (pixels.length % 4) throw new RangeError("Expected RGBA pixels");
    const heights = new Float32Array(pixels.length / 4);
    for (let i = 0; i < heights.length; i++) {
        const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
        heights[i] = encoding === "terrarium"
            ? r * 256 + g + b / 256 - 32768
            : -10000 + (r * 65536 + g * 256 + b) * 0.1;
    }
    return heights;
}
