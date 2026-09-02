/**
 * Resolve a file served relative to the current document.
 *
 * The default path remains compatible with the original `map_cache/` lookup,
 * while callers can place cached assets below any relative or absolute URL
 * prefix.
 */
export function getLocalResourceURL(
    localPathPrefix: string,
    fileName: string,
    locationHref = window.location.href,
): string {
    const pageURL = new URL(locationHref);
    pageURL.pathname = pageURL.pathname
        .replace(/\/[^/]*\.[^/]*$/, "")
        .replace(/\/$/, "") + "/";
    pageURL.search = "";
    pageURL.hash = "";

    const prefix = localPathPrefix.trim();
    const directory = prefix.length === 0
        ? ""
        : prefix.endsWith("/") ? prefix : `${prefix}/`;

    return new URL(directory + fileName.replace(/^\/+/, ""), pageURL).toString();
}
