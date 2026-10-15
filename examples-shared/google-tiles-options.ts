/**
 * Shared flat Google tile streaming policy for the standalone and WebXR demos.
 * `detail` is the old tree-depth setting (18 overview … 24 finest), now a
 * screen-space error target: each two levels halve it.
 */
export function googleTilesOptions(apiKey: string, detail: number) {
    return {
        apiKey,
        maximumScreenSpaceError: googleTilesError(detail),
        memoryBudgetMB: 768,
    };
}

export function googleTilesError(detail: number): number {
    return Math.max(4, 32 / 2 ** ((Math.min(24, Math.max(18, detail)) - 18) / 2));
}
