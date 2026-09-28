import { describe, expect, it } from "vitest";
import { globeLODPlan, MIN_GLOBE_BUILDING_ZOOM } from "../examples-npm/globe-mode/src/GlobeLODPlan";

const tile = (lat: number, lon: number, z: number) => ({
    x: (lon + 180) / 360 * 2 ** z,
    y: (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z,
});
const destination = (lat: number, lon: number, bearing: number, miles: number) => {
    const angle = miles * 1609.344 / 6371008.8;
    const phi = lat * Math.PI / 180, lambda = lon * Math.PI / 180;
    const theta = bearing * Math.PI / 180;
    const nextPhi = Math.asin(Math.sin(phi) * Math.cos(angle)
        + Math.cos(phi) * Math.sin(angle) * Math.cos(theta));
    const nextLambda = lambda + Math.atan2(Math.sin(theta) * Math.sin(angle) * Math.cos(phi),
        Math.cos(angle) - Math.sin(phi) * Math.sin(nextPhi));
    return { lat: nextPhi * 180 / Math.PI, lon: nextLambda * 180 / Math.PI };
};

describe("globe distance LOD", () => {
    it.each([14, 16, 18])("keeps Mount Fuji within the regional terrain window from Tokyo at zoom %s", zoom => {
        const region = globeLODPlan(zoom)[1];
        const tokyo = tile(35.6812, 139.7671, region.zoom);
        const fuji = tile(35.3606, 138.7274, region.zoom);
        // Leave one tile of margin for centering on integer tile boundaries.
        expect(Math.abs(tokyo.x - fuji.x)).toBeLessThan(region.size / 2 - 1);
        expect(Math.abs(tokyo.y - fuji.y)).toBeLessThan(region.size / 2 - 1);
    });
    it("keeps useful building tiers while bounding distant raster draw calls", () => {
        for (const zoom of [15, 16, 17, 18]) {
            const plans = globeLODPlan(zoom);
            expect(plans.slice(1).every(plan => plan.zoom >= MIN_GLOBE_BUILDING_ZOOM)).toBe(true);
            expect(plans[0].zoom).toBeLessThan(MIN_GLOBE_BUILDING_ZOOM);
            expect(plans.reduce((count, plan) => count + plan.size ** 2, 25)).toBeLessThanOrEqual(1129);
            // Preserve the original horizon span of eight zoom-8 tiles.
            expect(plans[0].size / 2 ** plans[0].zoom).toBe(8 / 2 ** 8);
        }
    });
    it("bounds geometry independently of close-up zoom", () => {
        for (let zoom = 8; zoom <= 18; zoom++) {
            const plans = globeLODPlan(zoom);
            const vertices = plans.reduce((total, p) => total + p.size ** 2 * (p.precision + 1) ** 2, 0);
            expect(vertices).toBeLessThan(800000);
            expect(plans[0].zoom).toBeLessThan(plans[1].zoom);
            expect(plans[1].zoom).toBeLessThan(zoom);
            expect(plans.map(p => p.group)).toEqual([1, 2, 3, 4, 5]);
        }
    });
    it("keeps the moving NYC 15-mile disk inside the Google-mode regional tier", () => {
        const plan = globeLODPlan(17, true)[1];
        expect(plan.zoom).toBe(12);
        expect(plan.size).toBe(10);
        for (const movedMiles of [0, 10, 20]) {
            const center = destination(40.7484, -73.9857, 90, movedMiles);
            const c = tile(center.lat, center.lon, plan.zoom);
            for (let bearing = 0; bearing < 360; bearing += 15) {
                const edge = destination(center.lat, center.lon, bearing, 15);
                const e = tile(edge.lat, edge.lon, plan.zoom);
                expect(Math.abs(e.x - c.x)).toBeLessThan(plan.size / 2 - 1);
                expect(Math.abs(e.y - c.y)).toBeLessThan(plan.size / 2 - 1);
            }
        }
        const plans = globeLODPlan(17, true);
        const vertices = plans.reduce((total, p) => total + p.size ** 2 * (p.precision + 1) ** 2, 0);
        expect(vertices).toBeLessThan(800000);
    });
});
