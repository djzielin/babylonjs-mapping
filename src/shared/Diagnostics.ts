export type MappingDebugLogger = (...values: unknown[]) => void;
let logger: MappingDebugLogger | undefined;

/** Opt into map diagnostics; normal rendering performs no logging or message formatting. */
export function setMappingDebugLogger(sink?: MappingDebugLogger): void {
    logger = sink;
}

export function debugLog(values: () => unknown[]): void {
    if (logger) logger(...values());
}
