import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostThrottle } from "../src/shared/HostThrottle";

const URL_A = "https://tile.example.com/v1/3dtiles/a.glb";

describe("HostThrottle", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    /** Starts `count` requests in turn, each released as soon as it starts; resolves with when each started. */
    async function run(throttle: HostThrottle, count: number, status?: number): Promise<number[]> {
        const started: number[] = [];
        const all = Array.from({ length: count }, () => throttle.acquire(URL_A).then(host => {
            started.push(performance.now());
            throttle.release(host, status);
        }));
        await vi.runAllTimersAsync();
        await Promise.all(all);
        return started;
    }

    it("starts requests no faster than its rate", async () => {
        const started = await run(new HostThrottle(64, 10), 36);
        // The first few at once, then ten a second.
        expect(started.length).toBe(36);
        expect(started[35] - started[0]).toBeGreaterThanOrEqual(2900);
        expect(started[35] - started[0]).toBeLessThan(3300);
    });

    it("never pauses a host for more than 15 seconds, however often it pushes back", async () => {
        const throttle = new HostThrottle(64, 1000);
        for (let strike = 0; strike < 12; strike++) {
            const host = await throttle.acquire(URL_A);
            throttle.release(host, 429);
            expect(throttle.pausedFor(URL_A)).toBeLessThanOrEqual(15_001);
            await vi.advanceTimersByTimeAsync(throttle.pausedFor(URL_A) + 1);
        }
    });

    it("forgets push-backs long past", async () => {
        const throttle = new HostThrottle(64, 1000);
        for (let strike = 0; strike < 4; strike++) {
            const host = await throttle.acquire(URL_A);
            throttle.release(host, 429);
            await vi.advanceTimersByTimeAsync(throttle.pausedFor(URL_A) + 1);
        }
        await vi.advanceTimersByTimeAsync(60_000);
        const host = await throttle.acquire(URL_A);
        throttle.release(host, 429);
        // A first strike again: about a second, with jitter.
        expect(throttle.pausedFor(URL_A)).toBeLessThanOrEqual(1250);
    });

    it("keeps several requests in flight after push-backs", async () => {
        const throttle = new HostThrottle(64, 1000);
        for (let strike = 0; strike < 8; strike++) {
            const host = await throttle.acquire(URL_A);
            throttle.release(host, 429);
            await vi.advanceTimersByTimeAsync(throttle.pausedFor(URL_A) + 1);
        }
        let inFlight = 0, most = 0;
        const all = Array.from({ length: 12 }, () => throttle.acquire(URL_A).then(async host => {
            most = Math.max(most, ++inFlight);
            await new Promise(resolve => setTimeout(resolve, 500));
            inFlight--;
            throttle.release(host, 200);
        }));
        await vi.runAllTimersAsync();
        await Promise.all(all);
        expect(most).toBeGreaterThanOrEqual(4);
    });

    it("lets a burst start at once after a quiet spell, then holds the steady rate", async () => {
        const throttle = new HostThrottle(1000, 10);
        throttle.setRate(URL_A, 10, 200);
        await vi.advanceTimersByTimeAsync(30_000);
        const started = await run(throttle, 250);
        // The saved-up 200 at once (as concurrency grows), the other 50 at ten a second.
        expect(started.filter(t => t - started[0] < 1000).length).toBeGreaterThanOrEqual(190);
        expect(started[249] - started[0]).toBeGreaterThanOrEqual(4500);
        expect(started[249] - started[0]).toBeLessThan(6500);
    });

    it("takes a smaller share after a push-back, and regrows it", async () => {
        // The pause's jitter, fixed: a second.
        vi.spyOn(Math, "random").mockReturnValue(0.5);
        const throttle = new HostThrottle(64, 100);
        throttle.setRate(URL_A, 100, 100);
        const host = await throttle.acquire(URL_A);
        throttle.release(host, 429);
        await vi.advanceTimersByTimeAsync(throttle.pausedFor(URL_A) + 1);
        // Half the rate, and only what refilled during the pause saved up: 100 requests take about a second.
        let started = await run(throttle, 100);
        expect(started[99] - started[0]).toBeGreaterThan(700);
        // A minute without push-backs later, the full rate and burst are back.
        await vi.advanceTimersByTimeAsync(70_000);
        started = await run(throttle, 100);
        expect(started[99] - started[0]).toBeLessThan(500);
    });
});
