import { describe, expect, it } from "vitest";
import { FreeCamera, Matrix, Mesh, MeshBuilder, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { orientTrafficIcon } from "../examples-shared/TrafficIconOrientation";

describe("traffic icon orientation", () => {
    it.each([0, 90, 180, 270, 39, 245])("aligns the visible nose with heading %s through camera orbits", heading => {
        const engine = new NullEngine();
        const scene = new Scene(engine);
        const camera = new FreeCamera("viewer", new Vector3(0, 12, -12), scene);
        const mesh = MeshBuilder.CreatePlane("vehicle", { size: 1 }, scene);
        mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        const angle = heading * Math.PI / 180;
        const behind = new Vector3(-Math.sin(angle), 0, -Math.cos(angle));
        for (const eye of [new Vector3(0, 12, -12), new Vector3(12, 8, 0), new Vector3(-8, 15, 5)]) {
            camera.position.copyFrom(eye); camera.setTarget(Vector3.Zero());
            scene.updateTransformMatrix(true);
            orientTrafficIcon(mesh, behind);
            const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
            const project = (position: Vector3) => Vector3.Project(position, Matrix.IdentityReadOnly, scene.getTransformMatrix(), viewport);
            const origin = project(mesh.position);
            const tail = project(behind);
            const nose = project(Vector3.TransformCoordinates(new Vector3(0, .5, 0), mesh.computeWorldMatrix(true)));
            const travel = origin.subtract(tail).normalize();
            const facing = nose.subtract(origin).normalize();
            expect(facing.x * travel.x + facing.y * travel.y).toBeGreaterThan(.999);
        }
        scene.dispose(); engine.dispose();
    });
});
