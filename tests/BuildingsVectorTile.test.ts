import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine, Scene, Vector2, Vector3, VertexBuffer } from "@babylonjs/core";

import BuildingsVectorTile, {
  type VectorTileDataLoader,
  type VectorTileDecoder,
  MAPBOX_STREETS_VECTOR_TILE_URL,
} from "../src/BuildingsVectorTile";
import type { BuildingRequest } from "../src/Buildings";
import TileSet from "../src/TileSet";
import { RetrievalLocation } from "../src/Retrieval";
import { EPSG_Type } from "../src/TileMath";

vi.mock("../src/core/Attribution", () => ({
  default: class AttributionStub {
    public advancedTexture = {};
    public addAttribution = vi.fn();
  },
}));

class TestBuildingsVectorTile extends BuildingsVectorTile {
  public getRequests(): BuildingRequest[] {
    return this.buildingRequests;
  }
}

function createTileSet() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const tileSet = new TileSet(scene, engine);
  tileSet.createGeometry(new Vector2(1, 1), 100, 1);
  tileSet.updateRaster(0, 0, 2);
  return { engine, scene, tileSet };
}

async function drainRequests(buildings: TestBuildingsVectorTile): Promise<void> {
  for (let i = 0; i < 100; i++) {
    buildings.processBuildingRequests();
    await Promise.resolve();
    await Promise.resolve();

    if (buildings.getRequests().length === 0) {
      return;
    }
  }

  throw new Error("vector tile request queue did not drain");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BuildingsVectorTile", () => {
  it("groups road lines into bounded jobs without dropping source geometry", () => {
    const { engine, scene, tileSet } = createTileSet();
    const buildings = new TestBuildingsVectorTile(tileSet);
    buildings.maxLinesPerFeature = 8;
    const vector = { layers: { road: {
      length: 17,
      feature: (index: number) => ({ toGeoJSON: () => ({
        id: index, properties: { class: "street" },
        geometry: { type: "LineString", coordinates: [[index, 0], [index, 1]] },
      }) }),
    } } };
    const collection = (buildings as any).toFeatureCollection(vector, 0, 0, 2);
    expect(collection.features).toHaveLength(3);
    expect(collection.features.map((item: any) => item.geometry.coordinates.length)).toEqual([8, 8, 1]);
    expect(collection.features.flatMap((item: any) => item.geometry.coordinates)
      .map((line: number[][]) => line[0][0])).toEqual(Array.from({ length: 17 }, (_, i) => i));
    scene.dispose(); engine.dispose();
  });
  it("resolves Mapbox tile URLs and encodes the access token", () => {
    const { engine, scene, tileSet } = createTileSet();
    const buildings = new TestBuildingsVectorTile(tileSet);
    buildings.accessToken = "pk.test token";

    expect(buildings.getTileURL(new Vector3(3, 4, 5))).toBe(
      `${MAPBOX_STREETS_VECTOR_TILE_URL.replace("{z}", "5").replace("{x}", "3").replace("{y}", "4")}?access_token=pk.test%20token`,
    );

    scene.dispose();
    engine.dispose();
  });

  it("loads selected layers and normalizes LineString features", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const requestedURLs: string[] = [];
    const dataLoader: VectorTileDataLoader = vi.fn(async (url) => {
      requestedURLs.push(url);
      return new ArrayBuffer(0);
    });
    const roadFeature = {
      toGeoJSON: vi.fn(() => ({
        id: 17,
        properties: { class: "primary" },
        geometry: {
          type: "LineString",
          coordinates: [[0, 0], [1, 0], [1, 1]],
        },
      })),
    };
    const decoder: VectorTileDecoder = vi.fn(() => ({
      layers: {
        road: {
          length: 1,
          feature: vi.fn(() => roadFeature),
        },
        building: {
          length: 1,
          feature: vi.fn(() => ({
            toGeoJSON: vi.fn(() => ({
              id: 99,
              properties: {},
              geometry: { type: "Point", coordinates: [0, 0] },
            })),
          })),
        },
      },
    }) as never);
    const buildings = new TestBuildingsVectorTile(
      tileSet,
      "https://tiles.example/{z}/{x}/{y}.pbf?source=roads",
      ["road"],
      RetrievalLocation.Remote,
      dataLoader,
      decoder,
    );
    buildings.accessToken = "pk.test";
    buildings.generateBuildings();
    await drainRequests(buildings);

    expect(requestedURLs).toHaveLength(1);
    expect(requestedURLs[0]).toContain("/2/");
    expect(requestedURLs[0]).toContain("?source=roads&access_token=pk.test");
    expect(decoder).toHaveBeenCalledOnce();
    expect(roadFeature.toGeoJSON).toHaveBeenCalledOnce();
    expect(tileSet.ourTiles[0].buildings).toHaveLength(1);
    expect(tileSet.ourTiles[0].buildings[0].mesh.metadata).toMatchObject({
      class: "primary",
      sourceLayer: "road",
    });
    expect(tileSet.ourAttribution.addAttribution).not.toHaveBeenCalledWith("MB");
    expect(buildings.getPerformanceStats().peakQueueLength).toBeGreaterThan(0);

    scene.dispose();
    engine.dispose();
  });

  it("keeps road triangles local to each segment through sharp turns", async () => {
    const { engine, scene, tileSet } = createTileSet();
    const source = [[0, 0], [5, 0], [5, 5], [10, 5]];
    const buildings = new TestBuildingsVectorTile(tileSet, "https://tiles.example/{z}/{x}/{y}.pbf", ["road"],
      RetrievalLocation.Remote, async () => new ArrayBuffer(0), () => ({ layers: { road: {
        length: 1, feature: () => ({ toGeoJSON: () => ({ id: 1, properties: {},
          geometry: { type: "LineString", coordinates: source } }) }),
      } } }) as never);
    buildings.generateBuildings();
    await drainRequests(buildings);
    const mesh = tileSet.ourTiles[0].buildings[0].mesh;
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const indices = mesh.getIndices()!;
    const first = Vector3.FromArray(positions, Number(indices[0]) * 3);
    const second = Vector3.FromArray(positions, Number(indices[1]) * 3);
    const third = Vector3.FromArray(positions, Number(indices[2]) * 3);
    expect(Vector3.Cross(second.subtract(first), third.subtract(first)).y).toBeLessThan(0);
    let longestEdge = 0;
    for (let i = 0; i < indices.length; i += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const left = Vector3.FromArray(positions, Number(indices[i + a]) * 3);
      const right = Vector3.FromArray(positions, Number(indices[i + b]) * 3);
      longestEdge = Math.max(longestEdge, Vector3.Distance(left, right));
    }
    const projected = source.map(([x, y]) => tileSet.getGeometryMath().EPSG_to_Game(new Vector2(x, y), EPSG_Type.EPSG_4326));
    const longestSegment = Math.max(...projected.slice(1).map((point, i) => Vector3.Distance(point, projected[i])));
    expect(longestEdge).toBeLessThan(longestSegment + 2 * buildings.lineWidth);
    scene.dispose(); engine.dispose();
  });

  it("requires a token for the default Mapbox endpoint", () => {
    const { engine, scene, tileSet } = createTileSet();
    const buildings = new TestBuildingsVectorTile(tileSet);

    expect(() => buildings.generateBuildings()).toThrow(
      "A Mapbox access token is required",
    );

    scene.dispose();
    engine.dispose();
  });

  it("allows a custom vector source without a Mapbox token", () => {
    const { engine, scene, tileSet } = createTileSet();
    const dataLoader: VectorTileDataLoader = vi.fn(async () => new ArrayBuffer(0));
    const decoder: VectorTileDecoder = vi.fn(() => ({ layers: {} }) as never);
    const buildings = new TestBuildingsVectorTile(
      tileSet,
      "https://tiles.example/{z}/{x}/{y}.pbf",
      ["traffic"],
      RetrievalLocation.Remote,
      dataLoader,
      decoder,
    );

    expect(() => buildings.generateBuildings()).not.toThrow();

    scene.dispose();
    engine.dispose();
  });
});
