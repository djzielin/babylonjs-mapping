/**
 * Resolve a file served relative to the current document.
 *
 * The default path remains compatible with the original `map_cache/` lookup,
 * while callers can place cached assets below any relative or absolute URL
 * prefix.
 */
export declare function getLocalResourceURL(localPathPrefix: string, fileName: string, locationHref?: string): string;
