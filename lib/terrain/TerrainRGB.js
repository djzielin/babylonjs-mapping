/** Numeric DEM streaming, including negative ocean depths. No GPU readback. */
export default class TerrainRGB {
    constructor(options = {}) {
        this.cache = new Map();
        this.load = async (coords, signal) => {
            const z = Math.min(coords.z, this.maxZoom), factor = 2 ** (coords.z - z), n = 2 ** z;
            const x = ((Math.floor(coords.x / factor) % n) + n) % n, y = Math.max(0, Math.min(n - 1, Math.floor(coords.y / factor)));
            const url = this.url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
            let grid = this.cache.get(url);
            if (!grid) {
                const response = await fetch(url, { signal });
                if (!response.ok)
                    throw new Error(`Elevation HTTP ${response.status}`);
                const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
                try {
                    signal.throwIfAborted();
                    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                    const context = canvas.getContext('2d');
                    context.drawImage(bitmap, 0, 0);
                    grid = { data: TerrainRGB.decode(context.getImageData(0, 0, bitmap.width, bitmap.height).data, this.encoding), width: bitmap.width, height: bitmap.height };
                }
                finally {
                    bitmap.close();
                }
            }
            this.cache.delete(url);
            this.cache.set(url, grid);
            while (this.cache.size > this.cacheSize)
                this.cache.delete(this.cache.keys().next().value);
            return TerrainRGB.crop(grid, coords, z);
        };
        this.url = options.url ?? 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
        this.encoding = options.encoding ?? 'terrarium';
        this.maxZoom = options.maxZoom ?? 15;
        this.cacheSize = options.cacheSize ?? 64;
        if (!Number.isInteger(this.maxZoom) || this.maxZoom < 0 || this.maxZoom > 22 || !Number.isInteger(this.cacheSize) || this.cacheSize < 0)
            throw new RangeError('Invalid terrain cache size or zoom');
    }
    static decode(pixels, encoding) {
        if (pixels.length % 4)
            throw new RangeError('Expected RGBA pixels');
        const heights = new Float32Array(pixels.length / 4);
        for (let i = 0; i < heights.length; i++) {
            const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
            heights[i] = encoding === 'terrarium' ? r * 256 + g + b / 256 - 32768 : -10000 + (r * 65536 + g * 256 + b) * 0.1;
        }
        return heights;
    }
    /** Resample a child of an overzoomed source without losing its geographic bounds. */
    static crop(grid, coordinates, sourceZoom) {
        const factor = 2 ** (coordinates.z - sourceZoom), size = grid.width + 1;
        const ox = ((coordinates.x % factor) + factor) % factor, oy = ((coordinates.y % factor) + factor) % factor;
        const data = new Float32Array(size * size);
        for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++) {
                const sx = Math.min(grid.width - 1, (ox + x / (size - 1)) / factor * grid.width);
                const sy = Math.min(grid.height - 1, (oy + y / (size - 1)) / factor * grid.height);
                const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(x0 + 1, grid.width - 1), y1 = Math.min(y0 + 1, grid.height - 1), tx = sx - x0, ty = sy - y0;
                data[y * size + x] = (grid.data[y0 * grid.width + x0] * (1 - tx) + grid.data[y0 * grid.width + x1] * tx) * (1 - ty) + (grid.data[y1 * grid.width + x0] * (1 - tx) + grid.data[y1 * grid.width + x1] * tx) * ty;
            }
        return { data, width: size, height: size };
    }
    clearCache() { this.cache.clear(); }
}
//# sourceMappingURL=TerrainRGB.js.map