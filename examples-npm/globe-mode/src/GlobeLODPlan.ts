export const MIN_GLOBE_BUILDING_ZOOM = 10;

/** Overlapping tiers avoid a single large jump from street imagery to the horizon. */
export function globeLODPlan(detailZoom: number) {
    return [
        { zoom: Math.max(3, Math.min(8, detailZoom - 5)), size: 8, precision: 16, group: 1 },
        { zoom: Math.max(3, Math.min(10, detailZoom - 4)), size: 8, precision: 64, group: 2 },
        { zoom: Math.max(3, Math.min(14, detailZoom - 3)), size: 16, precision: 16, group: 3 },
        { zoom: Math.max(3, Math.min(16, detailZoom - 2)), size: 24, precision: 16, group: 4 },
        { zoom: Math.max(3, detailZoom - 1), size: 12, precision: 32, group: 5 },
    ];
}
