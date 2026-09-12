import { describe, expect, it } from "vitest";
import { MotionFrameProfile } from "../examples-npm/globe-mode/src/MotionFrameProfile";

describe("moving frame pacing", () => {
    it("separates motion from idle and includes the final movement frame", () => {
        const profile = new MotionFrameProfile(); const view = new Float64Array(16);
        profile.sample(0, view, true); profile.sample(10, view, true);
        view[12] = 1; profile.sample(30, view, true);
        profile.sample(60, view, true); profile.sample(70, view, true);
        expect(profile.summary(true)).toEqual({ samples: 2, fps: 1000 / 30, p95: 30 });
        expect(profile.summary().samples).toBe(4);
    });
    it("excludes hidden-tab gaps but retains real long frames and bounds history", () => {
        const profile = new MotionFrameProfile(2); const view = new Float64Array(16);
        profile.sample(0, view, true); profile.sample(10, view, false);
        profile.sample(10000, view, true); profile.sample(10010, view, true);
        profile.sample(12010, view, true); profile.sample(12020, view, true);
        expect(profile.summary()).toEqual({ samples: 2, fps: 0.5, p95: 2000 });
        profile.reset(); expect(profile.summary().samples).toBe(0);
    });
});
