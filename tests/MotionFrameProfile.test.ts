import { describe, expect, it } from "vitest";
import { MotionFrameProfile } from "../examples-npm/globe-mode/src/MotionFrameProfile";

describe("moving frame pacing", () => {
    it("separates motion from idle and includes the final movement frame", () => {
        const profile = new MotionFrameProfile(); const view = new Float64Array(16);
        profile.sample(0, view, true); profile.sample(10, view, true);
        view[12] = 1; profile.sample(30, view, true);
        profile.sample(60, view, true); profile.sample(70, view, true);
        expect(profile.summary(true)).toEqual({ samples: 2, fps: 40, p95: 30, low1: 1000 / 30, low01: 1000 / 30 });
        expect(profile.summary().samples).toBe(4);
    });
    it("reports average FPS and averages the slowest one and tenth percent of frames", () => {
        const profile = new MotionFrameProfile(10000); const view = new Float64Array(16);
        let now = 0; profile.sample(now, view, true);
        for (let i = 0; i < 10000; i++) { now += i < 10 ? 10 : i < 100 ? 8 : 4; profile.sample(now, view, true); }
        const result = profile.summary();
        expect(result.samples).toBe(10000);
        expect(result.fps).toBeCloseTo(10000000 / 40420);
        expect(result.low1).toBeCloseTo(100000 / 820);
        expect(result.low01).toBe(100);
    });
    it("excludes hidden-tab gaps but retains real long frames and bounds history", () => {
        const profile = new MotionFrameProfile(2); const view = new Float64Array(16);
        profile.sample(0, view, true); profile.sample(10, view, false);
        profile.sample(10000, view, true); profile.sample(10010, view, true);
        profile.sample(12010, view, true); profile.sample(12020, view, true);
        expect(profile.summary()).toEqual({ samples: 2, fps: 2000 / 2010, p95: 2000, low1: 0.5, low01: 0.5 });
        profile.reset(); expect(profile.summary().samples).toBe(0);
    });
});
