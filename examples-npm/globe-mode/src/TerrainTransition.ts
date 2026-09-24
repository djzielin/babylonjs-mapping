import { Constants } from "@babylonjs/core/Engines/constants";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { GlobeSet } from "babylonjs-mapping";

type Retained = { mesh: Mesh; material: StandardMaterial; coordinate: Vector3 };

/** Keep one previous zoom per tier while replacement imagery streams. */
export class TerrainTransition {
    private previous = new Map<GlobeSet, Retained[]>();
    private nextCheck = 0;
    public capture(globe: GlobeSet, nextZoom: number, latitude?: number, longitude?: number): void {
        if (globe.zoom < 8) return;
        const nextCorner = latitude === undefined || longitude === undefined ? undefined : {
            x: globe.ourTileMath.lon_to_tile(longitude, nextZoom) - Math.floor(globe.numTiles.x / 2),
            y: globe.ourTileMath.lat_to_tile(latitude, nextZoom) + Math.floor(globe.numTiles.y / 2),
        };
        const currentCorner = globe.ourTiles[0]?.tileCoords;
        if (globe.zoom === nextZoom && (!nextCorner || !currentCorner
            || (currentCorner.x === nextCorner.x && currentCorner.y === nextCorner.y))) return;
        const retained: Retained[] = this.previous.get(globe) ?? [];
        const retainedCoordinates = new Set(retained.map(old => old.coordinate.toString()));
        for (const tile of globe.ourTiles) {
            if (globe.zoom === nextZoom && nextCorner
                && tile.tileCoords.x >= nextCorner.x && tile.tileCoords.x < nextCorner.x + globe.numTiles.x
                && tile.tileCoords.y <= nextCorner.y && tile.tileCoords.y > nextCorner.y - globe.numTiles.y) continue;
            const coordinateKey = tile.tileCoords.toString();
            if (retainedCoordinates.has(coordinateKey)) continue;
            const source = tile.mesh;
            const original = source.material as StandardMaterial;
            if (!tile.terrainLoaded || !original?.diffuseTexture?.isReady()) continue;
            // The clone has never been drawn, so its setters have no existing
            // draw wrappers to invalidate. Babylon otherwise scans every mesh
            // in the scene for each copied material property.
            const scene = globe.scene as typeof globe.scene & { _forceBlockMaterialDirtyMechanism(value: boolean): void };
            const wasBlocked = scene.blockMaterialDirtyMechanism;
            scene._forceBlockMaterialDirtyMechanism(true);
            let material: StandardMaterial;
            try { material = original.clone("previous terrain"); }
            finally { scene._forceBlockMaterialDirtyMechanism(wasBlocked); }
            // Current terrain draws first. Older data fills only uncovered pixels.
            material.stencil.func = Constants.GREATER;
            const mesh = source.clone("previous terrain", null, true)!;
            mesh.makeGeometryUnique();
            mesh.material = material;
            mesh.visibility = 1;
            mesh.isVisible = true;
            mesh.setEnabled(true);
            mesh.isPickable = false;
            mesh.freezeWorldMatrix(source.computeWorldMatrix(true).clone());
            // freeze() does another whole-scene markDirty scan. A fresh clone
            // has no cached ready state, so setting its frozen flag is enough.
            material.checkReadyOnlyOnce = true;
            retained.push({ mesh, material, coordinate: tile.tileCoords.clone() });
            retainedCoordinates.add(coordinateKey);
        }
        while (retained.length > globe.ourTiles.length * 2) this.release(retained.shift()!);
        if (retained.length) this.previous.set(globe, retained);
    }
    public update(now: number): void {
        if (now < this.nextCheck) return;
        this.nextCheck = now + 250;
        for (const [globe, retained] of this.previous) {
            let west = Infinity, east = -Infinity, north = Infinity, south = -Infinity;
            for (const tile of globe.ourTiles) {
                west = Math.min(west, tile.tileCoords.x);
                east = Math.max(east, tile.tileCoords.x);
                north = Math.min(north, tile.tileCoords.y);
                south = Math.max(south, tile.tileCoords.y);
            }
            const ready = retained.filter(old => {
                const factor = 2 ** (globe.zoom - old.coordinate.z);
                const x0 = Math.floor(old.coordinate.x * factor);
                const y0 = Math.floor(old.coordinate.y * factor);
                const x1 = Math.ceil((old.coordinate.x + 1) * factor) - 1;
                const y1 = Math.ceil((old.coordinate.y + 1) * factor) - 1;
                const overlapsWindow = x0 <= east && x1 >= west && y0 <= south && y1 >= north;
                if (!overlapsWindow) {
                    if (!globe.scene.frustumPlanes || old.mesh.isInFrustum(globe.scene.frustumPlanes)) return true;
                    this.release(old); return false;
                }
                let covered = true;
                // A large zoom jump cannot have a fully loaded replacement in this window.
                if ((x1 - x0 + 1) * (y1 - y0 + 1) > globe.ourTiles.length) return true;
                for (let y = y0; y <= y1 && covered; y++) for (let x = x0; x <= x1; x++) {
                    const tile = globe.ourTilesMap.get(new Vector3(x, y, globe.zoom).toString());
                    if (!tile?.terrainLoaded || !(tile.mesh.material as StandardMaterial)?.diffuseTexture?.isReady()) { covered = false; break; }
                }
                if (!covered) return true;
                this.release(old); return false;
            });
            if (ready.length) this.previous.set(globe, ready); else this.previous.delete(globe);
        }
    }
    private release(old: Retained): void {
        old.mesh.dispose(); old.material.dispose(false, true);
    }
    public dispose(): void {
        for (const retained of this.previous.values()) retained.forEach(old => this.release(old));
        this.previous.clear();
    }
}
