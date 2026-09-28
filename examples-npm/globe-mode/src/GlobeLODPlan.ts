export const MIN_GLOBE_BUILDING_ZOOM = 10;

/** Overlapping tiers avoid a single large jump from street imagery to the horizon.
 * Google mode gives the full 15-mile disk z12 regional imagery and terrain;
 * lower mesh precision offsets the additional regional raster tiles.
 */
export function globeLODPlan(detailZoom: number, detailed15MileRadius = false) {
    return [
        { zoom: Math.max(3, Math.min(8, detailZoom - 5)), size: 8, precision: 16, group: 1 },
        { zoom: Math.max(3, Math.min(detailed15MileRadius ? 12 : 10, detailZoom - 4)),
            size: detailed15MileRadius ? 10 : 8, precision: detailed15MileRadius ? 32 : 64, group: 2 },
        { zoom: Math.max(3, Math.min(14, detailZoom - 3)), size: 16, precision: 16, group: 3 },
        { zoom: Math.max(3, Math.min(16, detailZoom - 2)), size: 24, precision: 16, group: 4 },
        { zoom: Math.max(3, detailZoom - 1), size: 12, precision: 32, group: 5 },
    ];
}
