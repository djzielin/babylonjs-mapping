export type OvertureFootprint = {
    id?: string;
    south: number;
    west: number;
    north: number;
    east: number;
};

/** Match prepared finer geometry before hiding a coarse Overture footprint. */
export class OvertureTierCoverage {
    private byId = new Map<string, OvertureFootprint[]>();

    public add(footprint: OvertureFootprint): void {
        if (!footprint.id) return;
        const matches = this.byId.get(footprint.id) ?? [];
        matches.push(footprint);
        this.byId.set(footprint.id, matches);
    }

    public covers(coarse?: OvertureFootprint): boolean {
        if (!coarse?.id) return false;
        const area = (coarse.east - coarse.west) * (coarse.north - coarse.south);
        if (area <= 0) return false;
        // Retire the coarse copy only when the matching fine footprint is
        // essentially complete; a 70% threshold left visible building holes.
        const threshold = area * 0.98;
        const clipped: Array<{ west: number; east: number; south: number; north: number }> = [];
        for (const fine of this.byId.get(coarse.id) ?? []) {
            const west = Math.max(coarse.west, fine.west), east = Math.min(coarse.east, fine.east);
            const south = Math.max(coarse.south, fine.south), north = Math.min(coarse.north, fine.north);
            const width = Math.max(0, east - west), height = Math.max(0, north - south);
            // A partial replacement must not remove the rest of a building.
            if (width * height >= threshold) return true;
            if (width && height) clipped.push({ west, east, south, north });
        }
        if (clipped.length < 2) return false;
        // Fine vector tiles can split one building into several footprints.
        // Sum their union, not their raw areas, so duplicate overlap cannot
        // make a partly replaced coarse building disappear.
        const edges = [...new Set(clipped.flatMap(rect => [rect.west, rect.east]))].sort((a, b) => a - b);
        let covered = 0;
        for (let i = 1; i < edges.length; i++) {
            const west = edges[i - 1], east = edges[i];
            const spans = clipped.filter(rect => rect.west <= west && rect.east >= east)
                .map(rect => [rect.south, rect.north] as const).sort((a, b) => a[0] - b[0]);
            let south = -Infinity, north = -Infinity;
            for (const [start, end] of spans) {
                if (start > north) {
                    if (north > south) covered += (east - west) * (north - south);
                    south = start; north = end;
                } else north = Math.max(north, end);
            }
            if (north > south) covered += (east - west) * (north - south);
            if (covered >= threshold) return true;
        }
        return false;
    }
}
