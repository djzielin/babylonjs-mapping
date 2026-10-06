import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AssetContainer, Material, Matrix, NullEngine, PBRMaterial, Quaternion, Scene, Texture, Vector3, VertexBuffer } from "@babylonjs/core";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { tryLoadGoogle3DFastModel } from "../src/google/Google3DFastModel";

beforeAll(async () => { await import("@babylonjs/loaders/glTF/index.js"); });
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(dispose => dispose()); vi.restoreAllMocks(); });
let nextNativeName = 0;
function setup(rightHanded = false) {
    const engine = new NullEngine({ renderWidth: 512, renderHeight: 512, textureSize: 64,
        deterministicLockstep: false, lockstepMaxSteps: 4, useHighPrecisionMatrix: true });
    const scene = new Scene(engine); scene.useRightHandedSystem = rightHanded;
    // PBR creates one shared scene BRDF lookup texture outside every glTF
    // container, including unlit materials. Keep that native resource out of
    // atlas request/ownership assertions below.
    new PBRMaterial("shared BRDF warmup", scene).dispose();
    const sceneTextureCount = scene.textures.length;
    cleanup.push(() => { scene.dispose(); engine.dispose(); });
    return { scene, engine, sceneTextureCount };
}
function pack(json: any, binary: Uint8Array): ArrayBuffer {
    const encoded = new TextEncoder().encode(JSON.stringify(json)), jsonLength = Math.ceil(encoded.length / 4) * 4;
    const binaryLength = Math.ceil(binary.length / 4) * 4, result = new ArrayBuffer(28 + jsonLength + binaryLength);
    const header = new DataView(result), bytes = new Uint8Array(result);
    header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, result.byteLength, true);
    header.setUint32(12, jsonLength, true); header.setUint32(16, 0x4e4f534a, true);
    bytes.fill(32, 20, 20 + jsonLength); bytes.set(encoded, 20);
    header.setUint32(20 + jsonLength, binaryLength, true); header.setUint32(24 + jsonLength, 0x004e4942, true);
    bytes.set(binary, 28 + jsonLength); return result;
}
function fixture(textured = false, mutate?: (json: any) => void) {
    const views: any[] = [], parts: { offset: number; bytes: Uint8Array }[] = [];
    let length = 0;
    const append = (data: ArrayBufferView) => {
        length = Math.ceil(length / 4) * 4;
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length }); parts.push({ offset: length, bytes });
        length += bytes.length; return views.length - 1;
    };
    append(new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0, 2, 3, 0]));
    append(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]));
    append(new Uint8Array([0, 1, 2, 2, 1, 3]));
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZGsAAAAASUVORK5CYII=", "base64"));
    const imageViews = textured ? [append(png), append(png)] : [];
    const localMatrix = Matrix.Compose(new Vector3(-1, 1.5, 2), Quaternion.RotationAxis(Vector3.Forward(), 0.2), new Vector3(4, 5, 6));
    const json: any = {
        asset: { version: "2.0" }, extensionsUsed: ["KHR_materials_unlit"], extensionsRequired: ["KHR_materials_unlit"],
        scene: 0, scenes: [{ nodes: [0] }],
        nodes: [{ name: "TRS parent", translation: [1, 2, 3], rotation: Quaternion.RotationAxis(Vector3.Up(), 0.3).asArray(), scale: [2, 0.5, 3], children: [1] },
            { name: "matrix child", matrix: Array.from(localMatrix.asArray()), mesh: 0 }],
        meshes: [{ primitives: [0, 1].map(material => ({ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, mode: 4, material })) }],
        buffers: [{ byteLength: length }], bufferViews: views,
        accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: "VEC3", min: [0, 0, 0], max: [2, 3, 0] },
            { bufferView: 1, componentType: 5126, count: 4, type: "VEC2" }, { bufferView: 2, componentType: 5121, count: 6, type: "SCALAR" }],
        materials: [0, 1].map(index => ({ extensions: { KHR_materials_unlit: {} }, doubleSided: index === 1, alphaMode: "OPAQUE",
            pbrMetallicRoughness: { baseColorFactor: index === 0 ? [0.2, 0.4, 0.6, 0.35] : [0.7, 0.5, 0.3, 0.9],
                metallicFactor: 0.2, roughnessFactor: 0.4, ...(textured ? { baseColorTexture: { index } } : {}) } })),
        textures: textured ? [0, 1].map(source => ({ source, sampler: 0 })) : [],
        images: imageViews.map(bufferView => ({ bufferView, mimeType: "image/png" })),
        samplers: textured ? [{ wrapS: 33071, wrapT: 33648 }] : [],
    };
    mutate?.(json);
    const binary = new Uint8Array(length); for (const part of parts) binary.set(part.bytes, part.offset);
    return { buffer: pack(json, binary), png };
}
function digest(values: ArrayLike<number>): string {
    // Hash numeric data to keep real fixture coordinate/pixel arrays out of failure output.
    return createHash("sha256").update(JSON.stringify(Array.from(values))).digest("hex");
}
function difference(a: ArrayLike<number>, b: ArrayLike<number>): number {
    if (a.length !== b.length) return Infinity;
    let maximum = 0; for (let index = 0; index < a.length; index++) maximum = Math.max(maximum, Math.abs(a[index] - b[index]));
    return maximum;
}
function materialState(material: PBRMaterial) {
    return { unlit: material.unlit, color: material.albedoColor.asArray(), alpha: material.alpha,
        metallic: material.metallic, roughness: material.roughness, transparency: material.transparencyMode,
        cull: material.backFaceCulling, twoSided: material.twoSidedLighting, specularAA: material.enableSpecularAntiAliasing,
        radianceOverAlpha: material.useRadianceOverAlpha, specularOverAlpha: material.useSpecularOverAlpha };
}
function textureState(texture: Texture) {
    return { wrapU: texture.wrapU, wrapV: texture.wrapV, sampling: texture.samplingMode,
        gamma: texture.gammaSpace, coordinateIndex: texture.coordinatesIndex, invertY: texture.getInternalTexture()?.invertY,
        mipmaps: texture.getInternalTexture()?.generateMipMaps };
}
async function pair(buffer: ArrayBuffer, scene: Scene) {
    const native = await LoadAssetContainerAsync(new Uint8Array(buffer), scene,
        { pluginExtension: ".glb", name: `native-fast-compatibility-${nextNativeName++}.glb` });
    cleanup.push(() => native.dispose());
    const loaded = await tryLoadGoogle3DFastModel(buffer, scene);
    expect(loaded !== undefined).toBe(true);
    const fast = loaded!.asset; cleanup.push(() => fast.dispose());
    return { native, fast };
}
function compareGeometry(native: AssetContainer, fast: AssetContainer) {
    const original = native.meshes.filter(mesh => mesh.getTotalVertices() > 0), candidate = fast.meshes.filter(mesh => mesh.getTotalVertices() > 0);
    expect(candidate.length).toBe(original.length);
    for (let index = 0; index < original.length; index++) {
        const a = original[index], b = candidate[index];
        expect(b.getTotalVertices()).toBe(a.getTotalVertices());
        expect(digest(b.getIndices()!)).toBe(digest(a.getIndices()!));
        for (const kind of [VertexBuffer.PositionKind, VertexBuffer.UVKind, VertexBuffer.NormalKind]) {
            expect(b.isVerticesDataPresent(kind)).toBe(a.isVerticesDataPresent(kind));
            if (a.isVerticesDataPresent(kind)) expect(digest(b.getVerticesData(kind)!)).toBe(digest(a.getVerticesData(kind)!));
        }
        expect(b.sideOrientation).toBe(a.sideOrientation);
        expect(difference(b.computeWorldMatrix(true).asArray(), a.computeWorldMatrix(true).asArray())).toBeLessThan(1e-5);
        expect(Vector3.Distance(b.getBoundingInfo().boundingBox.minimumWorld, a.getBoundingInfo().boundingBox.minimumWorld)).toBeLessThan(1e-5);
        expect(Vector3.Distance(b.getBoundingInfo().boundingBox.maximumWorld, a.getBoundingInfo().boundingBox.maximumWorld)).toBeLessThan(1e-5);
        expect(materialState(b.material as PBRMaterial)).toEqual(materialState(a.material as PBRMaterial));
    }
}

