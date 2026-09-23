import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { GlobeSet } from "babylonjs-mapping";

type Retained = { mesh: Mesh; coordinate: Vector3; source: object };

/** Keep the old building tier visible until the replacement tiles finish. */
export class BuildingTransition {
    private previous = new Map<GlobeSet, Retained[]>();
    private nextCheck = 0;

    public capture(globe: GlobeSet, nextZoom: number, latitude?: number, longitude?: number): void {
        if (globe.zoom < 10) return;
        const nextCorner = latitude === undefined || longitude === undefined ? undefined : {
            x: globe.ourTileMath.lon_to_tile(longitude, nextZoom) - Math.floor(globe.numTiles.x / 2),
            y: globe.ourTileMath.lat_to_tile(latitude, nextZoom) + Math.floor(globe.numTiles.y / 2),
        };
        const currentCorner = globe.ourTiles[0]?.tileCoords;
        if (globe.zoom === nextZoom && (!nextCorner || !currentCorner
            || (currentCorner.x === nextCorner.x && currentCorner.y === nextCorner.y))) return;
        const retained = this.previous.get(globe) ?? [];
        for (const tile of globe.ourTiles) {
            if (globe.zoom === nextZoom && nextCorner
                && tile.tileCoords.x >= nextCorner.x && tile.tileCoords.x < nextCorner.x + globe.numTiles.x
                && tile.tileCoords.y <= nextCorner.y && tile.tileCoords.y > nextCorner.y - globe.numTiles.y) continue;
            if (!tile.buildingBatches.length && !tile.mergedBuildingMesh) continue;
            const sources = [...tile.buildingBatches, tile.mergedBuildingMesh].filter((mesh): mesh is Mesh =>
                !!mesh && !mesh.isDisposed() && mesh.isEnabled() && mesh.isVisible
                && (!globe.scene.frustumPlanes || mesh.isInFrustum(globe.scene.frustumPlanes)));
            for (const source of sources) {
                if (retained.some(old => old.source === source)) continue;
                const mesh = source.clone("previous building detail", null, true)!;
                mesh.setEnabled(true);
                mesh.isPickable = false;
                mesh.freezeWorldMatrix(source.computeWorldMatrix(true).clone());
                retained.push({ mesh, coordinate: tile.tileCoords.clone(), source });
            }
        }
        while (retained.length > globe.ourTiles.length * 2) retained.shift()!.mesh.dispose();
        if (retained.length) this.previous.set(globe, retained);
        this.nextCheck = 0;
    }

    public update(now: number): void {
        if (now < this.nextCheck) return;
        this.nextCheck = now + 200;
        for (const [globe, retained] of this.previous) {
            const tiles = globe.ourTiles;
            const west = Math.min(...tiles.map(tile => tile.tileCoords.x));
            const east = Math.max(...tiles.map(tile => tile.tileCoords.x));
            const north = Math.min(...tiles.map(tile => tile.tileCoords.y));
            const south = Math.max(...tiles.map(tile => tile.tileCoords.y));
            const at = (x: number, y: number) => globe.ourTilesMap.get(new Vector3(x, y, globe.zoom).toString());
            const current = retained.filter(old => {
                const sameTile = globe.ourTilesMap.get(old.coordinate.toString());
                if (sameTile && (sameTile.buildingBatches.some(mesh => mesh === old.source)
                    || sameTile.mergedBuildingMesh === old.source)) {
                    old.mesh.dispose();
                    return false;
                }
                const overlap = [] as typeof tiles;
                if (old.coordinate.z >= globe.zoom) {
                    const factor = 2 ** (old.coordinate.z - globe.zoom);
                    const tile = at(Math.floor(old.coordinate.x / factor), Math.floor(old.coordinate.y / factor));
                    if (tile) overlap.push(tile);
                } else {
                    const factor = 2 ** (globe.zoom - old.coordinate.z);
                    const x0 = Math.max(west, old.coordinate.x * factor);
                    const x1 = Math.min(east, (old.coordinate.x + 1) * factor - 1);
                    const y0 = Math.max(north, old.coordinate.y * factor);
                    const y1 = Math.min(south, (old.coordinate.y + 1) * factor - 1);
                    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
                        const tile = at(x, y);
                        if (tile) overlap.push(tile);
                    }
                }
                if (!overlap.length && (!globe.scene.frustumPlanes || old.mesh.isInFrustum(globe.scene.frustumPlanes))) return true;
                if (!overlap.length || overlap.every(tile => tile.buildingsResolvedKey === tile.tileCoords.toString())) {
                    old.mesh.dispose();
                    return false;
                }
                return true;
            });
            if (current.length) this.previous.set(globe, current);
            else this.previous.delete(globe);
        }
    }

    public dispose(): void {
        for (const retained of this.previous.values()) retained.forEach(old => old.mesh.dispose());
        this.previous.clear();
    }
}
