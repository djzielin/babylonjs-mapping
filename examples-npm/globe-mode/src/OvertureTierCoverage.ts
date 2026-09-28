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
        for (const fine of this.byId.get(coarse.id) ?? []) {
            const width = Math.max(0, Math.min(coarse.east, fine.east) - Math.max(coarse.west, fine.west));
            const height = Math.max(0, Math.min(coarse.north, fine.north) - Math.max(coarse.south, fine.south));
            // A partial replacement must not remove the rest of a building.
            if (width * height >= area * 0.7) return true;
        }
        return false;
    }
}
