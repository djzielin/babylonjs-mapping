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

/** Repair narrow source-data spikes before terrain tiles sample this grid. */
export function repairIsolatedTerrainSpikes(data: ArrayLike<number>, width: number, height: number,
    sourceZoom: number): Float32Array | undefined {
    if (sourceZoom < 12 || width < 3 || height < 3) return undefined;
    const threshold = 100;
    let repaired: Float32Array | undefined;
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const index = y * width + x, center = data[index];
        const left = data[index - 1], right = data[index + 1];
        const above = data[index - width], below = data[index + width];
        if (!((Math.abs(center - left) > threshold && Math.abs(center - right) > threshold)
            || (Math.abs(center - above) > threshold && Math.abs(center - below) > threshold))) continue;
        const neighbors = [data[index - width - 1], above, data[index - width + 1],
            left, right, data[index + width - 1], below, data[index + width + 1]];
        neighbors.sort((a, b) => a - b);
        const median = (neighbors[3] + neighbors[4]) / 2;
        if (Math.abs(center - median) <= threshold
            || neighbors.filter(value => Math.abs(value - median) < threshold / 2).length < 5) continue;
        repaired ??= Float32Array.from(data);
        repaired[index] = median;
    }
    return repaired;
}
