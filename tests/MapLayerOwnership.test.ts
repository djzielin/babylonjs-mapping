import { describe, expect, it } from "vitest";
import { MeshBuilder, NullEngine, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { Constants } from "@babylonjs/core/Engines/constants";
import BuildingReplacementIndex from "../src/buildings/BuildingReplacementIndex";
import MapLayerRenderer from "../src/core/MapLayerRenderer";
import { landscapeTerrainLOD } from "../src/terrain/LandscapeLOD";

describe("shared map layer ownership", () => {
    it("rejects only footprints covered by actual detailed model geometry", () => {
        const engine = new NullEngine(); const scene = new Scene(engine);
        const model = MeshBuilder.CreateBox("model", { width: 10, height: 30, depth: 2 }, scene);
        model.rotation.y = Math.PI / 4;
        const footprint = MeshBuilder.CreateBox("footprint", { size: 1 }, scene);
        const index = new BuildingReplacementIndex(); index.setModels([model]);
        expect(index.keepFootprint(footprint)).toBe(false);
        // Inside the rotated model's AABB, but outside its actual footprint.
        footprint.position.set(3.5, 0, 3.5);
        expect(index.keepFootprint(footprint)).toBe(true);
        footprint.position.setAll(0); model.dispose();
        expect(index.keepFootprint(footprint)).toBe(true);
        scene.dispose(); engine.dispose();
    });
    it("preserves depth between tiers and reserves covered pixels for the finer tier", () => {
        const engine = new NullEngine(); const scene = new Scene(engine);
        const renderer = new MapLayerRenderer(scene);
        const near = MeshBuilder.CreateBox("near", {}, scene);
        const far = MeshBuilder.CreateBox("far", {}, scene);
        near.material = new StandardMaterial("near", scene); far.material = new StandardMaterial("far", scene);
        renderer.add(near, 6); renderer.add(far, 2);
        expect(near.renderingGroupId).toBeLessThan(far.renderingGroupId);
        expect(scene.getAutoClearDepthStencilSetup(far.renderingGroupId).autoClear).toBe(false);
        expect(far.material.stencil.func).toBe(Constants.GEQUAL);
        expect(far.material.stencil.funcRef).toBeLessThan(near.material.stencil.funcRef);
        renderer.dispose(); scene.dispose(); engine.dispose();
    });
    it("uses the working Tokyo terrain profile and retains 32 steps to Fuji distance", () => {
        expect(landscapeTerrainLOD(64, 100)).toEqual({ precisions: [48, 32, 16, 8, 4, 2, 0], distances: [100, 250, 800, 1100, 1400, 1650, 1900] });
        expect(landscapeTerrainLOD(32, 16000).distances[0]).toBe(128000);
    });
});
