/** Shared flat Google tile loading policy for the standalone and WebXR demos. */
export function googleTilesOptions(apiKey: string, targetDepth: number) {
    return {
        apiKey,
        maxDepth: Math.min(18, targetDepth),
        maxTiles: 512,
        // Keep overview coverage until every replacement sibling has loaded.
        maximumScreenSpaceError: 16,
    };
}
