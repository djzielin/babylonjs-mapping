import { describe, expect, it, vi } from "vitest";
import { NullEngine, Scene, Vector2 } from "@babylonjs/core";

import RasterOSM from "../src/RasterOSM";

vi.mock("../src/core/Attribution", () => ({
  default: class AttributionStub {
    public advancedTexture = {};
    public addAttribution() {}
  },
}));

describe("TileSet", () => {
  it("uses OpenStreetMap as the default raster provider", async () => {
    const { default: TileSet } = await import("../src/TileSet");
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const tileSet = new TileSet(scene, engine);
    const provider = (tileSet as unknown as { ourRasterProvider: unknown }).ourRasterProvider;

    expect(provider).toBeInstanceOf(RasterOSM);

    scene.dispose();
    engine.dispose();
  });
});


describe("TileSet updates", () => {
  it("replaces pending imagery and removes old coordinate mappings", async () => {
    const { default: TileSet } = await import("../src/TileSet");
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const tiles = new TileSet(scene, engine);
    tiles.createGeometry(new Vector2(2, 2), 10, 1);
    tiles.updateRaster(36, -79, 10);
    const pending = (tiles as any).tileRequests;
    const dispose = vi.fn();
    pending[0].texture = { dispose };
    tiles.updateRaster(40, -70, 10);
    expect(dispose).toHaveBeenCalledOnce();
    expect((tiles as any).tileRequests).toHaveLength(4);
    expect(tiles.ourTilesMap.size).toBe(4);
    for (const tile of tiles.ourTiles) {
      expect(tiles.ourTilesMap.get(tile.tileCoords.toString())).toBe(tile);
    }
    scene.dispose();
    engine.dispose();
  });

  it.each([0, 1, 2, 4])("honors a reload limit of %i and refreshes moved bounds", async (limit) => {
    const { default: TileSet } = await import("../src/TileSet");
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const tiles = new TileSet(scene, engine);
    tiles.createGeometry(new Vector2(2, 2), 10, 1);
    tiles.updateRaster(36, -79, 10);
    const updated = vi.fn();
    tiles.onTilePositionUpdatedObservable.add(updated);
    tiles.moveAllTiles(21, 0, limit, null);
    expect(updated).toHaveBeenCalledTimes(limit);
    for (const tile of tiles.ourTiles) {
      expect(tile.box2D.center.x).toBeCloseTo(tile.mesh.position.x);
    }
    scene.dispose();
    engine.dispose();
  });

  it("releases tile materials when replacing geometry", async () => {
    const { default: TileSet } = await import("../src/TileSet");
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const tiles = new TileSet(scene, engine);
    tiles.createGeometry(new Vector2(1, 1), 10, 1);
    tiles.updateRaster(36, -79, 10);
    const material = tiles.ourTiles[0].material;
    const dispose = vi.spyOn(material, "dispose");
    tiles.createGeometry(new Vector2(1, 1), 10, 1);
    expect(dispose).toHaveBeenCalledOnce();
    expect((tiles as any).tileRequests).toHaveLength(0);
    scene.dispose();
    engine.dispose();
  });
});

it("processes active image downloads before hundreds of unstarted requests", async () => {
  const {default:TileSet}=await import("../src/TileSet");
  const engine=new NullEngine(),scene=new Scene(engine),tiles=new TileSet(scene,engine);
  const ready={inProgress:true};
  (tiles as any).tileRequests=[...Array.from({length:576},()=>({inProgress:false})),ready];
  const processed:unknown[]=[];
  vi.spyOn(tiles as any,"processNextTileRequest").mockImplementation(()=>{
    processed.push((tiles as any).tileRequests.shift());
  });
  tiles.processTileRequests();
  expect(processed[0]).toBe(ready);
  expect(processed).toHaveLength(tiles.rasterConcurrency+1);
  scene.dispose();engine.dispose();
});
