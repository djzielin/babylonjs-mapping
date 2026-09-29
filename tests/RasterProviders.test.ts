import { afterEach, describe, expect, it, vi } from "vitest";
import { Vector2 } from "@babylonjs/core/Maths/math";

import RasterMB from "../src/RasterMB";
import RasterOSM from "../src/RasterOSM";
import RasterGoogleSatellite from "../src/RasterGoogleSatellite";
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

  it("wraps longitude tiles and clamps latitude tiles", () => {
    const raster = new RasterOSM(tileSetStub as never);

    expect(raster.getRasterURL(new Vector2(4, -1), 2)).toBe(
      "https://tile.openstreetmap.org/2/0/0.png",
    );
    expect(raster.getRasterURL(new Vector2(-1, 99), 2)).toBe(
      "https://tile.openstreetmap.org/2/3/3.png",
    );
    expect(() => raster.getRasterURL(new Vector2(0, 0), -1)).toThrow(
      "RasterOSM zoom must be a non-negative integer",
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

describe("RasterGoogleSatellite", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens a satellite session and uses it for wrapped raster URLs", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({
      session: "session-test", expiry: String(Math.floor(Date.now() / 1000) + 3600),
    }) }));
    vi.stubGlobal("fetch", fetch);
    const session = await RasterGoogleSatellite.openSession("key-test");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/v1/createSession?key=key-test"),
      expect.objectContaining({ method: "POST", body: expect.stringContaining('"mapType":"satellite"') }));
    const raster = new RasterGoogleSatellite(tileSetStub as never, "key-test", session);
    const url = new URL(raster.getRasterURL(new Vector2(-1, 99), 2));
    expect(url.pathname).toBe("/v1/2dtiles/2/3/3");
    expect(url.searchParams.get("session")).toBe("session-test");
    expect(url.searchParams.get("key")).toBe("key-test");
    expect(() => raster.getRasterURL(new Vector2(0, 0), 23)).toThrow(RangeError);
  });

  it("requests copyright for the actual viewport", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ copyright: "Map data ©2026" }) }));
    vi.stubGlobal("fetch", fetch);
    const copyright = await RasterGoogleSatellite.viewportCopyright("key-test",
      { session: "session-test", expiry: Date.now() / 1000 + 3600 },
      { north: 40.95, south: 40.52, east: -73.7, west: -74.3 }, 12);
    expect(copyright).toBe("Map data ©2026");
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe("/tile/v1/viewport");
    expect(url.searchParams.get("west")).toBe("-74.3");
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

it("uses SRS for WMS 1.1.1", () => {
  const raster = new RasterGEBCO(tileSetStub as never, { version: "1.1.1" });
  const params = new URL(raster.getRasterURL(new Vector2(0, 0), 0)).searchParams;
  expect(params.get("srs")).toBe("EPSG:3857");
  expect(params.has("crs")).toBe(false);
});
