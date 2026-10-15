/** Statuses by which a server asks clients to slow down. */
const SLOW_DOWN = new Set([429, 503]);
const MAX_BACKOFF_MS = 120_000;
/** Requests a new host gets before it has answered any: a refusing host costs only these. */
const INITIAL_LIMIT = 6;

interface HostState {
    inFlight: number;
    /** Concurrent requests allowed: halved when the server pushes back, regrown on success. */
    limit: number;
    /** No new requests before this time (performance.now()). */
    pausedUntil: number;
    /** Consecutive slow-down replies, for exponential backoff. */
    strikes: number;
    /** Before the first push-back, each success adds a whole slot (TCP-style slow start). */
    slowStart: boolean;
    waiting: (() => void)[];
    timer?: ReturnType<typeof setTimeout>;
}

/**
 * Per-host (per API) politeness for tile requests. A 429 or 503 pauses every request
 * to that host for the server's Retry-After, or an exponential backoff with
 * jitter when it gives none, and halves the host's concurrency. A host
 * starts with a few concurrent requests, doubling while they succeed, then
 * grows additively after its first push-back. Requests wait their turn
 * instead of failing.
 */
export class HostThrottle {
    private readonly hosts = new Map<string, HostState>();

    public constructor(public readonly maxPerHost = 64) {}

    /** Wait for a slot to request `url`. Rejects with an AbortError if `signal` aborts first. */
    public async acquire(url: string, signal?: AbortSignal): Promise<string> {
        const host = hostOf(url);
        const state = this.state(host);
        while (state.inFlight >= Math.floor(state.limit) || performance.now() < state.pausedUntil) {
            await new Promise<void>((resolve, reject) => {
                const wake = () => { signal?.removeEventListener("abort", onAbort); resolve(); };
                const onAbort = () => {
                    const index = state.waiting.indexOf(wake);
                    if (index >= 0) state.waiting.splice(index, 1);
                    reject(new DOMException("Aborted", "AbortError"));
                    // A wake already delivered to this waiter passes to the next.
                    if (index < 0) this.arm(state);
                };
                signal?.addEventListener("abort", onAbort, { once: true });
                state.waiting.push(wake);
                this.arm(state);
            });
        }
        state.inFlight++;
        return host;
    }

    /** Report how the request ended. `retryAfter` is the response's Retry-After header, if readable. */
    public release(host: string, status?: number, retryAfter?: string | null): void {
        const state = this.state(host);
        state.inFlight--;
        if (status !== undefined && SLOW_DOWN.has(status)) {
            const retry = parseRetryAfter(retryAfter);
            // Requests already in flight when the server pushed back are
            // refused together: one burst is one strike, not one per reply.
            if (performance.now() < state.pausedUntil) {
                if (retry !== undefined) state.pausedUntil = Math.max(state.pausedUntil, performance.now() + retry);
                this.arm(state);
                return;
            }
            state.strikes++;
            state.slowStart = false;
            state.limit = Math.max(1, state.limit / 2);
            const backoff = retry
                ?? Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (state.strikes - 1)) * (0.75 + Math.random() * 0.5);
            state.pausedUntil = Math.max(state.pausedUntil, performance.now() + backoff);
        } else if (status === undefined || status < 400) {
            state.strikes = 0;
            state.limit = Math.min(this.maxPerHost, state.limit + (state.slowStart ? 1 : 1 / state.limit));
        }
        this.arm(state);
    }

    /** Milliseconds until `url`'s host accepts requests again; 0 if it does now. */
    public pausedFor(url: string): number {
        const state = this.hosts.get(hostOf(url));
        return state ? Math.max(0, state.pausedUntil - performance.now()) : 0;
    }

    private state(host: string): HostState {
        let state = this.hosts.get(host);
        if (!state) this.hosts.set(host, state = { inFlight: 0, limit: Math.min(INITIAL_LIMIT, this.maxPerHost), pausedUntil: 0, strikes: 0, slowStart: true, waiting: [] });
        return state;
    }

    /** Wake waiters now if a slot is free, or when the pause ends. */
    private arm(state: HostState): void {
        const wait = state.pausedUntil - performance.now();
        if (wait > 0) {
            if (!state.timer) state.timer = setTimeout(() => { state.timer = undefined; this.arm(state); }, wait);
            return;
        }
        let free = Math.floor(state.limit) - state.inFlight;
        while (free-- > 0 && state.waiting.length) state.waiting.shift()!();
    }
}

/**
 * The scope a server limits together: the host and the first two path
 * segments, so e.g. Google's 2D and 3D tile APIs, which have separate
 * quotas on one host, are throttled apart.
 */
function hostOf(url: string): string {
    try {
        const { host, pathname } = new URL(url, globalThis.location?.href);
        return host + pathname.split("/").slice(0, 3).join("/");
    } catch {
        return url;
    }
}

/** Retry-After as delay-seconds or an HTTP date, in milliseconds. */
export function parseRetryAfter(value?: string | null): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, 3_600_000));
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 3_600_000)) : undefined;
}
