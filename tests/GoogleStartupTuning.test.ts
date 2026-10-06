import { describe, expect, it } from "vitest";
import { googleStartupTuning } from "../examples-npm/globe-mode/src/GoogleStartupTuning";

describe("Google startup throughput overrides", () => {
    it("uses the normal profile when no diagnostic options are supplied", () => {
        expect(googleStartupTuning("")).toEqual({ requests: 512, decodes: 192, buffer: 1024, fastStaticModels: true });
    });
    it("keeps malformed and zero capacities from disabling the loader", () => {
        expect(googleStartupTuning("?tileRequests=0&tileDecodes=Infinity&tileBuffer=-1"))
            .toEqual(googleStartupTuning(""));
        expect(googleStartupTuning("?tileRequests=513&tileDecodes=1.5&tileBuffer=1025"))
            .toEqual(googleStartupTuning(""));
    });
    it("changes throughput without changing geometry quality settings", () => {
        expect(googleStartupTuning("?tileRequests=18&tileDecodes=12&tileBuffer=48"))
            .toEqual({ requests: 18, decodes: 12, buffer: 48, fastStaticModels: true });
    });
    it("allows native-loader comparisons without disabling fast loading for malformed options", () => {
        expect(googleStartupTuning("?staticTiles=1").fastStaticModels).toBe(true);
        expect(googleStartupTuning("?staticTiles=0").fastStaticModels).toBe(false);
        expect(googleStartupTuning("?staticTiles=false").fastStaticModels).toBe(true);
    });
});
