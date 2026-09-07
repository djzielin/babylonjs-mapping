/** Overlapping tiers avoid a single large jump from street imagery to the horizon. */
export function globeLODPlan(detailZoom: number) {
    return [
        { zoom: Math.max(3, Math.min(8, detailZoom - 5)), size: 8, precision: 16, group: 1 },
        { zoom: Math.max(3, Math.min(11, detailZoom - 4)), size: 16, precision: 32, group: 2 },
        { zoom: Math.max(3, Math.min(13, detailZoom - 3)), size: 8, precision: 32, group: 3 },
        { zoom: Math.max(3, Math.min(15, detailZoom - 2)), size: 8, precision: 32, group: 4 },
        { zoom: Math.max(3, detailZoom - 1), size: 8, precision: 32, group: 5 },
    ];
}
