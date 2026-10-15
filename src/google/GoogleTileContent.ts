import type { IGLTF, IMeshPrimitive, INode } from "babylonjs-gltf2interface";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { DracoDecoder } from "@babylonjs/core/Meshes/Compression/dracoDecoder.js";
import { Geometry } from "@babylonjs/core/Meshes/geometry.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { TileDrawable } from "../shared/TileBatch.js";
import { createDecodedTexture, type DecodedImage } from "../shared/TileTextures.js";
import type { GoogleTileTextureOwner } from "./GoogleTileMaterial.js";

/** One drawable primitive, decoded off the main thread and ready for upload. */
export interface DecodedGooglePrimitive {
    positions: Float32Array;
    uvs?: Float32Array;
    indices: Uint16Array | Uint32Array;
    /** glTF-space bounds of `positions`. */
    minimum: Vector3;
    maximum: Vector3;
    /** Node hierarchy transform, glTF space. */
    nodeMatrix: Matrix;
    /** Index into `DecodedGoogleTile.images`. */
    image?: number;
}

export type DecodedGoogleImage = DecodedImage;

export interface DecodedGoogleTile {
    primitives: DecodedGooglePrimitive[];
    images: DecodedGoogleImage[];
    /** CESIUM_RTC centre in tile (ECEF) coordinates. */
    rtcCenter?: Vector3;
    attributions: string[];
}

/** Babylon objects created for one tile. */
export interface GoogleTileMeshes {
    meshes: Mesh[];
    textures: BaseTexture[];
    /** Approximate GPU memory in bytes. */
    byteLength: number;
}

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** Parsed GLB container: the JSON document and its binary chunk. */
export function parseGLB(buffer: ArrayBuffer): { json: IGLTF; binary?: Uint8Array } {
    const view = new DataView(buffer);
    if (buffer.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2)
        throw new Error("Not a glTF 2.0 binary.");
    let json: IGLTF | undefined, binary: Uint8Array | undefined;
    const end = Math.min(view.getUint32(8, true), buffer.byteLength);
    for (let offset = 12; offset + 8 <= end;) {
        const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
        const start = offset + 8;
        if (start + length > end) throw new Error("Truncated GLB chunk.");
        if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)));
        else if (type === BIN_CHUNK) binary = new Uint8Array(buffer, start, length);
        offset = start + length;
    }
    if (!json) throw new Error("GLB has no JSON chunk.");
    return { json, binary };
}

/** Attribution sources from the glTF `asset.copyright` field, which Google separates with semicolons. */
export function glbAttributions(json: IGLTF): string[] {
    const copyright = json.asset?.copyright;
    return typeof copyright === "string" ? copyright.split(";").map(part => part.trim()).filter(Boolean) : [];
}

let decoder: DracoDecoder | undefined;
/** A Draco worker pool sized for streaming: most of the CPU, but never the main thread's core. */
function draco(): DracoDecoder {
    const cores = typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4;
    return decoder ??= new DracoDecoder({ ...DracoDecoder.DefaultConfiguration, numWorkers: Math.max(1, Math.min(8, cores - 2)) });
}

/** Start loading the Draco decoder before the first tile arrives. */
export function warmGoogleTileDecoder(): void {
    void draco().whenReadyAsync().catch(() => undefined);
}

