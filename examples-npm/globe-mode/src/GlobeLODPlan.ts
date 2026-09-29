export const MIN_GLOBE_BUILDING_ZOOM = 10;

/** Overlapping tiers avoid a single large jump from street imagery to the horizon.
 * At street zoom, Google mode gives the moving 15-mile disk z13 imagery and
 * terrain, with equivalent ground-sample spacing to the former z12 grid.
 */
export function globeLODPlan(detailZoom: number, detailed15MileRadius = false) {
    const streetRegion = detailed15MileRadius && detailZoom >= 17;
    return [
        { zoom: Math.max(3, Math.min(8, detailZoom - 5)), size: 8, precision: 16, group: 1 },
        { zoom: Math.max(3, Math.min(streetRegion ? 13 : detailed15MileRadius ? 12 : 10,
            detailZoom - (streetRegion ? 3 : 4))),
            size: streetRegion ? 18 : detailed15MileRadius ? 10 : 8,
            precision: streetRegion ? 16 : detailed15MileRadius ? 32 : 64, group: 2 },
        { zoom: Math.max(3, Math.min(14, detailZoom - 3)), size: 16, precision: 16, group: 3 },
        { zoom: Math.max(3, Math.min(16, detailZoom - 2)), size: 24, precision: 16, group: 4 },
        { zoom: Math.max(3, detailZoom - 1), size: 12, precision: 32, group: 5 },
    ];
}
