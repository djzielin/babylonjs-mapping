import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveLatestOvertureBuildingsURL } from "../src/buildings/BuildingsOverture.js";

describe("Overture buildings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves the newest public PMTiles release", async () => {
    const listing = [
      "<ListBucketResult>",
      "<CommonPrefixes><Prefix>tiles/2026-06-17.0/</Prefix></CommonPrefixes>",
      "<CommonPrefixes><Prefix>tiles/2026-07-22.0/</Prefix></CommonPrefixes>",
      "</ListBucketResult>",
    ].join("");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(listing)));

    await expect(
      resolveLatestOvertureBuildingsURL("https://example.test/"),
    ).resolves.toBe(
      "https://example.test/tiles/2026-07-22.0/buildings.pmtiles",
    );
  });

  it("reports an empty release listing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<ListBucketResult/>")),
    );

    await expect(resolveLatestOvertureBuildingsURL()).rejects.toThrow(
      "No Overture tile releases were found.",
    );
  });
});
