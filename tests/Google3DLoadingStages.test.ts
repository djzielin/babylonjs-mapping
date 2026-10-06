import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcRotateCamera, AssetContainer, NullEngine, Scene, TransformNode, Vector2 } from "@babylonjs/core";
import GlobeSet from "../src/core/GlobeSet";
import Google3DTiles, { type Google3DTile, type Google3DTileset, type Google3DTilesOptions, type GoogleModelTileLoader } from "../src/google/Google3DTiles";
import { tryLoadGoogle3DFastModel } from "../src/google/Google3DFastModel";

vi.mock("../src/core/Attribution", () => ({ default: class AttributionStub {
  public advancedTexture = {};
  public addAttribution = vi.fn();
  public setGoogleAttributions = vi.fn();
} }));

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(dispose => dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function sphere(longitude: number, radius = 100) {
  const angle = longitude * Math.PI / 180;
  return { sphere: [6378137 * Math.cos(angle), 6378137 * Math.sin(angle), 0, radius] };
}

function branch(name: string, longitude: number): Google3DTile {
  const boundingVolume = sphere(longitude);
  return { boundingVolume, geometricError: 128, content: { uri: `${name}-coarse.glb` },
    children: [{ boundingVolume, geometricError: 0, content: { uri: `${name}-fine.glb` } }] };
}

function fixture(root: Google3DTile, customLoader?: GoogleModelTileLoader, nativeHierarchy = false, options: Google3DTilesOptions = {}) {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const camera = new ArcRotateCamera("eye", 0, 1, 1, globe.getSurfacePosition(0, 0.01), scene);
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld));
  camera.minZ = 1e-7; camera.getViewMatrix(true); camera.getProjectionMatrix(true);
  const requests: string[] = [];
  const hierarchy = vi.fn(async (_url: string): Promise<Google3DTileset> => ({ root }));
  const modelTileLoader: GoogleModelTileLoader = async (url, modelScene, signal) => {
    requests.push(new URL(url).pathname.split("/").at(-1)!);
    if (customLoader) return customLoader(url, modelScene, signal);
    const asset = new AssetContainer(modelScene);
    asset.rootNodes.push(new TransformNode(url, modelScene));
    return { asset, attributions: [] };
  };
  const google = new Google3DTiles(globe, { apiKey: "test", coverageRadius: 15 * 1609.344, maxTiles: 64,
    maximumScreenSpaceError: 1, maximumDisplayGeometricError: 33, maximumInitialErrorRatio: 2,
    cullToCamera: true, fullRadiusDemand: true, tilesetLoader: nativeHierarchy ? undefined : hierarchy, modelTileLoader, ...options });
  cleanup.push(() => engine.dispose(), () => scene.dispose(), () => google.dispose());
  return { google, requests, hierarchy, scene, camera, globe };
}

function staticTriangleGLB(): ArrayBuffer {
  const binary = new Uint8Array(40);
  binary.set([0, 1, 2]); binary.set(new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer), 4);
  const json = { asset: { version: "2.0" }, buffers: [{ byteLength: 40 }],
    bufferViews: [{ buffer: 0, byteLength: 4 }, { buffer: 0, byteOffset: 4, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5121, count: 3, type: "SCALAR" },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 1 }, indices: 0, material: 0 }] }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
    materials: [{ extensions: { KHR_materials_unlit: {} } }], textures: [], images: [], samplers: [], extensionsUsed: ["KHR_materials_unlit"] };
  const encoded = new TextEncoder().encode(JSON.stringify(json)), length = Math.ceil(encoded.length / 4) * 4;
  const buffer = new ArrayBuffer(28 + length + binary.length), view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20, length).fill(32); new Uint8Array(buffer, 20, encoded.length).set(encoded);
  view.setUint32(20 + length, binary.length, true); view.setUint32(24 + length, 0x004e4942, true);
  new Uint8Array(buffer, 28 + length).set(binary);
  return buffer;
}

