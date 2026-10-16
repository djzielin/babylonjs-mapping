/** How much the photorealistic tiles draw, from finest to lightest. */
export interface QualityLevel {
    /** Google tiles' target screen-space error, in pixels. */
    error: number;
    /** Metres within which that target holds before easing off with distance. */
    detailRadius: number;
    /** How many times coarser the farthest tiles may be. */
    distantErrorScale: number;
    /** Metres beyond which no 3D tiles are drawn. */
    radius: number;
}

/**
 * Every level draws 3D tiles out to the same range, so the view never falls
 * back to flat imagery nearby: levels trade detail, near and far, instead.
 * Measured on a Quest 3, the range costs little once distant tiles are
 * coarse; fine detail costs most (tile textures fill its memory).
 */
export const QUALITY_LEVELS: QualityLevel[] = [
    { error: 12, detailRadius: 1000, distantErrorScale: 6, radius: 10_000 },
    { error: 16, detailRadius: 800, distantErrorScale: 6, radius: 10_000 },
    { error: 20, detailRadius: 800, distantErrorScale: 6, radius: 10_000 },
    { error: 24, detailRadius: 800, distantErrorScale: 6, radius: 10_000 },
    { error: 28, detailRadius: 700, distantErrorScale: 8, radius: 10_000 },
    { error: 32, detailRadius: 600, distantErrorScale: 8, radius: 10_000 },
    { error: 40, detailRadius: 500, distantErrorScale: 10, radius: 10_000 },
    { error: 48, detailRadius: 400, distantErrorScale: 12, radius: 10_000 },
];

/** The level the headset starts at, before the governor has measured anything. */
export const INITIAL_LEVEL = 3;

/**
 * Holds the headset's refresh rate by trading detail: frames that miss the
 * display's interval step the level down quickly; a long run of frames on
 * time steps it back up, but never to a level that has already failed in
 * the last half minute, so it settles instead of oscillating.
 */
export class QualityGovernor {
    public level: number;
    private intervals: number[] = [];
    private last = 0;
    private changedAt = 0;
    private readonly failedAt: number[] = [];
    /** When a second last missed too many frames, waiting to see if the next does too. */
    private overAt = -Infinity;

    public constructor(private readonly targetHz: () => number, initial = INITIAL_LEVEL, private readonly onChange: (level: QualityLevel, index: number) => void) {
        this.level = initial;
        onChange(QUALITY_LEVELS[initial], initial);
    }

    /** Frames per second over the last second. */
    public get fps(): number {
        const total = this.intervals.reduce((sum, interval) => sum + interval, 0);
        return total ? this.intervals.length * 1000 / total : 0;
    }

    /** Share of the last second's frames that missed the display. */
    public get missed(): number {
        const budget = 1000 / this.targetHz();
        return this.intervals.length ? this.intervals.filter(interval => interval > budget * 1.5).length / this.intervals.length : 0;
    }

    /** Records a frame's timing without changing the level. */
    public measure(now: number): void {
        if (this.last) this.intervals.push(now - this.last);
        this.last = now;
        let total = this.intervals.reduce((sum, interval) => sum + interval, 0);
        while (total > 1000 && this.intervals.length > 1) total -= this.intervals.shift()!;
    }

    /** Call at the start of every XR frame. */
    public frame(now: number): void {
        this.measure(now);
        if (now - this.changedAt < 1500 || this.intervals.length < 20) return;
        const missed = this.missed;
        // Holding the 95th percentile at the refresh rate allows about one
        // frame in 25 to miss; stepping up wants a clear margin below that.
        // A single bad second is often a burst of tiles arriving: only two in
        // a row step down.
        if (missed > 0.04 && this.level < QUALITY_LEVELS.length - 1) {
            if (now - this.overAt > 2500) { this.overAt = now; this.intervals = []; return; }
            // The second second, measured afresh.
            if (now - this.overAt < 1000) return;
            this.overAt = -Infinity;
            this.failedAt[this.level] = now;
            this.set(this.level + 1, now);
        } else if (missed <= 0.01 && now - this.changedAt > 6000 && this.level > 0 && !(now - (this.failedAt[this.level - 1] ?? -Infinity) < 30_000)) {
            this.set(this.level - 1, now);
        }
    }

    /** Forget timing across a pause, such as leaving and re-entering VR. */
    public reset(): void {
        this.intervals = [];
        this.last = 0;
    }

    private set(level: number, now: number): void {
        this.level = level;
        this.changedAt = now;
        this.intervals = [];
        this.onChange(QUALITY_LEVELS[level], level);
    }
}
