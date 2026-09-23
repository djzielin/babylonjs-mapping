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
        transition.dispose(); scene.dispose(); engine.dispose();
    });
});
