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
        // At street zoom a 20-40 m DEM structure standing in near-zero
        // surroundings is still a conspicuous vertical terrain wall. The
        // coarser tiles keep the higher threshold to retain real hills.
        ...(sourceZoom >= 10 ? [{ seed: sourceZoom >= 14 ? 20 : 40,
                fringe: sourceZoom >= 14 ? 5 : 10, limit: sourceZoom >= 14 ? 1024 : 128,
                floor: -10, ceiling: 10, positive: true }] : []),
        { seed: -100, fringe: -20, limit: 512, floor: -30, ceiling: 100, positive: false },
        // A second, narrower pass catches one-pixel-wide riverbank seams
        // around -70 m that never reach the deep-pit threshold.
        ...(sourceZoom >= 10 ? [{ seed: -20, fringe: -10, limit: 128, floor: -10, ceiling: 100, positive: false }] : [])
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
    for (let y = 1; y < height - 1; y++)
        for (let x = 1; x < width - 1; x++) {
            const index = y * width + x, center = source[index];
            const left = source[index - 1], right = source[index + 1];
            const above = source[index - width], below = source[index + width];
            if (!((Math.abs(center - left) > threshold && Math.abs(center - right) > threshold)
                || (Math.abs(center - above) > threshold && Math.abs(center - below) > threshold)))
                continue;
            const neighbors = [source[index - width - 1], above, source[index - width + 1],
                left, right, source[index + width - 1], below, source[index + width + 1]];
            neighbors.sort((a, b) => a - b);
            const median = (neighbors[3] + neighbors[4]) / 2;
            if (Math.abs(center - median) <= threshold
                || neighbors.filter(value => Math.abs(value - median) < threshold / 2).length < 5)
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