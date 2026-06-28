import { afterEach, describe, expect, it, vi } from "vitest";
import { Vector2 } from "@babylonjs/core/Maths/math";

import RasterOSM from "../src/RasterOSM";
import RasterWMTS from "../src/RasterWMTS";
import { RetrievalLocation } from "../src/Retrieval";

const tileSetStub = {
  scene: {
    onBeforeRenderObservable: {
      add: vi.fn(),
    },
  },
};

describe("RasterOSM", () => {
  it("builds OpenStreetMap raster tile URLs", () => {
    const raster = new RasterOSM(tileSetStub as never);

    expect(raster.getRasterURL(new Vector2(25908, 18050), 16)).toBe(
      "https://tile.openstreetmap.org/16/25908/18050.png",
    );
  });
});

describe("RasterWMTS", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds remote WMTS tile URLs", () => {
    const raster = new RasterWMTS(tileSetStub as never, RetrievalLocation.Remote);
    raster.setup("https://example.test/wmts", "imagery");

    expect(raster.getRasterURL(new Vector2(5, 6), 4)).toBe(
      "https://example.test/wmts/tile/1.0.0/imagery/default/default028mm/4/6/5.png",
    );
  });

  it("builds local cache URLs relative to the current page", () => {
    vi.stubGlobal("window", {
      location: {
        href: "https://example.test/viewers/wmts-local/index.html",
      },
    });

    const raster = new RasterWMTS(tileSetStub as never, RetrievalLocation.Local);

    expect(raster.getRasterURL(new Vector2(25908, 18050), 16)).toBe(
      "https://example.test/viewers/wmts-local/map_cache/16_18050_25908.png",
    );
  });
});
