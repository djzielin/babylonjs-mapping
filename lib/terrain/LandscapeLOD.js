/** Shared Tokyo–Fuji landscape profile, scaled to a source tile's world width. */
export function landscapeTerrainLOD(meshPrecision, tileWorldWidth) {
    const levels = [[48, 1], [32, 2.5], [16, 8], [8, 11], [4, 14], [2, 16.5], [0, 19]];
    const selected = levels.filter(([precision]) => precision < meshPrecision);
    return { precisions: selected.map(([precision]) => precision), distances: selected.map(([, distance]) => distance * tileWorldWidth) };
}
//# sourceMappingURL=LandscapeLOD.js.map