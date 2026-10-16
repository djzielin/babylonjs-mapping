/** Statuses by which a server asks clients to slow down. */
const SLOW_DOWN = new Set([429, 503]);
/**
 * Longest pause after a push-back. Per-minute quotas refill continuously:
 * a long pause leaves the map unloaded for nothing.
 */
const MAX_BACKOFF_MS = 15_000;
/** Push-backs further apart than this start the backoff afresh. */
const STRIKE_MEMORY_MS = 30_000;
/** Requests a new host gets before it has answered any: a refusing host costs only these. */
const INITIAL_LIMIT = 6;
/** Fewest concurrent requests a host is cut to: one at a time stalls a map for minutes. */
const MIN_LIMIT = 4;
/** Lowest fraction of its rate a host is cut to by push-backs. */
const MIN_RATE_SHARE = 1 / 8;
/** Seconds for a cut rate to climb back to the full rate, while requests succeed. */
const RATE_RECOVERY_SECONDS = 60;

interface HostState {
    inFlight: number;
    /** Concurrent requests allowed: halved when the server pushes back, regrown on success. */
    limit: number;
    /** No new requests before this time (performance.now()). */
    pausedUntil: number;
    /** Consecutive slow-down replies, for exponential backoff. */
    strikes: number;
    lastStrikeAt: number;
    /** Requests that may start now under the rate limit; refills continuously up to `burst`. */
    tokens: number;
    refilledAt: number;
    /** Requests a second at most, sustained: cut when the server pushes back, regrown as it answers. */
    rate: number;
    /** The rate it regrows to. */
    fullRate: number;
    /** Requests that may start at once after a quiet spell. */
    burst: number;
    /** Before the first push-back, each success adds a whole slot (TCP-style slow start). */
    slowStart: boolean;
    waiting: (() => void)[];
    timer?: ReturnType<typeof setTimeout>;
}

/**
 * Per-host (per API) politeness for tile requests. Requests to a host start
 * at most `ratePerSecond` a second, so a map loads steadily within an API's
 * per-minute quota instead of spending it in a burst. A 429 or 503 pauses
 * every request to that host for the server's Retry-After, or an exponential
 * backoff with jitter (up to 15 s) when it gives none, and halves the host's
 * concurrency. A host starts with a few concurrent requests, doubling while
 * they succeed, then grows additively after its first push-back. Requests
 * wait their turn instead of failing.
 */
export class HostThrottle {
    private readonly hosts = new Map<string, HostState>();

    public constructor(public readonly maxPerHost = 64, public readonly ratePerSecond = 100) {}

    /** Wait for a slot to request `url`. Rejects with an AbortError if `signal` aborts first. */
    public async acquire(url: string, signal?: AbortSignal): Promise<string> {
        const host = hostOf(url);
        const state = this.state(host);
        while (!this.ready(state)) {
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
        state.tokens--;
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
            const now = performance.now();
            if (now - state.lastStrikeAt > STRIKE_MEMORY_MS) state.strikes = 0;
            state.strikes++;
            state.lastStrikeAt = now;
            state.slowStart = false;
            state.limit = Math.max(Math.min(MIN_LIMIT, this.maxPerHost), state.limit / 2);
            // A shared quota is full: this client takes a smaller share, and
            // gives up what it had saved, rather than pushing on in bursts.
            state.rate = Math.max(state.fullRate * MIN_RATE_SHARE, state.rate / 2);
            state.tokens = Math.min(state.tokens, 0);
            const backoff = retry
                ?? Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (state.strikes - 1) * (0.75 + Math.random() * 0.5));
            state.pausedUntil = Math.max(state.pausedUntil, performance.now() + backoff);
        } else if (status === undefined || status < 400) {
            state.strikes = 0;
            state.limit = Math.min(this.maxPerHost, state.limit + (state.slowStart ? 1 : 1 / state.limit));
        }
        this.arm(state);
    }

    /**
     * Limits requests to `url`'s host to `perSecond` sustained (an API's own
     * quota, or a share of it), in place of the default rate, with up to
     * `burst` at once after a quiet spell: a per-minute quota allows a view
     * to load in a rush, then idle.
     */
    public setRate(url: string, perSecond: number, burst = perSecond): void {
        const state = this.state(hostOf(url));
        state.fullRate = state.rate = Math.max(1, perSecond);
        state.burst = Math.max(1, burst);
        state.tokens = Math.min(state.tokens, state.burst);
    }

    /** Milliseconds until `url`'s host accepts requests again; 0 if it does now. */
    public pausedFor(url: string): number {
        const state = this.hosts.get(hostOf(url));
        return state ? Math.max(0, state.pausedUntil - performance.now()) : 0;
    }

    private state(host: string): HostState {
        let state = this.hosts.get(host);
        if (!state) this.hosts.set(host, state = {
            inFlight: 0, limit: Math.min(INITIAL_LIMIT, this.maxPerHost), pausedUntil: 0, strikes: 0, lastStrikeAt: -Infinity,
            tokens: Math.min(INITIAL_LIMIT, this.ratePerSecond), refilledAt: performance.now(),
            rate: this.ratePerSecond, fullRate: this.ratePerSecond, burst: this.ratePerSecond, slowStart: true, waiting: [],
        });
        return state;
    }

    private refill(state: HostState, now: number): void {
        const seconds = (now - state.refilledAt) / 1000;
        // Unrefused for a while, a cut rate regrows.
        if (state.rate < state.fullRate && now - state.lastStrikeAt > 1000) {
            state.rate = Math.min(state.fullRate, state.rate + state.fullRate * seconds / RATE_RECOVERY_SECONDS);
        }
        state.tokens = Math.min(state.burst, state.tokens + seconds * state.rate);
        state.refilledAt = now;
    }

    private ready(state: HostState): boolean {
        const now = performance.now();
        this.refill(state, now);
        return state.inFlight < Math.floor(state.limit) && now >= state.pausedUntil && state.tokens >= 1;
    }

    /** Wake waiters now if a slot and the rate allow, or when the pause or the next token comes. */
    private arm(state: HostState): void {
        const now = performance.now();
        this.refill(state, now);
        const wait = Math.max(state.pausedUntil - now, state.tokens < 1 ? (1 - state.tokens) / state.rate * 1000 : 0);
        if (wait > 0) {
            if (!state.timer) state.timer = setTimeout(() => { state.timer = undefined; this.arm(state); }, wait);
            return;
        }
        let free = Math.min(Math.floor(state.limit) - state.inFlight, Math.floor(state.tokens));
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
