import { afterEach, describe, expect, it, vi } from "vitest";
import { Mesh, NullEngine, Scene, VertexBuffer } from "@babylonjs/core";
import { removeCoastalSkirtTriangles } from "../src/google/Google3DTiles";

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(dispose => dispose()); vi.restoreAllMocks(); });

function meshWithHeights(heights: number[]) {
  const engine = new NullEngine(), scene = new Scene(engine), mesh = new Mesh("height bounds", scene);
  const positions = heights.flatMap((height, i) => [i * 10, height, i % 2 * 10]);
  mesh.setVerticesData(VertexBuffer.PositionKind, positions, false, 3);
  const indices = Array.from({ length: heights.length - 2 }, (_, i) => [0, i + 1, i + 2]).flat();
  mesh.setIndices(indices);
  cleanup.push(() => engine.dispose(), () => scene.dispose());
  return mesh;
}

describe("coastal skirt height-bound shortcut", () => {
  it.each([
    [5, 30, 10, 20], [-100, -50, -16], [0, 25, 10], [-40, -15, -15], [4.99999999, 30, 30],
  ])("skips the height sort for an exact no-skirt range %#", (...heights) => {
    const mesh = meshWithHeights(heights), indices = mesh.getIndices();
    const subMeshes = mesh.subMeshes.map(sub => [sub, sub.materialIndex, sub.indexStart, sub.indexCount, sub.verticesStart, sub.verticesCount]);
    const sort = vi.spyOn(Float32Array.prototype, "sort");
    expect(removeCoastalSkirtTriangles(mesh, 1)).toBe(0);
    expect(sort).not.toHaveBeenCalled(); expect(mesh.getIndices()).toBe(indices);
    expect(mesh.subMeshes.map(sub => [sub, sub.materialIndex, sub.indexStart, sub.indexCount, sub.verticesStart, sub.verticesCount])).toEqual(subMeshes);
  });

  it.each([[4.9999995, 30, 30], [-40.000004, -15, -15]])("retains repair immediately beyond strict cutoff boundaries %#", (...heights) => {
    const mesh = meshWithHeights(heights), sort = vi.spyOn(Float32Array.prototype, "sort");
    expect(removeCoastalSkirtTriangles(mesh, 1)).toBe(1);
    expect(sort).toHaveBeenCalledOnce(); expect(mesh.getIndices()).toHaveLength(0);
  });

  it("retains the existing sorted NaN/underwater behavior", () => {
    const mesh = meshWithHeights([NaN, -100, 0, 0, 0]), sort = vi.spyOn(Float32Array.prototype, "sort");
    expect(removeCoastalSkirtTriangles(mesh, 1)).toBe(1);
    expect(sort).toHaveBeenCalledOnce();
    expect(mesh.getIndices()).toEqual([0, 2, 3, 0, 3, 4]);
  });

  it("agrees with the former quantile/cutoff test across deterministic candidate height ranges", () => {
    let random = 173;
    const sample = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 0x100000000; };
    let candidates = 0;
    for (let iteration = 0; iteration < 120; iteration++) {
      const mode = iteration % 3, base = mode === 0 ? 5 + sample() * 40 : mode === 1 ? -16 - sample() * 100 : -100 + sample() * 200;
      const spread = mode === 2 ? sample() * 24 : sample() * 100;
      const heights = Float32Array.from({ length: 3 + iteration % 17 }, () => base + (mode === 1 ? -1 : 1) * sample() * spread);
      const minimum = Math.min(...heights), maximum = Math.max(...heights);
      if (!(minimum >= 5 || maximum < -15 || maximum - minimum <= 25)) continue;
      const sorted = Float32Array.from(heights).sort(), surface = sorted[Math.floor(sorted.length * (sorted.length < 10 ? 0.5 : 0.2))];
      expect(surface < -15 || surface > 30 || Array.from(heights).every(height => height >= surface - 25)).toBe(true);
      const mesh = meshWithHeights(Array.from(heights)), indices = mesh.getIndices();
      expect(removeCoastalSkirtTriangles(mesh, 1)).toBe(0); expect(mesh.getIndices()).toBe(indices);
      candidates++;
    }
    expect(candidates).toBeGreaterThan(10);
  });
});
