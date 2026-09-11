import { ArcRotateCamera, ArcRotateCameraPointersInput, NullEngine, Scene, Vector2, Vector3, VertexBuffer } from "@babylonjs/core";
import { describe, expect, it, vi } from "vitest";

import GlobeNavigator from "../src/GlobeNavigator";
import GlobeSet from "../src/GlobeSet";
import Raster from "../src/Raster";

vi.mock("../src/core/Attribution", () => ({
    default: class AttributionStub {
        public advancedTexture = {};
        public addAttribution = vi.fn();
    },
}));

class TestRaster extends Raster {
    public constructor(tileSet: GlobeSet) {
        super("TEST", tileSet);
    }

    public override getRasterURL(tileCoords: Vector2, zoom: number): string {
        return `test://${zoom}/${tileCoords.x}/${tileCoords.y}`;
    }
}

function createNavigator() {
    const engine = new NullEngine({ renderWidth: 1280, renderHeight: 800, useHighPrecisionMatrix: true });
    const scene = new Scene(engine);
    const globe = new GlobeSet(scene, engine, { radius: 60, backingSurface: false });
    globe.setRasterProvider(new TestRaster(globe));
    globe.createGeometry(new Vector2(3, 3), 20, 4);

    const camera = new ArcRotateCamera(
        "globe camera",
        0,
        Math.PI / 2,
        120,
        Vector3.Zero(),
        scene,
    );
    const navigator = new GlobeNavigator(globe, camera, {
        minZoom: 3,
        maxZoom: 18,
        tileUpdateDelayMs: 0,
    });

    return { engine, scene, globe, camera, navigator };
}

