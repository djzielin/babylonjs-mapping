import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcRotateCamera, AssetContainer, Matrix, NullEngine, Scene, TransformNode, Vector2, Vector3 } from "@babylonjs/core";

import Google3DTiles, {
  GOOGLE_3D_TILES_ROOT_URL,
  type Google3DTile,
  type Google3DTileset,
  type GoogleModelTileLoader,
  type LoadedGoogleModelTile,
  type GoogleTilesetLoader,
  parseGoogleGLBMetadata,
} from "../src/Google3DTiles";
import { EPSG_Type } from "../src/core/TileMath";
import TileSet from "../src/TileSet";
import GlobeSet from "../src/GlobeSet";
import { PerformanceConfigurator } from "@babylonjs/core/Engines/performanceConfigurator";

vi.mock("../src/core/Attribution", () => ({
  default: class AttributionStub {
    public advancedTexture = {};
    public addAttribution = vi.fn();
    public setGoogleAttributions = vi.fn();
  },
}));

function createTileSet() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const tileSet = new TileSet(scene, engine);
  tileSet.createGeometry(new Vector2(1, 1), 100, 1);
  tileSet.updateRaster(0, 0, 2);
  return { engine, scene, tileSet };
}

function createGLB(json: Record<string, unknown>): ArrayBuffer {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const paddedLength = Math.ceil(encoded.length / 4) * 4;
  const buffer = new ArrayBuffer(20 + paddedLength);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20, paddedLength).fill(32);
  new Uint8Array(buffer, 20, encoded.length).set(encoded);
  return buffer;
}

function createModelLoader(requests: string[]) {
  const loader: GoogleModelTileLoader = vi.fn(async (url, scene) => {
    requests.push(url);
    const asset = new AssetContainer(scene);
    asset.rootNodes.push(new TransformNode("google-model", scene));
    return {
      asset,
      attributions: ["Google imagery", "Open data"],
      rtcCenter: Vector3.Zero(),
    };
  });
  return loader;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseGoogleGLBMetadata", () => {
  it("extracts sorted-source inputs and CESIUM_RTC metadata from a GLB JSON chunk", () => {
    const metadata = parseGoogleGLBMetadata(createGLB({
      asset: { copyright: "Google; Open data; Google" },
      extensions: { CESIUM_RTC: { center: [1, 2, 3] } },
    }));

    expect(metadata.attributions).toEqual(["Google", "Open data", "Google"]);
    expect(metadata.rtcCenter?.asArray()).toEqual([1, 2, 3]);
  });

  it("returns an empty result for non-GLB input", () => {
    expect(parseGoogleGLBMetadata(new ArrayBuffer(20))).toEqual({ attributions: [] });
  });
});

