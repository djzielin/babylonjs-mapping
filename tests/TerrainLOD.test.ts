import { describe, expect, it, vi } from "vitest";
import { NullEngine, Scene, Vector2, VertexBuffer } from "@babylonjs/core";

import TileSet from "../src/TileSet";

vi.mock("../src/core/Attribution", () => ({
  default: class AttributionStub {
    public advancedTexture = {};
    public addAttribution = vi.fn();
  },
}));

function createTerrainTileSet() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const tileSet = new TileSet(scene, engine);
  tileSet.createGeometry(new Vector2(2, 1), 100, 4);
  tileSet.updateRaster(0, 0, 14);

  for (const [tileIndex, tile] of tileSet.ourTiles.entries()) {
    const positions = tile.mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) {
      throw new Error("Expected terrain positions.");
    }

    for (let vertex = 0; vertex < positions.length / 3; vertex++) {
      positions[vertex * 3 + 1] = tileIndex * 100 + vertex;
    }
    tile.mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
    tile.terrainLoaded = true;
  }

  tileSet.ourTerrainMB.fixEastSeam(tileSet.ourTiles[0], tileSet.ourTiles[1]);
  return { engine, scene, tileSet };
}

describe("terrain LOD stitching", () => {
  it("resamples fixed detailed borders and adds skirts to reduced meshes", () => {
    const { engine, scene, tileSet } = createTerrainTileSet();

    tileSet.setupTerrainLOD([2, 1, 0], [100, 200, 300], 10);

    for (const tile of tileSet.ourTiles) {
      const levels = tile.mesh.getLODLevels();
      expect(levels).toHaveLength(3);
      expect(levels.find((level) => level.distanceOrScreenCoverage === 300)?.mesh).toBeNull();

      const lod = levels.find((level) => level.distanceOrScreenCoverage === 100)?.mesh;
      if (!lod) {
        throw new Error("Expected a reduced terrain mesh.");
      }

      // A 2x2 ground has 9 surface vertices plus 8 top and 8 bottom skirt vertices.
      expect(lod.getTotalVertices()).toBe(25);
      expect(lod.material).toBe(tile.material);
      expect(lod.isPickable).toBe(false);

      const positions = lod.getVerticesData(VertexBuffer.PositionKind);
      if (!positions) {
        throw new Error("Expected LOD positions.");
      }
      for (let skirtIndex = 0; skirtIndex < 8; skirtIndex++) {
        const skirtTopY = positions[(9 + skirtIndex) * 3 + 1];
        const skirtBottomY = positions[(17 + skirtIndex) * 3 + 1];
        const surfaceY = positions[
          [0, 1, 2, 5, 8, 7, 6, 3][skirtIndex] * 3 + 1
        ];
        expect(skirtTopY).toBeCloseTo(surfaceY);
        expect(skirtBottomY).toBeCloseTo(surfaceY - 10);
      }
    }

    const leftLOD = tileSet.ourTiles[0].mesh.getLODLevelAtDistance(100);
    const rightLOD = tileSet.ourTiles[1].mesh.getLODLevelAtDistance(100);
    if (!leftLOD || !rightLOD) {
      throw new Error("Expected adjacent terrain LOD meshes.");
    }
    const leftPositions = leftLOD.getVerticesData(VertexBuffer.PositionKind)!;
    const rightPositions = rightLOD.getVerticesData(VertexBuffer.PositionKind)!;

    for (let row = 0; row < 3; row++) {
      const leftY = leftPositions[(2 + row * 3) * 3 + 1];
      const rightY = rightPositions[(row * 3) * 3 + 1];
      expect(leftY).toBe(rightY);
    }

    scene.dispose();
    engine.dispose();
  });

  it("disposes replaced terrain LOD meshes", () => {
    const { engine, scene, tileSet } = createTerrainTileSet();
    tileSet.setupTerrainLOD([2], [100], 10);
    const oldLOD = tileSet.ourTiles[0].mesh.getLODLevelAtDistance(100);
    if (!oldLOD) {
      throw new Error("Expected an initial terrain LOD mesh.");
    }

    tileSet.setupTerrainLOD([1], [200], 20);

    expect(oldLOD.isDisposed()).toBe(true);
    expect(tileSet.ourTiles[0].mesh.getLODLevels()).toHaveLength(1);
    expect(tileSet.ourTiles[0].mesh.getLODLevels()[0].distanceOrScreenCoverage).toBe(200);

    scene.dispose();
    engine.dispose();
  });

  it("rejects invalid level definitions before replacing existing LODs", () => {
    const { engine, scene, tileSet } = createTerrainTileSet();
    tileSet.setupTerrainLOD([2], [100], 10);

    expect(() => tileSet.setupTerrainLOD([2, 3], [100, 200], 10))
      .toThrow("strictly decrease");
    expect(() => tileSet.setupTerrainLOD([2, 0, 1], [100, 200, 300], 10))
      .toThrow("final level");
    expect(() => tileSet.setupTerrainLOD([2], [100], 0))
      .toThrow("skirtDepth");
    expect(tileSet.ourTiles[0].mesh.getLODLevels()).toHaveLength(1);

    scene.dispose();
    engine.dispose();
  });
});
