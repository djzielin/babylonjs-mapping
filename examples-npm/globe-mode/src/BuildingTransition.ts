import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Material } from "@babylonjs/core/Materials/material";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { GlobeSet } from "babylonjs-mapping";
import { OvertureTierCoverage } from "./OvertureTierCoverage";

type BuildingRange = { id?: string; latitude: number; longitude: number; south: number; west: number; north: number; east: number; start: number; end: number };
type Coverage = { ranges: BuildingRange[]; indices: Uint32Array };
type Retained = { mesh: Mesh; coordinate: Vector3; source: object; coverage?: Coverage; mask?: Uint8Array; ownGeometry?: boolean };

/** Keep the old building tier visible until the replacement tiles finish. */
export class BuildingTransition {
    private previous = new Map<GlobeSet, Retained[]>();
    private fallbackMaterials = new Map<Material, { material: Material; users: number }>();
    private nextCheck = 0;
    private enabled = true;

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) this.dispose();
    }

    public *retainedFootprints(globe: GlobeSet): Generator<BuildingRange> {
        for (const old of this.previous.get(globe) ?? []) {
            if (old.mesh.isDisposed() || !old.mesh.isEnabled() || !old.mesh.isVisible || !old.coverage) continue;
            for (const [index, range] of old.coverage.ranges.entries())
                if (!old.mask || old.mask[index]) yield range;
        }
    }

    public capture(globe: GlobeSet, nextZoom: number, latitude?: number, longitude?: number, force = false): void {
        if (!this.enabled || globe.zoom < 10) return;
        const nextCorner = latitude === undefined || longitude === undefined ? undefined : {
            x: globe.ourTileMath.lon_to_tile(longitude, nextZoom) - Math.floor(globe.numTiles.x / 2),
            y: globe.ourTileMath.lat_to_tile(latitude, nextZoom) + Math.floor(globe.numTiles.y / 2),
        };
        const currentCorner = globe.ourTiles[0]?.tileCoords;
        if (!force && globe.zoom === nextZoom && (!nextCorner || !currentCorner
            || (currentCorner.x === nextCorner.x && currentCorner.y === nextCorner.y))) return;
        const retained = this.previous.get(globe) ?? [];
        const retainedSources = new Set(retained.map(old => old.source));
        for (const tile of globe.ourTiles) {
            if (!force && globe.zoom === nextZoom && nextCorner
                && tile.tileCoords.x >= nextCorner.x && tile.tileCoords.x < nextCorner.x + globe.numTiles.x
                && tile.tileCoords.y <= nextCorner.y && tile.tileCoords.y > nextCorner.y - globe.numTiles.y) continue;
            if (!tile.buildingBatches.length && !tile.mergedBuildingMesh) continue;
            const sources = [...tile.buildingBatches, tile.mergedBuildingMesh].filter((mesh): mesh is Mesh =>
                !!mesh && !mesh.isDisposed() && mesh.isEnabled() && mesh.isVisible
                && (!globe.scene.frustumPlanes || mesh.isInFrustum(globe.scene.frustumPlanes)));
            for (const source of sources) {
                if (retainedSources.has(source)) continue;
                const world = source.computeWorldMatrix(true).clone();
                const mesh = source.clone("previous building detail", null, true)!;
                // Babylon keeps the source parent when clone() receives null.
                // Recycling that tile would disable this supposedly retained
                // building before a finer replacement is ready.
                mesh.setParent(null);
                mesh.setEnabled(true);
                mesh.isPickable = false;
                mesh.freezeWorldMatrix(world);
                // New Google and Overture geometry draws first. The fallback
                // fills only pixels their level-7 stencil has not claimed, so
                // partial finer buildings do not z-fight with the old batch.
                const sourceMaterial = source.material ?? globe.scene.defaultMaterial;
                let fallback = this.fallbackMaterials.get(sourceMaterial);
                if (!fallback) {
                    const material = sourceMaterial.clone("retained building material");
                    if (material) {
                        material.stencil.enabled = true;
                        material.stencil.func = Constants.GREATER;
                        material.stencil.funcRef = 8;
                        material.stencil.opStencilDepthPass = Constants.REPLACE;
                        fallback = { material, users: 0 };
                        this.fallbackMaterials.set(sourceMaterial, fallback);
                    }
                }
                if (fallback) {
                    fallback.users++;
                    mesh.material = fallback.material;
                    const shared = fallback;
                    mesh.onDisposeObservable.addOnce(() => {
                        if (--shared.users === 0) {
                            this.fallbackMaterials.delete(sourceMaterial);
                            shared.material.dispose();
                        }
                    });
                }
                mesh.renderingGroupId = Math.min(8, source.renderingGroupId + 1);
                const coverage = (source.metadata as { overtureCoverage?: Coverage } | null)?.overtureCoverage;
                // Most outgoing batches still draw every building. Preserve
                // their shared geometry until coverage actually changes.
                const mask = coverage && source.getIndices()?.length === coverage.indices.length
                    ? new Uint8Array(coverage.ranges.length).fill(1) : undefined;
                retained.push({ mesh, coordinate: tile.tileCoords.clone(), source, coverage, mask });
                retainedSources.add(source);
            }
        }
        // A fast move can leave more than two windows of ready detail in view.
        // update() releases each fallback after replacement or frustum exit.
        if (retained.length) this.previous.set(globe, retained);
        this.nextCheck = 0;
    }

    public update(now: number, googleCovers?: (latitude: number, longitude: number,
        bounds?: { south: number; west: number; north: number; east: number }) => boolean, force = false): void {
        if (!force && now < this.nextCheck) return;
        this.nextCheck = now + 200;
        for (const [globe, retained] of this.previous) {
            const tiles = globe.ourTiles;
            const west = Math.min(...tiles.map(tile => tile.tileCoords.x));
            const east = Math.max(...tiles.map(tile => tile.tileCoords.x));
            const north = Math.min(...tiles.map(tile => tile.tileCoords.y));
            const south = Math.max(...tiles.map(tile => tile.tileCoords.y));
            const at = (x: number, y: number) => globe.ourTilesMap.get(new Vector3(x, y, globe.zoom).toString());
            const finerCoverageByOverlap = new Map<string, OvertureTierCoverage>();
            const current = retained.filter(old => {
                if (!old.coverage && googleCovers) {
                    const box = old.mesh.getBoundingInfo().boundingBox;
                    // A legacy merged mesh has no per-building ranges to mask.
                    // Keep it while Google covers only part of its footprint;
                    // otherwise the uncovered buildings disappear with it.
                    if ([box.centerWorld, ...box.vectorsWorld].every(vertex => {
                        if (!Number.isFinite(vertex.lengthSquared()) || vertex.lengthSquared() === 0) return false;
                        const point = globe.getSurfaceCoordinates(vertex);
                        return googleCovers(point.latitude, point.longitude);
                    })) {
                        old.mesh.dispose();
                        return false;
                    }
                }
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
                if (old.coverage) {
                    let finer: OvertureTierCoverage | undefined;
                    if (globe.zoom >= old.coordinate.z) {
                        const key = overlap.map(tile => tile.tileCoords.toString()).join(";");
                        finer = finerCoverageByOverlap.get(key);
                        if (!finer) {
                            finer = new OvertureTierCoverage();
                            for (const tile of overlap) {
                                if (tile.buildingsResolvedKey !== tile.tileCoords.toString()) continue;
                                for (const mesh of tile.buildingBatches) {
                                    if (mesh.isDisposed() || !mesh.isEnabled() || !mesh.isVisible || !mesh.getIndices()?.length) continue;
                                    const coverage = (mesh.metadata as { overtureCoverage?: Coverage } | null)?.overtureCoverage;
                                    for (const range of coverage?.ranges ?? []) finer.add(range);
                                }
                            }
                            finerCoverageByOverlap.set(key, finer);
                        }
                    }
                    const { ranges, indices } = old.coverage;
                    const mask = Uint8Array.from(ranges, range => Number(
                        !googleCovers?.(range.latitude, range.longitude, range) && !finer?.covers(range)));
                    const visibleCount = ranges.reduce((count, range, index) => count + (mask[index] ? range.end - range.start : 0), 0);
                    if (!visibleCount) { old.mesh.dispose(); return false; }
                    if (!old.mask || old.mask.length !== mask.length || mask.some((value, index) => value !== old.mask![index])) {
                        if (!old.ownGeometry) { old.mesh.makeGeometryUnique(); old.ownGeometry = true; }
                        const visibleIndices = new Uint32Array(visibleCount);
                        let offset = 0;
                        for (let i = 0; i < ranges.length; i++) if (mask[i]) {
                            const range = ranges[i];
                            visibleIndices.set(indices.subarray(range.start, range.end), offset);
                            offset += range.end - range.start;
                        }
                        old.mesh.setIndices(visibleIndices);
                        old.mask = mask;
                    }
                    if (!overlap.length && globe.scene.frustumPlanes && !old.mesh.isInFrustum(globe.scene.frustumPlanes)) {
                        old.mesh.dispose(); return false;
                    }
                    return true;
                }
                if (!overlap.length && (!globe.scene.frustumPlanes || old.mesh.isInFrustum(globe.scene.frustumPlanes))) return true;
                if (!overlap.length || overlap.every(tile => tile.buildingsResolvedKey === tile.tileCoords.toString()
                    && (tile.buildingBatches.length > 0 || tile.buildings.length > 0 || !!tile.mergedBuildingMesh))) {
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