describe("Google3DTiles", () => {
  it("reuses model assets and hierarchy when zooming out and back", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const requests: string[] = [];
    const tilesetLoader = vi.fn(async () => ({ root: {
      content: { uri: "coarse.glb" }, children: [{ content: { uri: "fine.glb" } }],
    } }));
    const provider = new Google3DTiles(tileSet, { apiKey: "test", tilesetLoader,
      modelTileLoader: createModelLoader(requests), maxDepth: 1 });
    const fine = (await provider.load())[0];
    provider.maxDepth = 0;
    await provider.load();
    expect(fine.root.isEnabled()).toBe(false);
    provider.maxDepth = 1;
    expect((await provider.load())[0].asset).toBe(fine.asset);
    expect(fine.root.isEnabled()).toBe(true);
    expect(requests).toHaveLength(2);
    expect(tilesetLoader).toHaveBeenCalledTimes(1);
    provider.dispose(); scene.dispose(); engine.dispose();
  });

  it("streams the first model before a slower sibling hierarchy finishes", async () => {
    const { engine, scene, tileSet } = createTileSet();
    let release!: (value: Google3DTileset) => void;
    const slow = new Promise<Google3DTileset>(resolve => { release = resolve; });
    const requests: string[] = [];
    const provider = new Google3DTiles(tileSet, { apiKey: "test",
      tilesetLoader: async url => url.includes("slow.json") ? slow : { root: { children: [
        { content: { uri: "first.glb" } }, { content: { uri: "slow.json" } },
      ] } }, modelTileLoader: createModelLoader(requests) });
    const loading = provider.load();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    release({ root: { content: { uri: "second.glb" } } });
    await loading;
    expect(requests).toHaveLength(2);
    provider.dispose(); scene.dispose(); engine.dispose();
  });

  it.each([
    { region: [-0.001, -0.001, 0.001, 0.001, 0, 200] },
    { box: [6378137, 0, 0, 200, 0, 0, 0, 200, 0, 0, 0, 200] },
    { sphere: [6378137, 0, 0, 200] },
  ])("limits building replacement to successfully loaded coverage %j", async boundingVolume => {
    const { engine, scene, tileSet } = createTileSet();
    const provider = new Google3DTiles(tileSet, {
      apiKey: "test", tilesetLoader: async () => ({ root: { boundingVolume, content: { uri: "model.glb" } } }),
      modelTileLoader: createModelLoader([]),
    });
    expect(provider.coversLocation(0, 0)).toBe(false);
    await provider.load();
    expect(provider.coversLocation(0, 0)).toBe(true);
    expect(provider.coversLocation(1, 1)).toBe(false);
    provider.dispose();
    expect(provider.coversLocation(0, 0)).toBe(false);
    scene.dispose(); engine.dispose();
  });

  it("keeps parent content when replacement descendants are empty", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const requests: string[] = [];
    const provider = new Google3DTiles(tileSet, {
      apiKey: "test", tilesetLoader: async () => ({ root: {
        content: { uri: "parent.glb" }, children: [{ geometricError: 0 }],
      } }), modelTileLoader: createModelLoader(requests),
    });
    expect(await provider.load()).toHaveLength(1);
    expect(requests[0]).toContain("parent.glb");
    provider.dispose(); scene.dispose(); engine.dispose();
  });

  it("adds the API key and session to Google child URLs while traversing content", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const requests: string[] = [];
    const externalURL = "https://tile.googleapis.com/v1/3dtiles/city.json?session=session-123&key=test-key";
    const tilesetLoader: GoogleTilesetLoader = vi.fn(async (url) => {
      if (url.includes("root.json")) {
        return {
          root: {
            boundingVolume: { region: [-Math.PI, -Math.PI / 2, Math.PI, Math.PI / 2, 0, 100] },
            content: { uri: "/v1/3dtiles/city.json?session=session-123" },
          },
        } satisfies Google3DTileset;
      }
      expect(url).toBe(externalURL);
      return {
        root: {
          boundingVolume: { region: [-0.5, -0.5, 0.5, 0.5, 0, 100] },
          content: { uri: "city.glb" },
        },
      } satisfies Google3DTileset;
    });
    const modelLoader = createModelLoader(requests);
    const google = new Google3DTiles(tileSet, {
      apiKey: "test-key",
      tilesetLoader,
      modelTileLoader: modelLoader,
      maxDepth: 3,
      maxTiles: 4,
    });

    const loaded = await google.load();

    expect(tilesetLoader).toHaveBeenCalledWith(
      `${GOOGLE_3D_TILES_ROOT_URL}?key=test-key`,
    );
    expect(requests).toEqual([
      "https://tile.googleapis.com/v1/3dtiles/city.glb?session=session-123&key=test-key",
    ]);
    expect(google.sessionToken).toBe("session-123");
    expect(loaded).toHaveLength(1);
    expect(google.getAttributions()).toEqual(["Google imagery", "Open data"]);
    expect(tileSet.ourAttribution.addAttribution).toHaveBeenCalledWith("GOOGLE");
    expect(tileSet.ourAttribution.setGoogleAttributions).toHaveBeenCalledWith([
      "Google imagery",
      "Open data",
    ]);

    await google.load();
    expect(tilesetLoader).toHaveBeenCalledTimes(2);
    expect(modelLoader).toHaveBeenCalledOnce();

    google.dispose();
    expect(loaded[0].root.isDisposed()).toBe(true);
    scene.dispose();
    engine.dispose();
  });

  it("filters region children and places imported coordinates in local ENU space", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const requests: string[] = [];
    const outsideTile: Google3DTile = {
      boundingVolume: { region: [2, -0.5, 2.5, 0.5, 0, 100] },
      content: { uri: "outside.glb" },
    };
    const insideTile: Google3DTile = {
      boundingVolume: { region: [-0.5, -0.5, 0.5, 0.5, 0, 100] },
      content: { uri: "inside.glb" },
    };
    const tilesetLoader: GoogleTilesetLoader = vi.fn(async () => ({
      root: {
        boundingVolume: { region: [-Math.PI, -Math.PI / 2, Math.PI, Math.PI / 2, 0, 100] },
        children: [outsideTile, insideTile],
      },
    }));
    const modelLoader: GoogleModelTileLoader = vi.fn(async (url, loadScene) => {
      requests.push(url);
      const asset = new AssetContainer(loadScene);
      asset.rootNodes.push(new TransformNode("google-model", loadScene));
      return {
        asset,
        attributions: ["Google"],
        rtcCenter: Vector3.Zero(),
      };
    });
    const google = new Google3DTiles(tileSet, {
      apiKey: "test-key",
      tilesetLoader,
      modelTileLoader: modelLoader,
      maxDepth: 1,
      maxTiles: 4,
      origin: { latitude: 0, longitude: 0 },
    });

    const loaded = await google.load();

    expect(requests).toEqual([
      "https://tile.googleapis.com/v1/3dtiles/inside.glb?key=test-key",
    ]);
    expect(loaded[0].root.getWorldMatrix().m[0]).toBeCloseTo(0);
    expect(loaded[0].root.getWorldMatrix().m[1]).toBeCloseTo(-tileSet.tileScale, 10);
    expect(loaded[0].root.getWorldMatrix().m[6]).toBeCloseTo(tileSet.tileScale, 10);
    expect(loaded[0].root.getWorldMatrix().m[8]).toBeCloseTo(-tileSet.tileScale, 10);

    google.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("validates the API key and map lifecycle before making requests", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const tileSet = new TileSet(scene, engine);
    const google = new Google3DTiles(tileSet);

    await expect(google.load()).rejects.toThrow(
      "Cannot load Google 3D Tiles before createGeometry() has been called.",
    );

    tileSet.createGeometry(new Vector2(1, 1), 100, 1);
    tileSet.updateRaster(0, 0, 2);
    await expect(google.load()).rejects.toThrow(
      "A Google Maps Platform API key is required",
    );

    google.apiKey = "test-key";
    google.maxTiles = 0;
    await expect(google.load()).rejects.toThrow("maxTiles must be a positive integer");

    scene.dispose();
    engine.dispose();
  });
});


