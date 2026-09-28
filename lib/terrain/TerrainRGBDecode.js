export const TERRAIN_REPAIR_VERSION = 2;
export function decodeTerrainRGB(pixels, encoding) {
    if (pixels.length % 4)
        throw new RangeError("Expected RGBA pixels");
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
export function repairIsolatedTerrainSpikes(data, width, height, sourceZoom) {
    if (sourceZoom < 8 || width < 3 || height < 3)
        return undefined;
    const threshold = 100;
    let repaired;
    // Terrarium has occasional short runs of invalid deep samples along
    // shallow water. A single-pixel median cannot repair a connected run,
    // which otherwise produces kilometre-deep vertical walls in rivers.
    // Only replace small components whose entire surrounding ring is shallow;
    // broad or genuinely deep bathymetry retains its original samples.
    for (const pass of [
        // Repair raised coastal clusters before their adjacent negative pits:
        // changing the pit first can make a false high point appear to sit on
        // a legitimate elevated ring and leave a vertical wall behind.
        // At street zoom a 10-40 m DEM structure standing in near-zero
        // surroundings is still a conspicuous vertical terrain wall. The
        // coarser tiles keep the higher threshold to retain real hills.
        ...(sourceZoom >= 10 ? [
            { seed: 20,
                fringe: 5, limit: sourceZoom >= 14 ? 1024 : 128,
                floor: -10, ceiling: 10, positive: true },
            ...(sourceZoom >= 14 ? [{ seed: 10, fringe: 3, limit: 128,
                    floor: -10, ceiling: 10, positive: true }] : []),
        ] : []),
        { seed: -100, fringe: -20, limit: 512, floor: -30, ceiling: 100, positive: false },
        // A second, narrower pass catches one-pixel-wide riverbank seams
        // around -70 m that never reach the deep-pit threshold.
        ...(sourceZoom >= 10 ? [{ seed: -10,
                fringe: -5, limit: 128,
                floor: -10, ceiling: 100, positive: false }] : [])
    ]) {
        const visited = new Uint8Array(width * height);
        const source = repaired ?? data;
        for (let start = 0; start < source.length; start++) {
            if (visited[start] || (pass.positive ? source[start] <= pass.seed : source[start] >= pass.seed))
                continue;
            const component = [start], ring = [];
            visited[start] = 1;
            for (let head = 0; head < component.length; head++) {
                const index = component[head], x = index % width, y = Math.floor(index / width);
                for (const neighbor of [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1,
                    y > 0 ? index - width : -1, y + 1 < height ? index + width : -1]) {
                    if (neighbor < 0)
                        continue;
                    // Include the less extreme lip around a corrupt pit; keeping
                    // that lip still leaves a conspicuous vertical river wall.
                    if (pass.positive ? source[neighbor] > pass.fringe : source[neighbor] < pass.fringe) {
                        if (!visited[neighbor]) {
                            visited[neighbor] = 1;
                            component.push(neighbor);
                        }
                    }
                    else
                        ring.push(source[neighbor]);
                }
            }
            // Some corrupted urban water tiles contain over a thousand samples
            // below -12 km, deeper than any real ocean floor. Keep the normal
            // small-cluster limit for plausible bathymetry.
            const impossibleDepth = !pass.positive && component.some(index => source[index] < -12000);
            if (component.length > (impossibleDepth ? 4096 : pass.limit) || ring.length < 3)
                continue;
            ring.sort((a, b) => a - b);
            const surrounding = ring[Math.floor(ring.length / 2)];
            if (surrounding < pass.floor || surrounding > pass.ceiling)
                continue;
            repaired ??= Float32Array.from(data);
            for (const index of component)
                repaired[index] = surrounding;
        }
    }
    // A median pass remains useful for isolated values outside the shallow
    // coastal bands. Run it after the component passes: changing one point of
    // a multi-pixel corruption first can split the cluster into unrepairable
    // fragments with a misleading surrounding ring.
    const source = repaired ?? data;
    const singles = [];
    const isolatedThreshold = sourceZoom >= 10 ? 15 : threshold;
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const index = y * width + x, center = source[index];
            let different = 0;
            if (x > 0 && Math.abs(center - source[index - 1]) > isolatedThreshold)
                different++;
            if (x + 1 < width && Math.abs(center - source[index + 1]) > isolatedThreshold)
                different++;
            if (y > 0 && Math.abs(center - source[index - width]) > isolatedThreshold)
                different++;
            if (y + 1 < height && Math.abs(center - source[index + width]) > isolatedThreshold)
                different++;
            if (different < 2)
                continue;
            const neighbors = [];
            for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++)
                for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++)
                    if (nx !== x || ny !== y)
                        neighbors.push(source[ny * width + nx]);
            if (neighbors.length < 3)
                continue;
            // A solitary pit can touch a broad, genuinely negative riverbed. Its
            // connected component then exceeds the coastal limit even though this
            // one sample is far outside every immediately adjacent elevation.
            const beyondNeighbors = center < Math.min(...neighbors) - 30
                || center > Math.max(...neighbors) + 30;
            // A real slope or broad bathymetric shelf has several nearby samples
            // at its own elevation, even when this pixel sits at a sharp corner.
            if (neighbors.filter(value => Math.abs(center - value) < isolatedThreshold / 2).length > 1)
                continue;
            neighbors.sort((a, b) => a - b);
            const middle = Math.floor(neighbors.length / 2);
            const median = neighbors.length % 2 ? neighbors[middle] : (neighbors[middle - 1] + neighbors[middle]) / 2;
            if (!beyondNeighbors && (Math.abs(center - median) <= isolatedThreshold
                || neighbors.filter(value => Math.abs(value - median) < isolatedThreshold / 2).length < Math.min(5, neighbors.length - 1)))
                continue;
            singles.push([index, median]);
        }
    if (singles.length) {
        repaired ??= Float32Array.from(data);
        for (const [index, median] of singles)
            repaired[index] = median;
    }
    return repaired;
}
/** Dampen small DEM oscillations around sea level without a hard height seam. */
export function smoothNearSeaLevel(data, sourceZoom) {
    if (sourceZoom < 8)
        return undefined;
    let result;
    for (let index = 0; index < data.length; index++) {
        const height = data[index];
        if (height === 0 || Math.abs(height) >= 30)
            continue;
        const t = Math.abs(height) / 30;
        result ??= Float32Array.from(data);
        result[index] = height * t * t * (3 - 2 * t);
    }
    return result;
}
//# sourceMappingURL=TerrainRGBDecode.js.map