import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine, Scene, Vector2 } from "@babylonjs/core";

import BuildingsWFS from "../src/buildings/BuildingsWFS";
import type { BuildingRequest } from "../src/buildings/Buildings";
import { type feature } from "../src/buildings/GeoJSON";
import TileSet from "../src/core/TileSet";
import { EPSG_Type } from "../src/core/TileMath";
import { RetrievalLocation, RetrievalType } from "../src/shared/Retrieval";

vi.mock("../src/core/Attribution", () => ({
  default: class AttributionStub {
    public advancedTexture = {};
    public addAttribution = vi.fn();
  },
}));

class TestBuildingsWFS extends BuildingsWFS {
  public getRequests(): BuildingRequest[] {
    return this.buildingRequests;
  }
}

function createBuildings() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const tileSet = new TileSet(scene, engine);
  tileSet.createGeometry(new Vector2(1, 1), 100, 1);
  tileSet.updateRaster(0, 0, 2);

  const buildings = new TestBuildingsWFS(
    "test-buildings",
    "https://example.test/wfs?",
    "example:buildings",
    EPSG_Type.EPSG_4326,
    tileSet,
    RetrievalLocation.Remote,
  );
  buildings.retrievalType = RetrievalType.AllData;
  buildings.buildingsCreatedPerFrame = 100;
  buildings.maxFeaturesPerRequest = 2;

  return { engine, scene, tileSet, buildings };
}

function pointFeature(id: string): feature {
  return {
    id,
    type: "Feature",
    properties: {},
    geometry: {
      type: "Point",
      coordinates: [0, 0],
    },
  };
}

function installFetchPages(pages: Record<number, { features?: feature[]; status?: number }>) {
  const requestedURLs: string[] = [];
  const fetchMock = vi.fn((requestURL: string) => {
    requestedURLs.push(requestURL);
    const startIndex = Number(new URL(requestURL).searchParams.get("startIndex") ?? "0");
    const page = pages[startIndex] ?? { features: [] };
    const status = page.status ?? 200;
    const text = status === 200
      ? JSON.stringify({ type: "FeatureCollection", features: page.features ?? [] })
      : "";

    return Promise.resolve({
      status,
      text: () => Promise.resolve(text),
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  return requestedURLs;
}

async function drainRequests(buildings: TestBuildingsWFS): Promise<void> {
  for (let i = 0; i < 100; i++) {
    buildings.processBuildingRequests();
    await Promise.resolve();
    await Promise.resolve();

    if (buildings.getRequests().length === 0) {
      return;
    }
  }

  throw new Error("building request queue did not drain");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BuildingsWFS pagination", () => {
  it("paginates ArcGIS Online requests and generates every returned feature", async () => {
    const { engine, scene, tileSet, buildings } = createBuildings();
    const features = [1, 2, 3, 4, 5].map((id) => pointFeature(String(id)));
    const requestedURLs = installFetchPages({
      0: { features: features.slice(0, 2) },
      2: { features: features.slice(2, 4) },
      4: { features: features.slice(4) },
    });

    try {
      buildings.setupAGOL();
      buildings.generateBuildings();
      await drainRequests(buildings);

      expect(requestedURLs).toHaveLength(3);
      expect(requestedURLs.map((url) => new URL(url).searchParams.get("startIndex"))).toEqual(["0", "2", "4"]);
      expect(requestedURLs.map((url) => new URL(url).searchParams.get("count"))).toEqual(["2", "2", "2"]);
      expect(new URL(requestedURLs[0]).searchParams.get("version")).toBe("2.0.0");
      expect(new URL(requestedURLs[0]).searchParams.get("typeNames")).toBe("example:buildings");
      expect(new URL(requestedURLs[0]).searchParams.get("typeName")).toBeNull();
      expect(tileSet.ourTiles[0].buildings).toHaveLength(5);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("finishes an exact-page dataset when ArcGIS reports the next page as out of range", async () => {
    const { engine, scene, tileSet, buildings } = createBuildings();
    const requestedURLs = installFetchPages({
      0: { features: [pointFeature("1"), pointFeature("2")] },
      2: { status: 400 },
    });

    try {
      buildings.setupAGOL();
      buildings.doMerge = true;
      buildings.generateBuildings();
      await drainRequests(buildings);

      expect(requestedURLs).toHaveLength(2);
      expect(buildings.getRequests()).toHaveLength(0);
      expect(tileSet.ourTiles[0].buildings).toHaveLength(2);
      expect(tileSet.ourTiles[0].mergedBuildingMesh).toBeDefined();
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it("keeps GeoServer requests on the existing non-paginated WFS form", () => {
    const { engine, scene, buildings } = createBuildings();

    try {
      buildings.generateBuildings();
      const requestURL = buildings.getRequests()[0].url!;
      const parsedURL = new URL(requestURL);

      expect(parsedURL.searchParams.get("typeName")).toBe("example:buildings");
      expect(parsedURL.searchParams.get("typeNames")).toBeNull();
      expect(parsedURL.searchParams.get("count")).toBeNull();
      expect(parsedURL.searchParams.get("startIndex")).toBeNull();
      expect(parsedURL.searchParams.get("version")).toBeNull();
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});
