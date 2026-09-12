let logger;
/** Opt into map diagnostics; normal rendering performs no logging or message formatting. */
export function setMappingDebugLogger(sink) {
    logger = sink;
}
export function debugLog(values) {
    if (logger)
        logger(...values());
}
//# sourceMappingURL=Diagnostics.js.map