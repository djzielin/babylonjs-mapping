import { NullEngine, Scene, Vector2, Vector3, VertexBuffer } from "@babylonjs/core";
import { describe, expect, it, vi } from "vitest";

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

function createGlobe(options?: ConstructorParameters<typeof GlobeSet>[2]) {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const globe = new GlobeSet(scene, engine, options);
    globe.setRasterProvider(new TestRaster(globe));
    globe.createGeometry(new Vector2(1, 1), 20, 2);

    return { engine, scene, globe };
}

describe("GlobeSet", () => {
    it("maps a raster tile onto an outward-facing spherical patch", () => {
        const { engine, scene, globe } = createGlobe({ radius: 25 });
        globe.updateRaster(0, 0, 2);

        const tile = globe.ourTiles[0];
        const positions = tile.mesh.getVerticesData(VertexBuffer.PositionKind);
        const normals = tile.mesh.getVerticesData(VertexBuffer.NormalKind);

        expect(positions).not.toBeNull();
        expect(normals).not.toBeNull();
        expect(positions).toHaveLength(27);
        expect(normals).toHaveLength(27);

        for (let index = 0; index < positions!.length; index += 3) {
            const point = new Vector3(positions![index], positions![index + 1], positions![index + 2]);
            expect(point.length()).toBeCloseTo(globe.radius, 5);

            const normal = new Vector3(normals![index], normals![index + 1], normals![index + 2]);
            // Normals are averaged over the low-resolution test patch, so
            // they are outward-facing without being exactly radial.
            expect(Vector3.Dot(point.normalize(), normal)).toBeGreaterThan(0.8);
        }

        const uvs = tile.mesh.getVerticesData(VertexBuffer.UVKind);
        expect(Array.from(uvs ?? [])).toEqual([
            0, 1, 0.5, 1, 1, 1,
            0, 0.5, 0.5, 0.5, 1, 0.5,
            0, 0, 0.5, 0, 1, 0,
        ]);

        scene.dispose();
        engine.dispose();
    });

    it("provides surface positions and normals for globe overlays", () => {
        const { engine, scene, globe } = createGlobe({ radius: 10 });

        expect(globe.getSurfacePosition(0, 0)).toEqual(new Vector3(0, 0, 10));
        expect(globe.getSurfacePosition(90, 0).y).toBeCloseTo(10);
        expect(globe.getSurfacePosition(0, 90).x).toBeCloseTo(10);
        expect(globe.getSurfacePosition(0, 0, 2).z).toBeCloseTo(12);

        const normal = globe.getSurfaceNormal(0, 90);
        expect(normal.x).toBeCloseTo(1);
        expect(normal.y).toBeCloseTo(0);
        expect(normal.z).toBeCloseTo(0);

        const tilePoint = globe.getTileSurfacePosition(new Vector3(2, 2, 2));
        expect(tilePoint.length()).toBeCloseTo(10);

        scene.dispose();
        engine.dispose();
    });

    it("validates radius and surface coordinates", () => {
        const { engine, scene, globe } = createGlobe();

        expect(() => new GlobeSet(scene, engine, { radius: 0 })).toThrow(
            "radius must be a finite number greater than zero",
        );
        expect(() => globe.getSurfacePosition(91, 0)).toThrow(
            "latitude must be a finite value between -90 and 90 degrees",
        );
        expect(() => globe.getTileSurfacePosition(new Vector3(0, 0, 2), 1.1)).toThrow(
            "tile surface coordinates u and v must be between 0 and 1",
        );
        expect(() => globe.getSurfacePosition(0, 0, -100)).toThrow(
            "elevation must keep the resulting globe radius positive",
        );

        scene.dispose();
        engine.dispose();
    });
});