describe("Google3DTiles regression coverage", () => {
  it.each([false, true])("rebases, scales and aligns glTF geometry (right handed: %s)", async (rightHanded) => {
    const { engine, scene, tileSet } = createTileSet();
    scene.useRightHandedSystem = rightHanded;
    tileSet.tileScale = 0.5;
    const google = new Google3DTiles(tileSet, {
      apiKey: "test-key", exaggeration: 2,
      tilesetLoader: async () => ({ root: {
        transform: Array.from(Matrix.Translation(6378137, 0, 0).m),
        children: [{ transform: Array.from(Matrix.Translation(10, 20, 30).m), content: { uri: "model.glb" } }],
      } }),
      modelTileLoader: async () => ({ asset: new AssetContainer(scene), attributions: [], rtcCenter: new Vector3(1, 2, 3) }),
    });
    const [tile] = await google.load();
    // Source glTF (4, 5, 6) -> tile (4, -6, 5) -> RTC -> nested transforms.
    const point = Vector3.TransformCoordinates(new Vector3(rightHanded ? 4 : -4, 5, 6), tile.root.getWorldMatrix());
    const mapOrigin = tileSet.ourTileMath.EPSG_to_Game(new Vector2(0, 0), EPSG_Type.EPSG_4326);
    expect(point.x).toBeCloseTo(mapOrigin.x + 8, 5);
    expect(point.y).toBeCloseTo(15, 5);
    expect(point.z).toBeCloseTo(mapOrigin.z + 19, 5);
    google.dispose(); scene.dispose(); engine.dispose();
  });

  it("does not resurrect assets when disposed while fetching the hierarchy", async () => {
    const { engine, scene, tileSet } = createTileSet();
    let resolve!: (value: Google3DTileset) => void;
    const modelTileLoader = createModelLoader([]);
    const google = new Google3DTiles(tileSet, { apiKey: "test-key", modelTileLoader,
      tilesetLoader: () => new Promise(r => { resolve = r; }),
    });
    const loading = google.load();
    google.dispose();
    resolve({ root: { content: { uri: "late.glb" } } });
    expect(await loading).toEqual([]);
    expect(modelTileLoader).not.toHaveBeenCalled();
    expect(google.tileset).toBeUndefined();
    scene.dispose(); engine.dispose();
  });

  it("disposes a late model response after cancellation", async () => {
    const { engine, scene, tileSet } = createTileSet();
    let resolve!: (value: LoadedGoogleModelTile) => void;
    const asset = new AssetContainer(scene);
    const disposed = vi.spyOn(asset, "dispose");
    const google = new Google3DTiles(tileSet, { apiKey: "test-key",
      tilesetLoader: async () => ({ root: { content: { uri: "late.glb" } } }),
      modelTileLoader: () => new Promise(r => { resolve = r; }),
    });
    const loading = google.load();
    await vi.waitFor(() => expect(resolve).toBeDefined());
    google.dispose(); resolve({ asset, attributions: [] });
    expect(await loading).toEqual([]);
    expect(disposed).toHaveBeenCalledOnce();
    scene.dispose(); engine.dispose();
  });

  it("inherits additive refinement and respects the model budget", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const google = new Google3DTiles(tileSet, { apiKey: "test-key", maxTiles: 2,
      tilesetLoader: async () => ({ root: { refine: "ADD", children: [{
        content: { uri: "parent.glb" }, children: [{ content: { uri: "child.glb" } }],
      }] } }), modelTileLoader: createModelLoader([]),
    });
    expect((await google.load()).map(tile => new URL(tile.url).pathname.split("/").pop())).toEqual(["child.glb", "parent.glb"]);
    google.dispose(); scene.dispose(); engine.dispose();
  });

  it.each(["box", "sphere"])("filters transformed %s volumes outside the map", async (kind) => {
    const { engine, scene, tileSet } = createTileSet();
    tileSet.updateRaster(0, 0, 16);
    const volume = kind === "box" ? { box: [0,0,0,10,0,0,0,10,0,0,0,10] } : { sphere: [0,0,0,10] };
    const google = new Google3DTiles(tileSet, { apiKey: "test-key",
      tilesetLoader: async () => ({ root: { children: [
        { boundingVolume: volume, transform: Array.from(Matrix.Translation(-6378137,0,0).m), content: { uri: "outside.glb" } },
        { boundingVolume: volume, transform: Array.from(Matrix.Translation(6378137,0,0).m), content: { uri: "inside.glb" } },
      ] } }), modelTileLoader: createModelLoader([]),
    });
    expect((await google.load()).map(tile => new URL(tile.url).pathname.split("/").pop())).toEqual(["inside.glb"]);
    google.dispose(); scene.dispose(); engine.dispose();
  });

  it("retries failed child tilesets on a subsequent load", async () => {
    const { engine, scene, tileSet } = createTileSet();
    let attempts = 0;
    const google = new Google3DTiles(tileSet, { apiKey: "test-key",
      tilesetLoader: async (url) => {
        if (url.includes("root.json")) return { root: { content: { uri: "child.json" } } };
        if (++attempts === 1) throw new Error("Temporary failure");
        return { root: { content: { uri: "model.glb" } } };
      }, modelTileLoader: createModelLoader([]),
    });
    expect(await google.load()).toHaveLength(0);
    expect(await google.load()).toHaveLength(1);
    google.dispose(); scene.dispose(); engine.dispose();
  });
});


