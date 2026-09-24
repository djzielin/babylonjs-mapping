import { expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import type { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import { DrawSnapshotCache } from "../examples-npm/globe-mode/src/DrawSnapshotCache";

it("invalidates draw snapshots for turns, replacement meshes and hidden content", async () => {
    const engine = new NullEngine(); const scene = new Scene(engine);
    const camera = new FreeCamera("eye", Vector3.Zero(), scene);
    const gpu = { snapshotRendering: false, snapshotRenderingMode: 0, onResizeObservable: new Observable(), onContextLostObservable: new Observable() } as unknown as WebGPUEngine;
    const cache = new DrawSnapshotCache(scene, gpu);
    const box = (name: string, z: number) => {
        const mesh = MeshBuilder.CreateBox(name, {}, scene);
        mesh.position.z = z; mesh.freezeWorldMatrix();
        const material = new StandardMaterial(name, scene); material.disableLighting = true; material.freeze(); mesh.material = material;
        return mesh;
    };
    const front = box("front", 10); const back = box("back", -10);
    await scene.whenReadyAsync();
    scene.render(); scene.render();
    expect(cache.stats).toContain("1 captures / 1 replays");
    camera.setTarget(new Vector3(0, 0, -10)); scene.render();
    expect(cache.stats).toContain("2 captures");
    const replacement = box("replacement", -8); scene.render();
    expect(cache.stats).toContain("3 captures");
    back.setEnabled(false); scene.render();
    expect(cache.stats).toContain("4 captures");
    replacement.setVerticesData(VertexBuffer.PositionKind, replacement.getVerticesData(VertexBuffer.PositionKind)!);
    scene.render(); expect(cache.stats).toContain("1 replays");
    replacement.freezeWorldMatrix(); await scene.whenReadyAsync(); scene.render();
    expect(gpu.snapshotRendering).toBe(true);
    // Unrelated background textures do not invalidate the visible scene.
    const texture = RawTexture.CreateRGBATexture(new Uint8Array(16), 2, 2, scene);
    expect(gpu.snapshotRendering).toBe(true);
    scene.render(); expect(gpu.snapshotRendering).toBe(true);
    // Binding that texture to a recorded material must capture its new resources.
    const beforeAssignment = cache.stats.match(/(\d+) replays/)![1];
    (replacement.material as StandardMaterial).diffuseTexture = texture;
    scene.render();
    expect(cache.stats.match(/(\d+) replays/)![1]).toBe(beforeAssignment);
    texture.getInternalTexture()!.isReady = true; // Simulate the completed GPU upload in NullEngine.
    await scene.whenReadyAsync(); scene.render();
    expect(gpu.snapshotRendering).toBe(true);
    replacement.dispose(); expect(gpu.snapshotRendering).toBe(false);
    back.setEnabled(true); scene.render();
    back.material!.unfreeze(); scene.render();
    expect(gpu.snapshotRendering).toBe(false);
    back.material!.freeze(); scene.render();
    gpu.onResizeObservable.notifyObservers(gpu); expect(gpu.snapshotRendering).toBe(false);
    expect(front.alwaysSelectAsActiveMesh).toBe(false);
    expect(back.alwaysSelectAsActiveMesh).toBe(false);
    scene.dispose(); engine.dispose();
});

it("records a visible mesh that uses the scene default material", async () => {
    const engine = new NullEngine(); const scene = new Scene(engine);
    new FreeCamera("eye", Vector3.Zero(), scene);
    const gpu = { snapshotRendering: false, snapshotRenderingMode: 0,
        onResizeObservable: new Observable(), onContextLostObservable: new Observable() } as unknown as WebGPUEngine;
    const cache = new DrawSnapshotCache(scene, gpu);
    const mesh = MeshBuilder.CreateBox("default material", {}, scene);
    mesh.position.z = 10; mesh.freezeWorldMatrix();
    await scene.whenReadyAsync(); scene.render(); scene.render();
    expect(gpu.snapshotRendering).toBe(true);
    expect(cache.stats).toContain("1 captures / 1 replays");
    expect(cache.stats).not.toContain("material none");
    scene.dispose(); engine.dispose();
});

it("keeps the enabled mesh index current when a parent is hidden", async () => {
    const engine = new NullEngine(); const scene = new Scene(engine);
    new FreeCamera("eye", Vector3.Zero(), scene);
    const gpu = { snapshotRendering: false, snapshotRenderingMode: 0,
        onResizeObservable: new Observable(), onContextLostObservable: new Observable() } as unknown as WebGPUEngine;
    const cache = new DrawSnapshotCache(scene, gpu);
    const parent = MeshBuilder.CreateBox("parent", {}, scene);
    const child = MeshBuilder.CreateBox("child", {}, scene);
    parent.position.z = 10;
    child.setParent(parent);
    parent.freezeWorldMatrix(); child.freezeWorldMatrix();
    const material = new StandardMaterial("static", scene); material.freeze();
    parent.material = child.material = material;
    await scene.whenReadyAsync(); scene.render(); scene.render();
    expect(cache.stats).toContain("2 enabled");
    expect(gpu.snapshotRendering).toBe(true);
    parent.setEnabled(false); scene.render();
    expect(cache.stats).toContain("0 enabled");
    expect(gpu.snapshotRendering).toBe(false);
    scene.dispose(); engine.dispose();
});