describe("static Google model native compatibility", () => {
    it.each([false, true])("matches native nested TRS/matrix, handedness, geometry and unlit PBR (%s)", async rightHanded => {
        const { scene } = setup(rightHanded), { native, fast } = await pair(fixture().buffer, scene);
        compareGeometry(native, fast);
        expect(scene.meshes).toHaveLength(0); expect(scene.materials).toHaveLength(0);
        expect(scene.geometries).toHaveLength(0); expect(scene.transformNodes).toHaveLength(0);
        for (const mesh of fast.meshes.filter(mesh => mesh.getTotalVertices())) {
            expect(mesh.getIndices()).toBeInstanceOf(Uint16Array);
            expect(mesh.isVerticesDataPresent(VertexBuffer.NormalKind)).toBe(false);
            expect(mesh.sideOrientation).toBe(rightHanded ? Material.CounterClockWiseSideOrientation : Material.ClockWiseSideOrientation);
        }
    });

    it("preserves native atlas buffer bytes, invertY, clamp/mirror, mipmaps and sRGB requests", async () => {
        const { scene, engine } = setup(), source = fixture(true);
        const requests = vi.spyOn(engine, "createTexture");
        const { native, fast } = await pair(source.buffer, scene);
        compareGeometry(native, fast);
        expect(fast.textures.length).toBe(native.textures.length);
        for (let index = 0; index < native.textures.length; index++) {
            expect(textureState(fast.textures[index] as Texture)).toEqual(textureState(native.textures[index] as Texture));
            expect((fast.textures[index] as Texture).wrapU).toBe(Texture.CLAMP_ADDRESSMODE);
            expect((fast.textures[index] as Texture).wrapV).toBe(Texture.MIRROR_ADDRESSMODE);
        }
        const calls = requests.mock.calls as unknown as any[][];
        expect(calls.length).toBe(4);
        for (const call of calls) {
            expect(call[2]).toBe(false); expect(call[14]).toBe(true);
            const bytes = call[7] as Uint8Array;
            expect(digest(bytes)).toBe(digest(source.png));
        }
        expect(new Set(calls.map(call => call[0])).size).toBe(4);
    });

    it.each([
        ["lit material without normals", (json: any) => { delete json.materials[0].extensions.KHR_materials_unlit; }],
        ["morph target", (json: any) => { json.meshes[0].primitives[0].targets = [{ POSITION: 0 }]; }],
        ["unknown required extension", (json: any) => { json.extensionsRequired.push("KHR_unsupported_test"); }],
        ["sparse accessor", (json: any) => { json.accessors[0].sparse = { count: 1 }; }],
    ])("rejects %s before allocating scene resources", async (_name, mutate) => {
        const { scene, engine, sceneTextureCount } = setup();
        const observers = scene.onDisposeObservable.observers.length, contextObservers = engine.onContextRestoredObservable.observers.length;
        expect(await tryLoadGoogle3DFastModel(fixture(false, mutate as (json: any) => void).buffer, scene)).toBeUndefined();
        expect(scene.meshes).toHaveLength(0); expect(scene.materials).toHaveLength(0); expect(scene.textures.length).toBe(sceneTextureCount);
        expect(scene.geometries).toHaveLength(0); expect(scene.transformNodes).toHaveLength(0);
        expect(scene.onDisposeObservable.observers.length).toBe(observers);
        expect(engine.onContextRestoredObservable.observers.length).toBe(contextObservers);
    });

    it("preserves dirty flags and native removal, re-add and disposal after fast preparation", async () => {
        const { scene, sceneTextureCount } = setup(); scene.blockMaterialDirtyMechanism = true;
        const loaded = await tryLoadGoogle3DFastModel(fixture(true).buffer, scene);
        expect(loaded !== undefined).toBe(true);
        const asset = loaded!.asset; cleanup.push(() => asset.dispose());
        expect(scene.blockMaterialDirtyMechanism).toBe(true); expect(scene._blockEntityCollection).toBe(false);
        expect(scene.meshes).toHaveLength(0); expect(scene.textures.length).toBe(sceneTextureCount);
        asset.addAllToScene();
        const meshCount = asset.meshes.length, geometryCount = asset.geometries.length, textureCount = asset.textures.length;
        expect(scene.meshes.length).toBe(meshCount); expect(scene.geometries.length).toBe(geometryCount); expect(scene.textures.length).toBe(textureCount + sceneTextureCount);
        asset.removeAllFromScene();
        expect(scene.meshes).toHaveLength(0); expect(scene.geometries).toHaveLength(0); expect(scene.textures.length).toBe(sceneTextureCount);
        asset.addAllToScene();
        expect(scene.meshes.length).toBe(meshCount); expect(scene.geometries.length).toBe(geometryCount); expect(scene.textures.length).toBe(textureCount + sceneTextureCount);
        asset.dispose();
        expect(scene.meshes).toHaveLength(0); expect(scene.geometries).toHaveLength(0); expect(scene.materials).toHaveLength(0); expect(scene.textures.length).toBe(sceneTextureCount);
    });
});

for (const name of ["baseline257", "near16", "source2"]) {
    const url = new URL(`../.tmp/google-native-schema/${name}.glb`, import.meta.url);
    it.skipIf(!existsSync(url))(`matches native geometry/materials for ignored, temporary ${name} fixture`, async () => {
        const { scene } = setup();
        const bytes = readFileSync(url), buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const { native, fast } = await pair(buffer, scene);
        compareGeometry(native, fast);
        expect(fast.textures.map(texture => textureState(texture as Texture)))
            .toEqual(native.textures.map(texture => textureState(texture as Texture)));
    });
}