describe("Google3DTiles edge cases", () => {
  it.each([
    { maxDepth: -1 }, { maxDepth: 1.5 }, { maxTiles: 0 }, { maxTiles: NaN },
    { exaggeration: 0 }, { exaggeration: Infinity }, { origin: { latitude: 91, longitude: 0 } },
    { origin: { latitude: 0, longitude: 181 } }, { origin: { latitude: 0, longitude: 0, height: NaN } },
  ])("rejects invalid options %j without network requests", async (options) => {
    const { engine, scene, tileSet } = createTileSet();
    const loader = vi.fn();
    const google = new Google3DTiles(tileSet, { apiKey: "test-key", ...options, tilesetLoader: loader });
    await expect(google.load()).rejects.toThrow();
    expect(loader).not.toHaveBeenCalled();
    scene.dispose(); engine.dispose();
  });

  it("selects across the antimeridian", async () => {
    const { engine, scene, tileSet } = createTileSet();
    tileSet.updateRaster(0, 180, 16);
    const google = new Google3DTiles(tileSet, { apiKey: "test-key",
      tilesetLoader: async () => ({ root: { boundingVolume: { region: [-Math.PI, -Math.PI/2, Math.PI, Math.PI/2] }, children: [
        { boundingVolume: { region: [-Math.PI, -0.01, -Math.PI + 0.01, 0.01] }, content: { uri: "dateline.glb" } },
        { boundingVolume: { region: [0, -0.01, 0.01, 0.01] }, content: { uri: "greenwich.glb" } },
      ] } }), modelTileLoader: createModelLoader([]),
    });
    expect((await google.load()).map(tile => new URL(tile.url).pathname.split("/").pop())).toEqual(["dateline.glb"]);
    google.dispose(); scene.dispose(); engine.dispose();
  });

  it("keeps the newest load when hierarchy responses arrive out of order", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const resolvers: Array<(value: Google3DTileset) => void> = [];
    const google = new Google3DTiles(tileSet, { apiKey: "test-key",
      tilesetLoader: () => new Promise(resolve => resolvers.push(resolve)),
      modelTileLoader: createModelLoader([]),
    });
    const first = google.load();
    const second = google.load();
    resolvers[1]({ root: { content: { uri: "new.glb" } } });
    expect(await second).toHaveLength(1);
    resolvers[0]({ root: { content: { uri: "old.glb" } } });
    expect(await first).toEqual([]);
    expect(google.loadedModelTiles[0].url).toContain("new.glb");
    google.dispose(); scene.dispose(); engine.dispose();
  });

  it("inherits a response's session instead of a different branch's latest token", () => {
    const { engine, scene, tileSet } = createTileSet();
    const google = new Google3DTiles(tileSet, { apiKey: "test-key" });
    google.getTileURL("child.json?session=other");
    const url = new URL(google.getTileURL("model.glb", "https://tile.googleapis.com/v1/3dtiles/child.json?session=parent"));
    expect(url.searchParams.get("session")).toBe("parent");
    scene.dispose(); engine.dispose();
  });

  it.each([new ArrayBuffer(0), createGLB({ extensions: { CESIUM_RTC: { center: [1, 2] } } })])("handles absent or malformed RTC data", (buffer) => {
    expect(parseGoogleGLBMetadata(buffer).rtcCenter).toBeUndefined();
  });
});

