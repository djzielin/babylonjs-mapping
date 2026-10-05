import { describe, expect, it } from "vitest";
import { AssetContainer, FreeCamera, Frustum, MeshBuilder, NullEngine, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { optimizeStaticGoogleModels } from "../examples-shared/static-google-models";

describe("static Google model optimization", () => {
    it("preserves placed geometry, material appearance, and visible mesh coverage", () => {
        const engine = new NullEngine();
        const scene = new Scene(engine);
        try {
            const camera = new FreeCamera("camera", new Vector3(0, 0, -10), scene);
            camera.setTarget(Vector3.Zero());
            const root = new TransformNode("model", scene);
            root.position.set(0.5, 0.25, 0);
            root.scaling.setAll(0.75);
            const mesh = MeshBuilder.CreateBox("model-mesh", {}, scene);
            mesh.parent = root;
            mesh.position.set(0.1, 0.2, 0.3);
            const material = new StandardMaterial("surface", scene);
            material.diffuseColor.set(0.2, 0.4, 0.6);
            mesh.material = material;
            const asset = new AssetContainer(scene);
            asset.meshes.push(mesh);
            const before = Array.from(mesh.computeWorldMatrix(true).asArray());
            const planes = Frustum.GetPlanes(camera.getTransformationMatrix());
            expect(mesh.isInFrustum(planes)).toBe(true);
            optimizeStaticGoogleModels([{ root, asset }]);
            for (let frame = 0; frame < 3; frame++) scene.render();
            expect(Array.from(mesh.getWorldMatrix().asArray())).toEqual(before);
            expect(mesh.isInFrustum(planes)).toBe(true);
            expect(material.diffuseColor.asArray()).toEqual([0.2, 0.4, 0.6]);
            expect(mesh.isPickable).toBe(true);
            expect(mesh.isWorldMatrixFrozen).toBe(true);
            expect(material.isFrozen).toBe(true);
        } finally {
            scene.dispose();
            engine.dispose();
        }
    });
});
