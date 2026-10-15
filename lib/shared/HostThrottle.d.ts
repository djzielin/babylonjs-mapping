/**
 * Per-host (per API) politeness for tile requests. A 429 or 503 pauses every request
 * to that host for the server's Retry-After, or an exponential backoff with
 * jitter when it gives none, and halves the host's concurrency. A host
 * starts with a few concurrent requests, doubling while they succeed, then
 * grows additively after its first push-back. Requests wait their turn
 * instead of failing.
 */
export declare class HostThrottle {
    readonly maxPerHost: number;
    private readonly hosts;
    constructor(maxPerHost?: number);
    /** Wait for a slot to request `url`. Rejects with an AbortError if `signal` aborts first. */
    acquire(url: string, signal?: AbortSignal): Promise<string>;
    /** Report how the request ended. `retryAfter` is the response's Retry-After header, if readable. */
    release(host: string, status?: number, retryAfter?: string | null): void;
    /** Milliseconds until `url`'s host accepts requests again; 0 if it does now. */
    pausedFor(url: string): number;
    private state;
    /** Wake waiters now if a slot is free, or when the pause ends. */
    private arm;
}
/** Retry-After as delay-seconds or an HTTP date, in milliseconds. */
export declare function parseRetryAfter(value?: string | null): number | undefined;
