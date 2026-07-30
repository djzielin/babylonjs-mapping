import { describe, expect, it, vi } from "vitest";
import {
  AssetContainer,
  NullEngine,
  Scene,
  TransformNode,
  Vector2,
} from "@babylonjs/core";

import BuildingsMB, {
  type MapboxModelTileLoader,
} from "../src/BuildingsMB";
import TileSet from "../src/TileSet";

vi.mock("../src/core/Attribution", () => ({
  default: class AttributionStub {
    public advancedTexture = {};
    public addAttribution = vi.fn();
  },
}));

function createTileSet(zoom = 16) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const tileSet = new TileSet(scene, engine);
  tileSet.createGeometry(new Vector2(4, 4), 100, 1);
  tileSet.updateRaster(35.2258461, -80.8400777, zoom);

  return { engine, scene, tileSet };
}

function createLoader() {
  const requests: string[] = [];
  const assets: AssetContainer[] = [];
  const loader: MapboxModelTileLoader = vi.fn(async (url, scene) => {
    requests.push(url);
    const asset = new AssetContainer(scene);
    asset.rootNodes.push(new TransformNode("model-root", scene));
    vi.spyOn(asset, "addAllToScene");
    vi.spyOn(asset, "dispose");
    assets.push(asset);
    return asset;
  });

  return { loader, requests, assets };
}

describe("BuildingsMB", () => {
  it("deduplicates source tiles and places them in Babylon map space", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const { loader, requests } = createLoader();
    const buildings = new BuildingsMB(tileSet, loader);
    buildings.accessToken = "pk.test token";

    const loaded = await buildings.generateBuildings();
    const expectedTileKeys = new Set(
      tileSet.ourTiles.map((tile) => {
        const factor = Math.pow(2, tileSet.zoom - buildings.sourceZoom);
        return `${Math.floor(tile.tileCoords.x / factor)}/${Math.floor(tile.tileCoords.y / factor)}`;
      }),
    );

    expect(loaded).toHaveLength(expectedTileKeys.size);
    expect(requests).toHaveLength(expectedTileKeys.size);
    expect(requests.every((url) => url.includes("/14/"))).toBe(true);
    expect(requests.every((url) => url.endsWith("access_token=pk.test+token"))).toBe(true);

    const first = loaded[0];
    const expectedHorizontalScale = (
      tileSet.tileWidth * Math.pow(2, tileSet.zoom - buildings.sourceZoom)
    ) / buildings.tileExtent;
    expect(first.root.scaling.x).toBeCloseTo(-expectedHorizontalScale);
    expect(first.root.scaling.y).toBeCloseTo(expectedHorizontalScale);
    expect(first.root.scaling.z).toBeCloseTo(tileSet.tileScale);
    expect(first.root.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(first.asset.rootNodes[0].parent).toBe(first.root);

    await buildings.generateBuildings();
    expect(requests).toHaveLength(expectedTileKeys.size);
    expect(tileSet.ourAttribution.addAttribution).toHaveBeenCalledWith("MBMODEL");

    buildings.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("disposes model tiles that no longer overlap after a raster update", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const { loader, assets } = createLoader();
    const buildings = new BuildingsMB(tileSet, loader);
    buildings.accessToken = "pk.test";

    await buildings.generateBuildings();
    const originalAssets = assets.slice();

    tileSet.updateRaster(35.2258461, -70, 16);
    await buildings.generateBuildings();

    expect(originalAssets.every((asset) => vi.mocked(asset.dispose).mock.calls.length === 1)).toBe(true);

    buildings.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("treats missing landmark tiles as an empty result", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const loader: MapboxModelTileLoader = vi.fn(async () => undefined);
    const buildings = new BuildingsMB(tileSet, loader);
    buildings.accessToken = "pk.test";

    await expect(buildings.generateBuildings()).resolves.toEqual([]);

    buildings.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("validates the token, zoom, and exaggeration before requesting tiles", async () => {
    const { engine, scene, tileSet } = createTileSet(13);
    const loader: MapboxModelTileLoader = vi.fn(async () => undefined);
    const buildings = new BuildingsMB(tileSet, loader);

    await expect(buildings.generateBuildings()).rejects.toThrow(
      "A Mapbox access token is required",
    );

    buildings.accessToken = "pk.test";
    await expect(buildings.generateBuildings()).rejects.toThrow(
      "require zoom 14 or greater",
    );

    tileSet.updateRaster(35.2258461, -80.8400777, 14);
    buildings.exaggeration = 0;
    await expect(buildings.generateBuildings()).rejects.toThrow(
      "exaggeration must be a finite number greater than zero",
    );
    expect(loader).not.toHaveBeenCalled();

    scene.dispose();
    engine.dispose();
  });
});