it("imports an actual GLB through Babylon's default loader and disposes its meshes", async () => {
  const { engine, scene, tileSet } = createTileSet();
  // Node has Blob/File but no FileReader. Preserve the browser file-reading contract.
  const fileNames: string[] = [];
  class TestFileReader {
    public result: ArrayBuffer | undefined;
    public onload?: (event: { target: TestFileReader }) => void;
    public onloadend?: () => void;
    public readAsArrayBuffer(file: File) {
      fileNames.push(file.name);
      void file.arrayBuffer().then(buffer => {
        this.result = buffer;
        this.onload?.({ target: this });
        this.onloadend?.();
      });
    }
    public abort() {}
  }
  vi.stubGlobal("FileReader", TestFileReader);
  const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
  const glb = createGLB({
    asset: { version: "2.0", copyright: "Integration fixture" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    extensionsUsed: ["KHR_materials_unlit"],
    materials: [{ extensions: { KHR_materials_unlit: {} } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0,0,0], max: [10,10,0] }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    buffers: [{ byteLength: positions.byteLength, uri: `data:application/octet-stream;base64,${Buffer.from(positions.buffer).toString("base64")}` }],
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(glb)));
  const google = new Google3DTiles(tileSet, { apiKey: "test-key",
    tilesetLoader: async () => ({ root: {
      transform: Array.from(Matrix.Translation(6378137, 0, 0).m), contents: [{ uri: "model.glb" }, { uri: "second.glb" }],
    } }),
  });
  try {
    const [loaded] = await google.load();
    expect(loaded).toBeDefined();
    expect(fileNames).toHaveLength(2);
    expect(new Set(fileNames).size).toBe(2);
    expect(loaded.asset.meshes.some(mesh => mesh.getTotalVertices() === 3)).toBe(true);
    expect(google.getAttributions()).toEqual(["Integration fixture"]);
    expect((loaded.asset.materials[0] as { unlit?: boolean }).unlit).toBe(true);
    const mesh = loaded.asset.meshes.find(mesh => mesh.getTotalVertices() === 3)!;
    const point = Vector3.TransformCoordinates(new Vector3(0, 10, 0), mesh.computeWorldMatrix(true));
    const origin = tileSet.ourTileMath.EPSG_to_Game(new Vector2(0, 0), EPSG_Type.EPSG_4326);
    expect(point.x).toBeCloseTo(origin.x, 5);
    expect(point.y).toBeCloseTo(0, 5);
    expect(point.z).toBeCloseTo(origin.z + 10 * tileSet.tileScale, 5);
    const meshes = [...loaded.asset.meshes];
    google.dispose();
    expect(meshes.every(mesh => mesh.isDisposed())).toBe(true);
  } finally {
    google.dispose(); scene.dispose(); engine.dispose(); vi.unstubAllGlobals();
  }
});

it("does not fall back to distant coarse content after all children are culled", async () => {
  const { engine, scene, tileSet } = createTileSet();
  tileSet.updateRaster(0, 0, 16);
  const google = new Google3DTiles(tileSet, { apiKey: "test-key",
    tilesetLoader: async () => ({ root: {
      boundingVolume: { region: [-Math.PI, -Math.PI / 2, Math.PI, Math.PI / 2] },
      content: { uri: "coarse.glb" },
      children: [{ boundingVolume: { region: [1, 0, 2, 1] }, content: { uri: "outside.glb" } }],
    } }), modelTileLoader: createModelLoader([]),
  });
  expect(await google.load()).toHaveLength(0);
  google.dispose(); scene.dispose(); engine.dispose();
});


describe("Google tiles on a globe", () => {
  it.each([[0, 0], [36, -78], [-45, 179]])("preserves radial height and metre scale at %s, %s without adding DEM height", async (latitude, longitude) => {
    const engine = new NullEngine();
    PerformanceConfigurator.SetMatrixPrecision(true);
    const scene = new Scene(engine);
    const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
    globe.createGeometry(new Vector2(1, 1), 20, 2);
    globe.updateRaster(latitude, longitude, 17);
    vi.spyOn(globe, "sampleElevation").mockReturnValue(100);
    const angle = latitude * Math.PI / 180;
    const e2 = 6.69437999014e-3;
    const n = 6378137 / Math.sqrt(1 - e2 * Math.sin(angle) ** 2);
    const lon = longitude * Math.PI / 180;
    const rtc = new Vector3((n + 120) * Math.cos(angle) * Math.cos(lon), (n + 120) * Math.cos(angle) * Math.sin(lon), (n * (1 - e2) + 120) * Math.sin(angle));
    const provider = new Google3DTiles(globe, {
      apiKey: "test",
      tilesetLoader: async () => ({ root: { content: { uri: "chapel.glb" } } }),
      modelTileLoader: async () => ({ asset: new AssetContainer(scene), attributions: [], rtcCenter: rtc }),
    });
    const [tile] = await provider.load();
    const world = tile.root.computeWorldMatrix(true);
    const position = Vector3.TransformCoordinates(Vector3.Zero(), world);
    expect(Vector3.Distance(position, globe.getSurfacePosition(latitude, longitude, 120 * globe.metresToWorld))).toBeLessThan(globe.metresToWorld);
    const metre = Vector3.TransformNormal(new Vector3(1, 0, 0), world).length();
    expect(metre).toBeCloseTo(globe.metresToWorld, 12);
    provider.heightOffset = 32;
    const [shifted] = await provider.load();
    const shiftedPosition = Vector3.TransformCoordinates(Vector3.Zero(), shifted.root.computeWorldMatrix(true));
    expect(Vector3.Distance(shiftedPosition, globe.getSurfacePosition(latitude, longitude, 152 * globe.metresToWorld))).toBeLessThan(globe.metresToWorld);
    provider.dispose();
    expect(tile.root.isDisposed()).toBe(true);
    scene.dispose(); engine.dispose();
  });
});


it("refines visible Google geometry as its projected error grows", async () => {
  const engine = new NullEngine({ renderWidth: 1000, renderHeight: 1000, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 4 });
  const scene = new Scene(engine);
  const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
  globe.createGeometry(new Vector2(1, 1), 20, 2);
  globe.updateRaster(0, 0, 17);
  const target = globe.getSurfacePosition(0, 0);
  const camera = new ArcRotateCamera("view", 0, 1, 1, target, scene);
  const bounds = { sphere: [6378137, 0, 0, 10] };
  const provider = new Google3DTiles(globe, { apiKey: "test", maximumScreenSpaceError: 1,
    tilesetLoader: async () => ({ root: { boundingVolume: { box: [0, 0, 0, 7645212, 0, 0, 0, 7645212, 0, 0, 0, 7645212] }, geometricError: 1e100, children: [{ boundingVolume: bounds, geometricError: 1, content: { uri: "coarse.glb" },
      children: [{ boundingVolume: bounds, geometricError: 0, content: { uri: "fine.glb" } }] }] } }),
    modelTileLoader: createModelLoader([]) });
  camera.setPosition(globe.getSurfacePosition(0, 0, 10000 * globe.metresToWorld));
  camera.getViewMatrix(true); camera.getProjectionMatrix(true);
  expect((await provider.load())[0].url).toContain("coarse.glb");
  camera.setPosition(globe.getSurfacePosition(0, 0, 100 * globe.metresToWorld));
  camera.getViewMatrix(true); camera.getProjectionMatrix(true);
  expect((await provider.load())[0].url).toContain("fine.glb");
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("keeps complete sibling coverage when refinement reaches the tile budget", async () => {
  const {engine, scene, tileSet} = createTileSet();
  const provider = new Google3DTiles(tileSet, {apiKey:"test", maximumScreenSpaceError:1, maxTiles:3,
    tilesetLoader:async () => ({root:{children:[
      {content:{uri:"west.glb"},children:[{content:{uri:"west-1.glb"}},{content:{uri:"west-2.glb"}}]},
      {content:{uri:"east.glb"},children:[{content:{uri:"east-1.glb"}},{content:{uri:"east-2.glb"}}]},
    ]}}), modelTileLoader:createModelLoader([])});
  const tiles = await provider.load();
  expect(tiles).toHaveLength(3);
  expect(provider.stats.modelRequests).toBe(3);
  expect(provider.stats.detailLimitedTiles).toBe(1);
  expect(tiles.some(tile => tile.url.includes("west"))).toBe(true);
  expect(tiles.some(tile => tile.url.includes("east"))).toBe(true);
  expect(tiles.filter(tile => /west-/.test(tile.url))).toHaveLength(2);
  expect(tiles.some(tile => tile.url.includes("east.glb"))).toBe(true);
  provider.dispose(); scene.dispose(); engine.dispose();
});

it("replaces a parent only after the complete child batch is ready", async () => {
  const {engine, scene, tileSet} = createTileSet();
  let finish!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => {started=resolve;});
  const slow = new Promise<void>(resolve => {finish=resolve;});
  const provider = new Google3DTiles(tileSet,{apiKey:"test",maximumScreenSpaceError:1,maxDepth:0,
    tilesetLoader:async () => ({root:{content:{uri:"parent.glb"},children:[{content:{uri:"fast.glb"}},{content:{uri:"slow.glb"}}]}}),
    modelTileLoader:async url => {
      if(url.includes("slow.glb")) {started(); await slow;}
      return {asset:new AssetContainer(scene),attributions:[]};
    }});
  const [parent]=await provider.load();
  provider.maxDepth=4;
  const replacement=provider.load(); await waiting;
  expect(parent.root.isEnabled()).toBe(true);
  expect(provider.loadedModelTiles.map(tile=>tile.url)).toEqual([parent.url]);
  finish(); await replacement;
  expect(parent.root.isEnabled()).toBe(false);
  expect(provider.stats.modelRequests).toBe(3);
  expect(provider.loadedModelTiles).toHaveLength(2);
  expect(provider.loadedModelTiles.every(tile=>tile.root.isEnabled())).toBe(true);
  provider.dispose();scene.dispose();engine.dispose();
});

it("retains parent coverage when a replacement model fails", async () => {
  const {engine, scene, tileSet}=createTileSet();
  const provider=new Google3DTiles(tileSet,{apiKey:"test",maximumScreenSpaceError:1,maxDepth:0,
    tilesetLoader:async()=>({root:{content:{uri:"parent.glb"},children:[{content:{uri:"failed.glb"}}]}}),
    modelTileLoader:async url=>url.includes("failed")?undefined:{asset:new AssetContainer(scene),attributions:[]}});
  const [parent]=await provider.load(); provider.maxDepth=4;
  expect(await provider.load()).toEqual([parent]);
  expect(parent.root.isEnabled()).toBe(true);
  provider.dispose();scene.dispose();engine.dispose();
});
