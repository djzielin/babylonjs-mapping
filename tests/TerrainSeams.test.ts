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
  tileSet.createGeometry(new Vector2(2, 2), 100, 2);
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

  return { engine, scene, tileSet };
}

function vertexY(tile: TileSet["ourTiles"][number], x: number, y: number): number {
  const positions = tile.mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!positions) {
    throw new Error("Expected terrain positions.");
  }
  const subdivisions = tile.tileSet.meshPrecision + 1;
  return positions[1 + (x + y * subdivisions) * 3];
}

describe("terrain seam recycling", () => {
  it("re-applies cardinal and diagonal seams even when flags were already set", () => {
    const { engine, scene, tileSet } = createTerrainTileSet();
    const lowerLeft = tileSet.ourTiles[0];
    const lowerRight = tileSet.ourTiles[1];
    const upperLeft = tileSet.ourTiles[2];
    const upperRight = tileSet.ourTiles[3];
    const subdivisions = tileSet.meshPrecision + 1;

    tileSet.ourTerrainMB.fixTileSeams();

    for (let row = 0; row < subdivisions; row++) {
      expect(vertexY(upperLeft, subdivisions - 1, row)).toBe(vertexY(upperRight, 0, row));
      expect(vertexY(lowerLeft, subdivisions - 1, row)).toBe(vertexY(lowerRight, 0, row));
    }
    for (let column = 0; column < subdivisions; column++) {
      expect(vertexY(lowerLeft, column, 0)).toBe(vertexY(upperLeft, column, subdivisions - 1));
    }
    expect(vertexY(lowerLeft, subdivisions - 1, 0)).toBe(vertexY(upperRight, 0, subdivisions - 1));

    const upperPositions = upperLeft.mesh.getVerticesData(VertexBuffer.PositionKind)!;
    for (let column = 0; column < subdivisions; column++) {
      upperPositions[1 + (column + (subdivisions - 1) * subdivisions) * 3] += 500;
    }
    upperLeft.mesh.updateVerticesData(VertexBuffer.PositionKind, upperPositions);
    lowerLeft.northSeamFixed = true;

    tileSet.ourTerrainMB.fixTileSeams();
    expect(vertexY(lowerLeft, 0, 0)).toBe(vertexY(upperLeft, 0, subdivisions - 1));

    scene.dispose();
    engine.dispose();
  });

  it("reloads terrain when an endless tile is recycled", () => {
    const { engine, scene, tileSet } = createTerrainTileSet();
    const updateTerrain = vi.spyOn(tileSet.ourTerrainMB, "updateSingleTerrainTile")
      .mockResolvedValue(undefined);
    const recycledTile = tileSet.ourTiles[1];
    const oldCoords = recycledTile.tileCoords.clone();

    tileSet.moveAllTiles(100, 0, 1, null, true);

    expect(updateTerrain).toHaveBeenCalledWith(recycledTile);
    expect(recycledTile.tileCoords.equals(oldCoords)).toBe(false);

    scene.dispose();
    engine.dispose();
  });
});
