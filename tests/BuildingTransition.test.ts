import { describe, expect, it, vi } from "vitest";
import { Constants, MeshBuilder, NullEngine, Scene, Vector2 } from "@babylonjs/core";
import GlobeSet from "../src/core/GlobeSet";
import GlobeDataController from "../src/core/GlobeDataController";
import { BuildingTransition } from "../examples-npm/globe-mode/src/BuildingTransition";

vi.mock("../src/core/Attribution", () => ({
    default: class { advancedTexture = {}; addAttribution() {} },
}));

describe("building detail transitions", () => {
    it("keeps building fallback safe before a resized regional window receives coordinates", () => {
        const engine = new NullEngine(), scene = new Scene(engine);
        const globe = new GlobeSet(scene, engine, { backingSurface: false });
        globe.createGeometry(new Vector2(1, 1), 20, 2);
        globe.updateRaster(40.7484, -73.9857, 13);
        const tile = globe.ourTiles[0];
        tile.mesh.setEnabled(true);
        const source = MeshBuilder.CreateBox("ready regional buildings", {}, scene);
        source.setParent(tile.mesh);
        tile.buildingBatches.push(source);
        const transition = new BuildingTransition();
        transition.capture(globe, 10, 40.7484, -73.9857, true);
        const fallback = scene.getMeshByName("previous building detail")!;
        expect(fallback).toBeDefined();
        globe.createGeometry(new Vector2(2, 2), 20, 2);
        expect(globe.ourTiles.every(tile => tile.tileCoords === undefined)).toBe(true);
        expect.soft(() => transition.capture(globe, 10, 40.7484, -73.9857)).not.toThrow();
        expect.soft(() => transition.capture(globe, 13, 40.7484, -73.9857)).not.toThrow();
        expect.soft(() => transition.update(1000)).not.toThrow();
        expect(fallback.isDisposed()).toBe(false);
        globe.updateRaster(40.7484, -73.9857, 10);
        expect(() => transition.update(1300)).not.toThrow();
        expect(fallback.isDisposed()).toBe(false);
        expect(fallback.isEnabled()).toBe(true);
        transition.dispose(); scene.dispose(); engine.dispose();
    });

    it("clears retained detail and distance-tier buildings when their layer is disabled", () => {
        const engine = new NullEngine(), scene = new Scene(engine);
        const transition = new BuildingTransition();
        const tiers = [12, 14].map(zoom => {
            const globe = new GlobeSet(scene, engine, { backingSurface: false });
            globe.createGeometry(new Vector2(1, 1), 20, 8);
            globe.updateRaster(40.7484, -73.9857, zoom);
            const tile = globe.ourTiles[0];
            tile.mesh.setEnabled(true);
            const source = MeshBuilder.CreateBox(`buildings at zoom ${zoom}`, {}, scene);
            source.setParent(tile.mesh);
            const indices = Uint32Array.from(source.getIndices()!);
            source.metadata = { overtureCoverage: { indices, ranges: [{ id: String(zoom),
                latitude: 40.7484, longitude: -73.9857, south: 40.748, west: -73.986,
                north: 40.749, east: -73.985, start: 0, end: indices.length }] } };
            tile.buildingBatches.push(source);
            transition.capture(globe, zoom + 1);
            return { globe, source, data: new GlobeDataController(globe) };
        });
        const retained = scene.meshes.filter(mesh => mesh.name === "previous building detail");
        expect(retained).toHaveLength(2);
        expect(retained.every(mesh => mesh.isEnabled())).toBe(true);
        const materialDisposed = vi.spyOn(retained[0].material!, "dispose");
        transition.setEnabled(false);
        expect(retained.every(mesh => mesh.isDisposed())).toBe(true);
        expect(materialDisposed).toHaveBeenCalledOnce();
        // Transition cleanup owns only its clones, not current provider meshes.
        expect(tiers.every(({ source }) => !source.isDisposed())).toBe(true);
        for (const { globe, source, data } of tiers) {
            data.options.buildings = undefined;
            data.invalidate(false, false);
            expect(source.isDisposed()).toBe(true);
            expect([...transition.retainedFootprints(globe)]).toEqual([]);
            data.dispose();
        }
        transition.update(300);
        expect(scene.getMeshByName("previous building detail")).toBeNull();
        transition.dispose(); scene.dispose(); engine.dispose();
    });

    it("prevents fallback capture while disabled and resumes after re-enabling", () => {
        const engine = new NullEngine(), scene = new Scene(engine);
        const globe = new GlobeSet(scene, engine, { backingSurface: false });
        globe.createGeometry(new Vector2(1, 1), 20, 8);
        globe.updateRaster(40.7484, -73.9857, 14);
        const tile = globe.ourTiles[0];
        tile.mesh.setEnabled(true);
        const source = MeshBuilder.CreateBox("ready buildings", {}, scene);
        source.setParent(tile.mesh);
        tile.buildingBatches.push(source);
        const transition = new BuildingTransition();
        transition.setEnabled(false);
        transition.capture(globe, 15, 40.7484, -73.9857, true);
        expect(scene.getMeshByName("previous building detail")).toBeNull();
        transition.setEnabled(true);
        transition.capture(globe, 15);
        expect(scene.getMeshByName("previous building detail")?.isEnabled()).toBe(true);
        transition.dispose(); scene.dispose(); engine.dispose();
    });

    it("shares one stencil fallback material across outgoing building batches", () => {
        const engine = new NullEngine(), scene = new Scene(engine);
        const globe = new GlobeSet(scene, engine, { backingSurface: false });
        globe.createGeometry(new Vector2(1, 1), 20, 8);
        globe.updateRaster(40.7484, -73.9857, 14);
        const tile = globe.ourTiles[0];
        tile.mesh.setEnabled(true);
        for (let i = 0; i < 2; i++) {
            const source = MeshBuilder.CreateBox(`source ${i}`, {}, scene);
            source.setParent(tile.mesh);
            tile.buildingBatches.push(source);
        }
        const transition = new BuildingTransition();
        transition.capture(globe, 15);
        const fallbacks = scene.meshes.filter(mesh => mesh.name === "previous building detail");
        expect(fallbacks).toHaveLength(2);
        expect(fallbacks[0].material).toBe(fallbacks[1].material);
        const dispose = vi.spyOn(fallbacks[0].material!, "dispose");
        transition.dispose();
        expect(dispose).toHaveBeenCalledOnce();
        scene.dispose(); engine.dispose();
    });
    it("keeps the old batch until its replacement tile completes", () => {
        const engine = new NullEngine();
        const scene = new Scene(engine);
        const globe = new GlobeSet(scene, engine, { backingSurface: false });
        globe.createGeometry(new Vector2(1, 1), 20, 8);
        globe.updateRaster(40.7484, -73.9857, 14);
        const tile = globe.ourTiles[0];
        tile.mesh.setEnabled(true);
        const source = MeshBuilder.CreateBox("old buildings", {}, scene);
        source.setParent(tile.mesh);
        tile.buildingBatches.push(source);
        const sourceWorld = source.computeWorldMatrix(true).clone();
        const transition = new BuildingTransition();
        transition.capture(globe, 15);
        globe.updateRaster(40.7484, -73.9857, 15);
        transition.update(1);
        const retained = scene.getMeshByName("previous building detail");
        expect(retained?.isDisposed()).toBe(false);
        expect(retained?.parent).toBeNull();
        expect(retained?.isEnabled()).toBe(true);
        expect(retained?.material).not.toBe(source.material);
        expect(retained?.material?.stencil.func).toBe(Constants.GREATER);
        expect(retained?.material?.stencil.funcRef).toBe(8);
        expect(retained?.renderingGroupId).toBe(source.renderingGroupId + 1);
        expect(Array.from(retained!.computeWorldMatrix(true).m)).toEqual(Array.from(sourceWorld.m));
        globe.ourTiles[0].buildingsResolvedKey = globe.ourTiles[0].tileCoords.toString();
        transition.update(300);
        expect(retained?.isDisposed()).toBe(false);
        const replacement = MeshBuilder.CreateBox("new buildings", {}, scene);
        replacement.setParent(globe.ourTiles[0].mesh);
        globe.ourTiles[0].buildingBatches.push(replacement);
        transition.update(600);
        expect(retained?.isDisposed()).toBe(true);
        transition.dispose(); scene.dispose(); engine.dispose();
    });

    it("keeps outgoing buildings visible when the camera crosses a tile at the same zoom", () => {
        const engine = new NullEngine();
        const scene = new Scene(engine);
        const globe = new GlobeSet(scene, engine, { backingSurface: false });
        globe.createGeometry(new Vector2(3, 3), 20, 8);
        globe.updateRaster(40.7484, -73.9857, 14);
        const outgoing = globe.ourTiles[0];
        outgoing.mesh.setEnabled(true);
        const source = MeshBuilder.CreateBox("outgoing buildings", {}, scene);
        source.setParent(outgoing.mesh);
        outgoing.buildingBatches.push(source);
        const longitude = globe.ourTileMath.tile_to_lon(globe.ourTiles[0].tileCoords.x + 2.5, 14);
        const transition = new BuildingTransition();
        transition.capture(globe, 14, 40.7484, longitude);
        globe.updateRaster(40.7484, longitude, 14);
        transition.update(1);
        const retained = scene.getMeshByName("previous building detail");
        expect(retained?.isDisposed()).toBe(false);
        vi.spyOn(scene, "frustumPlanes", "get").mockReturnValue([]);
        vi.spyOn(retained!, "isInFrustum").mockReturnValue(false);
        transition.update(300);
        expect(retained?.isDisposed()).toBe(true);
        transition.dispose(); scene.dispose(); engine.dispose();
    });

    it("retains ready buildings when a same-zoom LOD window is resized", () => {
        const engine = new NullEngine(), scene = new Scene(engine);
        const globe = new GlobeSet(scene, engine, { backingSurface: false });
        globe.createGeometry(new Vector2(1, 1), 20, 8);
        globe.updateRaster(40.7484, -73.9857, 14);
        const tile = globe.ourTiles[0];
        tile.mesh.setEnabled(true);
        const source = MeshBuilder.CreateBox("ready buildings", {}, scene);
        source.setParent(tile.mesh);
        tile.buildingBatches.push(source);
        const world = source.computeWorldMatrix(true).clone();
        const transition = new BuildingTransition();
        transition.capture(globe, 14, 40.7484, -73.9857, true);
        globe.createGeometry(new Vector2(2, 2), 20, 8);
        globe.updateRaster(40.7484, -73.9857, 14);
        transition.update(1);
        const retained = scene.getMeshByName("previous building detail")!;
        expect(retained.isDisposed()).toBe(false);
        expect(retained.isEnabled()).toBe(true);
        expect(retained.parent).toBeNull();
        expect(Array.from(retained.computeWorldMatrix(true).m)).toEqual(Array.from(world.m));
        transition.dispose();scene.dispose();engine.dispose();
    });

    it("keeps unmasked retained buildings until Google covers their whole mesh", () => {
        const engine = new NullEngine();
        const scene = new Scene(engine);
        const globe = new GlobeSet(scene, engine, { backingSurface: false });
        globe.createGeometry(new Vector2(1, 1), 20, 8);
        globe.updateRaster(40.7484, -73.9857, 14);
        const tile = globe.ourTiles[0];
        tile.mesh.setEnabled(true);
        const source = MeshBuilder.CreateBox("old buildings", {}, scene);
        source.position.copyFrom(globe.getSurfacePosition(40.7484, -73.9857));
        source.setParent(tile.mesh);
        tile.buildingBatches.push(source);
        const transition = new BuildingTransition();
        transition.capture(globe, 15);
        globe.updateRaster(40.7484, -73.9857, 15);
        transition.update(1);
        const retained = scene.getMeshByName("previous building detail");
        expect(retained?.isDisposed()).toBe(false);
        let probes = 0;
        transition.update(2, () => ++probes === 1, true);
        expect(probes).toBeGreaterThan(1);
        expect(retained?.isDisposed()).toBe(false);
        transition.update(2, () => true, true);
        expect(retained?.isDisposed()).toBe(true);
        transition.dispose(); scene.dispose(); engine.dispose();
    });

    it("keeps visible outgoing buildings across more than two fast tile-window moves", () => {
        const engine = new NullEngine();
        const scene = new Scene(engine);
        const globe = new GlobeSet(scene, engine, { backingSurface: false });
        globe.createGeometry(new Vector2(1, 1), 20, 8);
        globe.updateRaster(40.7484, -73.9857, 14);
        const firstX = globe.ourTiles[0].tileCoords.x;
        const transition = new BuildingTransition();
        const retained = [];
        for (let step = 1; step <= 3; step++) {
            const tile = globe.ourTiles[0];
            tile.mesh.setEnabled(true);
            const source = MeshBuilder.CreateBox(`outgoing ${step}`, {}, scene);
            source.setParent(tile.mesh);
            tile.buildingBatches.push(source);
            const longitude = globe.ourTileMath.tile_to_lon(firstX + step + 0.5, 14);
            transition.capture(globe, 14, 40.7484, longitude);
            retained.push(scene.meshes.filter(mesh => mesh.name === "previous building detail").at(-1)!);
            globe.updateRaster(40.7484, longitude, 14);
        }
        expect(retained).toHaveLength(3);
        expect(retained.every(mesh => mesh && !mesh.isDisposed())).toBe(true);
        transition.dispose(); scene.dispose(); engine.dispose();
    });

    it("masks only the Google-covered ranges of a retained Overture batch", () => {
        const engine = new NullEngine();
        const scene = new Scene(engine);
        const globe = new GlobeSet(scene, engine, { backingSurface: false });
        globe.createGeometry(new Vector2(1, 1), 20, 8);
        globe.updateRaster(40.7484, -73.9857, 14);
        const tile = globe.ourTiles[0];
        tile.mesh.setEnabled(true);
        const source = MeshBuilder.CreateBox("outgoing Overture batch", {}, scene);
        source.setParent(tile.mesh);
        const indices = Uint32Array.from(source.getIndices()!);
        const half = indices.length / 2;
        source.metadata = { overtureCoverage: {
            indices,
            ranges: [
                { id: "one", latitude: 1, longitude: 1, south: 0, west: 0, north: 2, east: 2, start: 0, end: half },
                { id: "two", latitude: 3, longitude: 3, south: 2, west: 2, north: 4, east: 4, start: half, end: indices.length },
            ],
        } };
        tile.buildingBatches.push(source);
        const transition = new BuildingTransition();
        transition.capture(globe, 15);
        globe.updateRaster(40.7484, -73.9857, 15);
        const retained = scene.getMeshByName("previous building detail")!;
        transition.update(1, latitude => latitude === 1, true);
        expect(retained.isDisposed()).toBe(false);
        expect(retained.parent).toBeNull();
        expect(retained.isEnabled()).toBe(true);
        expect(Array.from(transition.retainedFootprints(globe), range => range.id)).toEqual(["two"]);
        expect(Array.from(retained.getIndices()!)).toEqual(Array.from(indices.subarray(half)));
        transition.update(2, undefined, true);
        expect(Array.from(transition.retainedFootprints(globe), range => range.id)).toEqual(["one", "two"]);
        expect(Array.from(retained.getIndices()!)).toEqual(Array.from(indices));
        transition.update(3, () => true, true);
        expect(retained.isDisposed()).toBe(true);
        transition.dispose(); scene.dispose(); engine.dispose();
    });

    it("keeps unmatched old Overture footprints when a finer tile resolves only some buildings", () => {
        const engine = new NullEngine(), scene = new Scene(engine);
        const globe = new GlobeSet(scene, engine, { backingSurface: false });
        globe.createGeometry(new Vector2(1, 1), 20, 8);
        globe.updateRaster(40.7484, -73.9857, 14);
        const tile = globe.ourTiles[0];
        tile.mesh.setEnabled(true);
        const source = MeshBuilder.CreateBox("old Overture batch", {}, scene);
        source.setParent(tile.mesh);
        const indices = Uint32Array.from(source.getIndices()!);
        const half = indices.length / 2;
        const range = (id: string, start: number, end: number) =>
            ({ id, latitude: 40.7484, longitude: -73.9857, south: 40.748, west: -73.986,
                north: 40.749, east: -73.985, start, end });
        source.metadata = { overtureCoverage: { indices,
            ranges: [range("one", 0, half), range("two", half, indices.length)] } };
        tile.buildingBatches.push(source);
        const transition = new BuildingTransition();
        transition.capture(globe, 15);
        globe.updateRaster(40.7484, -73.9857, 15);
        const replacementTile = globe.ourTiles[0];
        replacementTile.mesh.setEnabled(true);
        const replacement = (id: string) => {
            const mesh = MeshBuilder.CreateBox(`new ${id}`, {}, scene);
            mesh.setParent(replacementTile.mesh);
            const indices = Uint32Array.from(mesh.getIndices()!);
            mesh.metadata = { overtureCoverage: { indices, ranges: [range(id, 0, indices.length)] } };
            replacementTile.buildingBatches.push(mesh);
            return mesh;
        };
        const first = replacement("one");
        first.setEnabled(false);
        replacementTile.buildingsResolvedKey = replacementTile.tileCoords.toString();
        const retained = scene.getMeshByName("previous building detail")!;
        transition.update(1);
        expect(retained.isDisposed()).toBe(false);
        expect(Array.from(transition.retainedFootprints(globe), footprint => footprint.id)).toEqual(["one", "two"]);
        first.setEnabled(true);
        transition.update(300);
        expect(Array.from(transition.retainedFootprints(globe), footprint => footprint.id)).toEqual(["two"]);
        replacement("two");
        transition.update(600);
        expect(retained.isDisposed()).toBe(true);
        transition.dispose(); scene.dispose(); engine.dispose();
    });
});
