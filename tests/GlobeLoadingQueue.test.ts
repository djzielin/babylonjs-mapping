import { describe, expect, it, vi } from "vitest";
import { GlobeLoadingQueue, type GlobeLoadingSnapshot } from "../examples-npm/globe-mode/src/GlobeLoadingQueue";

function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

async function flush() {
    for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe("globe startup loading barriers", () => {
    it("releases terrain, full-radius coverage, immediate detail, then background in order", async () => {
        let now = 100;
        const queue = new GlobeLoadingQueue(() => now);
        const terrain = deferred(), coverage = deferred(), immediate = deferred(), background = deferred();
        const transitions: GlobeLoadingSnapshot[] = [];
        const tasks = {
            terrain: vi.fn(() => terrain.promise), coverage: vi.fn(() => coverage.promise),
            immediate: vi.fn(() => immediate.promise), background: vi.fn(() => background.promise),
        };
        const released = queue.run({ ...tasks, onTransition: snapshot => transitions.push(snapshot) });
        await flush();
        expect(tasks.terrain).toHaveBeenCalledOnce();
        expect(tasks.coverage).not.toHaveBeenCalled();
        now = 110; terrain.resolve(); await flush();
        expect(tasks.coverage).toHaveBeenCalledOnce();
        expect(tasks.immediate).not.toHaveBeenCalled();
        now = 135; coverage.resolve(); await flush();
        expect(tasks.immediate).toHaveBeenCalledOnce();
        expect(tasks.background).not.toHaveBeenCalled();
        now = 142; immediate.resolve();
        const result = await released;
        await flush();
        expect(tasks.background).toHaveBeenCalledOnce();
        expect(result.stage).toBe("background");
        expect(result.status).toBe("background");
        expect(result.googleCoverageReady).toBe(true);
        expect(result.immediateReady).toBe(true);
        expect(result.timings.terrain?.durationMs).toBe(10);
        expect(result.timings.coverage?.durationMs).toBe(25);
        expect(result.timings.immediate?.durationMs).toBe(7);
        expect(result.timings.background?.startedMs! - result.startedMs).toBe(42);
        expect(transitions.map(snapshot => snapshot.stage)).toEqual(["terrain", "coverage", "immediate", "background"]);
        // Transition snapshots stay unchanged when subsequent stages finish.
        expect(transitions[0].timings.terrain?.status).toBe("running");
        expect(transitions[0].timings.coverage).toBeUndefined();
        now = 170; background.resolve(); await flush();
        expect(queue.snapshot.status).toBe("complete");
        expect(queue.snapshot.timings.background?.durationMs).toBe(28);
    });

    it("cancels an uncooperative pending barrier immediately and blocks stale unlocks", async () => {
        const queue = new GlobeLoadingQueue();
        const obsolete = deferred(), current = deferred();
        let oldSignal!: AbortSignal;
        const oldCoverage = vi.fn(async () => {}), oldBackground = vi.fn(async () => {});
        const first = queue.run({ terrain: signal => { oldSignal = signal; return obsolete.promise; },
            coverage: oldCoverage, background: oldBackground });
        await flush();
        const currentBackground = vi.fn(async () => {});
        const second = queue.run({ terrain: () => current.promise, background: currentBackground });
        expect(oldSignal.aborted).toBe(true);
        expect((await first).status).toBe("cancelled");
        obsolete.resolve(); await flush();
        expect(oldCoverage).not.toHaveBeenCalled();
        expect(oldBackground).not.toHaveBeenCalled();
        expect(currentBackground).not.toHaveBeenCalled();
        expect(queue.snapshot.generation).toBe(2);
        expect(queue.snapshot.stage).toBe("terrain");
        current.resolve(); await second; await flush();
        expect(currentBackground).toHaveBeenCalledOnce();
    });

    it("still awaits nearby detail after distant coverage fails without claiming full-radius coverage", async () => {
        const queue = new GlobeLoadingQueue();
        const detail = deferred();
        const immediate = vi.fn(() => detail.promise), background = vi.fn(async () => {});
        const error = new Error("Google temporarily unavailable");
        const released = queue.run({ terrain: async () => {}, coverage: async () => { throw error; },
            immediate, background });
        await vi.waitFor(() => expect(queue.snapshot.stage).toBe("immediate"));
        expect(queue.snapshot.googleCoverageReady).toBe(false);
        expect(queue.snapshot.degraded).toBe(true);
        expect(immediate).toHaveBeenCalledOnce();
        expect(background).not.toHaveBeenCalled();
        detail.resolve();
        const result = await released;
        await flush();
        expect(result.stage).toBe("background");
        expect(result.googleCoverageReady).toBe(false);
        expect(result.immediateReady).toBe(true);
        expect(result.degraded).toBe(true);
        expect(result.error).toBe(error);
        expect(result.timings.coverage?.status).toBe("failed");
        expect(result.timings.immediate?.status).toBe("complete");
        expect(background).toHaveBeenCalledOnce();
        // Retrying the same view can establish Google coverage later.
        const retried = await queue.run({ terrain: async () => {}, coverage: async () => {}, immediate: async () => {} });
        expect(retried.googleCoverageReady).toBe(true);
        expect(retried.immediateReady).toBe(true);
        expect(retried.degraded).toBe(false);
        expect(retried.generation).toBe(2);
    });

    it("retains proven coverage when immediate detail fails and releases fallback work", async () => {
        const queue = new GlobeLoadingQueue();
        const result = await queue.run({ terrain: async () => {}, coverage: async () => {},
            immediate: async () => { throw new Error("detail failed"); } });
        expect(result.stage).toBe("background");
        expect(result.googleCoverageReady).toBe(true);
        expect(result.immediateReady).toBe(false);
        expect(result.degraded).toBe(true);
        expect(result.timings.immediate?.status).toBe("failed");
    });

    it("skips Google barriers explicitly when no Google provider is available", async () => {
        const queue = new GlobeLoadingQueue();
        const background = vi.fn(async () => {});
        const result = await queue.run({ terrain: async () => {}, background });
        await flush();
        expect(result.stage).toBe("background");
        expect(result.googleCoverageReady).toBe(false);
        expect(result.immediateReady).toBe(false);
        expect(result.timings.coverage?.status).toBe("skipped");
        expect(result.timings.immediate?.status).toBe("skipped");
        expect(background).toHaveBeenCalledOnce();
    });

    it.each(["terrain", "coverage"] as const)("does not bypass an unsuccessful required %s barrier", async failedStage => {
        const queue = new GlobeLoadingQueue();
        const background = vi.fn(async () => {});
        const result = await queue.run({
            terrain: async () => { if (failedStage === "terrain") throw new Error("terrain failed"); },
            coverage: async () => { throw new Error("coverage failed"); },
            allowGoogleFailure: false, background,
        });
        expect(result.stage).toBe(failedStage);
        expect(result.status).toBe("failed");
        expect(result.googleCoverageReady).toBe(false);
        expect(background).not.toHaveBeenCalled();
    });

    it("observes independent background failure and ignores stale background completion", async () => {
        const queue = new GlobeLoadingQueue();
        const background = deferred();
        const first = await queue.run({ terrain: async () => {}, background: () => background.promise });
        expect(first.status).toBe("background");
        background.reject(new Error("refinement failed")); await flush();
        expect(queue.snapshot.status).toBe("failed");
        expect(queue.snapshot.timings.background?.status).toBe("failed");
        const obsolete = deferred();
        await queue.run({ terrain: async () => {}, background: () => obsolete.promise });
        const current = deferred();
        const third = queue.run({ terrain: () => current.promise });
        obsolete.resolve(); await flush();
        expect(queue.snapshot.generation).toBe(3);
        expect(queue.snapshot.stage).toBe("terrain");
        expect(queue.snapshot.status).toBe("running");
        current.resolve(); await third;
    });

    it("awaits background state publication after the raw work promise resolves", async () => {
        const queue = new GlobeLoadingQueue();
        const work = deferred();
        const transitions: GlobeLoadingSnapshot[] = [];
        await queue.run({ terrain: async () => {}, background: () => work.promise,
            onTransition: snapshot => transitions.push(snapshot) });
        expect(queue.snapshot.status).toBe("background");
        work.resolve();
        await work.promise;
        const completed = await queue.awaitBackground();
        expect(completed.status).toBe("complete");
        expect(completed.timings.background?.status).toBe("complete");
        expect(transitions.at(-1)?.status).toBe("complete");
        // Scheduling the next view after this wait cannot cancel completed work.
        const nextTerrain = deferred();
        const next = queue.run({ terrain: () => nextTerrain.promise });
        expect(transitions.at(-1)?.status).toBe("complete");
        nextTerrain.resolve(); await next;
    });

    it("resolves a background wait promptly on cancellation and retains that generation's outcome", async () => {
        const queue = new GlobeLoadingQueue();
        const work = deferred();
        const first = await queue.run({ terrain: async () => {}, background: () => work.promise });
        const settled = queue.awaitBackground();
        queue.cancel();
        const nextTerrain = deferred();
        const next = queue.run({ terrain: () => nextTerrain.promise });
        const cancelled = await settled;
        expect(cancelled.generation).toBe(first.generation);
        expect(cancelled.status).toBe("cancelled");
        expect(cancelled.timings.background?.status).toBe("cancelled");
        expect(queue.snapshot.generation).toBe(first.generation + 1);
        work.resolve(); await flush();
        expect(queue.snapshot.stage).toBe("terrain");
        expect(queue.snapshot.status).toBe("running");
        nextTerrain.resolve(); await next;
    });
});
