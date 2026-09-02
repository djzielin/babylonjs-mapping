import { ArcRotateCamera, NullEngine, Scene, Vector2, Vector3 } from "@babylonjs/core";
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
    const engine = new NullEngine({ renderWidth: 1280, renderHeight: 800 });
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
        maxZoom: 12,
        tileUpdateDelayMs: 0,
    });

    return { engine, scene, globe, camera, navigator };
}

describe("GlobeNavigator", () => {
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
