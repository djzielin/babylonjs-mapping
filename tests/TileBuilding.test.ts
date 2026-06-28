import { describe, expect, it } from "vitest";
import { BoundingBox, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";

import TileBuilding from "../src/TileBuilding";
import TileMath from "../src/TileMath";

describe("TileBuilding", () => {
  it("captures each vertex z coordinate in world space", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = MeshBuilder.CreateBox("building", { size: 2 }, scene);
    mesh.computeWorldMatrix(true);

    const tile = {
      tileSet: {
        ourTileMath: new TileMath(undefined),
        streetExtensionAmount: 0.25,
      },
      mesh: {
        name: "tile",
      },
      box2D: new BoundingBox(new Vector3(-10, -1, -10), new Vector3(10, 1, 10)),
    };

    const building = new TileBuilding(mesh, tile as never);
    const uniqueZValues = new Set(building.vertices.map((vertex) => vertex.z.toFixed(4)));

    expect(building.verticies).toBe(building.vertices);
    expect(uniqueZValues.size).toBeGreaterThan(1);

    scene.dispose();
    engine.dispose();
  });
});
