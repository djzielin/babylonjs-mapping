import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine, PBRMaterial, Scene, Texture } from "@babylonjs/core";
import { googleAtlasDimensions, tryLoadGoogle3DFastModel } from "../src/google/Google3DFastModel";

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(dispose => dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([255, 216, 255, 192, 0, 8, 8, height >>> 8, height & 255, width >>> 8, width & 255, 1, 255, 217]);
}

function model(image: Uint8Array): ArrayBuffer {
  const size = Math.ceil((64 + image.length) / 4) * 4, binary = new Uint8Array(size);
  binary.set([0, 1, 2]); binary.set(new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer), 4);
  binary.set(new Uint8Array(new Float32Array([0, 0, 1, 0, 0, 1]).buffer), 40); binary.set(image, 64);
  const json = { asset: { version: "2.0" }, buffers: [{ byteLength: 64 + image.length }],
    bufferViews: [{ buffer: 0, byteLength: 4 }, { buffer: 0, byteOffset: 4, byteLength: 36 },
      { buffer: 0, byteOffset: 40, byteLength: 24 }, { buffer: 0, byteOffset: 64, byteLength: image.length }],
    accessors: [{ bufferView: 0, componentType: 5121, count: 3, type: "SCALAR" }, { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 3, type: "VEC2" }], meshes: [{ primitives: [{ attributes: { POSITION: 1, TEXCOORD_0: 2 }, indices: 0, material: 0 }] }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
    materials: [{ extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }], images: [{ bufferView: 3, mimeType: "image/jpeg" }], samplers: [], extensionsUsed: ["KHR_materials_unlit"] };
  const encoded = new TextEncoder().encode(JSON.stringify(json)), length = Math.ceil(encoded.length / 4) * 4;
  const buffer = new ArrayBuffer(28 + length + size), view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20, length).fill(32); new Uint8Array(buffer, 20, encoded.length).set(encoded);
  view.setUint32(20 + length, size, true); view.setUint32(24 + length, 0x004e4942, true); new Uint8Array(buffer, 28 + length).set(binary);
  return buffer;
}

function sceneFixture() {
  const engine = new NullEngine(), scene = new Scene(engine);
  new PBRMaterial("scene BRDF initialization", scene).dispose();
  cleanup.push(() => engine.dispose(), () => scene.dispose());
  return scene;
}

describe("distant coverage atlas preview", () => {
  it("reads JPEG SOF and PNG IHDR dimensions without decoding pixels", () => {
    expect(googleAtlasDimensions(jpeg(4096, 2048), "image/jpeg")).toEqual({ width: 4096, height: 2048 });
    const png = new Uint8Array(24), header = new DataView(png.buffer);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]); header.setUint32(8, 13); header.setUint32(12, 0x49484452);
    header.setUint32(16, 512); header.setUint32(20, 1024);
    expect(googleAtlasDimensions(png, "image/png")).toEqual({ width: 512, height: 1024 });
    expect(googleAtlasDimensions(jpeg(0, 32), "image/jpeg")).toBeUndefined();
    expect(googleAtlasDimensions(jpeg(64, 32).subarray(0, 9), "image/jpeg")).toBeUndefined();
    expect(googleAtlasDimensions(new Uint8Array([1, 2, 3]), "image/png")).toBeUndefined();
  });

  it("resizes only larger known atlases with preserved aspect and high-quality sampling", async () => {
    const scene = sceneFixture(), closed = vi.fn();
    const decode = vi.fn(async () => ({ width: 1024, height: 512, close: closed } as unknown as ImageBitmap));
    vi.stubGlobal("createImageBitmap", decode);
    const report = vi.fn();
    const loaded = await tryLoadGoogle3DFastModel(model(jpeg(4096, 2048)), scene, undefined, undefined, { maxSize: 1024, decoded: report });
    expect(decode).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ resizeWidth: 1024, resizeHeight: 512, resizeQuality: "high" }));
    expect(report).toHaveBeenCalledWith({ sourceWidth: 4096, sourceHeight: 2048, width: 1024, height: 512, resized: true });
    expect(loaded!.asset.meshes.find(mesh => mesh.getTotalVertices() > 0)!.getTotalVertices()).toBe(3);
    loaded!.asset.dispose(); expect(closed).toHaveBeenCalledOnce();
  });

  it.each(["small", "unknown", "default"])("keeps full-source decode for %s eligibility", async mode => {
    const scene = sceneFixture(), closed = vi.fn();
    const decode = vi.fn(async () => ({ width: 512, height: 256, close: closed } as unknown as ImageBitmap));
    vi.stubGlobal("createImageBitmap", decode);
    const image = mode === "unknown" ? new Uint8Array([255, 216, 255, 217]) : jpeg(512, 256);
    const loaded = await tryLoadGoogle3DFastModel(model(image), scene, undefined, undefined, mode === "default" ? undefined : { maxSize: 1024 });
    expect(decode.mock.calls[0][1]).not.toHaveProperty("resizeWidth");
    loaded!.asset.dispose(); expect(closed).toHaveBeenCalledOnce();
  });

  it.each(["failed", "ignored"])("falls back to full embedded bytes when bitmap resize is %s", async mode => {
    const scene = sceneFixture(), closed = vi.fn();
    vi.stubGlobal("createImageBitmap", mode === "failed" ? vi.fn(async () => { throw new Error("Resize unsupported"); })
      : vi.fn(async () => ({ width: 4096, height: 2048, close: closed } as unknown as ImageBitmap)));
    const report = vi.fn(), image = jpeg(4096, 2048);
    const loaded = await tryLoadGoogle3DFastModel(model(image), scene, undefined, undefined, { maxSize: 1024, decoded: report });
    const texture = loaded!.asset.textures[0] as Texture;
    expect(Array.from((texture as any)._buffer)).toEqual(Array.from(image));
    expect(report).toHaveBeenCalledWith({ sourceWidth: 4096, sourceHeight: 2048, width: 4096, height: 2048, resized: false });
    if (mode === "ignored") expect(closed).toHaveBeenCalledOnce();
    loaded!.asset.dispose();
  });
});
