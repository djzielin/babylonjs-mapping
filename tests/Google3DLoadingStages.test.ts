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
afterEach(() => { cleanup.splice(0).reverse().forEach(dispose => dispose()); vi.restoreAllMocks(); });

function sphere(longitude: number, radius = 100) {
  const angle = longitude * Math.PI / 180;
  return { sphere: [6378137 * Math.cos(angle), 6378137 * Math.sin(angle), 0, radius] };
}

function branch(name: string, longitude: number): Google3DTile {
  const boundingVolume = sphere(longitude);
  return { boundingVolume, geometricError: 128, content: { uri: `${name}-coarse.glb` },
    children: [{ boundingVolume, geometricError: 0, content: { uri: `${name}-fine.glb` } }] };
}

function fixture(root: Google3DTile, customLoader?: GoogleModelTileLoader) {
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
    cullToCamera: true, fullRadiusDemand: true, tilesetLoader: hierarchy, modelTileLoader });
  cleanup.push(() => engine.dispose(), () => scene.dispose(), () => google.dispose());
  return { google, requests, hierarchy, scene, camera, globe };
}

describe("staged Google loading", () => {
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
