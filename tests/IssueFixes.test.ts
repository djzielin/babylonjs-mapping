import { describe, expect, it, vi } from "vitest";
import { NullEngine, Scene, StandardMaterial, Vector2, VertexBuffer } from "@babylonjs/core";

import { GeoJSON, type feature } from "../src/GeoJSON";
import { resolveRoofSpec } from "../src/buildings/RoofBuilder";
import Buildings from "../src/Buildings";
import TileSet from "../src/TileSet";
import { EPSG_Type } from "../src/TileMath";
import { RetrievalLocation, RetrievalType } from "../src/Retrieval";

vi.mock("../src/core/Attribution", () => ({
  default: class AttributionStub {
    public advancedTexture = {};
    public addAttribution = vi.fn();
  },
}));

class TestBuildings extends Buildings {
  public SubmitLoadTileRequest(): void {
    // The request queue is not part of these lifecycle tests.
  }

  public SubmitLoadAllRequest(): void {
    // The request queue is not part of these lifecycle tests.
  }
}

function createTileSet() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const tileSet = new TileSet(scene, engine);
  tileSet.createGeometry(new Vector2(4, 4), 100, 1);
  tileSet.updateRaster(0, 0, 2);

  return { engine, scene, tileSet };
}

function createBuildingSettings(scene: Scene, lineWidth = 6, pointDiameter = 8) {
  return {
    buildingMaterial: new StandardMaterial("test-building-material", scene),
    exaggeration: 1,
    defaultBuildingHeight: 2,
    lineWidth,
    pointDiameter,
    retrievalType: RetrievalType.IndividualTiles,
  } as unknown as Buildings;
}

function createFeature(geometry: feature["geometry"], properties: Record<string, unknown> = {}): feature {
    return {
        id: "test-feature",
        type: "Feature",
        properties,
        geometry,
    };
}

describe("geometry lifecycle safeguards", () => {
  it("reports a useful error when raster work starts before geometry setup", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const tileSet = new TileSet(scene, engine);

    expect(() => tileSet.updateRaster(0, 0, 2)).toThrow(
      "Cannot update raster before createGeometry() has been called.",
    );
    expect(tileSet.isGeometryCreated).toBe(false);

    scene.dispose();
    engine.dispose();
  });

  it("prevents building generation before geometry setup", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const tileSet = new TileSet(scene, engine);
    const buildings = new TestBuildings("test", tileSet, RetrievalLocation.Local);

    expect(() => buildings.generateBuildings()).toThrow(
      "Cannot generate buildings before createGeometry() has been called.",
    );

    scene.dispose();
    engine.dispose();
  });

  it("prevents building generation before raster coordinates are available", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const tileSet = new TileSet(scene, engine);
    tileSet.createGeometry(new Vector2(1, 1), 10, 1);
    const buildings = new TestBuildings("test", tileSet, RetrievalLocation.Local);

    expect(() => buildings.generateBuildings()).toThrow(
      "Cannot generate buildings before updateRaster() has been called.",
    );

    scene.dispose();
    engine.dispose();
  });
});

describe("GeoJSON geometry sizing", () => {
  it("uses the requested line width in world units for both supported projections", () => {
    const widths: number[] = [];

    for (const [epsg, coordinates] of [
      [EPSG_Type.EPSG_4326, [[[0, 0], [0, 1]]]],
      [EPSG_Type.EPSG_3857, [[[0, 0], [0, 100000]]]],
    ] as const) {
      const { engine, scene, tileSet } = createTileSet();
      const geoJson = new GeoJSON(tileSet, scene);
      const tile = tileSet.ourTiles[0];
      const feature = createFeature({ type: "MultiLineString", coordinates });

      geoJson.generateSingleBuilding(
        "test",
        feature,
        epsg,
        tile,
        false,
        createBuildingSettings(scene, 6),
      );

      const mesh = tile.buildings[0].mesh;
      widths.push(mesh.getBoundingInfo().boundingBox.extendSizeWorld.x * 2);

      scene.dispose();
      engine.dispose();
    }

    expect(widths[0]).toBeCloseTo(6, 3);
    expect(widths[1]).toBeCloseTo(6, 3);
  });

  it("uses the requested point diameter in world units", () => {
    const { engine, scene, tileSet } = createTileSet();
    const geoJson = new GeoJSON(tileSet, scene);
    const feature = createFeature({ type: "Point", coordinates: [0, 0] });

    geoJson.generateSingleBuilding(
      "test",
      feature,
      EPSG_Type.EPSG_4326,
      tileSet.ourTiles[0],
      false,
      createBuildingSettings(scene, 6, 8),
    );

    const mesh = tileSet.ourTiles[0].buildings[0].mesh;
    expect(mesh.getBoundingInfo().boundingBox.extendSizeWorld.x * 2).toBeCloseTo(8, 3);

    scene.dispose();
    engine.dispose();
  });
});

describe("OSM roof shapes", () => {
  const footprint = {
    type: "Polygon",
    coordinates: [[[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]],
  };

  it.each(["gabled", "hipped", "pyramidal", "skillion"])(
    "builds a %s roof without changing the tagged total height",
    (roofShape) => {
      const { engine, scene, tileSet } = createTileSet();
      const geoJson = new GeoJSON(tileSet, scene);
      const feature = createFeature(footprint, {
        height: 12,
        roofShape,
        roofHeight: 4,
        roofDirection: 90,
      });

      geoJson.generateSingleBuilding(
        "test",
        feature,
        EPSG_Type.EPSG_3857,
        tileSet.ourTiles[0],
        false,
        createBuildingSettings(scene),
      );

      const mesh = tileSet.ourTiles[0].buildings[0].mesh;
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
      const yCoordinates = positions.filter((_, index) => index % 3 === 1);
      const expectedWallHeight = 8 * tileSet.tileScale;
      const expectedTotalHeight = 12 * tileSet.tileScale;

      expect(Math.max(...yCoordinates)).toBeCloseTo(expectedTotalHeight, 5);
      expect(yCoordinates.some((height) => Math.abs(height - expectedWallHeight) < 1e-5)).toBe(true);
      expect(mesh.metadata.roofShape).toBe(roofShape);

      scene.dispose();
      engine.dispose();
    },
  );

  it("uses roof levels and accepts raw Simple 3D Buildings property names", () => {
    expect(resolveRoofSpec({
      "roof:shape": "gabled",
      "roof:levels": "2",
      "roof:direction": "45",
    }, 20)).toEqual({
      shape: "gabled",
      height: 6,
      direction: 45,
    });
  });

  it("keeps a full-height flat roof when a shaped roof cannot preserve a courtyard", () => {
    const { engine, scene, tileSet } = createTileSet();
    const geoJson = new GeoJSON(tileSet, scene);
    const feature = createFeature({
      type: "Polygon",
      coordinates: [
        [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]],
        [[5, 5], [5, 15], [15, 15], [15, 5], [5, 5]],
      ],
    }, {
      height: 12,
      roofShape: "pyramidal",
      roofHeight: 4,
    });

    geoJson.generateSingleBuilding(
      "test",
      feature,
      EPSG_Type.EPSG_3857,
      tileSet.ourTiles[0],
      false,
      createBuildingSettings(scene),
    );

    const mesh = tileSet.ourTiles[0].buildings[0].mesh;
    mesh.computeWorldMatrix(true);
    expect(mesh.getBoundingInfo().boundingBox.maximumWorld.y).toBeCloseTo(12 * tileSet.tileScale, 5);

    scene.dispose();
    engine.dispose();
  });
});
