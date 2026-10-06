export type GlobeLoadingStage = "terrain" | "coverage" | "immediate" | "background";
export type GlobeLoadingStatus = "idle" | "running" | "background" | "complete" | "failed" | "cancelled";

export interface GlobeLoadingTiming {
    startedMs: number;
    endedMs?: number;
    durationMs?: number;
    status: "running" | "complete" | "failed" | "skipped" | "cancelled";
}

export interface GlobeLoadingSnapshot {
    generation: number;
    stage: GlobeLoadingStage | "idle";
    status: GlobeLoadingStatus;
    startedMs: number;
    elapsedMs: number;
    timings: Partial<Record<GlobeLoadingStage, GlobeLoadingTiming>>;
    googleCoverageReady: boolean;
    immediateReady: boolean;
    degraded: boolean;
    error?: unknown;
}

export interface GlobeLoadingPlan {
    terrain: (signal: AbortSignal) => Promise<void>;
    coverage?: (signal: AbortSignal) => Promise<void>;
    immediate?: (signal: AbortSignal) => Promise<void>;
    background?: (signal: AbortSignal) => Promise<void>;
    /** Release Overture fallback after a Google failure, without claiming Google coverage. */
    allowGoogleFailure?: boolean;
    onTransition?: (snapshot: GlobeLoadingSnapshot) => void;
}

interface LoadingRun {
    abort: AbortController;
    plan: GlobeLoadingPlan;
    state: GlobeLoadingSnapshot;
}

/** Startup barriers share one generation; obsolete work cannot release a new view's queue. */
export class GlobeLoadingQueue {
    private generation = 0;
    private current?: LoadingRun;

    constructor(private readonly now: () => number = () => performance.now()) {}

    public get snapshot(): GlobeLoadingSnapshot {
        return this.current ? this.snapshotOf(this.current) : {
            generation: this.generation, stage: "idle", status: "idle", startedMs: 0,
            elapsedMs: 0, timings: {}, googleCoverageReady: false, immediateReady: false, degraded: false,
        };
    }

    /** Resolves when background work starts (or startup fails/cancels), not after all refinement. */
    public async run(plan: GlobeLoadingPlan): Promise<GlobeLoadingSnapshot> {
        this.cancel();
        const run: LoadingRun = {
            abort: new AbortController(), plan,
            state: {
                generation: ++this.generation, stage: "idle", status: "running", startedMs: this.now(),
                elapsedMs: 0, timings: {}, googleCoverageReady: false, immediateReady: false, degraded: false,
            },
        };
        this.current = run;
        if (!await this.barrier(run, "terrain", plan.terrain)) return this.snapshotOf(run);

        if (plan.coverage) {
            const covered = await this.barrier(run, "coverage", plan.coverage, plan.allowGoogleFailure !== false);
            if (!this.canContinue(run)) return this.snapshotOf(run);
            run.state.googleCoverageReady = covered;
            if (covered && plan.immediate) {
                const immediate = await this.barrier(run, "immediate", plan.immediate, plan.allowGoogleFailure !== false);
                if (!this.canContinue(run)) return this.snapshotOf(run);
                run.state.immediateReady = immediate;
            } else this.skip(run, "immediate");
        } else {
            this.skip(run, "coverage");
            this.skip(run, "immediate");
        }

        if (!this.isCurrent(run)) return this.snapshotOf(run);
        this.start(run, "background");
        run.state.status = "background";
        this.notify(run);
        // Observe background failures here; stage four must release immediately.
        void this.background(run);
        return this.snapshotOf(run);
    }

    public cancel(): void {
        const run = this.current;
        if (!run || run.abort.signal.aborted) return;
        run.abort.abort();
        // A failed parallel task may have left sibling work running. Abort it
        // on retry while preserving the finished run's diagnostic outcome.
        if (run.state.status === "complete" || run.state.status === "failed") return;
        if (run.state.stage !== "idle" && run.state.timings[run.state.stage]?.status === "running")
            this.finish(run, run.state.stage, "cancelled");
        run.state.status = "cancelled";
        this.notify(run);
    }

    private isCurrent(run: LoadingRun): boolean {
        return this.current === run && !run.abort.signal.aborted;
    }

    private canContinue(run: LoadingRun): boolean {
        return this.isCurrent(run) && run.state.status !== "failed";
    }

    private async barrier(run: LoadingRun, stage: GlobeLoadingStage,
        task: (signal: AbortSignal) => Promise<void>, allowFailure = false): Promise<boolean> {
        this.start(run, stage);
        this.notify(run);
        try {
            await this.wait(run, task);
            if (!this.isCurrent(run)) return false;
            this.finish(run, stage, "complete");
            return true;
        } catch (error) {
            if (!this.isCurrent(run)) return false;
            this.finish(run, stage, "failed");
            run.state.error = error;
            run.state.degraded = allowFailure;
            if (!allowFailure) run.state.status = "failed";
            this.notify(run);
            return false;
        }
    }

    private async background(run: LoadingRun): Promise<void> {
        try {
            if (run.plan.background) await this.wait(run, run.plan.background);
            if (!this.isCurrent(run)) return;
            this.finish(run, "background", "complete");
            run.state.status = "complete";
        } catch (error) {
            if (!this.isCurrent(run)) return;
            this.finish(run, "background", "failed");
            run.state.error = error;
            run.state.status = "failed";
        }
        this.notify(run);
    }

    private async wait(run: LoadingRun, task: (signal: AbortSignal) => Promise<void>): Promise<void> {
        const signal = run.abort.signal;
        signal.throwIfAborted();
        let onAbort!: () => void;
        const cancelled = new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(signal.reason);
            signal.addEventListener("abort", onAbort, { once: true });
        });
        try {
            await Promise.race([Promise.resolve().then(() => {
                signal.throwIfAborted();
                return task(signal);
            }), cancelled]);
        } finally {
            signal.removeEventListener("abort", onAbort);
        }
    }

    private start(run: LoadingRun, stage: GlobeLoadingStage): void {
        run.state.stage = stage;
        run.state.timings[stage] = { startedMs: this.now(), status: "running" };
    }

    private finish(run: LoadingRun, stage: GlobeLoadingStage, status: GlobeLoadingTiming["status"]): void {
        const timing = run.state.timings[stage]!;
        const endedMs = this.now();
        run.state.timings[stage] = { ...timing, endedMs, durationMs: endedMs - timing.startedMs, status };
    }

    private skip(run: LoadingRun, stage: GlobeLoadingStage): void {
        const now = this.now();
        run.state.timings[stage] = { startedMs: now, endedMs: now, durationMs: 0, status: "skipped" };
    }

    private snapshotOf(run: LoadingRun): GlobeLoadingSnapshot {
        const timings: GlobeLoadingSnapshot["timings"] = {};
        for (const stage of Object.keys(run.state.timings) as GlobeLoadingStage[])
            timings[stage] = { ...run.state.timings[stage]! };
        return { ...run.state, elapsedMs: this.now() - run.state.startedMs, timings };
    }

    private notify(run: LoadingRun): void {
        run.plan.onTransition?.(this.snapshotOf(run));
    }
}
