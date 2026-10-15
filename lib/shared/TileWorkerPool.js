import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { HostThrottle } from "./HostThrottle.js";
import { DracoDecoder } from "@babylonjs/core/Meshes/Compression/dracoDecoder.js";
import { DecodeMesh } from "@babylonjs/core/Meshes/Compression/dracoCompressionWorker.js";
/**
 * Body of each streaming worker: download, GLB parsing, Draco decoding and
 * image decoding, so the main thread only creates GPU resources. Stringified
 * into a Blob worker, so it must not reference anything outside itself
 * except `DecodeMeshInWorker`, which is injected beside it.
 */
function tileWorker() {
    let draco;
    const aborts = new Map();
    const multiply = (a, b) => {
        // Column-major a * b.
        const r = new Array(16);
        for (let c = 0; c < 4; c++)
            for (let row = 0; row < 4; row++)
                r[c * 4 + row] = a[row] * b[c * 4] + a[4 + row] * b[c * 4 + 1] + a[8 + row] * b[c * 4 + 2] + a[12 + row] * b[c * 4 + 3];
        return r;
    };
    const compose = (node) => {
        if (node.matrix)
            return node.matrix;
        const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
        const [sx, sy, sz] = node.scale ?? [1, 1, 1];
        const [tx, ty, tz] = node.translation ?? [0, 0, 0];
        return [
            (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
            2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
            2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
            tx, ty, tz, 1,
        ];
    };
    const floats = (data, size, offset, stride, count) => {
        if (data instanceof Float32Array && (stride === 0 || stride === size * 4) && offset === 0)
            return data.subarray(0, count * size);
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const step = stride || size * 4;
        const result = new Float32Array(count * size);
        for (let i = 0; i < count; i++)
            for (let c = 0; c < size; c++)
                result[i * size + c] = view.getFloat32(offset + i * step + c * 4, true);
        return result;
    };
    const ARRAYS = {
        5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
    };
    const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3 };
    /** Halve an RGBA image with a 2x2 box filter. */
    const downsample = (src, w, h) => {
        const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
        const out = new Uint8ClampedArray(nw * nh * 4);
        const sx = w > 1 ? 1 : 0, sy = h > 1 ? w : 0;
        for (let y = 0; y < nh; y++)
            for (let x = 0; x < nw; x++) {
                const p = ((y * (h > 1 ? 2 : 1)) * w + x * (w > 1 ? 2 : 1)) * 4, q = (y * nw + x) * 4;
                for (let c = 0; c < 3; c++)
                    out[q + c] = (src[p + c] + src[p + sx * 4 + c] + src[p + sy * 4 + c] + src[p + (sx + sy) * 4 + c] + 2) >> 2;
                out[q + 3] = 255;
            }
        return out;
    };
    const block = new Float64Array(48);
    const codes = new Uint8Array(16);
    const palette = new Float64Array(12);
    const pack = (r, g, b) => (Math.min(31, Math.max(0, Math.round(r * 31 / 255))) << 11) | (Math.min(63, Math.max(0, Math.round(g * 63 / 255))) << 5) | Math.min(31, Math.max(0, Math.round(b * 31 / 255)));
    const expand = (c, out, at) => {
        const r = c >> 11, g = (c >> 5) & 63, b = c & 31;
        out[at] = (r << 3) | (r >> 2);
        out[at + 1] = (g << 2) | (g >> 4);
        out[at + 2] = (b << 3) | (b >> 2);
    };
    /**
     * Choose the nearest of the four palette colours for each pixel. The
     * palette is collinear, so the nearest colour follows exactly from each
     * pixel's projection onto the endpoint axis.
     */
    const assign = (c0, c1) => {
        expand(c0, palette, 0);
        expand(c1, palette, 3);
        const r1 = palette[3], g1 = palette[4], b1 = palette[5];
        const dd = (palette[0] - r1) ** 2 + (palette[1] - g1) ** 2 + (palette[2] - b1) ** 2;
        const scale = dd > 0 ? 1 / dd : 0;
        const dr = (palette[0] - r1) * scale, dg = (palette[1] - g1) * scale, db = (palette[2] - b1) * scale;
        for (let i = 0, j = 0; i < 16; i++, j += 3) {
            const t = (block[j] - r1) * dr + (block[j + 1] - g1) * dg + (block[j + 2] - b1) * db;
            // Palette positions along the axis: c1 = 0, code 3 = 1/3, code 2 = 2/3, c0 = 1.
            codes[i] = t > 5 / 6 ? 0 : t > 0.5 ? 2 : t > 1 / 6 ? 3 : 1;
        }
    };
    /**
     * BC1 (DXT1) encoder: endpoints from the block's principal axis (found by
     * power iteration on the colour covariance), inset slightly so the
     * interpolated colours cover the block's spread evenly.
     */
    const encodeBC1 = (src, w, h) => {
        const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2);
        const out = new Uint8Array(bw * bh * 8);
        for (let by = 0; by < bh; by++)
            for (let bx = 0; bx < bw; bx++) {
                let mr = 0, mg = 0, mb = 0;
                if (bx * 4 + 4 <= w && by * 4 + 4 <= h) {
                    for (let row = 0, i = 0; row < 4; row++) {
                        let p = ((by * 4 + row) * w + bx * 4) * 4;
                        for (let col = 0; col < 4; col++, i += 3, p += 4) {
                            mr += block[i] = src[p];
                            mg += block[i + 1] = src[p + 1];
                            mb += block[i + 2] = src[p + 2];
                        }
                    }
                }
                else {
                    for (let i = 0; i < 16; i++) {
                        const x = Math.min(w - 1, bx * 4 + (i & 3)), y = Math.min(h - 1, by * 4 + (i >> 2)), p = (y * w + x) * 4;
                        mr += block[i * 3] = src[p];
                        mg += block[i * 3 + 1] = src[p + 1];
                        mb += block[i * 3 + 2] = src[p + 2];
                    }
                }
                mr /= 16;
                mg /= 16;
                mb /= 16;
                let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
                for (let i = 0; i < 16; i++) {
                    const r = block[i * 3] - mr, g = block[i * 3 + 1] - mg, b = block[i * 3 + 2] - mb;
                    xx += r * r;
                    xy += r * g;
                    xz += r * b;
                    yy += g * g;
                    yz += g * b;
                    zz += b * b;
                }
                let vx = 1, vy = 1, vz = 1;
                for (let k = 0; k < 4; k++) {
                    const nx = xx * vx + xy * vy + xz * vz, ny = xy * vx + yy * vy + yz * vz, nz = xz * vx + yz * vy + zz * vz;
                    const m = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
                    if (m < 1e-6) {
                        vx = vy = vz = 0;
                        break;
                    }
                    vx = nx / m;
                    vy = ny / m;
                    vz = nz / m;
                }
                const length = Math.sqrt(vx * vx + vy * vy + vz * vz);
                let c0, c1;
                if (length < 1e-6) {
                    c0 = c1 = pack(mr, mg, mb);
                }
                else {
                    vx /= length;
                    vy /= length;
                    vz /= length;
                    let lo = Infinity, hi = -Infinity;
                    for (let i = 0; i < 16; i++) {
                        const t = (block[i * 3] - mr) * vx + (block[i * 3 + 1] - mg) * vy + (block[i * 3 + 2] - mb) * vz;
                        if (t < lo)
                            lo = t;
                        if (t > hi)
                            hi = t;
                    }
                    const inset = (hi - lo) / 16;
                    hi -= inset;
                    lo += inset;
                    c0 = pack(mr + vx * hi, mg + vy * hi, mb + vz * hi);
                    c1 = pack(mr + vx * lo, mg + vy * lo, mb + vz * lo);
                }
                assign(c0, c1);
                // Four-colour mode needs c0 > c1; swapping endpoints swaps codes 0/1 and 2/3.
                let indices = 0;
                if (c0 === c1) {
                    indices = 0;
                }
                else {
                    const swap = c0 < c1;
                    if (swap) {
                        const t = c0;
                        c0 = c1;
                        c1 = t;
                    }
                    for (let i = 15; i >= 0; i--)
                        indices = (indices << 2) | (swap ? codes[i] ^ 1 : codes[i]);
                }
                const at = (by * bw + bx) * 8;
                out[at] = c0 & 255;
                out[at + 1] = c0 >> 8;
                out[at + 2] = c1 & 255;
                out[at + 3] = c1 >> 8;
                out[at + 4] = indices & 255;
                out[at + 5] = (indices >>> 8) & 255;
                out[at + 6] = (indices >>> 16) & 255;
                out[at + 7] = indices >>> 24;
            }
        return out;
    };
    let compress = false;
    let encodeMs = 0, pixelMs = 0;
    /** Decode an encoded image into a bitmap, or a BC1 mip chain when compressing. */
    const decodeImage = async (blob, wrapS, wrapT) => {
        const bitmap = await createImageBitmap(blob, { imageOrientation: "none", premultiplyAlpha: "none", colorSpaceConversion: "none" });
        const { width, height } = bitmap;
        if (!compress)
            return { bitmap, width, height, wrapS, wrapT };
        const start = performance.now();
        const context = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        let pixels = context.getImageData(0, 0, width, height).data;
        pixelMs += performance.now() - start;
        const bc1 = [];
        for (let w = width, h = height;; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
            bc1.push(encodeBC1(pixels, w, h));
            if (w === 1 && h === 1)
                break;
            pixels = downsample(pixels, w, h);
        }
        encodeMs += performance.now() - start;
        return { bc1, width, height, wrapS, wrapT };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lerc;
    /**
     * A LERC float raster as heights: a square grid of samples at pixel
     * corners, its edges shared with the neighbouring tiles. No data is sea level.
     */
    function decodeLerc(buffer) {
        if (!lerc)
            throw new Error("LERC decoder not loaded.");
        const raster = lerc.decode(buffer);
        const size = raster.width;
        const source = raster.pixels[0];
        const mask = raster.maskData;
        const heights = new Float32Array(size * size);
        for (let i = 0; i < heights.length; i++)
            heights[i] = mask && !mask[i] ? 0 : source[i];
        return { heights, size, corners: true };
    }
    /** A request that hangs is abandoned, and fails like any other, after this long. */
    const TIMED_OUT = new Error("Request timed out");
    async function fetchTile(url, abort) {
        const timer = setTimeout(() => abort.abort(TIMED_OUT), 30_000);
        try {
            return await fetch(url, { signal: abort.signal });
        }
        finally {
            clearTimeout(timer);
        }
    }
    async function load(id, url) {
        const abort = new AbortController();
        aborts.set(id, abort);
        try {
            const response = await fetchTile(url, abort);
            if (!response.ok || response.status === 204) {
                postMessage({ id, status: response.status, retryAfter: response.headers.get("Retry-After") });
                return;
            }
            const buffer = await response.arrayBuffer();
            const view = new DataView(buffer);
            if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67)
                throw new Error("Not a GLB.");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let json, bin = new Uint8Array(0);
            for (let at = 12; at + 8 <= Math.min(view.getUint32(8, true), buffer.byteLength);) {
                const length = view.getUint32(at, true), type = view.getUint32(at + 4, true);
                if (type === 0x4e4f534a)
                    json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, at + 8, length)));
                else if (type === 0x004e4942)
                    bin = new Uint8Array(buffer, at + 8, length);
                at += 8 + length;
            }
            if (!json)
                throw new Error("GLB has no JSON chunk.");
            const bytes = (viewIndex) => {
                const v = json.bufferViews[viewIndex];
                return new Uint8Array(bin.buffer, bin.byteOffset + (v.byteOffset ?? 0), v.byteLength);
            };
            const accessor = (index) => {
                const a = json.accessors[index], v = json.bufferViews[a.bufferView];
                const Type = ARRAYS[a.componentType], size = SIZES[a.type];
                const start = bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
                if ((!v.byteStride || v.byteStride === size * Type.BYTES_PER_ELEMENT) && start % Type.BYTES_PER_ELEMENT === 0)
                    return new Type(bin.buffer, start, a.count * size);
                const out = new Float32Array(a.count * size), data = new DataView(bin.buffer);
                for (let i = 0; i < a.count; i++)
                    for (let c = 0; c < size; c++) {
                        const p = start + i * v.byteStride + c * Type.BYTES_PER_ELEMENT;
                        out[i * size + c] = a.componentType === 5126 ? data.getFloat32(p, true) : a.componentType === 5125 ? data.getUint32(p, true)
                            : a.componentType === 5123 ? data.getUint16(p, true) : data.getUint8(p);
                    }
                return out;
            };
            const imageOf = new Map();
            const images = [];
            const textureImage = (texture) => {
                if (!imageOf.has(texture)) {
                    const t = json.textures[texture], image = json.images[t.source];
                    const sampler = t.sampler === undefined ? undefined : json.samplers?.[t.sampler];
                    const blob = new Blob([bytes(image.bufferView)], { type: image.mimeType ?? "image/jpeg" });
                    images.push(decodeImage(blob, sampler?.wrapS, sampler?.wrapT));
                    imageOf.set(texture, images.length - 1);
                }
                return imageOf.get(texture);
            };
            const primitives = [];
            const module = json.extensionsUsed?.includes("KHR_draco_mesh_compression") ? await (draco ??= initDraco()) : undefined;
            const visit = (index, parent) => {
                const node = json.nodes[index];
                const matrix = multiply(parent, compose(node));
                for (const p of node.mesh === undefined ? [] : json.meshes[node.mesh].primitives) {
                    if (p.mode !== undefined && p.mode !== 4)
                        continue;
                    const position = json.accessors[p.attributes.POSITION];
                    const textureIndex = p.material === undefined ? undefined : json.materials?.[p.material]?.pbrMetallicRoughness?.baseColorTexture?.index;
                    const image = textureIndex === undefined || p.attributes.TEXCOORD_0 === undefined ? undefined : textureImage(textureIndex);
                    const out = { positions: new Float32Array(0), indices: new Uint16Array(0), min: position.min, max: position.max, matrix, image };
                    const compressed = p.extensions?.KHR_draco_mesh_compression;
                    let indices;
                    if (compressed) {
                        const wanted = { position: compressed.attributes.POSITION };
                        if (image !== undefined)
                            wanted.uv = compressed.attributes.TEXCOORD_0;
                        const count = DecodeMeshInWorker(module, new Int8Array(bin.buffer, bin.byteOffset + (json.bufferViews[compressed.bufferView].byteOffset ?? 0), json.bufferViews[compressed.bufferView].byteLength), wanted, data => { indices = data; }, (kind, data, size, offset, stride) => {
                            const values = floats(data, size, offset, stride, data.byteLength / data.BYTES_PER_ELEMENT / size);
                            if (kind === "position")
                                out.positions = values;
                            else
                                out.uvs = values;
                        });
                        if (out.positions.length !== count * 3)
                            out.positions = out.positions.subarray(0, count * 3);
                    }
                    else {
                        out.positions = Float32Array.from(accessor(p.attributes.POSITION));
                        if (image !== undefined)
                            out.uvs = Float32Array.from(accessor(p.attributes.TEXCOORD_0));
                        if (p.indices !== undefined)
                            indices = accessor(p.indices);
                    }
                    const vertices = out.positions.length / 3;
                    if (!indices)
                        indices = Uint32Array.from({ length: vertices }, (_, i) => i);
                    // 16-bit indices halve index memory and bandwidth when they fit.
                    out.indices = vertices <= 65536 ? Uint16Array.from(indices) : indices instanceof Uint32Array ? indices : Uint32Array.from(indices);
                    if (!out.min || !out.max) {
                        out.min = [Infinity, Infinity, Infinity];
                        out.max = [-Infinity, -Infinity, -Infinity];
                        for (let i = 0; i < out.positions.length; i++) {
                            out.min[i % 3] = Math.min(out.min[i % 3], out.positions[i]);
                            out.max[i % 3] = Math.max(out.max[i % 3], out.positions[i]);
                        }
                    }
                    primitives.push(out);
                }
                for (const child of node.children ?? [])
                    visit(child, matrix);
            };
            const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
            for (const root of json.scenes?.[json.scene ?? 0]?.nodes ?? json.nodes.map((_, i) => i))
                visit(root, identity);
            const decoded = await Promise.all(images);
            if (abort.signal.aborted) {
                decoded.forEach(image => image.bitmap?.close());
                postMessage({ id, aborted: true });
                return;
            }
            const transfer = decoded.flatMap((image) => image.bitmap ? [image.bitmap] : image.bc1.map(level => level.buffer));
            for (const p of primitives) {
                transfer.push(p.indices.buffer);
                if (p.uvs)
                    transfer.push(p.uvs.buffer);
                if (!transfer.includes(p.positions.buffer))
                    transfer.push(p.positions.buffer);
            }
            postMessage({
                id, byteLength: buffer.byteLength, primitives, images: decoded, encodeMs, pixelMs,
                rtc: json.extensions?.CESIUM_RTC?.center, copyright: json.asset?.copyright,
            }, { transfer: [...new Set(transfer)] });
        }
        catch (error) {
            postMessage({ id, aborted: abort.signal.aborted && abort.signal.reason !== TIMED_OUT, error: error instanceof Error ? error.message : String(error) });
        }
        finally {
            aborts.delete(id);
        }
    }
    /** Fetch a raster image and decode it for upload. */
    async function loadImage(id, url) {
        const abort = new AbortController();
        aborts.set(id, abort);
        try {
            const response = await fetchTile(url, abort);
            if (!response.ok) {
                postMessage({ id, status: response.status, retryAfter: response.headers.get("Retry-After") });
                return;
            }
            const blob = await response.blob();
            const image = await decodeImage(blob, 33071, 33071);
            if (abort.signal.aborted) {
                image.bitmap?.close();
                postMessage({ id, aborted: true });
                return;
            }
            const transfer = image.bitmap ? [image.bitmap] : image.bc1.map(level => level.buffer);
            postMessage({ id, byteLength: blob.size, images: [image], encodeMs, pixelMs }, { transfer });
        }
        catch (error) {
            postMessage({ id, aborted: abort.signal.aborted && abort.signal.reason !== TIMED_OUT, error: error instanceof Error ? error.message : String(error) });
        }
        finally {
            aborts.delete(id);
        }
    }
    /** Fetch a Terrarium PNG and decode it to metres: (R * 256 + G + B / 256) - 32768. */
    async function loadHeights(id, url, format) {
        const abort = new AbortController();
        aborts.set(id, abort);
        try {
            const response = await fetchTile(url, abort);
            if (!response.ok) {
                postMessage({ id, status: response.status, retryAfter: response.headers.get("Retry-After") });
                return;
            }
            if (format === "lerc") {
                const buffer = await response.arrayBuffer();
                const heights = decodeLerc(buffer);
                postMessage({ id, byteLength: buffer.byteLength, ...heights }, { transfer: [heights.heights.buffer] });
                return;
            }
            const blob = await response.blob();
            const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
            const size = bitmap.width;
            const context = new OffscreenCanvas(size, size).getContext("2d", { willReadFrequently: true });
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            const pixels = context.getImageData(0, 0, size, size).data;
            const heights = new Float32Array(size * size);
            for (let i = 0; i < heights.length; i++)
                heights[i] = pixels[i * 4] * 256 + pixels[i * 4 + 1] + pixels[i * 4 + 2] / 256 - 32768;
            postMessage({ id, byteLength: blob.size, heights, size }, { transfer: [heights.buffer] });
        }
        catch (error) {
            postMessage({ id, aborted: abort.signal.aborted && abort.signal.reason !== TIMED_OUT, error: error instanceof Error ? error.message : String(error) });
        }
        finally {
            aborts.delete(id);
        }
    }
    let wrapperUrl = "", wasmBinary;
    const initDraco = () => {
        importScripts(wrapperUrl);
        return DracoDecoderModule({ wasmBinary: wasmBinary });
    };
    onmessage = (event) => {
        const message = event.data;
        if (message.type === "init") {
            wrapperUrl = message.wrapperUrl;
            wasmBinary = message.wasmBinary;
            compress = message.compress === true && typeof OffscreenCanvas !== "undefined";
            // Compile Draco now rather than when the first tile arrives.
            draco ??= initDraco();
        }
        else if (message.type === "load")
            void load(message.id, message.url);
        else if (message.type === "image")
            void loadImage(message.id, message.url);
        else if (message.type === "heights")
            void loadHeights(message.id, message.url, message.format);
        else if (message.type === "lerc") {
            // The decoder's UMD wrapper assigns the global Lerc in a plain script context.
            new Function(message.source)();
            lerc = self.Lerc;
        }
        else if (message.type === "cancel")
            aborts.get(message.id)?.abort();
    };
}
/**
 * A pool of workers that turn tile URLs into upload-ready data: glTF tiles
 * into geometry and textures, raster tiles into textures and Terrarium tiles
 * into heights. Requests go to the least busy worker; each worker overlaps
 * many downloads while decoding one tile at a time.
 */
