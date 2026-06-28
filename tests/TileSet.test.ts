import { describe, expect, it, vi } from "vitest";
import { NullEngine, Scene } from "@babylonjs/core";

import RasterOSM from "../src/RasterOSM";

vi.mock("../src/core/Attribution", () => ({
  default: class AttributionStub {
    public advancedTexture = {};
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
