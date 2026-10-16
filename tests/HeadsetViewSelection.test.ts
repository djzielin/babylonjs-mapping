import { describe, expect, it } from "vitest";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";

import { gridTriangles, RayMesh } from "../src/shared/RayMesh";
import { ViewChange } from "../src/shared/ViewMargin";

/** Every triangle tested, as Babylon does it. */
function bruteForce(ray: Ray, positions: Float32Array, indices: ArrayLike<number>): number | undefined {
  let nearest: number | undefined;
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let i = 0; i < indices.length; i += 3) {
    a.fromArray(positions, indices[i] * 3); b.fromArray(positions, indices[i + 1] * 3); c.fromArray(positions, indices[i + 2] * 3);
    const hit = ray.intersectsTriangle(a, b, c);
    if (hit && (nearest === undefined || hit.distance < nearest)) nearest = hit.distance;
  }
  return nearest;
}

describe("RayMesh", () => {
  // A bumpy 32 × 32 grid, like a surface tile.
  const grid = 32;
  const positions = new Float32Array((grid + 1) ** 2 * 3);
  for (let row = 0; row <= grid; row++) for (let column = 0; column <= grid; column++) {
    const i = (row * (grid + 1) + column) * 3;
    positions.set([column, Math.sin(column / 3) * Math.cos(row / 4) * 2, row], i);
  }
  const indices = gridTriangles(grid);

  it("finds the same nearest hit as testing every triangle", () => {
    let hits = 0;
    for (let k = 0; k < 200; k++) {
      const origin = new Vector3(Math.random() * 40 - 4, 5 + Math.random() * 5, Math.random() * 40 - 4);
      const direction = new Vector3(Math.random() - 0.5, -1, Math.random() - 0.5).normalize();
      const ray = new Ray(origin, direction);
      const expected = bruteForce(ray, positions, indices);
      const actual = RayMesh.for(positions, indices).intersect(ray);
      if (expected === undefined) expect(actual).toBeUndefined();
      else { hits++; expect(actual).toBeCloseTo(expected, 4); }
    }
    expect(hits).toBeGreaterThan(50);
  });

  it("finds vertical hits, whose direction has zero components", () => {
    const ray = new Ray(new Vector3(10.25, 10, 7.5), new Vector3(0, -1, 0));
    expect(RayMesh.for(positions, indices).intersect(ray)).toBeCloseTo(bruteForce(ray, positions, indices)!, 4);
  });

  it("reuses the structure for the same positions", () => {
    expect(RayMesh.for(positions, indices)).toBe(RayMesh.for(positions, indices));
  });
});

describe("ViewChange", () => {
  const scene = new Scene(new NullEngine());
  const camera = new FreeCamera("eye", new Vector3(0, 0, 0), scene);

  it("follows every projection change without a tolerance", () => {
    const view = new ViewChange();
    const before = view.projection(camera);
    camera.getProjectionMatrix(true);
    expect(view.projection(camera)).not.toBe(before);
  });

  it("ignores a headset setting the same projection every frame, but not a new lens", () => {
    const view = new ViewChange();
    view.tolerance = { degrees: 4, distance: 0.02 };
    const before = view.projection(camera);
    for (let frame = 0; frame < 5; frame++) camera.getProjectionMatrix(true);
    expect(view.projection(camera)).toBe(before);
    camera.fov *= 1.2;
    expect(view.projection(camera)).not.toBe(before);
  });
});
