import { describe, expect, it, vi } from "vitest";
import { MeshBuilder, NullEngine, Scene, Vector2 } from "@babylonjs/core";
import GlobeSet from "../src/core/GlobeSet";
import { BuildingTransition } from "../examples-npm/globe-mode/src/BuildingTransition";

vi.mock("../src/core/Attribution", () => ({
    default: class { advancedTexture = {}; addAttribution() {} },
}));

describe("building detail transitions", () => {
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
        const transition = new BuildingTransition();
        transition.capture(globe, 15);
        globe.updateRaster(40.7484, -73.9857, 15);
        transition.update(1);
        const retained = scene.getMeshByName("previous building detail");
        expect(retained?.isDisposed()).toBe(false);
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

    it("drops retained Overture detail immediately when Google covers it", () => {
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
                { latitude: 1, longitude: 1, south: 0, west: 0, north: 2, east: 2, start: 0, end: half },
                { latitude: 3, longitude: 3, south: 2, west: 2, north: 4, east: 4, start: half, end: indices.length },
            ],
        } };
        tile.buildingBatches.push(source);
        const transition = new BuildingTransition();
        transition.capture(globe, 15);
        globe.updateRaster(40.7484, -73.9857, 15);
        const retained = scene.getMeshByName("previous building detail")!;
        transition.update(1, latitude => latitude === 1, true);
        expect(retained.isDisposed()).toBe(false);
        expect(Array.from(retained.getIndices()!)).toEqual(Array.from(indices.subarray(half)));
        transition.update(2, undefined, true);
        expect(Array.from(retained.getIndices()!)).toEqual(Array.from(indices));
        transition.update(3, () => true, true);
        expect(retained.isDisposed()).toBe(true);
        transition.dispose(); scene.dispose(); engine.dispose();
    });
});
