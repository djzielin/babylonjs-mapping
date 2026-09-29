import { Constants } from "@babylonjs/core/Engines/constants";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { GlobeSet } from "babylonjs-mapping";

type Retained = { mesh: Mesh; material: StandardMaterial; coordinate: Vector3 };

/** Keep one previous zoom per tier while replacement imagery streams. */
export class TerrainTransition {
    public maxCaptureMs = 0;
    private previous = new Map<GlobeSet, Retained[]>();
    private nextCheck = 0;
    public capture(globe: GlobeSet, nextZoom: number, latitude?: number, longitude?: number, force = false): void {
        const started = performance.now();
        if (globe.zoom < 8) return;
        const nextCorner = latitude === undefined || longitude === undefined ? undefined : {
            x: globe.ourTileMath.lon_to_tile(longitude, nextZoom) - Math.floor(globe.numTiles.x / 2),
            y: globe.ourTileMath.lat_to_tile(latitude, nextZoom) + Math.floor(globe.numTiles.y / 2),
        };
        const currentCorner = globe.ourTiles[0]?.tileCoords;
        if (!force && globe.zoom === nextZoom && (!nextCorner || !currentCorner
            || (currentCorner.x === nextCorner.x && currentCorner.y === nextCorner.y))) return;
        const retained: Retained[] = this.previous.get(globe) ?? [];
        const retainedByCoordinate = new Map(retained.map(old => [old.coordinate.toString(), old]));
        for (const tile of globe.ourTiles) {
            if (!force && globe.zoom === nextZoom && nextCorner
                && tile.tileCoords.x >= nextCorner.x && tile.tileCoords.x < nextCorner.x + globe.numTiles.x
                && tile.tileCoords.y <= nextCorner.y && tile.tileCoords.y > nextCorner.y - globe.numTiles.y) continue;
            const coordinateKey = tile.tileCoords.toString();
            const source = tile.mesh;
            const original = source.material as StandardMaterial;
            // Retain only an already renderable surface. In terrain mode a
            // texture may be ready while its flat patch still waits for DEM.
            if (!source.isEnabled() || !source.isVisible || source.visibility <= 0
                || !globe.isTileDisplayReady(tile) || !original?.diffuseTexture?.isReady()) continue;
            const older = retainedByCoordinate.get(coordinateKey);
            if (older?.material === original) continue;
            // Transfer the ready material and texture to the fallback. The
            // recycled tile gets a fresh material in updateRaster().
            const material = original;
            // Current terrain draws first. Older data fills only uncovered pixels.
            material.stencil.func = Constants.GREATER;
            const mesh = source.clone("previous terrain", null, true)!;
            // The fallback keeps the old geometry. Detach the recycled tile
            // instead of copying its vertex and index buffers for every move.
            // A style change keeps the same tile coordinates and geometry
            // readiness key. Share the geometry with the clone in that case;
            // detaching it would leave the replacement marked ready but empty.
            if (!force) source.geometry?.releaseForMesh(source);
            tile.material = undefined;
            mesh.material = material;
            // A replacement terrain batch is created after this fallback. If
            // both use the same rendering group, the fallback can claim the
            // stencil first and hide ready replacement tiles. Draw fallbacks
            // in the following (coarser) group, after all current tiles and
            // batches at this tier have had a chance to claim their pixels.
            mesh.renderingGroupId = Math.min(8, source.renderingGroupId + 1);
            mesh.visibility = 1;
            mesh.isVisible = true;
            mesh.setEnabled(true);
            mesh.isPickable = false;
            mesh.freezeWorldMatrix(source.computeWorldMatrix(true).clone());
            // freeze() does another whole-scene markDirty scan. A fresh clone
            // has no cached ready state, so setting its frozen flag is enough.
            material.checkReadyOnlyOnce = true;
            // A second style change can arrive before update() retires the
            // first fallback. The newer drawable image owns this coordinate.
            if (older) {
                retained.splice(retained.indexOf(older), 1);
                this.release(older);
            }
            const snapshot = { mesh, material, coordinate: tile.tileCoords.clone() };
            retained.push(snapshot);
            retainedByCoordinate.set(coordinateKey, snapshot);
        }
        // Movement may expose several previously visited patches before their
        // replacements finish loading. update() retires a patch only after it
        // is covered or leaves the view; a count cap can create a visible hole.
        if (retained.length) this.previous.set(globe, retained);
        this.maxCaptureMs = Math.max(this.maxCaptureMs, performance.now() - started);
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
                    if (!tile || !globe.isTileDisplayReady(tile) || !tile.mesh.isEnabled() || !tile.mesh.isVisible
                        || tile.mesh.visibility <= 0
                        || !(tile.mesh.material as StandardMaterial)?.diffuseTexture?.isReady()) { covered = false; break; }
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
