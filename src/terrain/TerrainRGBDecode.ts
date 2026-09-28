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
    if (sourceZoom < 8 || width < 3 || height < 3) return undefined;
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
    // Terrarium has occasional short runs of invalid deep samples along
    // shallow water. A single-pixel median cannot repair a connected run,
    // which otherwise produces kilometre-deep vertical walls in rivers.
    // Only replace small components whose entire surrounding ring is shallow;
    // broad or genuinely deep bathymetry retains its original samples.
    for (const pass of [{ seed: -100, fringe: -20, limit: 512, floor: -30, ceiling: 100, positive: false },
        // A second, narrower pass catches one-pixel-wide riverbank seams
        // around -70 m that never reach the deep-pit threshold.
        ...(sourceZoom >= 12 ? [{ seed: -20, fringe: -10, limit: 128, floor: -10, ceiling: 100, positive: false }] : []),
        // Urban DEMs can include compact raised roofs or encoding glitches in
        // otherwise level coastal ground. Those create the same vertical walls
        // as pits, including at coarse LoD where they cover several map tiles.
        ...(sourceZoom >= 12 ? [{ seed: 40, fringe: 10, limit: 1024, floor: -10, ceiling: 10, positive: true }] : [])]) {
        const visited = new Uint8Array(width * height);
        const source = repaired ?? data;
        for (let start = 0; start < source.length; start++) {
            if (visited[start] || (pass.positive ? source[start] <= pass.seed : source[start] >= pass.seed)) continue;
            const component = [start], ring: number[] = [];
            visited[start] = 1;
            for (let head = 0; head < component.length; head++) {
                const index = component[head], x = index % width, y = Math.floor(index / width);
                for (const neighbor of [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1,
                    y > 0 ? index - width : -1, y + 1 < height ? index + width : -1]) {
                    if (neighbor < 0) continue;
                    // Include the less extreme lip around a corrupt pit; keeping
                    // that lip still leaves a conspicuous vertical river wall.
                    if (pass.positive ? source[neighbor] > pass.fringe : source[neighbor] < pass.fringe) {
                        if (!visited[neighbor]) { visited[neighbor] = 1; component.push(neighbor); }
                    } else ring.push(source[neighbor]);
                }
            }
            // Some corrupted urban water tiles contain over a thousand samples
            // below -12 km, deeper than any real ocean floor. Keep the normal
            // small-cluster limit for plausible bathymetry.
            const impossibleDepth = !pass.positive && component.some(index => source[index] < -12000);
            if (component.length > (impossibleDepth ? 4096 : pass.limit) || ring.length < 3) continue;
            ring.sort((a, b) => a - b);
            const surrounding = ring[Math.floor(ring.length / 2)];
            if (surrounding < pass.floor || surrounding > pass.ceiling) continue;
            repaired ??= Float32Array.from(data);
            for (const index of component) repaired[index] = surrounding;
        }
    }
    return repaired;
}

/** Dampen small DEM oscillations around sea level without a hard height seam. */
export function smoothNearSeaLevel(data: ArrayLike<number>, sourceZoom: number): Float32Array | undefined {
    if (sourceZoom < 8) return undefined;
    let result: Float32Array | undefined;
    for (let index = 0; index < data.length; index++) {
        const height = data[index];
        if (height === 0 || Math.abs(height) >= 30) continue;
        const t = Math.abs(height) / 30;
        result ??= Float32Array.from(data);
        result[index] = height * t * t * (3 - 2 * t);
    }
    return result;
}
