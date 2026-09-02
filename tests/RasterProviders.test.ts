import { afterEach, describe, expect, it, vi } from "vitest";
import { Vector2 } from "@babylonjs/core/Maths/math";

import RasterMB from "../src/RasterMB";
import RasterOSM from "../src/RasterOSM";
import RasterGEBCO from "../src/RasterGEBCO";
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

describe("RasterMB", () => {
  it("builds Mapbox raster URLs with sku and access token query parameters", () => {
    const raster = new RasterMB({
      ourTileMath: {
        generateSKU: () => "101abcDEF42",
      },
    } as never);
    raster.accessToken = "pk.test-token";
    raster.doResBoost = true;

    expect(raster.getRasterURL(new Vector2(1, 2), 3)).toBe(
      "https://api.mapbox.com/v4/mapbox.satellite/3/1/2@2x.jpg90?sku=101abcDEF42&access_token=pk.test-token",
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

  it("supports a custom local cache prefix", () => {
    vi.stubGlobal("window", {
      location: {
        href: "https://example.test/viewers/wmts-local/index.html",
      },
    });

    const raster = new RasterWMTS(tileSetStub as never, RetrievalLocation.Local);
    raster.localPathPrefix = "assets/map_cache/";

    expect(raster.getRasterURL(new Vector2(1, 2), 3)).toBe(
      "https://example.test/viewers/wmts-local/assets/map_cache/3_2_1.png",
    );
  });
});

describe("RasterGEBCO", () => {
  it("builds colour-shaded EPSG:3857 WMS tile URLs", () => {
    const raster = new RasterGEBCO(tileSetStub as never);
    const url = new URL(raster.getRasterURL(new Vector2(0, 0), 1));

    expect(`${url.origin}${url.pathname}`).toBe("https://wms.gebco.net/mapserv");
    expect(url.searchParams.get("service")).toBe("WMS");
    expect(url.searchParams.get("request")).toBe("GetMap");
    expect(url.searchParams.get("layers")).toBe("GEBCO_LATEST_2");
    expect(url.searchParams.get("crs")).toBe("EPSG:3857");
    expect(url.searchParams.get("format")).toBe("image/png");
    expect(url.searchParams.get("bbox")).toBe(
      "-20037508.342789244,0,0,20037508.342789244",
    );
  });

  it("supports custom layers and wraps/clamps slippy-map coordinates", () => {
    const raster = new RasterGEBCO(tileSetStub as never, {
      layer: "GEBCO_LATEST_3",
      tileSize: 512,
      transparent: true,
    });
    const url = new URL(raster.getRasterURL(new Vector2(-1, 99), 2));

    expect(url.searchParams.get("layers")).toBe("GEBCO_LATEST_3");
    expect(url.searchParams.get("width")).toBe("512");
    expect(url.searchParams.get("height")).toBe("512");
    expect(url.searchParams.get("transparent")).toBe("true");
    const bbox = url.searchParams.get("bbox")!.split(",").map(Number);
    expect(bbox).toHaveLength(4);
    expect(bbox[0]).toBeCloseTo(10018754.171394622, 6);
    expect(bbox[1]).toBeCloseTo(-20037508.342789244, 6);
    expect(bbox[2]).toBeCloseTo(20037508.342789244, 6);
    expect(bbox[3]).toBeCloseTo(-10018754.171394622, 6);
  });
});