describe("staged Google loading", () => {
  it("ignores throwing fast timing diagnostics without changing the prepared model", async () => {
    const { scene } = fixture({});
    const phases: Array<{ phase: string; milliseconds: number }> = [];
    const loaded = await tryLoadGoogle3DFastModel(staticTriangleGLB(), scene, undefined,
      (phase, milliseconds) => { phases.push({ phase, milliseconds }); throw new Error("Diagnostic only"); });
    expect(loaded).toBeDefined(); expect(loaded!.renderable).toBe(true);
    expect(phases.map(value => value.phase)).toEqual(expect.arrayContaining(["parse", "creation", "material", "geometry"]));
    expect(phases.every(value => Number.isFinite(value.milliseconds) && value.milliseconds >= 0)).toBe(true);
    loaded!.asset.dispose();
  });

  it.each([[false, false, 0], [true, false, 1], [true, true, 0]] as const)(
    "keeps lightweight unlit materials opt-in and falls back for unsupported fog (%s/%s)", async (enabled, fog, expected) => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(staticTriangleGLB())));
      const { google, scene } = fixture({ boundingVolume: sphere(0), geometricError: 128, content: { uri: "coverage.glb" } },
        undefined, false, { modelTileLoader: undefined, fastStaticModels: true, lightweightUnlitMaterials: enabled });
      if (fog) scene.fogMode = Scene.FOGMODE_EXP;
      await google.load(undefined, { stage: "coverage" });
      expect(google.stats.lightweightMaterialCount).toBe(expected);
      expect(google.loadedModelTiles[0].asset.materials[0].getClassName()).toBe(expected ? "StandardMaterial" : "PBRMaterial");
      expect(google.lastLoadResult).toMatchObject({ coverageQualityComplete: true, selectedTiles: 1, loadedTiles: 1 });
    });

  it("keeps unverified WebGPU materials on PBR even with the lightweight opt-in", async () => {
    const { scene } = fixture({});
    Object.defineProperty(scene.getEngine(), "isWebGPU", { configurable: true, get: () => true });
    const loaded = await tryLoadGoogle3DFastModel(staticTriangleGLB(), scene, undefined, undefined, undefined, true);
    expect(loaded).toBeDefined(); expect(loaded!.asset.materials[0].getClassName()).toBe("PBRMaterial");
    loaded!.asset.dispose();
  });

  it.each([
    ["coverage", 256, 0.1, true, 1], ["coverage", 256, 0, true, 0], ["coverage", 128, 0.1, true, 0],
    ["coverage", 256, 0.1, false, 0], ["immediate", 256, 0.1, true, 0], ["refinement", 256, 0.1, true, 0],
  ] as const)("limits atlas preview candidates to eligible %s error%d longitude%f refinable%s", async (stage, error, longitude, refinable, expected) => {
    const boundingVolume = sphere(longitude);
    const root = { boundingVolume, geometricError: error, content: { uri: "parent.glb" },
      children: refinable ? [{ boundingVolume, geometricError: 0, content: { uri: "child.glb" } }] : undefined };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(staticTriangleGLB())));
    const { google } = fixture(root, undefined, false, { modelTileLoader: undefined, fastStaticModels: true });
    await google.load(undefined, { stage, coverageGeometricError: 257, coverageAtlasMaxSize: 1024, coverageNearRadius: 750 });
    expect(google.stats.coveragePreviewCandidateModels).toBe(expected);
    expect(google.stats.coveragePreviewSelectedMaxSize).toBe(expected ? 1024 : 0);
    expect(google.stats.coveragePreviewModels).toBe(0); // Untextured input cannot be counted as resized.
  });

  it("aggregates safe native header/body, readable transfer and fast preparation timing", async () => {
    const body = staticTriangleGLB();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "Cache-Control": "private, max-age=14400, must-revalidate" } })));
    vi.spyOn(performance, "getEntriesByName").mockImplementation(() => [{ startTime: performance.now(), transferSize: 0,
      encodedBodySize: body.byteLength, decodedBodySize: body.byteLength } as PerformanceResourceTiming]);
    const { google } = fixture({ boundingVolume: sphere(0), geometricError: 128, content: { uri: "coverage.glb" } },
      undefined, false, { modelTileLoader: undefined, fastStaticModels: true });
    await google.load(undefined, { stage: "coverage" });
    expect(google.stats).toMatchObject({ modelResponsePositiveMaxAgeCount: 1, modelResponseMaxAgeMinSeconds: 14400,
      modelResponseMaxAgeMaxSeconds: 14400, modelResourceTimingReadableCount: 1, modelResourceZeroTransferCount: 1,
      modelResourceTransferBytes: 0, modelResourceEncodedBytes: body.byteLength, modelResourceTimingOpaqueCount: 0,
      modelResourceTimingUnavailableCount: 0, fastModelCount: 1 });
    for (const key of ["modelFetchHeaderMs", "modelFetchBodyMs", "fastParseMs", "fastCreationMs", "fastGeometryMs", "fastMaterialMs"] as const)
      expect(Number.isFinite(google.stats[key]) && google.stats[key] >= 0).toBe(true);
    expect(JSON.stringify(google.stats)).not.toMatch(/https:|key=|coverage\.glb/);
  });

  it.each(["missing", "opaque"])("does not mistake %s Resource Timing for a readable zero-transfer result", async mode => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(staticTriangleGLB())));
    vi.spyOn(performance, "getEntriesByName").mockImplementation(() => mode === "missing" ? []
      : [{ startTime: performance.now(), transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 } as PerformanceResourceTiming]);
    const { google } = fixture({ boundingVolume: sphere(0), geometricError: 128, content: { uri: "coverage.glb" } },
      undefined, false, { modelTileLoader: undefined, fastStaticModels: true });
    await google.load(undefined, { stage: "coverage" });
    expect(google.stats.modelResourceTimingReadableCount).toBe(0); expect(google.stats.modelResourceZeroTransferCount).toBe(0);
    expect(mode === "missing" ? google.stats.modelResourceTimingUnavailableCount : google.stats.modelResourceTimingOpaqueCount).toBe(1);
    expect(google.lastLoadResult?.coverageComplete).toBe(true);
  });

  it("buffers native coverage bodies before terrain without occupying decoders or allocating model assets", async () => {
    let release!: () => void;
    const terrain = new Promise<void>(resolve => { release = resolve; });
    const body = staticTriangleGLB(), fetcher = vi.fn(async () => new Response(body));
    vi.stubGlobal("fetch", fetcher);
    const { google } = fixture({ children: Array.from({ length: 3 }, (_, index) => ({ boundingVolume: sphere(0),
      geometricError: 128, content: { uri: `coverage-${index}.glb` } })) }, undefined, false,
      { modelTileLoader: undefined, fastStaticModels: true, maxBufferedModels: 2 });
    const loaded = google.load(undefined, { stage: "coverage", publicationBarrier: terrain,
      deferModelPreparationUntilPublication: true });
    await vi.waitFor(() => expect(google.loadingProgress.preparationQueued).toBe(2));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(google.loadingProgress).toMatchObject({ decodeActive: 0, decodeQueued: 0, publicationQueued: 0 });
    expect(google.stats).toMatchObject({ modelDecodeCount: 0, fastModelCount: 0, modelIntegrationMs: 0 });
    expect(google.loadedModelTiles).toHaveLength(0); expect(google.lastLoadResult?.coverageComplete).toBe(false);
    release(); await loaded;
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(google.stats).toMatchObject({ modelDecodeCount: 3, fastModelCount: 3 });
    expect(google.loadingProgress.preparationQueued).toBe(0);
    expect(google.lastLoadResult).toMatchObject({ selectedTiles: 3, loadedTiles: 3, coverageQualityComplete: true });
  });

  it("cancels buffered undecoded coverage while its terrain gate remains unresolved", async () => {
    const body = staticTriangleGLB(); vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    const { google } = fixture({ boundingVolume: sphere(0), geometricError: 128, content: { uri: "coverage.glb" } },
      undefined, false, { modelTileLoader: undefined, fastStaticModels: true });
    const controller = new AbortController();
    const loaded = google.load(undefined, { stage: "coverage", publicationBarrier: new Promise<void>(() => {}),
      publicationSignal: controller.signal, deferModelPreparationUntilPublication: true });
    await vi.waitFor(() => expect(google.loadingProgress.preparationQueued).toBe(1));
    controller.abort(); expect(await loaded).toEqual([]);
    expect(google.loadingProgress).toMatchObject({ preparationQueued: 0, decodeActive: 0, decodeQueued: 0, publicationQueued: 0 });
    expect(google.stats).toMatchObject({ modelDecodeCount: 0, fastModelCount: 0, modelIntegrationMs: 0 });
    expect(google.lastLoadResult).toMatchObject({ cancelled: true, failedModelTiles: 0, coverageComplete: false });
  });

  it("fingerprints unchanged raw root data consistently without exposing authenticated URI or session values", async () => {
    const root = { content: { uri: "detail.json?session=private-session" } };
    const first = fixture(root), second = fixture(root), changed = fixture({ content: { uri: "detail.json?session=different-session" } });
    await first.google.prepareCoverageHierarchy();
    await second.google.prepareCoverageHierarchy();
    await changed.google.prepareCoverageHierarchy();
    const fingerprint = first.google.stats.rootResponseFingerprint;
    expect(Number.isInteger(fingerprint)).toBe(true); expect(fingerprint).toBeGreaterThan(0);
    expect(second.google.stats.rootResponseFingerprint).toBe(fingerprint);
    expect(changed.google.stats.rootResponseFingerprint).not.toBe(fingerprint);
    expect(JSON.stringify(first.google.stats)).not.toMatch(/private-session|session=|key=/);
  });

  it("downloads and decodes coverage before terrain while withholding model publication and readiness", async () => {
    let releaseTerrain!: () => void;
    const terrain = new Promise<void>(resolve => { releaseTerrain = resolve; });
    const assets: AssetContainer[] = [];
    const { google } = fixture({ children: [branch("near", 0), branch("far", 0.1)] }, async (_url, scene) => {
      const asset = new AssetContainer(scene); assets.push(asset); vi.spyOn(asset, "addAllToScene");
      return { asset, attributions: ["Test source"] };
    });
    const coverage = google.load(undefined, { stage: "coverage", publicationBarrier: terrain });
    await vi.waitFor(() => expect(google.loadingProgress.publicationQueued).toBe(2));
    expect(assets).toHaveLength(2);
    expect(assets.every(asset => vi.mocked(asset.addAllToScene).mock.calls.length === 0)).toBe(true);
    expect(google.loadedModelTiles).toHaveLength(0); expect(google.getAttributions()).toEqual([]);
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: false, coverageQualityComplete: false });
    releaseTerrain(); await coverage;
    expect(assets.every(asset => vi.mocked(asset.addAllToScene).mock.calls.length === 1)).toBe(true);
    expect(google.loadedModelTiles).toHaveLength(2);
    expect(google.getAttributions()).toEqual(["Test source"]);
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: true, coverageQualityComplete: true });
    expect(google.loadingProgress.publicationQueued).toBe(0);
  });

  it.each(["signal", "rejection", "provider"])("settles and disposes unpublished coverage on %s with the barrier unresolved", async mode => {
    let rejectTerrain!: (reason: unknown) => void;
    const terrain = new Promise<void>((_resolve, reject) => { rejectTerrain = reject; });
    const assets: AssetContainer[] = [];
    const { google } = fixture({ children: [branch("near", 0), branch("far", 0.1)] }, async (_url, scene) => {
      const asset = new AssetContainer(scene); assets.push(asset);
      vi.spyOn(asset, "addAllToScene"); vi.spyOn(asset, "dispose");
      return { asset, attributions: [] };
    });
    const controller = new AbortController();
    const coverage = google.load(undefined, { stage: "coverage", publicationBarrier: terrain, publicationSignal: controller.signal });
    await vi.waitFor(() => expect(google.loadingProgress.publicationQueued).toBe(2));
    if (mode === "signal") controller.abort();
    else if (mode === "provider") google.cancelPendingLoad(true);
    else rejectTerrain(new Error("Terrain unavailable"));
    expect(await coverage).toEqual([]);
    expect(assets.every(asset => vi.mocked(asset.dispose).mock.calls.length === 1)).toBe(true);
    expect(assets.every(asset => vi.mocked(asset.addAllToScene).mock.calls.length === 0)).toBe(true);
    expect(google.loadedModelTiles).toHaveLength(0);
    expect(google.lastLoadResult).toMatchObject({ cancelled: true, failedModelTiles: 0, coverageComplete: false });
    expect(google.loadingProgress.publicationQueued).toBe(0);
  });

  it("aborts active unpublished fetches even when the outer cancellation normally preserves downloads", async () => {
    const aborted = vi.fn();
    let asset!: AssetContainer;
    const { google } = fixture({ children: [branch("near", 0)] }, async (_url, scene, signal) => {
      asset = new AssetContainer(scene); vi.spyOn(asset, "dispose"); vi.spyOn(asset, "addAllToScene");
      await new Promise<void>(resolve => signal?.addEventListener("abort", () => { aborted(); resolve(); }, { once: true }));
      return { asset, attributions: [] };
    });
    const coverage = google.load(undefined, { stage: "coverage", publicationBarrier: new Promise<void>(() => {}) });
    await vi.waitFor(() => expect(google.loadingProgress.modelActive).toBe(1));
    google.cancelPendingLoad(true);
    expect(await coverage).toEqual([]);
    expect(aborted).toHaveBeenCalledOnce(); expect(asset.dispose).toHaveBeenCalledOnce();
    expect(asset.addAllToScene).not.toHaveBeenCalled();
    expect(google.lastLoadResult).toMatchObject({ cancelled: true, failedModelTiles: 0 });
  });

  it("withholds completion for fully cached coverage until its publication barrier opens", async () => {
    const { google, requests } = fixture({ children: [branch("near", 0)] });
    await google.load(undefined, { stage: "coverage" });
    let releaseTerrain!: () => void;
    const terrain = new Promise<void>(resolve => { releaseTerrain = resolve; });
    const coverage = google.load(undefined, { stage: "coverage", publicationBarrier: terrain });
    await Promise.resolve(); await Promise.resolve();
    expect(google.lastLoadResult?.coverageComplete).toBe(false);
    expect(requests).toHaveLength(1);
    releaseTerrain(); await coverage;
    expect(google.lastLoadResult?.coverageComplete).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it("prepares cached coverage JSON without loading or publishing models", async () => {
    const root = { boundingVolume: sphere(0), geometricError: 512, content: { uri: "coarse.glb" },
      children: [{ content: { uri: "coverage.json" } }] };
    const { google, hierarchy, requests } = fixture(root);
    hierarchy.mockImplementation(async url => url.includes("coverage.json")
      ? { root: { boundingVolume: sphere(0), geometricError: 8, content: { uri: "ready.glb" } } } : { root });
    await google.prepareCoverageHierarchy(undefined, { coverageNearGeometricError: 16 });
    expect(requests).toEqual([]); expect(google.loadedModelTiles).toHaveLength(0);
    expect(google.lastLoadResult).toBeUndefined();
    expect(google.loadingProgress).toMatchObject({ stage: "refinement", phase: "idle" });
    await google.load(undefined, { stage: "coverage", coverageNearGeometricError: 16 });
    expect(hierarchy).toHaveBeenCalledTimes(2);
    expect(requests).toEqual(["ready.glb"]);
    expect(google.lastLoadResult?.coverageQualityComplete).toBe(true);
  });

  it("shares one pending root fetch between preparation and the real coverage load", async () => {
    const root = { boundingVolume: sphere(0), geometricError: 128, content: { uri: "coarse.glb" } };
    const { google, hierarchy, requests } = fixture(root);
    let releaseRoot!: () => void;
    const ready = new Promise<void>(resolve => { releaseRoot = resolve; });
    hierarchy.mockImplementation(async () => { await ready; return { root }; });
    const prepared = google.prepareCoverageHierarchy();
    const loaded = google.load(undefined, { stage: "coverage" });
    expect(hierarchy).toHaveBeenCalledOnce();
    releaseRoot(); await Promise.all([prepared, loaded]);
    expect(hierarchy).toHaveBeenCalledOnce(); expect(requests).toEqual(["coarse.glb"]);
    expect(google.lastLoadResult?.coverageComplete).toBe(true);
  });

  it("keeps immediate JSON preparation alive across baseline generation changes and reuses it", async () => {
    const root = { boundingVolume: sphere(0), geometricError: 128, content: { uri: "coarse.glb" },
      children: [{ content: { uri: "detail.json" } }] };
    const { google, hierarchy, requests } = fixture(root);
    let releaseDetail!: () => void;
    const ready = new Promise<void>(resolve => { releaseDetail = resolve; });
    hierarchy.mockImplementation(async url => {
      if (!url.includes("detail.json")) return { root };
      await ready; return { root: { boundingVolume: sphere(0), geometricError: 8, content: { uri: "fine.glb" } } };
    });
    const prepared = google.prepareImmediateHierarchy(undefined, { detailRadius: 300 });
    await vi.waitFor(() => expect(hierarchy).toHaveBeenCalledTimes(2));
    await google.load(undefined, { stage: "coverage" });
    const baseline = google.lastLoadResult;
    expect(requests).toEqual(["coarse.glb"]);
    releaseDetail(); await prepared;
    expect(google.lastLoadResult).toBe(baseline);
    expect(requests).toEqual(["coarse.glb"]);
    await google.load(undefined, { stage: "immediate", detailRadius: 300 });
    expect(hierarchy).toHaveBeenCalledTimes(2); expect(requests).toEqual(["coarse.glb", "fine.glb"]);
    expect(google.lastLoadResult?.immediateQualityComplete).toBe(true);
  });

  it.each(["signal", "provider"])("drops queued preparation on %s cancellation without model or readiness mutations", async mode => {
    const root = { boundingVolume: sphere(0), geometricError: 128, content: { uri: "coarse.glb" },
      children: [{ content: { uri: "detail.json" } }] };
    const { google, hierarchy, requests } = fixture(root, undefined, false, { maxConcurrentRequests: 4 });
    const provider = google as any, releases: Array<() => void> = [];
    const occupied = Array.from({ length: 4 }, () => provider.networkSlot(() => new Promise<void>(resolve => releases.push(resolve)), 0, "hierarchy"));
    await vi.waitFor(() => expect(releases).toHaveLength(4));
    const controller = new AbortController();
    const prepared = google.prepareImmediateHierarchy(undefined, {}, controller.signal);
    await vi.waitFor(() => expect(google.loadingProgress.hierarchyQueued).toBe(1));
    if (mode === "signal") controller.abort(); else google.cancelPendingLoad();
    await prepared;
    await vi.waitFor(() => expect(google.loadingProgress.hierarchyQueued).toBe(0));
    expect(hierarchy).toHaveBeenCalledOnce(); expect(requests).toEqual([]); expect(google.lastLoadResult).toBeUndefined();
    releases.forEach(release => release()); await Promise.all(occupied);
  });

  it("does not report preparation-only JSON failures against a successful active baseline", async () => {
    let releaseModel!: () => void;
    const modelReady = new Promise<void>(resolve => { releaseModel = resolve; });
    const root = { boundingVolume: sphere(0), geometricError: 128, content: { uri: "coarse.glb" },
      children: [{ content: { uri: "unavailable-detail.json" } }] };
    const { google, hierarchy, requests } = fixture(root, async (_url, scene) => {
      await modelReady; return { asset: new AssetContainer(scene), attributions: [] };
    });
    hierarchy.mockImplementation(async url => {
      if (url.includes("unavailable-detail")) throw new Error("Private server detail");
      return { root };
    });
    const baseline = google.load(undefined, { stage: "coverage" });
    await vi.waitFor(() => expect(requests).toEqual(["coarse.glb"]));
    await google.prepareImmediateHierarchy();
    expect(google.lastLoadResult).toMatchObject({ stage: "coverage", hierarchyFailures: 0, hierarchyFailureSamples: [] });
    releaseModel(); await baseline;
    expect(google.lastLoadResult?.coverageComplete).toBe(true);
  });

  it("promotes a shared preparation JSON request when the active frontier needs it", async () => {
    const root = { boundingVolume: sphere(0), geometricError: 512, content: { uri: "coarse.glb" },
      children: [{ content: { uri: "detail.json" } }] };
    const { google, hierarchy } = fixture(root, undefined, false, { maxConcurrentRequests: 2 });
    const provider = google as any, releases: Array<() => void> = [], order: string[] = [];
    hierarchy.mockImplementation(async url => {
      if (!url.includes("detail.json")) return { root };
      order.push("detail"); return { root: { boundingVolume: sphere(0), geometricError: 8, content: { uri: "fine.glb" } } };
    });
    const occupied = Array.from({ length: 2 }, () => provider.networkSlot(() => new Promise<void>(resolve => releases.push(resolve)), 0, "hierarchy"));
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    const prepared = google.prepareCoverageHierarchy();
    await vi.waitFor(() => expect(google.loadingProgress.hierarchyQueued).toBe(1));
    const competing = provider.networkSlot(async () => { order.push("other"); }, 0, "hierarchy");
    const loaded = google.load(undefined, { stage: "coverage" });
    await vi.waitFor(() => expect([...provider.externalTilesetDemand.values()][0]?.size).toBe(2));
    releases[0]();
    await vi.waitFor(() => expect(order[0]).toBe("detail"));
    releases[1](); await Promise.all([...occupied, competing, prepared, loaded]);
    expect(hierarchy).toHaveBeenCalledTimes(2);
    expect(google.stats.hierarchyQueuePriorityChanges).toBe(1);
    expect(google.lastLoadResult?.coverageComplete).toBe(true);
  });

  it("does not rebuild network queues for equal-priority consumers of queued JSON", async () => {
    const { google, hierarchy } = fixture({}, undefined, false, { maxConcurrentRequests: 2 });
    const provider = google as any, releases: Array<() => void> = [];
    const occupied = Array.from({ length: 2 }, () => provider.networkSlot(() => new Promise<void>(resolve => releases.push(resolve)), 0, "hierarchy"));
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    const first = provider.loadExternalTileset("shared.json", provider.rootUrl, 2e9, null, () => true);
    await vi.waitFor(() => expect(google.loadingProgress.hierarchyQueued).toBe(1));
    const rebuilds = google.stats.networkQueueRebuilds;
    const second = provider.loadExternalTileset("shared.json", provider.rootUrl, 2e9, null, () => true);
    await Promise.resolve();
    expect(google.stats).toMatchObject({ networkQueueRebuilds: rebuilds, hierarchyQueuePriorityChecks: 1, hierarchyQueuePriorityChanges: 0 });
    releases.forEach(release => release());
    await Promise.all([...occupied, first, second]);
    expect(hierarchy).toHaveBeenCalledOnce();
  });

  it("does not reheap shared JSON that has already dispatched or completed", async () => {
    const { google, hierarchy } = fixture({});
    const provider = google as any;
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    hierarchy.mockImplementation(async () => { await ready; return { root: {} }; });
    const first = provider.loadExternalTileset("shared.json", provider.rootUrl, 2e9, null, () => true);
    await vi.waitFor(() => expect(hierarchy).toHaveBeenCalledOnce());
    const rebuilds = google.stats.networkQueueRebuilds;
    const second = provider.loadExternalTileset("shared.json", provider.rootUrl, -1, provider.generation, () => true);
    expect(google.stats.networkQueueRebuilds).toBe(rebuilds);
    expect(google.stats.hierarchyQueuePriorityChecks).toBe(0);
    release(); await Promise.all([first, second]);
    await provider.loadExternalTileset("shared.json", provider.rootUrl, -2, provider.generation, () => true);
    expect(google.stats.networkQueueRebuilds).toBe(rebuilds);
    expect(hierarchy).toHaveBeenCalledOnce();
  });

  it.each([[96, 24], [512, 64]])("bounds metadata preparation to one quarter of %i requests, capped at %i", async (requests, limit) => {
    const root = { children: Array.from({ length: 80 }, (_, index) => ({ boundingVolume: sphere(0), content: { uri: `meta-${index}.json` } })) };
    const { google, hierarchy } = fixture(root, undefined, false, { maxConcurrentRequests: requests, startupTraversalSliceMs: 16 });
    const releases: Array<() => void> = [];
    hierarchy.mockImplementation(async url => {
      if (url.includes("root.json")) return { root };
      await new Promise<void>(resolve => releases.push(resolve));
      return { root: { boundingVolume: sphere(0), geometricError: 0, content: { uri: "fine.glb" } } };
    });
    const controller = new AbortController();
    const prepared = google.prepareImmediateHierarchy(undefined, {}, controller.signal);
    await vi.waitFor(() => expect(releases).toHaveLength(limit));
    expect(hierarchy).toHaveBeenCalledTimes(limit + 1);
    expect(google.loadedModelTiles).toHaveLength(0);
    controller.abort(); await prepared;
    releases.forEach(release => release());
    await vi.waitFor(() => expect(google.loadingProgress.hierarchyActive).toBe(0));
    expect(hierarchy).toHaveBeenCalledTimes(limit + 1);
  });

  it("commits finished near subtrees while an earlier admitted near hierarchy remains pending", async () => {
    const root = { children: [
      { boundingVolume: sphere(0), geometricError: 128, content: { uri: "a-coarse.glb" }, children: [{ content: { uri: "a.json" } }] },
      { boundingVolume: sphere(0.001), geometricError: 128, content: { uri: "b-coarse.glb" }, children: [{ content: { uri: "b.json" } }] },
    ] };
    const { google, hierarchy } = fixture(root);
    let releaseA!: () => void, releaseB!: () => void;
    const aReady = new Promise<void>(resolve => { releaseA = resolve; }), bReady = new Promise<void>(resolve => { releaseB = resolve; });
    hierarchy.mockImplementation(async url => {
      if (url.includes("root.json")) return { root };
      const a = url.includes("a.json"); await (a ? aReady : bReady);
      return { root: { boundingVolume: sphere(a ? 0 : 0.001), geometricError: 0, content: { uri: `${a ? "a" : "b"}-fine.glb` } } };
    });
    await google.load(undefined, { stage: "coverage" });
    const aParent = google.loadedModelTiles.find(tile => tile.url.includes("a-coarse"))!;
    const immediate = google.load(undefined, { stage: "immediate" });
    await vi.waitFor(() => expect(hierarchy).toHaveBeenCalledTimes(3));
    releaseB();
    await vi.waitFor(() => expect(google.loadedModelTiles.some(tile => tile.url.includes("b-fine"))).toBe(true));
    expect(aParent.root.isEnabled()).toBe(true);
    releaseA(); await immediate;
    expect(google.lastLoadResult).toMatchObject({ selectedTiles: 2, loadedTiles: 2, coverageComplete: true, immediateQualityComplete: true });
  });

  it.each([["coverage", 32], ["immediate", 32], ["refinement", 16]] as const)(
    "%s admits %i hierarchy branches after recent movement", async (stage, expected) => {
      const root = { children: Array.from({ length: 40 }, (_, index) => ({ boundingVolume: sphere(0), geometricError: 512,
        content: { uri: `parent-${index}.glb` }, children: [{ content: { uri: `detail-${index}.json` } }] })) };
      const { google, hierarchy } = fixture(root, undefined, false, { maxConcurrentRequests: 128, startupTraversalSliceMs: 16 });
      google.maxPendingHierarchy = 32;
      const releases: Array<() => void> = [];
      hierarchy.mockImplementation(async url => {
        if (url.includes("root.json")) return { root };
        await new Promise<void>(resolve => releases.push(resolve));
        return { root: { boundingVolume: sphere(0), geometricError: 0, content: { uri: "fine.glb" } } };
      });
      google.reprioritizeRequests();
      const loaded = google.load(undefined, { stage });
      await vi.waitFor(() => expect(releases).toHaveLength(expected));
      expect(hierarchy).toHaveBeenCalledTimes(expected + 1);
      google.cancelPendingLoad(); expect(await loaded).toEqual([]);
      releases.forEach(release => release());
      await vi.waitFor(() => expect(google.loadingProgress.hierarchyActive).toBe(0));
      expect(hierarchy).toHaveBeenCalledTimes(expected + 1);
      expect(google.lastLoadResult).toMatchObject({ cancelled: true, hierarchyFailures: 0 });
    });

  it("keeps complete staged demand with a larger startup preparation and decode pipeline", async () => {
    const { google, requests } = fixture({ children: [branch("near", 0), branch("east", 0.1), branch("west", -0.1)] },
      undefined, false, { maxConcurrentModelDecodes: 16, maxBufferedModels: 64, startupTraversalSliceMs: 8 });
    await google.load(undefined, { stage: "coverage", coverageNearGeometricError: 16 });
    expect(requests.sort()).toEqual(["east-coarse.glb", "near-fine.glb", "west-coarse.glb"]);
    expect(google.lastLoadResult).toMatchObject({ selectedTiles: 3, loadedTiles: 3, coverageQualityComplete: true });
    await google.load(undefined, { stage: "immediate", coverageNearGeometricError: 16 });
    expect(requests).toHaveLength(3);
    expect(google.lastLoadResult).toMatchObject({ selectedTiles: 3, loadedTiles: 3, immediateQualityComplete: true });
    await google.load();
    expect(google.loadedModelTiles.every(tile => tile.geometricError === 0)).toBe(true);
  });

  it("keeps a strict central core while selecting recognizable near and full-radius far tiers", async () => {
    const tiered = (name: string, longitude: number): Google3DTile => ({ boundingVolume: sphere(longitude, 30), geometricError: 128.4076,
      content: { uri: `${name}-far.glb` }, children: [{ boundingVolume: sphere(longitude, 30), geometricError: 16.05095,
        content: { uri: `${name}-near.glb` }, children: [{ boundingVolume: sphere(longitude, 30), geometricError: 8.025475,
          content: { uri: `${name}-core.glb` } }] }] });
    const { google, requests } = fixture({ children: [tiered("center", 0), tiered("neighbor", 0.004), tiered("distant", 0.1)] });
    const tiers = { coverageGeometricError: 129, coverageNearGeometricError: 17, coverageNearRadius: 750,
      coverageCoreGeometricError: 16, coverageCoreRadius: 100 };
    await google.load(undefined, { stage: "coverage", ...tiers });
    expect(requests.sort()).toEqual(["center-core.glb", "distant-far.glb", "neighbor-near.glb"]);
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: true, coverageQualityComplete: true,
      nearCoverageQualityComplete: true, coverageCoreQualityMissingTiles: 0, coverageNearQualityMissingTiles: 0,
      geometricErrorHistogram: [
        { geometricError: 8.025475, selectedTiles: 1, loadedTiles: 1, coreTiles: 1, nearTiles: 1 },
        { geometricError: 16.05095, selectedTiles: 1, loadedTiles: 1, coreTiles: 0, nearTiles: 1 },
        { geometricError: 128.4076, selectedTiles: 1, loadedTiles: 1, coreTiles: 0, nearTiles: 0 },
      ] });
    await google.load(undefined, { stage: "immediate", detailRadius: 300, ...tiers });
    expect(google.lastLoadResult).toMatchObject({ immediateSelectedTiles: 1, immediateLoadedTiles: 1, immediateQualityComplete: true });
    expect(requests).toHaveLength(3);
  });

  it("invalidates cached coverage when a stricter core is added", async () => {
    const boundingVolume = sphere(0, 30);
    const { google, requests } = fixture({ boundingVolume, geometricError: 16.05095, content: { uri: "near.glb" },
      children: [{ boundingVolume, geometricError: 8.025475, content: { uri: "core.glb" } }] });
    await google.load(undefined, { stage: "coverage", coverageNearGeometricError: 17 });
    expect(requests).toEqual(["near.glb"]);
    await google.load(undefined, { stage: "coverage", coverageNearGeometricError: 17,
      coverageCoreGeometricError: 16, coverageCoreRadius: 100 });
    expect(requests).toEqual(["near.glb", "core.glb"]);
    expect(google.lastLoadResult?.coverageQualityComplete).toBe(true);
  });

  it("cannot excuse an over-target core source leaf through the distant-source exception", async () => {
    const { google } = fixture({ boundingVolume: sphere(0.004, 30), geometricError: 32, content: { uri: "source.glb" } });
    await google.load(undefined, { stage: "coverage", coverageGeometricError: 129,
      coverageNearGeometricError: 17, coverageNearRadius: 100, coverageCoreGeometricError: 16, coverageCoreRadius: 750 });
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: true, coverageQualityComplete: false,
      coverageNearQualityMissingTiles: 0, coverageCoreQualityMissingTiles: 1,
      nearCoverageQualityComplete: false, coverageAvailableQualityComplete: false });
  });

  it.each([{ coverageCoreRadius: 0 }, { coverageCoreRadius: Infinity }, { coverageCoreGeometricError: 0 },
    { coverageCoreGeometricError: NaN }])("rejects invalid optional core settings %j", async options => {
    const { google, hierarchy } = fixture({});
    await expect(google.load(undefined, { stage: "coverage", ...options })).rejects.toThrow(RangeError);
    expect(hierarchy).not.toHaveBeenCalled();
  });

  it("overlaps the configured number of asynchronous decodes and releases queued work", async () => {
    const { google } = fixture({}, undefined, false, { maxConcurrentModelDecodes: 8 });
    const provider = google as any;
    const releases: Array<() => void> = [];
    const tasks = Array.from({ length: 9 }, () => provider.modelDecodeSlot(() => new Promise<void>(resolve => releases.push(resolve)),
      () => 0, provider.generation));
    await vi.waitFor(() => expect(releases).toHaveLength(8));
    expect(provider.modelDecodeActive).toBe(8);
    releases[0]();
    await vi.waitFor(() => expect(releases).toHaveLength(9));
    expect(provider.modelDecodeActive).toBe(8);
    releases.slice(1).forEach(release => release());
    await Promise.all(tasks);
    expect(provider.modelDecodeActive).toBe(0);
  });

  it("bounds a larger native model buffer while allowing hierarchy to bypass it", async () => {
    const { google } = fixture({}, undefined, false, { modelTileLoader: undefined, maxBufferedModels: 32 });
    const provider = google as any;
    const releases: Array<() => void> = [];
    const tasks = Array.from({ length: 32 }, () => provider.networkSlot(() => new Promise<void>(resolve => releases.push(resolve)), 0, "model"));
    await vi.waitFor(() => expect(releases).toHaveLength(32));
    const next = provider.networkSlot(() => new Promise<void>(resolve => releases.push(resolve)), -1, "model");
    const hierarchy = vi.fn();
    await provider.networkSlot(async () => { hierarchy(); }, 10, "hierarchy");
    expect(hierarchy).toHaveBeenCalledOnce(); expect(releases).toHaveLength(32);
    releases[0]();
    await vi.waitFor(() => expect(releases).toHaveLength(33));
    releases.slice(1).forEach(release => release());
    await Promise.all([...tasks, next]);
  });

  it("caps a configurable shared request queue without losing cancellation or released slots", async () => {
    const { google } = fixture({}, undefined, false, { maxConcurrentRequests: 6 });
    const provider = google as any;
    const releases: Array<() => void> = [];
    const tasks = Array.from({ length: 7 }, () => provider.networkSlot(() => new Promise<void>(resolve => releases.push(resolve)),
      0, "hierarchy"));
    await vi.waitFor(() => expect(releases).toHaveLength(6));
    expect(google.loadingProgress).toMatchObject({ hierarchyActive: 6, hierarchyQueued: 1 });
    const obsolete = vi.fn();
    let wanted = true;
    const cancelled = provider.networkSlot(async () => { obsolete(); }, -1, "model", () => wanted).catch(() => undefined);
    wanted = false; google.cancelPendingLoad();
    await cancelled;
    expect(obsolete).not.toHaveBeenCalled();
    releases[0]();
    await vi.waitFor(() => expect(releases).toHaveLength(7));
    expect(google.stats.peakNetworkActive).toBe(6);
    releases.slice(1).forEach(release => release());
    await Promise.all(tasks);
  });

  it("updates exact attribution frequencies incrementally across replacement, retirement, and disposal", () => {
    const { google, scene } = fixture({});
    const provider = google as any;
    const tile = (url: string, attributions: string[]) => ({ url, depth: 1, root: new TransformNode(url, scene),
      asset: new AssetContainer(scene), attributions });
    const first = tile("first", ["Zulu", "Alpha", "Zulu"]);
    const second = tile("second", ["Zulu", "Bravo"]);
    provider.loadedTiles.set(first.url, first);
    provider.loadedTiles.set(second.url, second);
    expect(google.getAttributions()).toEqual(["Zulu", "Alpha", "Bravo"]);
    provider.loadedTiles.set(first.url, first);
    expect(google.getAttributions()).toEqual(["Zulu", "Alpha", "Bravo"]);
    provider.loadedTiles.set(first.url, tile(first.url, ["Bravo", "Bravo"]));
    expect(google.getAttributions()).toEqual(["Bravo", "Zulu"]);
    provider.loadedTiles.delete(second.url);
    expect(google.getAttributions()).toEqual(["Bravo"]);
    const returned = google.getAttributions(); returned.push("changed by caller");
    expect(google.getAttributions()).toEqual(["Bravo"]);
    provider.loadedTiles.clear();
    expect(google.getAttributions()).toEqual([]);
    google.dispose(); expect(google.getAttributions()).toEqual([]);
  });

  it.each([
    { maxConcurrentModelDecodes: 0 }, { maxConcurrentModelDecodes: 1.5 },
    { maxBufferedModels: 0 }, { maxBufferedModels: Infinity },
    { maxConcurrentRequests: 0 }, { maxConcurrentRequests: 1.5 },
    { startupTraversalSliceMs: 0 }, { startupTraversalSliceMs: NaN },
  ])("rejects invalid startup throughput options before network work %j", async options => {
    const { google, hierarchy } = fixture({}, undefined, false, options);
    await expect(google.load()).rejects.toThrow(RangeError);
    expect(hierarchy).not.toHaveBeenCalled();
  });

  it("recovers transient native ancestor fetches within the same coverage pass", async () => {
    const root: Google3DTile = { boundingVolume: sphere(0), geometricError: 512, content: { uri: "parent.glb" },
      children: [{ content: { uri: "detail.json" } }] };
    let attempts = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("root.json")) return new Response(JSON.stringify({ root }));
      attempts++;
      if (attempts === 1) throw new TypeError("Network request to https://secret.example/?key=private failed");
      if (attempts === 2) return new Response("server failure", { status: 503 });
      return new Response(JSON.stringify({ root: { boundingVolume: sphere(0), geometricError: 8,
        content: { uri: "fine.glb" } } }));
    });
    vi.stubGlobal("fetch", fetcher);
    const { google, requests } = fixture(root, undefined, true);
    await google.load(undefined, { stage: "coverage" });
    expect(attempts).toBe(3); expect(requests).toEqual(["fine.glb"]);
    expect(google.stats).toMatchObject({ hierarchyRequests: 4, hierarchyRetries: 2 });
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: true, hierarchyFailures: 0, hierarchyFailureSamples: [] });
  });

  it.each([408, 429, 500, 503])("bounds HTTP %i hierarchy retries and reports sanitized final diagnostics", async status => {
    const root: Google3DTile = { boundingVolume: sphere(0), geometricError: 512, content: { uri: "parent.glb" },
      children: [{ content: { uri: "detail.json" } }] };
    const fetcher = vi.fn(async (url: string) => url.includes("root.json")
      ? new Response(JSON.stringify({ root })) : new Response("https://secret.example/?key=private", { status }));
    vi.stubGlobal("fetch", fetcher);
    const { google } = fixture(root, undefined, true);
    await google.load(undefined, { stage: "coverage" });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(google.lastLoadResult).toMatchObject({ hierarchyFailures: 1,
      hierarchyFailureSamples: [{ type: "http", status, attempts: 3 }] });
    expect(JSON.stringify(google.lastLoadResult)).not.toMatch(/secret|private|https:/);
  });

  it.each([400, 401, 403, 404])("does not retry permanent HTTP %i hierarchy failures", async status => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status })));
    const { google } = fixture({}, undefined, true);
    await expect(google.load(undefined, { stage: "coverage" })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(google.stats.hierarchyRetries).toBe(0);
    expect(google.lastLoadResult).toMatchObject({ hierarchyFailures: 1,
      hierarchyFailureSamples: [{ type: "http", status, attempts: 1 }] });
  });

  it("does not retry native aborts or dispatch obsolete hierarchy after backoff", async () => {
    const root: Google3DTile = { boundingVolume: sphere(0), geometricError: 512, content: { uri: "parent.glb" },
      children: [{ content: { uri: "detail.json" } }] };
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("root.json")) return new Response(JSON.stringify({ root }));
      throw new TypeError("Temporary network failure");
    });
    vi.stubGlobal("fetch", fetcher);
    const { google } = fixture(root, undefined, true);
    const pending = google.load(undefined, { stage: "coverage" });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    google.cancelPendingLoad();
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(google.stats.hierarchyRetries).toBe(0);
    expect(google.lastLoadResult?.hierarchyFailureSamples).toEqual([]);

    fetcher.mockImplementation(async () => { throw new DOMException("Cancelled", "AbortError"); });
    const { google: aborted } = fixture({}, undefined, true);
    await expect(aborted.load(undefined, { stage: "coverage" })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(aborted.stats.hierarchyRetries).toBe(0);
    expect(aborted.lastLoadResult?.hierarchyFailureSamples).toEqual([]);
  });

  it("retries a fresh ancestor after a previous pass exhausted transient attempts", async () => {
    const root: Google3DTile = { boundingVolume: sphere(0), geometricError: 512, content: { uri: "parent.glb" },
      children: [{ content: { uri: "detail.json" } }] };
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("root.json")) return new Response(JSON.stringify({ root }));
      if (++attempts <= 3) return new Response("failure", { status: 503 });
      return new Response(JSON.stringify({ root: { boundingVolume: sphere(0), geometricError: 8,
        content: { uri: "fine.glb" } } }));
    }));
    const { google } = fixture(root, undefined, true);
    await google.load(undefined, { stage: "coverage" });
    expect(google.lastLoadResult?.hierarchyFailures).toBe(1);
    await google.load(undefined, { stage: "coverage" });
    expect(attempts).toBe(4);
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: true, hierarchyFailures: 0, hierarchyFailureSamples: [] });
  });

  it("loads coarse coverage in every direction, then nearby detail, reusing the same hierarchy and far models", async () => {
    const { google, requests, hierarchy } = fixture({ children: [branch("near", 0), branch("east", 0.1), branch("west", -0.1)] });
    await google.load(undefined, { stage: "coverage" });
    expect(requests.sort()).toEqual(["east-coarse.glb", "near-coarse.glb", "west-coarse.glb"]);
    expect(google.lastLoadResult).toMatchObject({ stage: "coverage", selectedTiles: 3, loadedTiles: 3,
      failedTiles: 0, failedModelTiles: 0, coverageComplete: true, detailComplete: true });
    expect(google.loadedModelTiles.every(tile => tile.geometricError === 128)).toBe(true);

    await google.load(undefined, { stage: "immediate", detailRadius: 750 });
    expect(requests).toHaveLength(4);
    expect(requests.at(-1)).toBe("near-fine.glb");
    expect(google.loadedModelTiles.map(tile => new URL(tile.url).pathname.split("/").at(-1)).sort())
      .toEqual(["east-coarse.glb", "near-fine.glb", "west-coarse.glb"]);
    expect(google.lastLoadResult).toMatchObject({ stage: "immediate", selectedTiles: 3, coverageComplete: true, detailComplete: true });

    await google.load();
    expect(requests).toHaveLength(6);
    expect(google.loadedModelTiles.every(tile => tile.geometricError === 0)).toBe(true);
    expect(hierarchy).toHaveBeenCalledTimes(1);
    expect(google.lastLoadResult).toMatchObject({ stage: "refinement", coverageComplete: true, detailComplete: true });
  });

  it("does not descend into external detail hierarchy during coarse coverage", async () => {
    const { google, hierarchy, requests } = fixture({ children: [
      { boundingVolume: sphere(0), geometricError: 128, content: { uri: "coarse.glb" },
        children: [{ content: { uri: "expensive-detail.json" } }] },
    ] });
    await google.load(undefined, { stage: "coverage" });
    expect(hierarchy).toHaveBeenCalledTimes(1);
    expect(requests).toEqual(["coarse.glb"]);
    expect(google.lastLoadResult?.coverageComplete).toBe(true);
  });

  it("retains sharp resident detail when a later coverage pass enters a neighboring area", async () => {
    const { google, requests } = fixture({ children: [branch("near", 0), branch("far", 0.1)] });
    await google.load(undefined, { stage: "coverage" });
    await google.load(undefined, { stage: "immediate" });
    const previousRequests = requests.length;
    await google.load(undefined, { stage: "coverage" });
    expect(requests).toHaveLength(previousRequests);
    expect(google.loadedModelTiles.map(tile => new URL(tile.url).pathname.split("/").at(-1)).sort())
      .toEqual(["far-coarse.glb", "near-fine.glb"]);
    expect(google.lastLoadResult?.coverageComplete).toBe(true);
  });

  it("keeps complete parent coverage until both near detail and its far sibling are ready", async () => {
    let releaseNear!: () => void;
    const nearReady = new Promise<void>(resolve => { releaseNear = resolve; });
    let notifyNear!: () => void;
    const nearStarted = new Promise<void>(resolve => { notifyNear = resolve; });
    const { google, requests } = fixture({ boundingVolume: sphere(0.05, 6000), geometricError: 128,
      content: { uri: "parent.glb" }, children: [
        { boundingVolume: sphere(0), geometricError: 0, content: { uri: "near.glb" } },
        { boundingVolume: sphere(0.1), geometricError: 128, content: { uri: "far.glb" },
          children: [{ boundingVolume: sphere(0.1), geometricError: 0, content: { uri: "far-fine.glb" } }] },
      ] }, async (url, scene) => {
      if (url.includes("near.glb")) { notifyNear(); await nearReady; }
      return { asset: new AssetContainer(scene), attributions: [] };
    });
    await google.load(undefined, { stage: "coverage" });
    const parent = google.loadedModelTiles[0];
    const immediate = google.load(undefined, { stage: "immediate", detailRadius: 750 });
    await nearStarted;
    expect(parent.root.isEnabled()).toBe(true);
    expect(google.loadedModelTiles.map(tile => tile.url)).toEqual([parent.url]);
    releaseNear(); await immediate;
    expect(parent.root.isEnabled()).toBe(false);
    expect(google.loadedModelTiles.map(tile => new URL(tile.url).pathname.split("/").at(-1)).sort()).toEqual(["far.glb", "near.glb"]);
    expect(requests).not.toContain("far-fine.glb");
    expect(google.lastLoadResult?.coverageComplete).toBe(true);
  });

  it("reports failed coverage downloads, then reuses successful models on retry", async () => {
    let failed = true;
    const { google, requests } = fixture({ children: [branch("near", 0), branch("far", 0.1)] }, async (url, scene) => {
      if (url.includes("far-coarse") && failed) return undefined;
      return { asset: new AssetContainer(scene), attributions: [] };
    });
    await google.load(undefined, { stage: "coverage" });
    expect(google.lastLoadResult).toMatchObject({ selectedTiles: 2, loadedTiles: 1, failedTiles: 1,
      failedModelTiles: 1, coverageComplete: false, detailComplete: false });
    failed = false;
    await google.load(undefined, { stage: "coverage" });
    expect(requests.filter(url => url === "near-coarse.glb")).toHaveLength(1);
    expect(requests.filter(url => url === "far-coarse.glb")).toHaveLength(2);
    expect(google.lastLoadResult).toMatchObject({ failedTiles: 0, failedModelTiles: 0, coverageComplete: true });
  });

  it("retains coarse coverage and reports an immediate detail download failure", async () => {
    const { google } = fixture({ children: [branch("near", 0)] }, async (url, scene) =>
      url.includes("near-fine") ? undefined : { asset: new AssetContainer(scene), attributions: [] });
    await google.load(undefined, { stage: "coverage" });
    await google.load(undefined, { stage: "immediate" });
    expect(google.loadedModelTiles[0].url).toContain("near-coarse.glb");
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: false, failedModelTiles: 1, detailComplete: false });
  });

  it("reports a budget-limited immediate pass without losing coarse full-radius coverage", async () => {
    const { google } = fixture({ boundingVolume: sphere(0, 1000), geometricError: 128, content: { uri: "parent.glb" },
      children: [
        { boundingVolume: sphere(0, 100), geometricError: 0, content: { uri: "a.glb" } },
        { boundingVolume: sphere(0.001, 100), geometricError: 0, content: { uri: "b.glb" } },
      ] });
    google.maxTiles = 1;
    await google.load(undefined, { stage: "coverage" });
    await google.load(undefined, { stage: "immediate" });
    expect(google.loadedModelTiles[0].url).toContain("parent.glb");
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: true, budgetLimitedTiles: 1, detailComplete: false });
  });

  it("finishes immediate detail despite source-limited coarse leaves far away", async () => {
    const { google } = fixture({ children: [branch("near", 0),
      { boundingVolume: sphere(0.1), geometricError: 512, content: { uri: "far-source-limit.glb" } },
    ] });
    await google.load(undefined, { stage: "coverage" });
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: true, sourceLimitedTiles: 1 });
    await google.load(undefined, { stage: "immediate" });
    expect(google.loadedModelTiles).toHaveLength(2);
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: true, sourceLimitedTiles: 0, detailComplete: true });
  });

  it("publishes the best available large source leaf when no finer model can meet immediate SSE", async () => {
    const boundingVolume = sphere(0, 600);
    const { google } = fixture({ boundingVolume, geometricError: 128, content: { uri: "coarse.glb" },
      children: [{ boundingVolume, geometricError: 8, content: { uri: "best-source.glb" } }] });
    await google.load(undefined, { stage: "coverage" });
    await google.load(undefined, { stage: "immediate" });
    expect(google.loadedModelTiles.map(tile => new URL(tile.url).pathname.split("/").at(-1))).toEqual(["best-source.glb"]);
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: true, sourceLimitedTiles: 1,
      detailComplete: false, immediateQualityComplete: true });
    expect(google.loadingProgress).toMatchObject({ phase: "idle", pendingHierarchy: 0,
      replacementGroups: 0, pendingModels: 0, hierarchyQueued: 0, modelQueued: 0, decodeQueued: 0 });
  });

  it("uses ground distance for immediate demand when the camera is above its radius", async () => {
    const { google, camera, globe, requests } = fixture({ children: [branch("near", 0), branch("far", 0.1)] });
    camera.setPosition(globe.getSurfacePosition(0, 0, 2000 * globe.metresToWorld)); camera.getViewMatrix(true);
    await google.load(undefined, { stage: "coverage" });
    await google.load(undefined, { stage: "immediate", detailRadius: 750 });
    expect(requests).toContain("near-fine.glb");
    expect(requests).not.toContain("far-fine.glb");
  });

  it.each(["sphere", "box"])("includes a tall roof directly above the viewer in immediate %s demand", async kind => {
    const boundingVolume = kind === "sphere" ? { sphere: [6378537, 0, 0, 30] }
      : { box: [6378537, 0, 0, 50, 0, 0, 0, 30, 0, 0, 0, 30] };
    const { google, requests } = fixture({ boundingVolume: sphere(0, 1000), geometricError: 128,
      content: { uri: "parent.glb" }, children: [{ boundingVolume, geometricError: 128, content: { uri: "roof-coarse.glb" },
        children: [{ boundingVolume, geometricError: 0, content: { uri: "roof-fine.glb" } }] }] });
    await google.load(undefined, { stage: "coverage" });
    await google.load(undefined, { stage: "immediate", detailRadius: 300 });
    expect(requests).toContain("roof-fine.glb");
    expect(requests).not.toContain("roof-coarse.glb");
    expect(google.loadedModelTiles.map(tile => new URL(tile.url).pathname.split("/").at(-1))).toEqual(["roof-fine.glb"]);
    expect(google.lastLoadResult?.immediateQualityComplete).toBe(true);
  });

  it("selects recognizable near coverage without refining distant baseline content", async () => {
    const { google, requests } = fixture({ children: [branch("near", 0), branch("far", 0.1)] });
    await google.load(undefined, { stage: "coverage", coverageGeometricError: 128,
      coverageNearGeometricError: 16, coverageNearRadius: 750 });
    expect(requests.sort()).toEqual(["far-coarse.glb", "near-fine.glb"]);
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: true, coverageQualityComplete: true,
      nearCoverageQualityComplete: true, coverageQualityMissingTiles: 0, coverageNearQualityMissingTiles: 0 });
  });

  it("distinguishes distant unavailable baseline quality from complete nearby recognizable coverage", async () => {
    const { google } = fixture({ children: [branch("near", 0),
      { boundingVolume: sphere(0.1), geometricError: 512, content: { uri: "far-source-limit.glb" } },
    ] });
    await google.load(undefined, { stage: "coverage", coverageGeometricError: 128,
      coverageNearGeometricError: 16, coverageNearRadius: 750 });
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: true, coverageQualityComplete: false,
      coverageAvailableQualityComplete: true, nearCoverageQualityComplete: true,
      coverageQualityMissingTiles: 1, coverageNearQualityMissingTiles: 0 });
  });

  it("does not excuse a depth-limited distant parent with an unrelated source-limited leaf", async () => {
    const { google } = fixture({ children: [
      { boundingVolume: sphere(0), geometricError: 0, content: { uri: "near.glb" } },
      { boundingVolume: sphere(0.1), geometricError: 128, content: { uri: "depth-limited.glb" },
        children: [{ boundingVolume: sphere(0.1), geometricError: 0, content: { uri: "available-fine.glb" } }] },
      { boundingVolume: sphere(-0.1), geometricError: 512, content: { uri: "source-limited.glb" } },
    ] });
    google.maxDepth = 1;
    await google.load(undefined, { stage: "coverage", coverageGeometricError: 64, coverageNearGeometricError: 16 });
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: true, nearCoverageQualityComplete: true,
      coverageQualityMissingTiles: 2, budgetLimitedTiles: 1, sourceLimitedTiles: 1,
      coverageQualityComplete: false, coverageAvailableQualityComplete: false });
  });

  it("preserves immediate fine residents when broader refinement relaxes quality", async () => {
    const { google, requests } = fixture({ children: [branch("near", 0), branch("far", 0.1)] });
    await google.load(undefined, { stage: "coverage" });
    await google.load(undefined, { stage: "immediate", detailRadius: 300 });
    const fine = google.loadedModelTiles.find(tile => tile.url.includes("near-fine"))!;
    google.maximumScreenSpaceError = 1e9; google.maximumDisplayGeometricError = 128;
    google.referenceImageHeight = 1080;
    await google.load(undefined, { stage: "refinement", detailRadius: 300 });
    expect(fine.root.isEnabled()).toBe(true);
    expect(google.loadedModelTiles.some(tile => tile.url.includes("near-coarse"))).toBe(false);
    expect(requests).toHaveLength(3);
  });

  it("can retire distant fine history with a complete coarse replacement after quality relaxes", async () => {
    const { google } = fixture({ children: [branch("near", 0), branch("far", 0.1)] });
    await google.load(undefined, { stage: "coverage" }); await google.load();
    const farFine = google.loadedModelTiles.find(tile => tile.url.includes("far-fine"))!;
    google.maximumScreenSpaceError = 1e9; google.maximumDisplayGeometricError = 128;
    await google.load(undefined, { stage: "refinement", detailRadius: 300 });
    expect(farFine.root.isEnabled()).toBe(false);
    expect(google.loadedModelTiles.map(tile => new URL(tile.url).pathname.split("/").at(-1)).sort())
      .toEqual(["far-coarse.glb", "near-fine.glb"]);
  });

  it("does not claim nearby quality readiness when the finest source still exceeds the configured near limit", async () => {
    const boundingVolume = sphere(0, 600);
    const { google } = fixture({ boundingVolume, geometricError: 128, content: { uri: "coarse.glb" },
      children: [{ boundingVolume, geometricError: 32, content: { uri: "best-source.glb" } }] });
    await google.load(undefined, { stage: "coverage", coverageNearGeometricError: 16 });
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: true, nearCoverageQualityComplete: false,
      coverageNearQualityMissingTiles: 1 });
    await google.load(undefined, { stage: "immediate", coverageNearGeometricError: 16 });
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: true, immediateQualityComplete: false });
    expect(google.lastLoadResult?.qualityLimitedSamples).toEqual([{ groundDistance: 0, geometricError: 32,
      depth: 1, sourceLeaf: true }]);
  });

  it("proves local immediate readiness independently of a missing distant source branch", async () => {
    const { google } = fixture({ children: [branch("near", 0), { boundingVolume: sphere(0.1), geometricError: 0 }] });
    await google.load(undefined, { stage: "coverage" });
    await google.load(undefined, { stage: "immediate", detailRadius: 300 });
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: false, sourceCoverageGaps: 1,
      nearSourceCoverageGaps: 0, immediateSelectedTiles: 1, immediateLoadedTiles: 1, immediateQualityComplete: true });
  });

  it("does not let a distant failed download block the visible nearby immediate frontier", async () => {
    const { google } = fixture({ children: [branch("near", 0), branch("far", 0.1)] }, async (url, scene) =>
      url.includes("far") ? undefined : { asset: new AssetContainer(scene), attributions: [] });
    await google.load(undefined, { stage: "coverage" });
    await google.load(undefined, { stage: "immediate", detailRadius: 300 });
    expect(google.lastLoadResult).toMatchObject({ coverageComplete: false, failedModelTiles: 1,
      nearFailedModelTiles: 0, immediateSelectedTiles: 1, immediateLoadedTiles: 1, immediateQualityComplete: true });
  });

  it("drops obsolete queued model and hierarchy requests before dispatch", async () => {
    const { google, requests, hierarchy } = fixture({ children: [] });
    const internal = google as any;
    const origin = internal.getOrigin(); internal.originStateKey = internal.getOriginStateKey(origin);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const blockers = Array.from({ length: 48 }, () => internal.networkSlot(async () => { await held; }));
    await vi.waitFor(() => expect(google.loadingProgress.hierarchyActive).toBe(48));
    const selection = { url: "https://example.invalid/obsolete.glb", depth: 1, boundingVolume: sphere(0) };
    internal.desiredTiles.set(selection.url, selection);
    const model = internal.loadTile(selection, origin, internal.generation);
    const json = internal.loadExternalTileset("obsolete.json", "https://example.invalid/root.json", 0,
      internal.generation, () => false).catch((error: Error) => error.name);
    internal.desiredTiles.delete(selection.url);
    release(); await Promise.all(blockers);
    expect(await model).toBeUndefined();
    expect(await json).toBe("AbortError");
    expect(requests).toEqual([]); expect(hierarchy).not.toHaveBeenCalled();
    expect(google.stats).toMatchObject({ modelRequests: 0, obsoleteModelRequests: 1, obsoleteHierarchyRequests: 1 });
  });

  it("settles cancelled queued work even when every active network slot is held", async () => {
    const { google, requests, hierarchy } = fixture({ children: [] });
    const internal = google as any;
    const origin = internal.getOrigin(); internal.originStateKey = internal.getOriginStateKey(origin);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const blockers = Array.from({ length: 48 }, () => internal.networkSlot(async () => { await held; }));
    await vi.waitFor(() => expect(google.loadingProgress.hierarchyActive).toBe(48));
    const selection = { url: "https://example.invalid/obsolete.glb", depth: 1, boundingVolume: sphere(0) };
    internal.desiredTiles.set(selection.url, selection);
    const model = internal.loadTile(selection, origin, internal.generation);
    const json = internal.loadExternalTileset("obsolete.json", "https://example.invalid/root.json")
      .catch((error: Error) => error.name);
    try {
      google.cancelPendingLoad();
      expect(await model).toBeUndefined(); expect(await json).toBe("AbortError");
      expect(google.loadingProgress).toMatchObject({ hierarchyActive: 48, hierarchyQueued: 0, modelQueued: 0 });
      expect(requests).toEqual([]); expect(hierarchy).not.toHaveBeenCalled();
    } finally { release(); await Promise.all(blockers); }
  });

  it("refuses a replacement batch removed from live demand while its model finishes", async () => {
    let release!: () => void, notify!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { notify = resolve; });
    const { google, scene } = fixture({ children: [] }, async (_url, modelScene) => {
      notify(); await held; return { asset: new AssetContainer(modelScene), attributions: [] };
    });
    const internal = google as any;
    const origin = internal.getOrigin(); internal.originStateKey = internal.getOriginStateKey(origin);
    const parent = { url: "parent.glb", depth: 0, boundingVolume: sphere(0, 1000) };
    const root = new TransformNode("parent", scene);
    internal.loadedSelections.set(parent.url, parent);
    internal.loadedTiles.set(parent.url, { ...parent, root, asset: new AssetContainer(scene), attributions: [] });
    const child = { url: "https://example.invalid/child.glb", depth: 1, geometricError: 0,
      ancestors: [parent.url], boundingVolume: sphere(0) };
    const batch = new Map([[child.url, child]]);
    internal.desiredTiles.set(child.url, child);
    const replacement = internal.loadReplacementGroups(batch, origin, internal.generation);
    await started; internal.desiredTiles.delete(child.url); release(); await replacement;
    expect(root.isEnabled()).toBe(true);
    expect(google.loadedModelTiles.map(tile => tile.url)).toEqual([parent.url]);
  });

  it("bounds static refinement to useful terminal demand plus a coverage reserve", async () => {
    const split = (name: string, longitude: number): Google3DTile => ({ boundingVolume: sphere(longitude),
      geometricError: 128, content: { uri: `${name}.glb` }, children: [
        { boundingVolume: sphere(longitude), geometricError: 0, content: { uri: `${name}-a.glb` } },
        { boundingVolume: sphere(longitude + 0.0001), geometricError: 0, content: { uri: `${name}-b.glb` } },
      ] });
    const { google, requests } = fixture({ children: [
      { boundingVolume: sphere(0.01), geometricError: 128, content: { uri: "near-parent.glb" },
        children: [split("near-one", 0.01), split("near-two", 0.011)] },
      ...Array.from({ length: 10 }, (_, i) => ({ boundingVolume: sphere(-0.01 - i * 0.001),
        geometricError: 0, content: { uri: `far-${i}.glb` } })),
    ] });
    google.maxTiles = 12;
    await google.load();
    expect(requests).toHaveLength(14);
    expect(google.loadedModelTiles).toHaveLength(14);
    expect(requests.every(url => url.startsWith("far-") || /near-(one|two)-[ab]/.test(url))).toBe(true);
    await google.load();
    expect(requests).toHaveLength(14);
    expect(google.loadingProgress).toMatchObject({ pendingModels: 0, modelQueued: 0, hierarchyQueued: 0 });
  });

  it("reports contentless source branches even when other coverage models load", async () => {
    const { google } = fixture({ children: [branch("near", 0),
      { boundingVolume: sphere(0.1), geometricError: 0 },
    ] });
    await google.load(undefined, { stage: "coverage" });
    expect(google.lastLoadResult).toMatchObject({ selectedTiles: 1, loadedTiles: 1,
      sourceCoverageGaps: 1, coverageComplete: false });
    await google.load(undefined, { stage: "coverage" });
    expect(google.lastLoadResult).toMatchObject({ sourceCoverageGaps: 1, coverageComplete: false });
  });

  it("limits immediate demand for geographic-region bounding volumes too", async () => {
    const radians = Math.PI / 180;
    const regionBranch = (name: string, longitude: number): Google3DTile => {
      const boundingVolume = { region: [(longitude - 0.001) * radians, -0.001 * radians,
        (longitude + 0.001) * radians, 0.001 * radians, 0, 100] };
      return { boundingVolume, geometricError: 128, content: { uri: `${name}-coarse.glb` },
        children: [{ boundingVolume, geometricError: 0, content: { uri: `${name}-fine.glb` } }] };
    };
    const { google, requests } = fixture({ children: [regionBranch("near", 0), regionBranch("far", 0.1)] });
    await google.load(undefined, { stage: "coverage" });
    await google.load(undefined, { stage: "immediate" });
    expect(requests).toContain("near-fine.glb");
    expect(requests).not.toContain("far-fine.glb");
  });

  it("keeps the complete parent when a refinement sibling has no source content", async () => {
    const { google } = fixture({ boundingVolume: sphere(0, 1000), geometricError: 128, content: { uri: "parent.glb" },
      children: [
        { boundingVolume: sphere(0, 100), geometricError: 0, content: { uri: "a.glb" } },
        { boundingVolume: sphere(0.001, 100), geometricError: 0 },
      ] });
    await google.load(undefined, { stage: "coverage" });
    await google.load(undefined, { stage: "immediate" });
    expect(google.loadedModelTiles.map(tile => new URL(tile.url).pathname.split("/").at(-1))).toEqual(["parent.glb"]);
    expect(google.lastLoadResult).toMatchObject({ sourceLimitedTiles: 1, sourceCoverageGaps: 0,
      coverageComplete: true, detailComplete: false });
  });

  it("lets fallback buildings coexist with coarse coverage until detailed Google content replaces it", async () => {
    const { google } = fixture({ children: [branch("near", 0)] });
    await google.load(undefined, { stage: "coverage" });
    expect(google.coversLocation(0, 0)).toBe(true);
    expect(google.coversLocation(0, 0, 33)).toBe(false);
    expect(google.coversAreaCompletely(-0.0001, -0.0001, 0.0001, 0.0001)).toBe(true);
    expect(google.coversAreaCompletely(-0.0001, -0.0001, 0.0001, 0.0001, 33)).toBe(false);
    expect(google.overlapsFootprint(-0.0001, -0.0001, 0.0001, 0.0001)).toBe(true);
    expect(google.overlapsFootprint(-0.0001, -0.0001, 0.0001, 0.0001, 33)).toBe(false);
    await google.load(undefined, { stage: "immediate" });
    expect(google.coversLocation(0, 0, 33)).toBe(true);
    expect(google.coversAreaCompletely(-0.0001, -0.0001, 0.0001, 0.0001, 33)).toBe(true);
    expect(google.overlapsFootprint(-0.0001, -0.0001, 0.0001, 0.0001, 33)).toBe(true);
  });
});
