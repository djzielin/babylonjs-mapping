export type MappingDebugLogger = (...values: unknown[]) => void;
/** Opt into map diagnostics; normal rendering performs no logging or message formatting. */
export declare function setMappingDebugLogger(sink?: MappingDebugLogger): void;
export declare function debugLog(values: () => unknown[]): void;
