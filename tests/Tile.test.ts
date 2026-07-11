import { describe, expect, it } from "vitest";
import { NullEngine, Scene } from "@babylonjs/core";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";

import Tile from "../src/Tile";

describe("Tile", () => {
  it("detects whether a mesh bounding box is fully inside the tile bounds", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const tileMesh = MeshBuilder.CreateGround("tile", { width: 10, height: 10 }, scene);
    const tile = new Tile(tileMesh, { scene } as never);

    const inside = MeshBuilder.CreateBox("inside", { size: 1 }, scene);
    inside.position.x = 0;
    inside.position.z = 0;
    inside.computeWorldMatrix(true);
    inside.refreshBoundingInfo();

    const outside = MeshBuilder.CreateBox("outside", { size: 1 }, scene);
    outside.position.x = 10;
    outside.position.z = 0;
    outside.computeWorldMatrix(true);
    outside.refreshBoundingInfo();

    expect(tile.isBuildingInsideTileBoundingBox(inside)).toBe(true);
    expect(tile.isBuildingInsideTileBoundingBox(outside)).toBe(false);

    scene.dispose();
    engine.dispose();
  });
});
