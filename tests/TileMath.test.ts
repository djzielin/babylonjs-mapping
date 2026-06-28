import { describe, expect, it } from "vitest";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math";

import TileMath, { EPSG_Type } from "../src/TileMath";

const math = new TileMath(undefined);

describe("TileMath slippy-map conversions", () => {
  it("round-trips exact tile coordinates through lon/lat at several zoom levels", () => {
    const samples = [
      { lon: 0, lat: 0, zoom: 1 },
      { lon: -80.8431, lat: 35.2271, zoom: 12 },
      { lon: 13.405, lat: 52.52, zoom: 15 },
      { lon: 151.2093, lat: -33.8688, zoom: 10 },
    ];

    for (const sample of samples) {
      const x = math.lon_to_tileExact(sample.lon, sample.zoom);
      const y = math.lat_to_tileExact(sample.lat, sample.zoom);

      expect(math.tile_to_lon(x, sample.zoom)).toBeCloseTo(sample.lon, 10);
      expect(math.tile_to_lat(y, sample.zoom)).toBeCloseTo(sample.lat, 10);
    }
  });

  it("floors longitude and latitude tile coordinates for discrete tile ids", () => {
    expect(math.lon_to_tile(0, 0)).toBe(0);
    expect(math.lat_to_tile(0, 0)).toBe(0);
    expect(math.lon_to_tile(-80.8431, 12)).toBe(Math.floor(math.lon_to_tileExact(-80.8431, 12)));
    expect(math.lat_to_tile(35.2271, 12)).toBe(Math.floor(math.lat_to_tileExact(35.2271, 12)));
  });

  it("computes a world-spanning EPSG:4326 bounding box for zoom zero", () => {
    const bbox = math.computeBBOX_4326(new Vector3(0, 0, 0));

    expect(bbox.x).toBeCloseTo(-85.05112878, 7);
    expect(bbox.y).toBeCloseTo(-180, 10);
    expect(bbox.z).toBeCloseTo(85.05112878, 7);
    expect(bbox.w).toBeCloseTo(180, 10);
  });
});

describe("TileMath EPSG projections", () => {
  it("converts between EPSG:4326 and EPSG:3857", () => {
    const lonLat = new Vector2(-80.8431, 35.2271);
    const mercator = math.epsg4326_to_Epsg3857(lonLat);
    const roundTrip = math.epsg3857_to_Epsg4326(mercator);

    expect(roundTrip.x).toBeCloseTo(lonLat.x, 8);
    expect(roundTrip.y).toBeCloseTo(lonLat.y, 8);
  });

  it("normalizes wrapped longitudes when projecting to EPSG:3857", () => {
    const wrapped = math.epsg4326_to_Epsg3857(new Vector2(190, 0));
    const expected = math.epsg4326_to_Epsg3857(new Vector2(-170, 0));

    expect(wrapped.x).toBeCloseTo(expected.x, 8);
    expect(wrapped.y).toBeCloseTo(expected.y, 8);
  });

  it("supports explicit EPSG:3857 inputs when computing exact tile coordinates", () => {
    const lonLat = new Vector2(-80.8431, 35.2271);
    const mercator = math.epsg4326_to_Epsg3857(lonLat);

    const tileFromLonLat = math.EPSG_to_TileExact(lonLat, EPSG_Type.EPSG_4326, 12);
    const tileFromMercator = math.EPSG_to_TileExact(mercator, EPSG_Type.EPSG_3857, 12);

    expect(tileFromMercator.x).toBeCloseTo(tileFromLonLat.x, 10);
    expect(tileFromMercator.y).toBeCloseTo(tileFromLonLat.y, 10);
  });
});

describe("TileMath line intersections", () => {
  it("finds the crossing point for two line segments", () => {
    const intersection = math.line_segment_intersect(
      new Vector2(0, 0),
      new Vector2(10, 10),
      new Vector2(0, 10),
      new Vector2(10, 0),
    );

    expect(intersection).not.toBe(false);
    expect((intersection as Vector2).x).toBeCloseTo(5, 10);
    expect((intersection as Vector2).y).toBeCloseTo(5, 10);
  });

  it("returns false for parallel, disjoint, and zero-length segments", () => {
    expect(math.line_segment_intersect(new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1), new Vector2(1, 1))).toBe(false);
    expect(math.line_segment_intersect(new Vector2(0, 0), new Vector2(1, 1), new Vector2(2, 2), new Vector2(3, 3))).toBe(false);
    expect(math.line_segment_intersect(new Vector2(0, 0), new Vector2(0, 0), new Vector2(0, 1), new Vector2(1, 0))).toBe(false);
  });

  it("maps game-plane vectors between Vector2 and Vector3", () => {
    expect(math.v3_to_v2(new Vector3(1, 99, 2))).toEqual(new Vector2(1, 2));
    expect(math.v2_to_v3(new Vector2(3, 4))).toEqual(new Vector3(3, 0, 4));
  });
});
