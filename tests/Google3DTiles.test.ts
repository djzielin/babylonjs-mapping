import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine, Ray, Scene, Vector2, Vector3 } from "@babylonjs/core";

import Google3DTiles, { GOOGLE_3D_TILES_ROOT_URL } from "../src/google/Google3DTiles";
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

const ROOT = {
  asset: { version: "1.0" },
  geometricError: 1e7,
  root: {
    boundingVolume: { box: [0, 0, 0, 6.4e6, 0, 0, 0, 6.4e6, 0, 0, 0, 6.4e6] },
    geometricError: 1e7,
    refine: "REPLACE",
    children: [],
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Google3DTiles", () => {
  it("validates its API key and error options before making requests", () => {
    const { tileSet } = createTileSet();
    const fetch = vi.fn();
    expect(() => new Google3DTiles(tileSet, { apiKey: " ", fetch })).toThrow("API key");
    expect(() => new Google3DTiles(tileSet, { apiKey: "key", fetch, maximumScreenSpaceError: 0 })).toThrow(RangeError);
    expect(() => new Google3DTiles(tileSet, { apiKey: "key", fetch, distantErrorScale: 0.5 })).toThrow(RangeError);
  });

  it("requests the root tileset with its key through a custom fetch", async () => {
    const { tileSet } = createTileSet();
    const fetch = vi.fn(async () => new Response(JSON.stringify(ROOT), { headers: { "content-type": "application/json" } }));
    const tiles = new Google3DTiles(tileSet, { apiKey: " secret ", fetch });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_3D_TILES_ROOT_URL);
    expect(url.searchParams.get("key")).toBe("secret");
    expect(tiles.rootUrl).toBe(GOOGLE_3D_TILES_ROOT_URL);
    expect(tiles.getAttributions()).toEqual([]);
    expect(tiles.stats).toBeTypeOf("object");
    tiles.dispose();
  });

  it("finds no surface where no tile is loaded", () => {
    const { tileSet } = createTileSet();
    const tiles = new Google3DTiles(tileSet, { apiKey: "key", fetch: vi.fn(() => new Promise<Response>(() => {})) });
    expect(tiles.intersectRay(new Ray(new Vector3(0, 100, 0), new Vector3(0, -1, 0)))).toBeUndefined();
    tiles.dispose();
  });
});
