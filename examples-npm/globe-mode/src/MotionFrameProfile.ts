/** Frame pacing includes streaming callbacks and browser scheduling, not just scene.render(). */
export class MotionFrameProfile {
    private intervals: number[] = [];
    private movingIntervals: number[] = [];
    private cursor = 0;
    private movingCursor = 0;
    private previousTime: number | undefined;
    private previousView = new Float64Array(16);
    private previousMoving = false;
    constructor(private capacity = 12000) {}

    sample(now: number, view: ArrayLike<number>, visible: boolean): void {
        if (!visible) { this.previousTime = undefined; this.previousMoving = false; return; }
        if (this.previousTime !== undefined) {
            let moving = false;
            for (let i = 0; i < 16; i++) if (view[i] !== this.previousView[i]) { moving = true; break; }
            const interval = now - this.previousTime;
            if (interval > 0) {
                this.intervals[this.cursor++ % this.capacity] = interval;
                if (moving || this.previousMoving) this.movingIntervals[this.movingCursor++ % this.capacity] = interval;
            }
            this.previousMoving = moving;
        }
        for (let i = 0; i < 16; i++) this.previousView[i] = view[i];
        this.previousTime = now;
    }

    summary(moving = false): { samples: number; fps: number; p95: number; low1: number; low01: number } {
        const values = [...(moving ? this.movingIntervals : this.intervals)].sort((a, b) => a - b);
        const rate = (samples: number[]) => samples.length ? 1000 * samples.length / samples.reduce((sum, value) => sum + value, 0) : 0;
        return { samples: values.length, fps: rate(values),
            low1: rate(values.slice(-Math.max(1, Math.ceil(values.length * 0.01)))),
            low01: rate(values.slice(-Math.max(1, Math.ceil(values.length * 0.001)))),
            p95: values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)] ?? 0 };
    }

    reset(): void {
        this.intervals.length = this.movingIntervals.length = 0;
        this.cursor = this.movingCursor = 0;
        this.previousTime = undefined;
        this.previousMoving = false;
    }
}
