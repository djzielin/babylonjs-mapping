/** How much the photorealistic tiles draw, from finest to lightest. */
export interface QualityLevel {
    /** Google tiles' target screen-space error, in pixels. */
    error: number;
    /** Metres within which that target holds before easing off with distance. */
    detailRadius: number;
    /** Metres beyond which no 3D tiles are drawn. */
    radius: number;
}

export const QUALITY_LEVELS: QualityLevel[] = [
    { error: 10, detailRadius: 3000, radius: 22_000 },
    { error: 14, detailRadius: 2500, radius: 18_000 },
    { error: 20, detailRadius: 2000, radius: 14_000 },
    { error: 28, detailRadius: 1500, radius: 11_000 },
    { error: 40, detailRadius: 1000, radius: 8_000 },
];

/**
 * Holds the headset's refresh rate by trading detail: frames that miss the
 * display's interval step the level down quickly; a long run of frames on
 * time steps it back up, but never to a level that has already failed in
 * the last minute, so it settles instead of oscillating.
 */
export class QualityGovernor {
    public level: number;
    private intervals: number[] = [];
    private last = 0;
    private changedAt = 0;
    private readonly failedAt: number[] = [];

    public constructor(private readonly targetHz: () => number, initial = 1, private readonly onChange: (level: QualityLevel, index: number) => void) {
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

    /** Call at the start of every XR frame. */
    public frame(now: number): void {
        if (this.last) this.intervals.push(now - this.last);
        this.last = now;
        let total = this.intervals.reduce((sum, interval) => sum + interval, 0);
        while (total > 1000 && this.intervals.length > 1) total -= this.intervals.shift()!;
        if (now - this.changedAt < 1500 || this.intervals.length < 20) return;
        const missed = this.missed;
        if (missed > 0.08 && this.level < QUALITY_LEVELS.length - 1) {
            this.failedAt[this.level] = now;
            this.set(this.level + 1, now);
        } else if (missed === 0 && now - this.changedAt > 8000 && this.level > 0 && !(now - (this.failedAt[this.level - 1] ?? -Infinity) < 60_000)) {
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
