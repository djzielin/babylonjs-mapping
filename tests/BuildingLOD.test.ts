import { describe, expect, it, vi } from "vitest";
import { Mesh, NullEngine, Scene, StandardMaterial, UniversalCamera, Vector2, Vector3 } from "@babylonjs/core";

import { GeoJSON, type feature } from "../src/GeoJSON";
import Buildings from "../src/Buildings";
import TileSet from "../src/TileSet";
import { EPSG_Type } from "../src/TileMath";
import { RetrievalLocation } from "../src/Retrieval";

vi.mock("../src/core/Attribution", () => ({
  default: class AttributionStub {
    public advancedTexture = {};
    public addAttribution = vi.fn();
  },
}));

class TestBuildings extends Buildings {
  public SubmitLoadTileRequest(): void {
    // The request queue is not part of these geometry tests.
  }

  public SubmitLoadAllRequest(): void {
    // The request queue is not part of these geometry tests.
  }
}

function createSceneAndBuildings() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const tileSet = new TileSet(scene, engine);
  tileSet.createGeometry(new Vector2(1, 1), 100, 1);
  tileSet.updateRaster(0, 0, 16);

  const buildings = new TestBuildings("test", tileSet, RetrievalLocation.Local);
  buildings.buildingMaterial = new StandardMaterial("building-material", scene);
  buildings.defaultBuildingHeight = 10;
  buildings.buildingLOD = {
    enabled: true,
    distance: 25,
  };

  return { engine, scene, tileSet, buildings };
}

function createFeature(): feature {
  return {
    id: "lod-building",
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[
        [-0.0005, -0.0005],
        [0.0005, -0.0005],
        [0.0005, 0.0005],
        [-0.0005, 0.0005],
        [-0.0005, -0.0005],
      ]],
    },
  };
}

describe("building billboard LOD", () => {
  it("registers a vertical rectangle sized from the building bounds", () => {
    const { engine, scene, tileSet, buildings } = createSceneAndBuildings();
    const geoJson = new GeoJSON(tileSet, scene);
    const tile = tileSet.ourTiles[0];

    geoJson.generateSingleBuilding(
      "test",
      createFeature(),
      EPSG_Type.EPSG_4326,
      tile,
      false,
      buildings,
    );

    const mesh = tile.buildings[0].mesh;
    const lodMesh = mesh.getLODLevels()[0].mesh;

    expect(mesh.getLODLevels()).toHaveLength(1);
    expect(lodMesh).not.toBeNull();
    if (!lodMesh) {
      throw new Error("Expected a building LOD mesh.");
    }

    expect(lodMesh.parent).toBe(mesh);
    expect(lodMesh.billboardMode).toBe(Mesh.BILLBOARDMODE_Y);
    expect(lodMesh.isPickable).toBe(false);
    expect(lodMesh.material).toBe(mesh.material);
    expect(lodMesh.getTotalVertices()).toBe(8);

    const positions = lodMesh.getVerticesData("position");
    expect(positions).not.toBeNull();
    if (!positions) {
      throw new Error("Expected billboard vertex data.");
    }

    const xValues = positions.filter((_, index) => index % 3 === 0);
    const yValues = positions.filter((_, index) => index % 3 === 1);
    const detailedBounds = mesh.getBoundingInfo().boundingBox;
    const expectedWidth = Math.max(detailedBounds.extendSizeWorld.x, detailedBounds.extendSizeWorld.z) * 2;
    const expectedHeight = detailedBounds.extendSizeWorld.y * 2;
    expect(Math.max(...xValues) - Math.min(...xValues)).toBeCloseTo(expectedWidth, 6);
    expect(Math.max(...yValues) - Math.min(...yValues)).toBeCloseTo(expectedHeight, 6);
    expect(mesh.getLODLevelAtDistance(25)).toBe(lodMesh);

    const buildingCenter = mesh.getBoundingInfo().boundingSphere.centerWorld.clone();
    const camera = new UniversalCamera(
      "lod-camera",
      buildingCenter.add(new Vector3(0, 0, 1)),
      scene,
    );
    camera.computeWorldMatrix(true);
    expect(mesh.getLOD(camera)).toBe(mesh);

    camera.position.copyFrom(buildingCenter.add(new Vector3(0, 0, 1000)));
    camera.computeWorldMatrix(true);
    expect(mesh.getLOD(camera)).toBe(lodMesh);

    scene.dispose();
    engine.dispose();
  });

  it("disposes the billboard with its detailed building", () => {
    const { engine, scene, tileSet, buildings } = createSceneAndBuildings();
    const geoJson = new GeoJSON(tileSet, scene);
    const tile = tileSet.ourTiles[0];

    geoJson.generateSingleBuilding(
      "test",
      createFeature(),
      EPSG_Type.EPSG_4326,
      tile,
      false,
      buildings,
    );

    const building = tile.buildings[0];
    const lodMesh = building.mesh.getLODLevels()[0].mesh;
    if (!lodMesh) {
      throw new Error("Expected a building LOD mesh.");
    }

    building.dispose();

    expect(building.mesh.isDisposed()).toBe(true);
    expect(lodMesh.isDisposed()).toBe(true);

    scene.dispose();
    engine.dispose();
  });

  it("rejects an invalid LOD distance before generating geometry", () => {
    const { engine, scene, tileSet, buildings } = createSceneAndBuildings();
    const geoJson = new GeoJSON(tileSet, scene);
    const tile = tileSet.ourTiles[0];
    buildings.buildingLOD.distance = 0;

    expect(() => geoJson.generateSingleBuilding(
      "test",
      createFeature(),
      EPSG_Type.EPSG_4326,
      tile,
      false,
      buildings,
    )).toThrow("buildingLOD.distance");
    expect(tile.buildings).toHaveLength(0);

    scene.dispose();
    engine.dispose();
  });
});
