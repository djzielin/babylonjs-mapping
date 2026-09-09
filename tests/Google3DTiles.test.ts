import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetContainer, Matrix, NullEngine, Scene, TransformNode, Vector2, Vector3 } from "@babylonjs/core";

import Google3DTiles, {
  GOOGLE_3D_TILES_ROOT_URL,
  type Google3DTile,
  type Google3DTileset,
  type GoogleModelTileLoader,
  type GoogleTilesetLoader,
  parseGoogleGLBMetadata,
} from "../src/Google3DTiles";
import { EPSG_Type } from "../src/core/TileMath";
import TileSet from "../src/TileSet";

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
    let resolve!: (value: any) => void;
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
