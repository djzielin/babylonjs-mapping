import type { Google3DTilesOptions } from "babylonjs-mapping";

export function googleTilesOptions(apiKey: string, targetDepth: number): Google3DTilesOptions {
    return {
        apiKey,
        maxDepth: Math.min(18, targetDepth),
        maxTiles: 512,
        // Use the complete frontier so the overview remains visible until all
        // replacement siblings load, including when one detail request fails.
        maximumScreenSpaceError: 16,
    };
}