export class TileWorkerPool {
    compress;
    static pools = new Map();
    /** Shared by every pool: servers see one client per page. */
    static throttle = new HostThrottle();
    /** One pool per compression mode, shared by every layer on the page. */
    static shared(compress) {
        let pool = TileWorkerPool.pools.get(compress);
        if (!pool)
            TileWorkerPool.pools.set(compress, pool = new TileWorkerPool(compress));
        return pool;
    }
    workers = [];
    pending = new Map();
    nextId = 1;
    /** Largest per-worker total of texture compression time, for profiling. */
    encodeMs = 0;
    pixelMs = 0;
    /** True where module workers from Blob URLs and worker image decoding exist. */
    static get isSupported() {
        return typeof Worker !== "undefined" && typeof URL?.createObjectURL === "function" && typeof createImageBitmap === "function";
    }
    /**
     * @param compress Encode textures as BC1 (S3TC) mip chains: an eighth of
     * the GPU memory and upload bandwidth of RGBA. Requires the GPU to support
     * S3TC; otherwise textures arrive as bitmaps.
     */
    constructor(compress, size = TileWorkerPool.defaultSize) {
        this.compress = compress;
        const configuration = DracoDecoder.DefaultConfiguration;
        const absolute = (url) => new URL(url, globalThis.location?.href).toString();
        const source = `const DecodeMeshInWorker = ${DecodeMesh};\n(${tileWorker})();`;
        const blobUrl = URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
        const wasm = fetch(absolute(configuration.wasmBinaryUrl)).then(response => response.arrayBuffer());
        for (let i = 0; i < size; i++) {
            const worker = new Worker(blobUrl);
            worker.onmessage = event => this.receive(event.data);
            void wasm.then(binary => worker.postMessage({ type: "init", compress, wrapperUrl: absolute(configuration.wasmUrl), wasmBinary: binary.slice(0) }), () => worker.postMessage({ type: "init", compress, wrapperUrl: absolute(configuration.wasmUrl) }));
            this.workers.push({ worker, busy: 0 });
        }
        URL.revokeObjectURL(blobUrl);
    }
    /** Most cores, leaving one for the main thread and one for the browser. */
    static get defaultSize() {
        const cores = typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4;
        return Math.max(2, Math.min(12, cores - 2));
    }
    /** Load and decode a glTF (GLB) tile. */
    async load(url, signal) {
        const reply = await this.request("load", url, signal);
        if (reply.status !== undefined)
            return { status: reply.status };
        const wrap = (mode) => mode === 33071 ? 0 : mode === 33648 ? 2 : 1;
        return {
            byteLength: reply.byteLength,
            tile: {
                primitives: reply.primitives.map(p => ({
                    positions: p.positions, uvs: p.uvs, indices: p.indices, image: p.image,
                    minimum: Vector3.FromArray(p.min), maximum: Vector3.FromArray(p.max), nodeMatrix: Matrix.FromArray(p.matrix),
                })),
                // Babylon address modes: CLAMP 0, WRAP 1, MIRROR 2.
                images: reply.images.map(image => ({
                    bitmap: image.bitmap, bc1: image.bc1, width: image.width, height: image.height,
                    wrapU: wrap(image.wrapS), wrapV: wrap(image.wrapT),
                })),
                rtcCenter: reply.rtc?.length === 3 ? Vector3.FromArray(reply.rtc) : undefined,
                attributions: typeof reply.copyright === "string" ? reply.copyright.split(";").map(s => s.trim()).filter(Boolean) : [],
            },
        };
    }
    /** Load a raster image tile as a clamped texture source. */
    async loadImage(url, signal) {
        const reply = await this.request("image", url, signal);
        if (reply.status !== undefined)
            return { status: reply.status };
        const image = reply.images[0];
        return { byteLength: reply.byteLength, image: { bitmap: image.bitmap, bc1: image.bc1, width: image.width, height: image.height, wrapU: 0, wrapV: 0 } };
    }
    /** Load a Terrarium elevation tile as a square grid of heights in metres. */
    /**
     * Load an elevation tile as a square grid of heights in metres: a
     * Terrarium PNG (samples at pixel centres) or a LERC float raster
     * (samples at pixel corners).
     */
    async loadHeights(url, signal, format = "terrarium") {
        if (format === "lerc")
            await this.loadLercDecoder();
        const reply = await this.request("heights", url, signal, { format });
        if (reply.status !== undefined)
            return { status: reply.status };
        return { byteLength: reply.byteLength, heights: reply.heights, size: reply.size, corners: reply.corners ?? false };
    }
    lercDecoder;
    /** The LERC decoder is fetched from this package only when first needed. */
    loadLercDecoder() {
        return this.lercDecoder ??= import("../vendor/lercDecoder.js").then(({ LERC_DECODER_SOURCE }) => {
            for (const { worker } of this.workers)
                worker.postMessage({ type: "lerc", source: LERC_DECODER_SOURCE });
        });
    }
    async request(type, url, signal, extra) {
        // Wait out any slow-down the host has asked for before asking again.
        const host = await TileWorkerPool.throttle.acquire(url, signal);
        let status, retryAfter;
        try {
            const reply = await this.post(type, url, signal, extra);
            status = reply.status;
            retryAfter = reply.retryAfter;
            return reply;
        }
        finally {
            TileWorkerPool.throttle.release(host, status, retryAfter);
        }
    }
    post(type, url, signal, extra) {
        if (signal?.aborted)
            return Promise.reject(new DOMException("Aborted", "AbortError"));
        const slot = this.workers.reduce((a, b) => (b.busy < a.busy ? b : a));
        const id = this.nextId++;
        slot.busy++;
        return new Promise((resolve, reject) => {
            const onAbort = () => slot.worker.postMessage({ type: "cancel", id });
            signal?.addEventListener("abort", onAbort, { once: true });
            this.pending.set(id, {
                worker: slot.worker,
                resolve: reply => { slot.busy--; signal?.removeEventListener("abort", onAbort); resolve(reply); },
                reject: error => { slot.busy--; signal?.removeEventListener("abort", onAbort); reject(error); },
            });
            slot.worker.postMessage({ ...extra, type, id, url });
        });
    }
    dispose() {
        for (const { worker } of this.workers)
            worker.terminate();
        for (const request of this.pending.values())
            request.reject(new DOMException("Disposed", "AbortError"));
        this.pending.clear();
    }
    receive(reply) {
        const request = this.pending.get(reply.id);
        if (!request) {
            reply.images?.forEach(image => image.bitmap?.close());
            return;
        }
        this.pending.delete(reply.id);
        if (reply.aborted)
            return request.reject(new DOMException("Aborted", "AbortError"));
        if (reply.error !== undefined)
            return request.reject(new Error(reply.error));
        this.encodeMs = Math.max(this.encodeMs, reply.encodeMs ?? 0);
        this.pixelMs = Math.max(this.pixelMs, reply.pixelMs ?? 0);
        request.resolve(reply);
    }
}
//# sourceMappingURL=TileWorkerPool.js.map