const COMPONENT_ARRAYS: Record<number, { new(buffer: ArrayBufferLike, offset: number, length: number): ArrayBufferView & ArrayLike<number> }> = {
    5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Read an uncompressed accessor as floats (or integers for indices), honouring stride. */
function readAccessor(json: IGLTF, binary: Uint8Array, index: number): ArrayLike<number> {
    const accessor = json.accessors![index];
    const view = json.bufferViews![accessor.bufferView!];
    const Type = COMPONENT_ARRAYS[accessor.componentType];
    const size = COMPONENTS[accessor.type];
    const elementBytes = (Type as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
    const stride = view.byteStride ?? size * elementBytes;
    const start = binary.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    if (stride === size * elementBytes && start % elementBytes === 0)
        return new Type(binary.buffer, start, accessor.count * size);
    const result = new Float32Array(accessor.count * size);
    const data = new DataView(binary.buffer);
    for (let i = 0; i < accessor.count; i++)
        for (let c = 0; c < size; c++) {
            const at = start + i * stride + c * elementBytes;
            result[i * size + c] = accessor.componentType === 5126 ? data.getFloat32(at, true)
                : accessor.componentType === 5125 ? data.getUint32(at, true)
                : accessor.componentType === 5123 ? data.getUint16(at, true) : data.getUint8(at);
        }
    return result;
}

function nodeMatrix(node: INode): Matrix {
    if (node.matrix) return Matrix.FromArray(node.matrix);
    return Matrix.Compose(
        node.scale ? Vector3.FromArray(node.scale) : Vector3.One(),
        node.rotation ? Quaternion.FromArray(node.rotation) : Quaternion.Identity(),
        node.translation ? Vector3.FromArray(node.translation) : Vector3.Zero(),
    );
}

function wrapMode(value: number | undefined): number {
    return value === 33071 ? Constants.TEXTURE_CLAMP_ADDRESSMODE
        : value === 33648 ? Constants.TEXTURE_MIRROR_ADDRESSMODE : Constants.TEXTURE_WRAP_ADDRESSMODE;
}

/**
 * Decode a Google photorealistic GLB. Geometry decompression runs in the
 * Draco worker pool and JPEG/PNG decoding in the browser's image decoder, so
 * the main thread only parses the JSON chunk. Normals are skipped: the tiles
 * are unlit photogrammetry.
 */
export async function decodeGoogleTile(buffer: ArrayBuffer, signal?: AbortSignal): Promise<DecodedGoogleTile> {
    const { json, binary } = parseGLB(buffer);
    const bytes = binary ?? new Uint8Array(0);
    const viewBytes = (index: number) => {
        const view = json.bufferViews![index];
        return new Uint8Array(bytes.buffer, bytes.byteOffset + (view.byteOffset ?? 0), view.byteLength);
    };

    const images: Promise<DecodedGoogleImage>[] = [];
    const imageForTexture = new Map<number, number>();
    const textureImage = (textureIndex: number): number => {
        const known = imageForTexture.get(textureIndex);
        if (known !== undefined) return known;
        const texture = json.textures![textureIndex];
        const image = json.images![texture.source!];
        const sampler = texture.sampler === undefined ? undefined : json.samplers?.[texture.sampler];
        const blob = new Blob([viewBytes(image.bufferView!) as BlobPart], { type: image.mimeType ?? "image/jpeg" });
        images.push(createImageBitmap(blob, { imageOrientation: "none", premultiplyAlpha: "none", colorSpaceConversion: "none" })
            .then(bitmap => ({ bitmap, width: bitmap.width, height: bitmap.height, wrapU: wrapMode(sampler?.wrapS), wrapV: wrapMode(sampler?.wrapT) })));
        imageForTexture.set(textureIndex, images.length - 1);
        return images.length - 1;
    };

    const primitives: Promise<DecodedGooglePrimitive>[] = [];
    const visit = (index: number, parent: Matrix) => {
        const node = json.nodes![index];
        const matrix = nodeMatrix(node).multiply(parent);
        if (node.mesh !== undefined)
            for (const primitive of json.meshes![node.mesh].primitives)
                if (primitive.mode === undefined || primitive.mode === 4)
                    primitives.push(decodePrimitive(json, bytes, primitive, matrix, viewBytes, textureImage));
        for (const child of node.children ?? []) visit(child, matrix);
    };
    const scene = json.scenes?.[json.scene ?? 0];
    for (const root of scene?.nodes ?? json.nodes?.map((_, i) => i) ?? []) visit(root, Matrix.Identity());

    const settled = await Promise.allSettled([Promise.all(primitives), Promise.all(images)]);
    if (settled[0].status === "rejected" || settled[1].status === "rejected" || signal?.aborted) {
        if (settled[1].status === "fulfilled") for (const image of settled[1].value) image.bitmap?.close();
        signal?.throwIfAborted();
        throw (settled[0] as PromiseRejectedResult).reason ?? (settled[1] as PromiseRejectedResult).reason;
    }
    const center = (json.extensions as { CESIUM_RTC?: { center?: number[] } } | undefined)?.CESIUM_RTC?.center;
    return {
        primitives: settled[0].value,
        images: settled[1].value,
        rtcCenter: center?.length === 3 ? Vector3.FromArray(center) : undefined,
        attributions: glbAttributions(json),
    };
}

async function decodePrimitive(json: IGLTF, binary: Uint8Array, primitive: IMeshPrimitive, matrix: Matrix,
    viewBytes: (index: number) => Uint8Array, textureImage: (index: number) => number): Promise<DecodedGooglePrimitive> {
    const position = json.accessors![primitive.attributes.POSITION];
    const material = primitive.material === undefined ? undefined : json.materials?.[primitive.material];
    const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
    const image = textureIndex === undefined || primitive.attributes.TEXCOORD_0 === undefined ? undefined : textureImage(textureIndex);
    const result: DecodedGooglePrimitive = {
        positions: new Float32Array(0), indices: new Uint16Array(0), nodeMatrix: matrix, image,
        minimum: Vector3.FromArray(position.min ?? [0, 0, 0]), maximum: Vector3.FromArray(position.max ?? [0, 0, 0]),
    };
    const compressed = primitive.extensions?.KHR_draco_mesh_compression as { bufferView: number; attributes: Record<string, number> } | undefined;
    if (compressed) {
        const wanted: Record<string, number> = { [VertexBuffer.PositionKind]: compressed.attributes.POSITION };
        if (image !== undefined) wanted[VertexBuffer.UVKind] = compressed.attributes.TEXCOORD_0;
        const data = await draco().decodeMeshToMeshDataAsync(viewBytes(compressed.bufferView), wanted);
        for (const attribute of data.attributes) {
            const values = toFloat32(attribute.data, attribute.size, attribute.byteOffset, attribute.byteStride, data.totalVertices);
            if (attribute.kind === VertexBuffer.PositionKind) result.positions = values;
            else if (attribute.kind === VertexBuffer.UVKind) result.uvs = values;
        }
        result.indices = data.indices ?? sequentialIndices(data.totalVertices);
    } else {
        result.positions = Float32Array.from(readAccessor(json, binary, primitive.attributes.POSITION));
        if (image !== undefined) result.uvs = Float32Array.from(readAccessor(json, binary, primitive.attributes.TEXCOORD_0!));
        const indices = primitive.indices === undefined ? undefined : readAccessor(json, binary, primitive.indices);
        const count = result.positions.length / 3;
        result.indices = !indices ? sequentialIndices(count)
            : count > 65535 ? Uint32Array.from(indices) : indices instanceof Uint16Array ? indices : Uint16Array.from(indices);
    }
    if (!position.min || !position.max) {
        const minimum = new Vector3(Infinity, Infinity, Infinity), maximum = minimum.negate();
        for (let i = 0; i < result.positions.length; i += 3) {
            const p = Vector3.FromArray(result.positions, i);
            minimum.minimizeInPlace(p); maximum.maximizeInPlace(p);
        }
        result.minimum = minimum; result.maximum = maximum;
    }
    return result;
}

function toFloat32(data: ArrayBufferView, size: number, byteOffset: number, byteStride: number, count: number): Float32Array {
    if (data instanceof Float32Array && (byteStride === 0 || byteStride === size * 4) && byteOffset === 0)
        return data.length === count * size ? data : data.subarray(0, count * size);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const stride = byteStride || size * 4;
    const result = new Float32Array(count * size);
    for (let i = 0; i < count; i++)
        for (let c = 0; c < size; c++) result[i * size + c] = view.getFloat32(byteOffset + i * stride + c * 4, true);
    return result;
}

function sequentialIndices(count: number): Uint16Array | Uint32Array {
    const indices = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
    return indices;
}

/** Upload a tile's images. */
function createTileTextures(tile: DecodedGoogleTile, engine: AbstractEngine, name: string): { textures: BaseTexture[]; byteLength: number } {
    let byteLength = 0;
    const textures = tile.images.map(image => {
        const created = createDecodedTexture(image, engine, name);
        byteLength += created.byteLength;
        return created.texture;
    });
    return { textures, byteLength };
}

/** Babylon objects created for one tile when drawn by `TileBatch`. */
export interface TileDrawables {
    drawables: TileDrawable[];
    textures: BaseTexture[];
    /** Approximate GPU memory in bytes. */
    byteLength: number;
}

/**
 * Create GPU buffers and textures for a decoded tile without scene meshes,
 * for `TileBatch`. `localToWorld` receives each primitive's glTF-space
 * matrix and returns its world matrix.
 */
export function createTileDrawables(tile: DecodedGoogleTile, engine: AbstractEngine, name: string,
    localToWorld: (primitive: DecodedGooglePrimitive) => Matrix): TileDrawables {
    const { textures, byteLength: textureBytes } = createTileTextures(tile, engine, name);
    let byteLength = textureBytes;
    const drawables = tile.primitives.map((primitive): TileDrawable => {
        byteLength += primitive.positions.byteLength + (primitive.uvs?.byteLength ?? 0) + primitive.indices.byteLength;
        return {
            positions: new VertexBuffer(engine, primitive.positions, VertexBuffer.PositionKind, false, false, 3),
            uvs: primitive.uvs && new VertexBuffer(engine, primitive.uvs, VertexBuffer.UVKind, false, false, 2),
            indexBuffer: engine.createIndexBuffer(primitive.indices),
            indexCount: primitive.indices.length,
            texture: primitive.image === undefined ? undefined : textures[primitive.image],
            world: localToWorld(primitive),
            localPositions: primitive.positions,
            localIndices: primitive.indices,
        };
    });
    return { drawables, textures, byteLength };
}

/**
 * Create GPU resources for a decoded tile. `localToWorld` receives each
 * primitive's glTF-space matrix and returns its frozen world matrix. Bitmaps
 * are released after upload; a lost context reloads tiles rather than
 * keeping a second copy of every image in memory.
 */
export function createGoogleTileMeshes(tile: DecodedGoogleTile, scene: Scene, material: Material, name: string,
    localToWorld: (primitive: DecodedGooglePrimitive) => Matrix): GoogleTileMeshes {
    const engine = scene.getEngine() as AbstractEngine;
    const created = createTileTextures(tile, engine, name);
    const textures = created.textures;
    let byteLength = created.byteLength;
    const meshes = tile.primitives.map(primitive => {
        const mesh = new Mesh(name, scene);
        const geometry = new Geometry(name, scene, undefined, false);
        // Known bounds skip Babylon's per-vertex extent scan on the main thread.
        geometry._boundingInfo = new BoundingInfo(primitive.minimum, primitive.maximum);
        geometry.useBoundingInfoFromGeometry = true;
        geometry.setVerticesBuffer(new VertexBuffer(engine, primitive.positions, VertexBuffer.PositionKind, false, false, 3), primitive.positions.length / 3);
        if (primitive.uvs) geometry.setVerticesBuffer(new VertexBuffer(engine, primitive.uvs, VertexBuffer.UVKind, false, false, 2));
        geometry.setIndices(primitive.indices, primitive.positions.length / 3);
        geometry.applyToMesh(mesh);
        byteLength += primitive.positions.byteLength + (primitive.uvs?.byteLength ?? 0) + primitive.indices.byteLength;
        // Google3DTiles enables only tiles inside the view, so skip Babylon's
        // per-mesh frustum test.
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.isPickable = false;
        mesh.material = material;
        (mesh as Mesh & GoogleTileTextureOwner).googleTexture = primitive.image === undefined ? undefined : textures[primitive.image];
        mesh.freezeWorldMatrix(localToWorld(primitive));
        return mesh;
    });
    return { meshes, textures, byteLength };
}
