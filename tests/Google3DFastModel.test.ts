import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetContainer, Mesh, NullEngine, PBRMaterial, Scene, Texture, VertexBuffer } from "@babylonjs/core";
import { DracoDecoder } from "@babylonjs/core/Meshes/Compression/dracoDecoder";
import type { IGLTF } from "babylonjs-gltf2interface";
import { tryLoadGoogle3DFastModel } from "../src/google/Google3DFastModel";

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(dispose => dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const uv = new Float32Array([0, 0, 1, 0, 0, 1]);

function glb(draco = false, change?: (json: IGLTF) => void): ArrayBuffer {
  const binary = new Uint8Array(68);
  binary.set([0, 1, 2], 0); binary.set(new Uint8Array(positions.buffer), 4);
  binary.set(new Uint8Array(uv.buffer), 40); binary.set([255, 216, 255, 217], 64);
  const json: IGLTF = { asset: { version: "2.0", copyright: "First; Second" }, buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }, { buffer: 0, byteOffset: 4, byteLength: 36 },
      { buffer: 0, byteOffset: 40, byteLength: 24 }, { buffer: 0, byteOffset: 64, byteLength: 4 }],
    accessors: [{ bufferView: 0, componentType: 5121, count: 3, type: "SCALAR" },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 2, componentType: 5126, count: 3, type: "VEC2" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 1, TEXCOORD_0: 2 }, indices: 0, material: 0, mode: 4 }] }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
    materials: [{ extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0, sampler: 0 }], images: [{ bufferView: 3, mimeType: "image/jpeg" }],
    samplers: [{ wrapS: 33071, wrapT: 33071 }], extensionsUsed: ["KHR_materials_unlit"] };
  if (draco) { json.meshes![0].primitives[0].extensions = { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 7, TEXCOORD_0: 8 } } }; json.extensionsUsed!.push("KHR_draco_mesh_compression"); }
  change?.(json);
  const encoded = new TextEncoder().encode(JSON.stringify(json)), length = Math.ceil(encoded.length / 4) * 4;
  const buffer = new ArrayBuffer(28 + length + binary.length), view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20, length).fill(32); new Uint8Array(buffer, 20, encoded.length).set(encoded);
  view.setUint32(20 + length, binary.length, true); view.setUint32(24 + length, 0x004e4942, true);
  new Uint8Array(buffer, 28 + length).set(binary);
  return buffer;
}

function sceneFixture() {
  const engine = new NullEngine(), scene = new Scene(engine);
  cleanups.push(() => engine.dispose(), () => scene.dispose());
  return { engine, scene };
}

