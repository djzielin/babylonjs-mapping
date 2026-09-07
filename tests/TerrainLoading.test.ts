import { describe, expect, it, vi } from "vitest";
import { NullEngine, Scene, Vector2, VertexBuffer } from "@babylonjs/core";
import TileSet from "../src/core/TileSet";
vi.mock("../src/core/Attribution", () => ({ default: class { addAttribution() {} } }));

function setup() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const tiles = new TileSet(scene, engine);
  tiles.createGeometry(new Vector2(1, 1), 10, 1);
  tiles.updateRaster(0, 0, 14);
  tiles.ourTerrainMB.setExaggeration(1, 1);
  return { engine, scene, terrain: tiles.ourTerrainMB, tile: tiles.ourTiles[0] };
}
function texture(pixels: Uint8Array | null) {
  return { readPixels: vi.fn().mockResolvedValue(pixels), getSize: () => ({ width: 2, height: 2 }), dispose: vi.fn() };
}

describe("terrain loading", () => {
  it("disposes textures when pixel readback fails", async () => {
    const { engine, scene, terrain, tile } = setup();
    const tex = texture(null);
    vi.spyOn(terrain as any, "GetAsyncTexture").mockResolvedValue(tex);
    await expect(terrain.updateSingleTerrainTile(tile)).rejects.toThrow("pixels");
    expect(tex.dispose).toHaveBeenCalledOnce();
    expect(tile.terrainLoaded).toBe(false);
    scene.dispose(); engine.dispose();
  });

  it("ignores an older request even when the coordinates are unchanged", async () => {
    const { engine, scene, terrain, tile } = setup();
    let resolveOld!: (value: unknown) => void;
    const old = texture(new Uint8Array(16));
    const latest = texture(new Uint8Array([1, 134, 160, 255, 1, 134, 170, 255, 1, 134, 180, 255, 1, 134, 190, 255]));
    vi.spyOn(terrain as any, "GetAsyncTexture")
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(latest);
    const first = terrain.updateSingleTerrainTile(tile);
    await terrain.updateSingleTerrainTile(tile);
    const heights = [...tile.dem];
    resolveOld(old);
    await first;
    expect(tile.dem).toEqual(heights);
    expect(old.dispose).toHaveBeenCalledOnce();
    expect(latest.dispose).toHaveBeenCalledOnce();
    const normals = tile.mesh.getVerticesData(VertexBuffer.NormalKind)!;
    expect(normals.some((v, i) => i % 3 !== 1 && Math.abs(v) > 0.01)).toBe(true);
    scene.dispose(); engine.dispose();
  });
});
