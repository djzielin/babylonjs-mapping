import { afterEach, describe, expect, it, vi } from "vitest";
import RasterWMTS from "../src/raster/RasterWMTS";
import { RetrievalLocation } from "../src/shared/Retrieval";
import { downloadBlob } from "../src/shared/Download";
import { Vector3 } from "@babylonjs/core/Maths/math";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browser downloads", () => {
  it("releases object URLs even when triggering the download throws", async () => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("window", { URL: { createObjectURL: () => "blob:test", revokeObjectURL } });
    vi.stubGlobal("document", { createElement: () => ({ click: () => { throw new Error("blocked"); } }) });
    expect(() => downloadBlob(new Blob(), "test.json")).toThrow("blocked");
    await vi.runAllTimersAsync();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it.each([404, 503])("unblocks the WMTS queue after HTTP %i", async (status) => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn().mockResolvedValue({ ok: false, status });
    vi.stubGlobal("fetch", fetch);
    const raster = new RasterWMTS({} as never, RetrievalLocation.Remote);
    const done = raster.processSingleRequest({ url: "https://example.test", tileCoords: new Vector3() } as never);
    await vi.runAllTimersAsync();
    await done;
    expect(raster.downloadComplete).toBe(true);
    expect(raster.downloadCount).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(status === 404 ? 1 : 10);
  });
});