function bitmapFixture() {
  const fixture = sceneFixture();
  new PBRMaterial("scene-owned BRDF initialization", fixture.scene).dispose();
  const bitmap = { width: 512, height: 1024, close: vi.fn() } as unknown as ImageBitmap;
  return { ...fixture, bitmap, sceneTextures: [...fixture.scene.textures] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("static Google model preparation", () => {
  it.each([
    ["animation", (json: IGLTF) => { json.animations = [{ channels: [], samplers: [] }]; }],
    ["unknown extension", (json: IGLTF) => { json.extensionsRequired = ["Unknown_extension"]; }],
    ["blend material", (json: IGLTF) => { json.materials![0].alphaMode = "BLEND"; }],
    ["external image", (json: IGLTF) => { json.images![0].uri = "external.jpg"; }],
    ["morph target", (json: IGLTF) => { json.meshes![0].primitives[0].targets = [{ POSITION: 1 }]; }],
    ["unknown attribute", (json: IGLTF) => { json.meshes![0].primitives[0].attributes.COLOR_0 = 1; }],
  ] as const)("falls back for %s before constructing any assets", async (_name, change) => {
    const { scene } = sceneFixture();
    const init = vi.spyOn(scene, "addMesh");
    expect(await tryLoadGoogle3DFastModel(glb(false, change), scene)).toBeUndefined();
    expect(init).not.toHaveBeenCalled();
    expect(scene.meshes).toHaveLength(0); expect(scene.materials).toHaveLength(0);
    expect(scene.geometries).toHaveLength(0); expect(scene.textures).toHaveLength(0);
  });

  it("preserves mapped Draco bytes, normalization, geometry and hidden container state", async () => {
    const { scene } = sceneFixture();
    const decode = vi.fn(async () => ({ totalVertices: 3, indices: new Uint16Array([0, 1, 2]), attributes: [
      { kind: VertexBuffer.PositionKind, data: positions, byteStride: 12, byteOffset: 0, size: 3, normalized: false },
      { kind: VertexBuffer.UVKind, data: uv, byteStride: 8, byteOffset: 0, size: 2, normalized: false },
    ] }));
    vi.spyOn(DracoDecoder, "Default", "get").mockReturnValue({ decodeMeshToMeshDataAsync: decode } as unknown as DracoDecoder);
    const loaded = await tryLoadGoogle3DFastModel(glb(true), scene);
    expect(loaded).toBeDefined(); cleanups.push(() => loaded!.asset.dispose());
    expect(decode).toHaveBeenCalledWith(expect.any(Uint8Array), { position: 7, uv: 8 }, { position: false, uv: false });
    expect(scene.meshes).toHaveLength(0); expect(scene.materials).toHaveLength(0);
    const mesh = loaded!.asset.meshes.find(mesh => mesh.getTotalVertices() > 0)!;
    expect(Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!)).toEqual(Array.from(positions));
    expect(Array.from(mesh.getIndices()!)).toEqual([0, 1, 2]);
    expect(loaded!.attributions).toEqual(["First", "Second"]);
    loaded!.asset.addAllToScene(); expect(scene.meshes).toHaveLength(2);
  });

  it("aborts unresolved Draco preparation without leaving hidden resources or dirty scene flags", async () => {
    const { scene, engine } = sceneFixture();
    new PBRMaterial("scene-owned BRDF initialization", scene).dispose();
    const sceneTextures = [...scene.textures];
    const released = vi.spyOn(engine, "_releaseTexture");
    const existing = new Mesh("existing city", scene);
    const decode = vi.fn(() => new Promise<never>(() => {}));
    vi.spyOn(DracoDecoder, "Default", "get").mockReturnValue({ decodeMeshToMeshDataAsync: decode } as unknown as DracoDecoder);
    const disposed = vi.spyOn(AssetContainer.prototype, "dispose");
    const controller = new AbortController();
    const pending = tryLoadGoogle3DFastModel(glb(true), scene, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce()); controller.abort(); await rejected;
    expect(disposed).toHaveBeenCalledOnce(); expect(scene.meshes).toEqual([existing]);
    expect(scene.materials).toHaveLength(0); expect(scene.textures).toEqual(sceneTextures);
    // NullEngine deliberately leaves its cache intact; the real engine releases
    // hardware/cache resources through this call once the texture refcount is zero.
    expect(released.mock.calls.some(([texture]) => texture.url?.startsWith("data:google-static-"))).toBe(true);
    expect(scene._blockEntityCollection).toBe(false); expect(scene.blockMaterialDirtyMechanism).toBe(false);
  });

  it("settles all started texture jobs after synchronous construction failure", async () => {
    const { scene, engine } = sceneFixture();
    new PBRMaterial("scene-owned BRDF initialization", scene).dispose();
    const sceneTextures = [...scene.textures];
    vi.spyOn(engine, "createTexture").mockImplementation(() => { throw new Error("GPU texture allocation failed"); });
    expect(await tryLoadGoogle3DFastModel(glb(), scene)).toBeUndefined();
    expect(scene.meshes).toHaveLength(0); expect(scene.materials).toHaveLength(0); expect(scene.textures).toEqual(sceneTextures);
    expect(scene._blockEntityCollection).toBe(false); expect(scene.blockMaterialDirtyMechanism).toBe(false);
  });
});

describe("static Google atlas bitmap lifetime", () => {
  it("decodes original atlas bytes without resize and retains the bitmap through context rebuilding", async () => {
    const { scene, engine, bitmap } = bitmapFixture();
    const decode = vi.fn(async () => bitmap);
    vi.stubGlobal("createImageBitmap", decode);
    const uploads = vi.spyOn(engine, "createTexture");
    const loaded = await tryLoadGoogle3DFastModel(glb(), scene);
    expect(loaded).toBeDefined(); cleanups.push(() => loaded!.asset.dispose());
    expect(decode).toHaveBeenCalledOnce();
    const [source, options] = decode.mock.calls[0] as unknown as [Blob, ImageBitmapOptions];
    expect(source.type).toBe("image/jpeg");
    expect(Array.from(new Uint8Array(await source.arrayBuffer()))).toEqual([255, 216, 255, 217]);
    expect(options).toEqual({ premultiplyAlpha: "none", colorSpaceConversion: "none", imageOrientation: "none" });
    expect(options.resizeWidth).toBeUndefined(); expect(options.resizeHeight).toBeUndefined();
    const texture = loaded!.asset.textures[0] as Texture;
    const internal = texture.getInternalTexture()!;
    expect(internal._buffer).toBe(bitmap);
    expect(uploads.mock.calls.filter(call => call[7] === bitmap)).toHaveLength(1);
    expect(bitmap.close).not.toHaveBeenCalled();
    internal._rebuild();
    await vi.waitFor(() => expect(uploads.mock.calls.filter(call => call[7] === bitmap)).toHaveLength(2));
    await vi.waitFor(() => expect(internal.isReady).toBe(true));
    expect(bitmap.close).not.toHaveBeenCalled();
    loaded!.asset.dispose();
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("uses the original encoded atlas when bitmap decoding rejects", async () => {
    const { scene, engine } = bitmapFixture();
    const decode = vi.fn(async () => { throw new Error("Bitmap format is unsupported"); });
    vi.stubGlobal("createImageBitmap", decode);
    const uploads = vi.spyOn(engine, "createTexture");
    const loaded = await tryLoadGoogle3DFastModel(glb(), scene);
    expect(loaded).toBeDefined(); cleanups.push(() => loaded!.asset.dispose());
    expect(decode).toHaveBeenCalledOnce();
    const atlasUpload = uploads.mock.calls.find(call => String(call[0]).startsWith("data:google-static-"))!;
    expect(atlasUpload).toBeDefined();
    expect(atlasUpload[7]).toBeInstanceOf(Uint8Array);
    expect(Array.from(atlasUpload[7] as Uint8Array)).toEqual([255, 216, 255, 217]);
  });

  it("closes a bitmap that finishes after cancellation without uploading it or retaining hidden assets", async () => {
    const { scene, engine, bitmap, sceneTextures } = bitmapFixture();
    const decoding = deferred<ImageBitmap>();
    const decode = vi.fn(() => decoding.promise);
    vi.stubGlobal("createImageBitmap", decode);
    const uploads = vi.spyOn(engine, "createTexture");
    const disposed = vi.spyOn(AssetContainer.prototype, "dispose");
    const controller = new AbortController();
    const pending = tryLoadGoogle3DFastModel(glb(), scene, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    controller.abort(); await rejected;
    expect(disposed).toHaveBeenCalledOnce();
    expect(scene.meshes).toHaveLength(0); expect(scene.materials).toHaveLength(0);
    expect(scene.geometries).toHaveLength(0); expect(scene.textures).toEqual(sceneTextures);
    decoding.resolve(bitmap);
    await vi.waitFor(() => expect(bitmap.close).toHaveBeenCalledOnce());
    expect(uploads.mock.calls.some(call => call[7] === bitmap)).toBe(false);
    expect(scene._blockEntityCollection).toBe(false); expect(scene.blockMaterialDirtyMechanism).toBe(false);
  });

  it("releases a decoded bitmap and all assets when its texture upload throws", async () => {
    const { scene, engine, bitmap, sceneTextures } = bitmapFixture();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    vi.spyOn(engine, "createTexture").mockImplementation(() => { throw new Error("GPU atlas allocation failed"); });
    expect(await tryLoadGoogle3DFastModel(glb(), scene)).toBeUndefined();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(scene.meshes).toHaveLength(0); expect(scene.materials).toHaveLength(0);
    expect(scene.geometries).toHaveLength(0); expect(scene.textures).toEqual(sceneTextures);
    expect(scene._blockEntityCollection).toBe(false); expect(scene.blockMaterialDirtyMechanism).toBe(false);
  });

  it("settles preparation when HTML fallback upload fails after bitmap rejection", async () => {
    const { scene, engine, sceneTextures } = bitmapFixture();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("Bitmap format is unsupported"); }));
    vi.spyOn(engine, "createTexture").mockImplementation(() => { throw new Error("HTML atlas allocation failed"); });
    expect(await tryLoadGoogle3DFastModel(glb(), scene)).toBeUndefined();
    expect(scene.meshes).toHaveLength(0); expect(scene.materials).toHaveLength(0);
    expect(scene.geometries).toHaveLength(0); expect(scene.textures).toEqual(sceneTextures);
    expect(scene._blockEntityCollection).toBe(false); expect(scene.blockMaterialDirtyMechanism).toBe(false);
  });
});
