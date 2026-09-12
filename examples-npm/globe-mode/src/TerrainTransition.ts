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
    public capture(globe: GlobeSet, nextZoom: number): void {
        if (globe.zoom < 8 || globe.zoom === nextZoom) return;
        const retained: Retained[] = this.previous.get(globe) ?? [];
        for (const tile of globe.ourTiles) {
            if (retained.some(old => old.coordinate.equals(tile.tileCoords))) continue;
            const source = tile.mesh;
            const original = source.material as StandardMaterial;
            if (!tile.terrainLoaded || !original?.diffuseTexture?.isReady()) continue;
            const material = original.clone("previous terrain");
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
            material.freeze();
            retained.push({ mesh, material, coordinate: tile.tileCoords.clone() });
        }
        while (retained.length > globe.ourTiles.length * 2) this.release(retained.shift()!);
        if (retained.length) this.previous.set(globe, retained);
    }
    public update(now: number): void {
        if (now < this.nextCheck) return;
        this.nextCheck = now + 250;
        for (const [globe, retained] of this.previous) {
            const ready = retained.filter(old => {
                const factor = 2 ** (globe.zoom - old.coordinate.z);
                const x0 = Math.floor(old.coordinate.x * factor);
                const y0 = Math.floor(old.coordinate.y * factor);
                const x1 = Math.ceil((old.coordinate.x + 1) * factor) - 1;
                const y1 = Math.ceil((old.coordinate.y + 1) * factor) - 1;
                const overlapsWindow = globe.ourTiles.some(tile => tile.tileCoords.x >= x0 && tile.tileCoords.x <= x1
                    && tile.tileCoords.y >= y0 && tile.tileCoords.y <= y1);
                if (!overlapsWindow) { this.release(old); return false; }
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
