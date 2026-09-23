import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { GlobeSet } from "babylonjs-mapping";

type Retained = { mesh: Mesh; coordinate: Vector3; source: object };

/** Keep the old building tier visible until the replacement tiles finish. */
export class BuildingTransition {
    private previous = new Map<GlobeSet, Retained[]>();
    private nextCheck = 0;

    public capture(globe: GlobeSet, nextZoom: number): void {
        if (globe.zoom < 10 || globe.zoom === nextZoom) return;
        const retained = this.previous.get(globe) ?? [];
        for (const tile of globe.ourTiles) {
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
        if (retained.length) this.previous.set(globe, retained);
        this.nextCheck = 0;
    }

    public update(now: number): void {
        if (now < this.nextCheck) return;
        this.nextCheck = now + 200;
        for (const [globe, retained] of this.previous) {
            const current = retained.filter(old => {
                const sameTile = globe.ourTilesMap.get(old.coordinate.toString());
                if (sameTile && (sameTile.buildingBatches.some(mesh => mesh === old.source)
                    || sameTile.mergedBuildingMesh === old.source)) {
                    old.mesh.dispose();
                    return false;
                }
                const overlap = globe.ourTiles.filter(tile => {
                    const zoom = Math.max(tile.tileCoords.z, old.coordinate.z);
                    const oldScale = 2 ** (zoom - old.coordinate.z);
                    const tileScale = 2 ** (zoom - tile.tileCoords.z);
                    return old.coordinate.x * oldScale < (tile.tileCoords.x + 1) * tileScale
                        && (old.coordinate.x + 1) * oldScale > tile.tileCoords.x * tileScale
                        && old.coordinate.y * oldScale < (tile.tileCoords.y + 1) * tileScale
                        && (old.coordinate.y + 1) * oldScale > tile.tileCoords.y * tileScale;
                });
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
