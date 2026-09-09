import Tile from "../src/core/Tile";
import { describe, expect, it, vi } from "vitest";
import { MeshBuilder, NullEngine, Scene, StandardMaterial, PBRMaterial, MultiMaterial, VertexBuffer, Vector3 } from "@babylonjs/core";
import { Constants } from "@babylonjs/core/Engines/constants";
import { mergeMeshesAtOrigin } from "../src/shared/MergeMeshesAtOrigin";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
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
    it("keeps late-loaded terrain and glTF submaterials on the same depth encoding", () => {
        const engine = new NullEngine(); const scene = new Scene(engine);
        engine.getCaps().fragmentDepthSupported = true;
        const renderer = new MapLayerRenderer(scene, 7, { logarithmicDepth: true });
        const terrain = MeshBuilder.CreateBox("terrain", {}, scene);
        terrain.material = new StandardMaterial("terrain", scene);
        renderer.add(terrain, 2);
        const model = MeshBuilder.CreateBox("model", {}, scene);
        renderer.add(model, 6);
        const materials = new MultiMaterial("glTF materials", scene);
        const walls = new PBRMaterial("walls", scene);
        const roof = new StandardMaterial("roof", scene);
        materials.subMaterials = [walls, roof, null];
        model.material = materials;
        walls.freeze();
        const dirty = vi.spyOn(walls, "markDirty");
        scene.onBeforeRenderObservable.notifyObservers(scene);
        scene.onBeforeRenderObservable.notifyObservers(scene);
        expect(dirty).toHaveBeenCalledExactlyOnceWith(true);
        for (const material of [terrain.material, walls, roof]) {
            expect(material.useLogarithmicDepth).toBe(true);
            expect(material.stencil.enabled).toBe(true);
        }
        expect(walls.stencil.funcRef).toBe(7);
        expect(terrain.material.stencil.funcRef).toBe(3);
        renderer.dispose(); scene.dispose(); engine.dispose();
    });
    it("retains ordinary depth when fragment depth is unavailable", () => {
        const engine = new NullEngine(); const scene = new Scene(engine);
        engine.getCaps().fragmentDepthSupported = false;
        const renderer = new MapLayerRenderer(scene, 7, { logarithmicDepth: true });
        const mesh = MeshBuilder.CreateBox("terrain", {}, scene);
        mesh.material = new StandardMaterial("terrain", scene);
        renderer.add(mesh, 2);
        expect(mesh.material.useLogarithmicDepth).toBeFalsy();
        renderer.dispose(); scene.dispose(); engine.dispose();
    });
    it("preserves sub-metre geometry when batching buildings at a globe origin", () => {
        const engine = new NullEngine({ renderWidth: 512, renderHeight: 512, textureSize: 512,
            deterministicLockstep: false, lockstepMaxSteps: 4, useHighPrecisionMatrix: true });
        const scene = new Scene(engine);
        const origin = new Vector3(45, 35, 20);
        const meshes = [0, 1].map(i => {
            const mesh = MeshBuilder.CreateBox("building", { size: 0.000001 }, scene);
            mesh.position.copyFrom(origin.add(new Vector3(i * 0.00002, 0.000003, 0)));
            return mesh;
        });
        const expected = meshes.flatMap(mesh => {
            const world = mesh.computeWorldMatrix(true);
            const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
            return Array.from({ length: positions.length / 3 }, (_, i) =>
                Vector3.TransformCoordinates(Vector3.FromArray(positions, i * 3), world));
        });
        const merged = mergeMeshesAtOrigin(meshes, origin)!;
        // Emulate the GPU's actual vertex precision rather than testing JS doubles.
        const vertices = Float32Array.from(merged.getVerticesData(VertexBuffer.PositionKind)!);
        expect(Math.max(...vertices.map(Math.abs))).toBeLessThan(0.001);
        const world = merged.computeWorldMatrix(true);
        for (let i = 0; i < expected.length; i++) {
            const actual = Vector3.TransformCoordinates(Vector3.FromArray(vertices, i * 3), world);
            expect(Vector3.Distance(actual, expected[i])).toBeLessThan(1e-10);
        }
        expect(meshes.every(mesh => mesh.isDisposed())).toBe(true);
        scene.dispose(); engine.dispose();
    });
    it("restores source transforms if a local-origin merge fails", () => {
        const engine = new NullEngine(); const scene = new Scene(engine);
        const mesh = MeshBuilder.CreateBox("building", {}, scene);
        mesh.position.set(45, 35, 20); mesh.freezeWorldMatrix();
        const world = mesh.getWorldMatrix().clone();
        const merge = vi.spyOn(Mesh, "MergeMeshes").mockReturnValueOnce(null);
        try {
            expect(mergeMeshesAtOrigin([mesh], mesh.position.clone())).toBeNull();
            expect(mesh.isWorldMatrixFrozen).toBe(true);
            expect(mesh.getWorldMatrix().equals(world)).toBe(true);
        } finally { merge.mockRestore(); scene.dispose(); engine.dispose(); }
    });
    it("uses the working Tokyo terrain profile and retains 32 steps to Fuji distance", () => {
        expect(landscapeTerrainLOD(64, 100)).toEqual({ precisions: [48, 32, 16, 8, 4, 2, 0], distances: [100, 250, 800, 1100, 1400, 1650, 1900] });
        expect(landscapeTerrainLOD(32, 16000).distances[0]).toBe(128000);
    });
});


it("merges later building pages without reusing disposed source meshes", () => {
    const engine = new NullEngine(); const scene = new Scene(engine);
    const first = MeshBuilder.CreateBox("first", {}, scene);
    const second = MeshBuilder.CreateBox("second", {}, scene);
    const origin = new Vector3(45, 35, 20);
    const merged = mergeMeshesAtOrigin([first, second], origin)!;
    const third = MeshBuilder.CreateBox("third", {}, scene);
    const tile = { buildings: [{ mesh: first }, { mesh: second }, { mesh: third }], mergedBuildingMesh: merged };
    const sources = Tile.prototype.getAllBuildingMeshes.call(tile as never);
    expect(sources).toEqual([third, merged]);
    const expectedVertices = third.getTotalVertices() + merged.getTotalVertices();
    const complete = mergeMeshesAtOrigin(sources, origin)!;
    expect(complete.getTotalVertices()).toBe(expectedVertices);
    expect(complete.isDisposed()).toBe(false);
    scene.dispose(); engine.dispose();
});
