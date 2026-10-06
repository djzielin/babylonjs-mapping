import { expect, it } from "vitest";
import { ArcRotateCamera, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { lookFromEye, moveEye, alignEyeHorizon } from "../examples-npm/globe-mode/src/FirstPersonNavigation";

it("looks and moves simultaneously without pulling the eye back to an orbit point", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new ArcRotateCamera("walk", 0, 1, 10, Vector3.Zero(), scene);
    camera.lowerBetaLimit = 0.001;
    camera.upperBetaLimit = Math.PI - 0.001;
    camera.inputs.clear();
    const start = camera.position.clone();
    const shift = new Vector3(2, 3, 4);
    for (let i = 0; i < 20; i++) {
        const backward = new Vector3(Math.cos(i), -0.5, Math.sin(i)).normalize();
        lookFromEye(camera, Vector3.Up(), backward);
        moveEye(camera, shift);
        camera.getViewMatrix(true);
        expect(Vector3.Distance(camera.position, start.add(shift.scale(i + 1)))).toBeLessThan(1e-5);
        expect(Vector3.Dot(camera.position.subtract(camera.getTarget()).normalize(), backward)).toBeCloseTo(1, 6);
    }
    scene.dispose(); engine.dispose();
});

it("preserves eye, pitch and radius while the local globe horizon turns", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new ArcRotateCamera("inspect", 0, 1, 0.0001, new Vector3(99, 0, 0), scene);
    camera.lowerRadiusLimit = null;
    camera.inputs.clear();
    const pitch = Vector3.Dot(camera.position.subtract(camera.getTarget()).normalize(), camera.upVector);
    for (let i = 1; i <= 100; i++) {
        const eye = camera.position.clone(), radius = camera.radius;
        const up = new Vector3(Math.sin(i / 100), Math.cos(i / 100), 0);
        alignEyeHorizon(camera, up);
        camera.getViewMatrix(true);
        expect(Vector3.Distance(camera.position, eye)).toBeLessThan(1e-9);
        expect(camera.radius).toBeCloseTo(radius, 10);
        expect(Vector3.Dot(camera.position.subtract(camera.getTarget()).normalize(), up)).toBeCloseTo(pitch, 6);
    }
    scene.dispose(); engine.dispose();
});
