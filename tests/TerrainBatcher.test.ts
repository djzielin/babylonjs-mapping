import { describe, it, expect } from "vitest";
import { NullEngine, Scene, MeshBuilder, VertexBuffer, Vector3, StandardMaterial, RawTexture } from "@babylonjs/core";
import { terrainBatchGeometry, TerrainBatcher } from "../examples-npm/globe-mode/src/TerrainBatcher";

describe("lossless terrain batching", () => {
    it("retains world positions, normals, UVs, colors and triangles in a local origin", () => {
        const engine = new NullEngine({ renderWidth: 32, renderHeight: 32, textureSize: 32, deterministicLockstep: false, lockstepMaxSteps: 4, useHighPrecisionMatrix: true });
        const scene = new Scene(engine);
        const meshes = [0, 1].map(i => {
            const mesh = MeshBuilder.CreateGround(`tile ${i}`, { width: 0.0001, height: 0.0001, subdivisions: 3 }, scene);
            mesh.position.set(40 + i * 0.0001, 30, 20);
            mesh.rotation.x = i * 0.2;
            if (i) mesh.setVerticesData(VertexBuffer.ColorKind, new Array(mesh.getTotalVertices()).fill([0.3, 0.5, 0.7, 1]).flat());
            mesh.computeWorldMatrix(true);
            return mesh;
        });
        const { vertices, layers, origin } = terrainBatchGeometry(meshes);
        let offset = 0, indexOffset = 0;
        for (let layer = 0; layer < meshes.length; layer++) {
            const mesh = meshes[layer];
            const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
            const normals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
            const uv = mesh.getVerticesData(VertexBuffer.UVKind)!;
            const indices = mesh.getIndices()!;
            for (let i = 0; i < mesh.getTotalVertices(); i++) {
                const expected = Vector3.TransformCoordinates(Vector3.FromArray(positions, i * 3), mesh.getWorldMatrix());
                const actual = Vector3.FromArray(Float32Array.from(vertices.positions!), (offset + i) * 3).add(origin);
                expect(Vector3.Distance(actual, expected)).toBeLessThan(1e-10);
                const normal = Vector3.TransformNormal(Vector3.FromArray(normals, i * 3), mesh.getWorldMatrix());
                expect(Vector3.Distance(Vector3.FromArray(vertices.normals!, (offset + i) * 3), normal)).toBeLessThan(1e-6);
                expect(Array.from(vertices.uvs!).slice((offset + i) * 2, (offset + i + 1) * 2)).toEqual(Array.from(Float32Array.from(uv)).slice(i * 2, i * 2 + 2));
                expect(layers[offset + i]).toBe(layer);
                expect(vertices.colors![(offset + i) * 4]).toBeCloseTo(layer ? 0.3 : 1);
            }
            expect(Array.from(vertices.indices!).slice(indexOffset, indexOffset + indices.length)).toEqual(Array.from(indices).map(i => i + offset));
            offset += mesh.getTotalVertices(); indexOffset += indices.length;
        }
        expect(vertices.positions!.length / 3).toBe(offset);
        scene.dispose(); engine.dispose();
    });
    it("invalidates batches when geometry, imagery, visibility or position changes", () => {
        const engine = new NullEngine();
        const scene = new Scene(engine);
        const mesh = MeshBuilder.CreateGround("tile", {}, scene);
        const material = new StandardMaterial("raster", scene);
        material.diffuseTexture = RawTexture.CreateRGBATexture(new Uint8Array(16), 2, 2, scene);
        mesh.material = material;
        mesh.freezeWorldMatrix();
        const batcher = new TerrainBatcher(scene, () => [], () => {}) as any;
        let source = batcher.snapshot(mesh);
        expect(batcher.valid(source)).toBe(true);
        mesh.unfreezeWorldMatrix(); mesh.computeWorldMatrix(true); mesh.freezeWorldMatrix();
        expect(batcher.valid(source)).toBe(true);
        mesh.setVerticesData(VertexBuffer.PositionKind, mesh.getVerticesData(VertexBuffer.PositionKind)!);
        expect(batcher.valid(source)).toBe(false);
        source = batcher.snapshot(mesh);
        mesh.isVisible = false;
        expect(batcher.valid(source)).toBe(false);
        mesh.isVisible = true;
        mesh.setEnabled(false);
        expect(batcher.valid(source)).toBe(false);
        mesh.setEnabled(true);
        mesh.unfreezeWorldMatrix(); mesh.position.x += 1; mesh.freezeWorldMatrix();
        expect(batcher.valid(source)).toBe(false);
        source = batcher.snapshot(mesh);
        material.diffuseTexture = RawTexture.CreateRGBATexture(new Uint8Array(16), 2, 2, scene);
        expect(batcher.valid(source)).toBe(false);
        scene.dispose(); engine.dispose();
    });

});
