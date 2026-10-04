import { describe, it, vi, expect } from "vitest";
import { NullEngine, Scene, Vector2, VertexBuffer } from "@babylonjs/core";
import GlobeSet from "../src/core/GlobeSet";
vi.mock("../src/core/Attribution", () => ({
    default: class {
        advancedTexture = {};
        addAttribution() {}
    },
}));

describe("globe CPU work", () => {
    it("keeps tile topology resident across elevation updates", () => {
        const engine = new NullEngine(), scene = new Scene(engine);
        const globe = new GlobeSet(scene, engine, { backingSurface: false });
        globe.createGeometry(new Vector2(1, 1), 20, 4);
        globe.updateRaster(35, -79, 15);
        const tile = globe.ourTiles[0];
        const indices = Array.from(tile.mesh.getIndices()!);
        const uvs = Array.from(tile.mesh.getVerticesData(VertexBuffer.UVKind)!);
        const setIndices = vi.spyOn(tile.mesh, "setIndices");
        const setVertices = vi.spyOn(tile.mesh, "setVerticesData");
        globe.setElevationData(tile, [100, -100, 50, 200], 2, 2);
        expect(setIndices).not.toHaveBeenCalled();
        expect(setVertices.mock.calls.map(call => call[0])).not.toContain(VertexBuffer.UVKind);
        expect(Array.from(tile.mesh.getIndices()!)).toEqual(indices);
        expect(Array.from(tile.mesh.getVerticesData(VertexBuffer.UVKind)!)).toEqual(uvs);
        scene.dispose(); engine.dispose();
    });

    it("measures a dense window and verifies unchanged views leave GPU buffers untouched", () => {
        const engine = new NullEngine(),
            scene = new Scene(engine);
        const globe = new GlobeSet(scene, engine, { backingSurface: false });
        globe.createGeometry(new Vector2(5, 5), 20, 64);
        const started = performance.now();
        globe.updateRaster(35, -79, 15);
        const projectionMs = performance.now() - started;
        const startTerrain = performance.now();
        for (const tile of globe.ourTiles)
            globe.setElevationData(tile, [100, -100, 50, 200], 2, 2);
        const terrainMs = performance.now() - startTerrain;
        const spies = globe.ourTiles.map((t) =>
            vi.spyOn(t.mesh, "setVerticesData"),
        );
        const samples: number[] = [];
        for (let i = 0; i < 100; i++) {
            const start = performance.now();
            globe.updateRaster(35, -79, 15);
            samples.push(performance.now() - start);
        }
        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
        samples.sort((a, b) => a - b);
        process.stdout.write(
            JSON.stringify({
                environment: "NullEngine CPU only; excludes network/GPU",
                tiles: 25,
                subdivisions: 64,
                projectionMs,
                terrainMs,
                unchangedViewMedianMs: samples[50],
                unchangedViewP95Ms: samples[95],
            }) + "\n",
        );
        scene.dispose();
        engine.dispose();
    });
});