describe("GlobeNavigator", () => {
    it.each([[0, 12], [60, 12], [0, 18], [60, 18]])(
        "keeps a close-up drag proportional to screen pixels at latitude %s and zoom %s",
        (latitude, zoom) => {
            const { engine, scene, globe, camera, navigator } = createNavigator();
            navigator.setView(latitude, 10, { zoom });
            const start = globe.getSurfacePosition(latitude, 10);
            // Project in double precision: cached engine matrices can lose
            // subpixel accuracy at street-level distances from the origin.
            const project = () => {
                camera.getViewMatrix(true);
                const forward = camera.getTarget().subtract(camera.globalPosition).normalize();
                const right = Vector3.Cross(camera.upVector, forward).normalize();
                const up = Vector3.Cross(forward, right).normalize();
                const relative = start.subtract(camera.globalPosition);
                const scale = 400 / (Vector3.Dot(relative, forward) * Math.tan(camera.fov / 2));
                return new Vector2(640 + Vector3.Dot(relative, right) * scale, 400 - Vector3.Dot(relative, up) * scale);
            };
            const before = project();
            const pointers = camera.inputs.attached.pointers as ArcRotateCameraPointersInput;
            pointers.onButtonDown({ button: 0, ctrlKey: false, altKey: false, shiftKey: false });
            pointers.onTouch(null, 20, 20);
            camera._checkInputs();
            const after = project();
            expect(after.x - before.x).toBeCloseTo(20, 0);
            expect(after.y - before.y).toBeCloseTo(20, 0);
            navigator.dispose(); scene.dispose(); engine.dispose();
        },
    );

    it("reduces angular movement continuously when zooming in", () => {
        const { engine, scene, camera, navigator } = createNavigator();
        navigator.setView(0, 0, { zoom: 12 });
        const sensitivity = camera.angularSensibilityY;
        camera.radius = 60 + navigator.getView().altitude / 2;
        navigator.refresh();
        expect(camera.angularSensibilityY).toBeCloseTo(sensitivity * 2, 5);
        navigator.setView(89.9, 0, { zoom: 3 });
        expect(camera.angularSensibilityX).toBeGreaterThanOrEqual(1000);
        expect(Number.isFinite(camera.angularSensibilityY)).toBe(true);
        navigator.dispose(); scene.dispose(); engine.dispose();
    });
    it.each([[0, 0], [40, -74], [-34, 151], [10, 179.9]])(
        "renders imagery east-right and north-up at %s, %s before and after elevation",
        (latitude, longitude) => {
            const { engine, scene, globe, camera, navigator } = createNavigator();
            navigator.setView(latitude, longitude, { zoom: 9 });
            camera.getViewMatrix(true);
            const transform = camera.getViewMatrix().multiply(camera.getProjectionMatrix());
            const viewport = camera.viewport.toGlobal(1280, 800);
            const tile = globe.ourTiles[4];
            const checkOrientation = () => {
                const positions = tile.mesh.getVerticesData(VertexBuffer.PositionKind)!;
                const uvs = tile.mesh.getVerticesData(VertexBuffer.UVKind)!;
                const project = (index: number) => Vector3.Project(
                    Vector3.FromArray(positions, index * 3),
                    tile.mesh.computeWorldMatrix(true), transform, viewport,
                );
                // Raster top-left, top-right and bottom-left in Babylon's default UV convention.
                expect(Array.from(uvs).slice(0, 2)).toEqual([0, 1]);
                expect(project(4).x).toBeGreaterThan(project(0).x);
                expect(project(20).y).toBeGreaterThan(project(0).y);
            };
            checkOrientation();
            globe.setElevationData(tile, new Float32Array([100, 100, 100, 100]), 2, 2);
            checkOrientation();
            const right = navigator.getCoordinatesAtScreenPoint(660, 400)!;
            const top = navigator.getCoordinatesAtScreenPoint(640, 380)!;
            expect(((right.longitude - longitude + 540) % 360) - 180).toBeGreaterThan(0);
            expect(top.latitude).toBeGreaterThan(latitude);
            navigator.dispose();
            scene.dispose();
            engine.dispose();
        },
    );

    it("sets geographic views and selects raster zoom from camera altitude", () => {
        const { engine, scene, globe, camera, navigator } = createNavigator();

        navigator.setView(35.2271, -80.8431, { zoom: 9 });
        const view = navigator.getView();

        expect(view.latitude).toBeCloseTo(35.2271, 8);
        expect(view.longitude).toBeCloseTo(-80.8431, 8);
        expect(view.zoom).toBe(9);
        expect(globe.zoom).toBe(9);
        expect(globe.centerCoords.x).toBeCloseTo(-80.8431, 8);
        expect(globe.centerCoords.y).toBeCloseTo(35.2271, 8);
        expect(navigator.getZoomForAltitude(navigator.getAltitudeForZoom(7))).toBe(7);

        camera.getViewMatrix(true);
        const pickedCenter = navigator.getCoordinatesAtScreenPoint(640, 400);
        expect(pickedCenter?.latitude).toBeCloseTo(35.2271, 4);
        expect(pickedCenter?.longitude).toBeCloseTo(-80.8431, 4);

        navigator.dispose();
        scene.dispose();
        engine.dispose();
    });

    it("supports immediate fly-to and wraps longitudes", () => {
        const { engine, scene, navigator } = createNavigator();

        navigator.flyTo(-33.8688, 511.2093, { zoom: 8, durationMs: 0 });
        const view = navigator.getView();

        expect(view.latitude).toBeCloseTo(-33.8688, 8);
        expect(view.longitude).toBeCloseTo(151.2093, 8);
        expect(view.zoom).toBe(8);

        navigator.dispose();
        scene.dispose();
        engine.dispose();
    });

    it("reuses overlapping globe tile meshes while the detail window moves", () => {
        const { engine, scene, globe, navigator } = createNavigator();

        globe.updateRaster(0, 0, 4);
        const coordinate = new Vector3(8, 8, 4);
        const originalTile = globe.ourTilesMap.get(coordinate.toString());
        expect(originalTile).toBeDefined();

        globe.updateRaster(0, 25, 4);
        expect(globe.ourTilesMap.get(coordinate.toString())).toBe(originalTile);

        navigator.dispose();
        scene.dispose();
        engine.dispose();
    });

    it("validates navigator limits and targets", () => {
        const { engine, scene, globe, camera, navigator } = createNavigator();

        expect(() => navigator.setView(91, 0)).toThrow("latitude must be between -90 and 90");
        expect(() => navigator.flyTo(0, 0, { durationMs: -1 })).toThrow(
            "durationMs must be zero or greater",
        );
        expect(() => navigator.getCoordinatesAtScreenPoint(Number.NaN, 0)).toThrow(
            "screen coordinates must be finite numbers",
        );
        expect(() => new GlobeNavigator(globe, camera, { minZoom: 5, maxZoom: 4 })).toThrow(
            "maxZoom must be an integer greater than or equal to minZoom",
        );

        navigator.dispose();
        scene.dispose();
        engine.dispose();
    });
});
