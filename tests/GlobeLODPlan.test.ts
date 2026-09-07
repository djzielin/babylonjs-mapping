import { describe, expect, it } from "vitest";
import { globeLODPlan } from "../examples-npm/globe-mode/src/GlobeLODPlan";

const tile = (lat: number, lon: number, z: number) => ({
    x: (lon + 180) / 360 * 2 ** z,
    y: (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z,
});

describe("globe distance LOD", () => {
    it.each([14, 16, 18])("keeps Mount Fuji within the regional terrain window from Tokyo at zoom %s", zoom => {
        const region = globeLODPlan(zoom)[1];
        const tokyo = tile(35.6812, 139.7671, region.zoom);
        const fuji = tile(35.3606, 138.7274, region.zoom);
        // Leave one tile of margin for centering on integer tile boundaries.
        expect(Math.abs(tokyo.x - fuji.x)).toBeLessThan(region.size / 2 - 1);
        expect(Math.abs(tokyo.y - fuji.y)).toBeLessThan(region.size / 2 - 1);
    });
    it("bounds geometry independently of close-up zoom", () => {
        for (let zoom = 8; zoom <= 18; zoom++) {
            const plans = globeLODPlan(zoom);
            const vertices = plans.reduce((total, p) => total + p.size ** 2 * (p.precision + 1) ** 2, 0);
            expect(vertices).toBeLessThan(300000);
            expect(plans[0].zoom).toBeLessThan(plans[1].zoom);
            expect(plans[1].zoom).toBeLessThan(zoom);
            expect(plans.map(p => p.group)).toEqual([1, 2]);
        }
    });
});
