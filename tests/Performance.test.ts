import { describe, expect, it, vi } from "vitest";
import {
  Mesh,
  NullEngine,
  Scene,
  StandardMaterial,
  UniversalCamera,
  Vector2,
  Vector3,
} from "@babylonjs/core";

import Buildings, {
  BuildingRequestType,
  type BuildingRequest,
} from "../src/Buildings";
import { GeoJSON, type feature } from "../src/GeoJSON";
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
    // Requests are queued directly by these tests.
  }

  public SubmitLoadAllRequest(): void {
    // Requests are queued directly by these tests.
  }

  public enqueue(request: BuildingRequest): void {
    this.enqueueBuildingRequest(request);
  }
}

function createTileSet(numTiles = 1) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const tileSet = new TileSet(scene, engine);
  tileSet.createGeometry(new Vector2(numTiles, 1), 100, 1);
  tileSet.updateRaster(0, 0, 16);
  return { engine, scene, tileSet };
}

function pointFeature(id = "point"): feature {
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

function createRequest(tile: TileSet["ourTiles"][number], id: string): BuildingRequest {
  return {
    requestType: BuildingRequestType.CreateBuilding,
    tile,
    tileCoords: tile.tileCoords.clone(),
    inProgress: false,
    flipWinding: false,
    epsgType: EPSG_Type.EPSG_3857,
    feature: pointFeature(id),
  };
}

describe("mapping performance controls", () => {
  it("prioritizes creation requests by active-camera distance", () => {
    const { engine, scene, tileSet } = createTileSet(2);
    const buildings = new TestBuildings("test", tileSet, RetrievalLocation.Local);
    buildings.buildingsCreatedPerFrame = 1;
    buildings.setOptimizationOptions({ prioritizeRequestsByDistance: true });

    const camera = new UniversalCamera("camera", new Vector3(50, 10, 0), scene);
    scene.activeCamera = camera;
    camera.computeWorldMatrix(true);

    buildings.enqueue(createRequest(tileSet.ourTiles[0], "far"));
    buildings.enqueue(createRequest(tileSet.ourTiles[1], "near"));
    buildings.processBuildingRequests();

    expect(tileSet.ourTiles[0].buildings).toHaveLength(0);
    expect(tileSet.ourTiles[1].buildings).toHaveLength(1);

    scene.dispose();
    engine.dispose();
  });

  it("surfaces safe mesh settings and keeps moving building parents live", () => {
    const { engine, scene, tileSet } = createTileSet();
    const buildings = new TestBuildings("test", tileSet, RetrievalLocation.Local);
    buildings.buildingMaterial = new StandardMaterial("building", scene);
    buildings.setOptimizationOptions({
      freezeMaterials: false,
      freezeWorldMatrices: false,
      disablePicking: false,
      disableCollisions: false,
    });

    const geoJson = new GeoJSON(tileSet, scene);
    geoJson.generateSingleBuilding(
      "test",
      pointFeature(),
      EPSG_Type.EPSG_3857,
      tileSet.ourTiles[0],
      false,
      buildings,
    );

    const mesh = tileSet.ourTiles[0].buildings[0].mesh;
    const initialCenter = mesh.getBoundingInfo().boundingBox.centerWorld.clone();
    expect(mesh.isPickable).toBe(true);
    expect(mesh.checkCollisions).toBe(true);
    expect(mesh.isWorldMatrixFrozen).toBe(false);
    expect(buildings.buildingMaterial.isFrozen).toBe(false);

    tileSet.ourTiles[0].mesh.position.x += 25;
    mesh.computeWorldMatrix(true);
    expect(mesh.getBoundingInfo().boundingBox.centerWorld.x - initialCenter.x).toBeCloseTo(25);

    scene.dispose();
    engine.dispose();
  });

  it("reports detailed and billboard geometry plus LOD selections", () => {
    const { engine, scene, tileSet } = createTileSet();
    const buildings = new TestBuildings("test", tileSet, RetrievalLocation.Local);
    buildings.buildingLOD = {
      enabled: true,
      distance: 25,
      billboardMode: Mesh.BILLBOARDMODE_Y,
    };

    const geoJson = new GeoJSON(tileSet, scene);
    geoJson.generateSingleBuilding(
      "test",
      pointFeature("lod"),
      EPSG_Type.EPSG_3857,
      tileSet.ourTiles[0],
      false,
      buildings,
    );

    const mesh = tileSet.ourTiles[0].buildings[0].mesh;
    const billboard = mesh.getLODLevels()[0].mesh;
    if (!billboard) {
      throw new Error("Expected a billboard LOD mesh.");
    }

    const buildingCenter = mesh.getBoundingInfo().boundingSphere.centerWorld.clone();
    const camera = new UniversalCamera("lod-camera", buildingCenter.add(new Vector3(0, 0, 1)), scene);
    camera.computeWorldMatrix(true);
    const nearLOD = mesh.getLOD(camera);
    camera.position.z = 1000;
    camera.computeWorldMatrix(true);
    const farLOD = mesh.getLOD(camera);
    expect(nearLOD).toBe(mesh);
    expect(farLOD).toBe(billboard);

    const stats = buildings.getPerformanceStats();
    expect(stats.detailedBuildingCount).toBe(1);
    expect(stats.billboardCount).toBe(1);
    expect(stats.detailedVertexCount).toBeGreaterThan(stats.billboardVertexCount);
    expect(stats.estimatedVertexReductionPercent).toBeGreaterThan(0);
    expect(stats.lodSelections).toBeGreaterThanOrEqual(2);
    expect(stats.detailedSelections).toBeGreaterThanOrEqual(1);
    expect(stats.billboardSelections).toBeGreaterThanOrEqual(1);

    buildings.setPerformanceMonitoringEnabled(true);
    scene.render();
    expect(buildings.getPerformanceStats().frameSamples).toBeGreaterThanOrEqual(1);

    buildings.resetPerformanceStats();
    expect(buildings.getPerformanceStats().detailedBuildingCount).toBe(0);
    expect(buildings.getPerformanceStats().frameSamples).toBe(0);

    scene.dispose();
    engine.dispose();
  });

  it("preserves picking and reports no LOD reduction when billboards are disabled", () => {
    const { engine, scene, tileSet } = createTileSet();
    const buildings = new TestBuildings("test", tileSet, RetrievalLocation.Local);
    const geoJson = new GeoJSON(tileSet, scene);

    geoJson.generateSingleBuilding(
      "test",
      pointFeature("default-options"),
      EPSG_Type.EPSG_3857,
      tileSet.ourTiles[0],
      false,
      buildings,
    );

    expect(tileSet.ourTiles[0].buildings[0].mesh.isPickable).toBe(true);
    expect(buildings.getPerformanceStats().estimatedVertexReductionPercent).toBe(0);

    scene.dispose();
    engine.dispose();
  });

  it("surfaces raster tile optimization settings", () => {
    const { engine, scene, tileSet } = createTileSet();
    const tile = tileSet.ourTiles[0];

    tileSet.setOptimizationOptions({
      freezeRasterMaterials: false,
      freezeTileWorldMatrices: true,
      disableTilePicking: true,
      disableTileCollisions: true,
    });

    expect(tile.mesh.isPickable).toBe(false);
    expect(tile.mesh.checkCollisions).toBe(false);
    expect(tile.mesh.isWorldMatrixFrozen).toBe(true);
    expect(tile.material.isFrozen).toBe(false);

    tileSet.setOptimizationOptions({
      freezeTileWorldMatrices: false,
      disableTilePicking: false,
      disableTileCollisions: false,
    });
    expect(tile.mesh.isPickable).toBe(true);
    expect(tile.mesh.checkCollisions).toBe(true);
    expect(tile.mesh.isWorldMatrixFrozen).toBe(false);

    scene.dispose();
    engine.dispose();
  });
});
