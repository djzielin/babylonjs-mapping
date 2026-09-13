import "@babylonjs/core/Meshes/instancedMesh.js";
import "@babylonjs/core/Materials/standardMaterial.js";
import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { installResidentMeshCandidates } from "../examples-npm/globe-mode/src/ResidentMeshCandidates";

describe("resident mesh candidates", () => {
    it("retains every frustum-visible mesh through near and far moving views", () => {
        const engine = new NullEngine(); const scene = new Scene(engine);
        const camera = new FreeCamera("camera", Vector3.Zero(), scene);
        const meshes = Array.from({ length: 120 }, (_, i) => {
            const mesh = MeshBuilder.CreateBox(String(i), { size: 2 }, scene);
            const angle = i * Math.PI * 2 / 120;
            mesh.position.set(Math.sin(angle) * 30, (i % 7) - 3, Math.cos(angle) * 30);
            mesh.freezeWorldMatrix(); return mesh;
        });
        installResidentMeshCandidates(scene);
        for (const distance of [0, 28, 100]) for (let step = 0; step < 24; step++) {
            const angle = step * Math.PI / 12;
            camera.position.set(distance, 0, step / 10);
            camera.setTarget(camera.position.add(new Vector3(Math.sin(angle), 0, Math.cos(angle))));
            scene.render();
            const candidates = scene.getActiveMeshCandidates();
            const selected = new Set(candidates.data.slice(0, candidates.length));
            for (const mesh of meshes) if (mesh.isInFrustum(scene.frustumPlanes)) expect(selected.has(mesh)).toBe(true);
        }
        // A previously culled mesh can move back into view without rebuilding a cache.
        meshes[0].unfreezeWorldMatrix();
        meshes[0].position.copyFrom(camera.position.add(new Vector3(0, 0, 5)));
        scene.render();
        expect(scene.getActiveMeshCandidates().data).toContain(meshes[0]);
        scene.dispose(); engine.dispose();
    });
    it("keeps visible static geometry and immediately includes it after a turn", () => {
        const engine = new NullEngine(); const scene = new Scene(engine);
        const camera = new FreeCamera("camera", Vector3.Zero(), scene);
        const front = MeshBuilder.CreateBox("front", {}, scene);
        const back = MeshBuilder.CreateBox("back", {}, scene);
        front.position.z = 10; back.position.z = -10;
        front.freezeWorldMatrix(); back.freezeWorldMatrix();
        const ready = vi.spyOn(back, "isReady");
        installResidentMeshCandidates(scene);
        scene.render();
        expect(scene.getActiveMeshCandidates().data).toContain(front);
        expect(scene.getActiveMeshCandidates().data).not.toContain(back);
        expect(ready).not.toHaveBeenCalled();
        camera.setTarget(new Vector3(0, 0, -10)); scene.render();
        expect(scene.getActiveMeshCandidates().data).toContain(back);
        expect(scene.getActiveMeshCandidates().data).not.toContain(front);
        expect(ready).toHaveBeenCalled();
        scene.dispose(); engine.dispose();
    });
    it("preserves Babylon evaluation for dynamic, forced and instanced geometry", () => {
        const engine = new NullEngine(); const scene = new Scene(engine);
        new FreeCamera("camera", Vector3.Zero(), scene);
        const dynamic = MeshBuilder.CreateBox("dynamic", {}, scene);
        const forced = MeshBuilder.CreateBox("forced", {}, scene);
        const instanced = MeshBuilder.CreateBox("instanced", {}, scene);
        for (const mesh of [dynamic, forced, instanced]) mesh.position.z = -10;
        forced.alwaysSelectAsActiveMesh = true; forced.freezeWorldMatrix();
        instanced.createInstance("instance"); instanced.freezeWorldMatrix();
        const previous = scene.getActiveMeshCandidates;
        const uninstall = installResidentMeshCandidates(scene);
        scene.render();
        for (const mesh of [dynamic, forced, instanced]) expect(scene.getActiveMeshCandidates().data).toContain(mesh);
        uninstall(); expect(scene.getActiveMeshCandidates).toBe(previous);
        scene.dispose(); engine.dispose();
    });
});
