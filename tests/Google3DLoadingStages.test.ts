import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcRotateCamera, AssetContainer, NullEngine, Scene, TransformNode, Vector2 } from "@babylonjs/core";
import GlobeSet from "../src/core/GlobeSet";
import Google3DTiles, { type Google3DTile, type Google3DTileset, type GoogleModelTileLoader } from "../src/google/Google3DTiles";

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

function fixture(root: Google3DTile, customLoader?: GoogleModelTileLoader, nativeHierarchy = false) {
  const engine = new NullEngine(), scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2); globe.updateRaster(0, 0, 12);
  const camera = new ArcRotateCamera("eye", 0, 1, 1, globe.getSurfacePosition(0, 0.01), scene);
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld));
  camera.minZ = 1e-7; camera.getViewMatrix(true); camera.getProjectionMatrix(true);
  const requests: string[] = [];
  const hierarchy = vi.fn(async (): Promise<Google3DTileset> => ({ root }));
  const modelTileLoader: GoogleModelTileLoader = async (url, modelScene, signal) => {
    requests.push(new URL(url).pathname.split("/").at(-1)!);
    if (customLoader) return customLoader(url, modelScene, signal);
    const asset = new AssetContainer(modelScene);
    asset.rootNodes.push(new TransformNode(url, modelScene));
    return { asset, attributions: [] };
  };
  const google = new Google3DTiles(globe, { apiKey: "test", coverageRadius: 15 * 1609.344, maxTiles: 64,
    maximumScreenSpaceError: 1, maximumDisplayGeometricError: 33, maximumInitialErrorRatio: 2,
    cullToCamera: true, fullRadiusDemand: true, tilesetLoader: nativeHierarchy ? undefined : hierarchy, modelTileLoader });
  cleanup.push(() => engine.dispose(), () => scene.dispose(), () => google.dispose());
  return { google, requests, hierarchy, scene, camera, globe };
}

describe("staged Google loading", () => {
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
