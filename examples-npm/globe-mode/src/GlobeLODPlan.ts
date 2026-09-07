/** Fixed mesh budgets; coverage grows by lowering source zoom, not adding close-up tiles. */
export function globeLODPlan(detailZoom: number) {
    return [
        { zoom: Math.max(3, Math.min(8, detailZoom - 6)), size: 8, precision: 16, group: 1 },
        { zoom: Math.max(3, Math.min(11, detailZoom - 3)), size: 16, precision: 32, group: 2 },
    ];
}
