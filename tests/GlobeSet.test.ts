import { NullEngine, Scene, Vector2, Vector3, VertexBuffer } from "@babylonjs/core";
import { describe, expect, it, vi } from "vitest";

import GlobeSet from "../src/GlobeSet";
import Raster from "../src/Raster";

vi.mock("../src/core/Attribution", () => ({
    default: class AttributionStub {
        public advancedTexture = { layer: { isEnabled: true } };
        public addAttribution = vi.fn();
        public constructor(_scene: Scene, deferred = false) {
            this.advancedTexture.layer.isEnabled = !deferred;
        }
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
    it.each([-79, -180])("preserves four-way corners when a nearby flat tile reloads at longitude %s", longitude => {
        const { engine, scene, globe } = createGlobe({ backingSurface: false });
        globe.createGeometry(new Vector2(3, 3), 20, 2);
        globe.updateRaster(35, longitude, 15);
        const minX = Math.min(...globe.ourTiles.map(tile => tile.tileCoords.x));
        const minY = Math.min(...globe.ourTiles.map(tile => tile.tileCoords.y));
        const tileAt = (x: number, y: number) => globe.ourTiles.find(tile =>
            tile.tileCoords.x === minX + x && tile.tileCoords.y === minY + y)!;
        const load = (x: number, y: number, height: number) =>
            globe.setElevationData(tileAt(x, y), [height, height, height, height], 2, 2);
        for (const tile of globe.ourTiles) globe.setElevationData(tile, [0, 0, 0, 0], 2, 2);
        load(0, 0, 100);
        const p = globe.meshPrecision, n = p + 1;
        const corners = () => [
            tileAt(0, 0).elevationHeights![p * n + p],
            tileAt(1, 0).elevationHeights![p * n],
            tileAt(0, 1).elevationHeights![p],
            tileAt(1, 1).elevationHeights![0],
        ].map(height => height / globe.metresToWorld);
        expect(corners()).toEqual([25, 25, 25, 25]);

        // The reload's neighbours include only the eastern pair of corner
        // contributors. Their remote corner must retain the four-way average.
        load(2, 0, 0);
        expect(corners()).toEqual([25, 25, 25, 25]);
        load(0, 2, 0);
        load(2, 2, 0);
        expect(corners()).toEqual([25, 25, 25, 25]);

        // A change which touches this corner must still update all four tiles.
        load(0, 0, 200);
        expect(corners()).toEqual([50, 50, 50, 50]);
        scene.dispose(); engine.dispose();
    });

    it.each([false, true])("keeps complete border averages throughout a larger DEM window load (%s)", reverse => {
        const { engine, scene, globe } = createGlobe({ backingSurface: false });
        globe.createGeometry(new Vector2(3, 3), 20, 2);
        globe.updateRaster(35, -79, 15);
        const tiles = [...globe.ourTiles];
        if (reverse) tiles.reverse();
        const sources = new Map<GlobeSet["ourTiles"][number], number>();
        const p = globe.meshPrecision, n = p + 1;
        for (const [tileIndex, tile] of tiles.entries()) {
            const height = (tileIndex + 1) * 10;
            sources.set(tile, height);
            globe.setElevationData(tile, [height, height, height, height], 2, 2);
            const groups = new Map<string, { source: number; actual: number }[]>();
            for (const [loaded, source] of sources) {
                for (let y = 0; y <= p; y++) for (let x = 0; x <= p; x++) {
                    if (x !== 0 && x !== p && y !== 0 && y !== p) continue;
                    const key = `${loaded.tileCoords.x * p + x}/${loaded.tileCoords.y * p + y}`;
                    const group = groups.get(key) ?? [];
                    group.push({ source, actual: loaded.elevationHeights![y * n + x] / globe.metresToWorld });
                    groups.set(key, group);
                }
            }
            for (const group of groups.values()) {
                const average = group.reduce((sum, item) => sum + item.source, 0) / group.length;
                for (const item of group) expect(item.actual).toBeCloseTo(average, 10);
            }
        }
        scene.dispose(); engine.dispose();
    });

    it("feathers the outer boundary while keeping the interior opaque", () => {
        const { engine, scene, globe } = createGlobe({ radius: 25, edgeFadeTiles: 1 });
        globe.createGeometry(new Vector2(3, 3), 20, 4);
        globe.updateRaster(35, 139, 12);
        const minX = Math.min(...globe.ourTiles.map(t => t.tileCoords.x));
        const minY = Math.min(...globe.ourTiles.map(t => t.tileCoords.y));
        const corner = globe.ourTiles.find(t => t.tileCoords.x === minX && t.tileCoords.y === minY)!;
        const center = globe.ourTiles.find(t => t.tileCoords.x === minX + 1 && t.tileCoords.y === minY + 1)!;
        const colors = corner.mesh.getVerticesData(VertexBuffer.ColorKind)!;
        expect(colors[3]).toBe(0);
        expect(colors[(2 * 5 + 2) * 4 + 3]).toBeCloseTo(0.5);
        expect(center.mesh.getVerticesData(VertexBuffer.ColorKind)![3]).toBe(1);
        expect(corner.mesh.hasVertexAlpha).toBe(true);
        globe.setElevationData(corner, [0, 100, 200, 300], 2, 2);
        expect(corner.mesh.getVerticesData(VertexBuffer.ColorKind)).toEqual(colors);
        scene.dispose(); engine.dispose();
    });
    it("maps a raster tile onto an outward-facing spherical patch", () => {
        const { engine, scene, globe } = createGlobe({ radius: 25 });
        globe.updateRaster(0, 0, 2);

        const tile = globe.ourTiles[0];
        expect(scene.getMeshByName("globe north polar cap")).not.toBeNull();
        expect(scene.getMeshByName("globe south polar cap")).not.toBeNull();
        const positions = tile.mesh.getVerticesData(VertexBuffer.PositionKind);
        const normals = tile.mesh.getVerticesData(VertexBuffer.NormalKind);

        expect(positions).not.toBeNull();
        expect(normals).not.toBeNull();
        expect(positions).toHaveLength(27);
        expect(normals).toHaveLength(27);

        // Check actual winding too: supplied radial normals can hide inward faces.
        const indices = tile.mesh.getIndices()!;
        for (let i = 0; i < indices.length; i += 3) {
            const a = Vector3.FromArray(positions!, indices[i] * 3);
            const b = Vector3.FromArray(positions!, indices[i + 1] * 3);
            const c = Vector3.FromArray(positions!, indices[i + 2] * 3);
            expect(Vector3.Dot(Vector3.Cross(c.subtract(a), b.subtract(a)), a)).toBeGreaterThan(0);
        }

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

        expect(globe.getSurfacePosition(0, 0)).toEqual(new Vector3(-0, 0, 10));
        expect(globe.getSurfacePosition(90, 0).y).toBeCloseTo(10);
        expect(globe.getSurfacePosition(0, 90).x).toBeCloseTo(-10);
        expect(globe.getSurfacePosition(0, 0, 2).z).toBeCloseTo(12);

        const normal = globe.getSurfaceNormal(0, 90);
        expect(normal.x).toBeCloseTo(-1);
        expect(normal.y).toBeCloseTo(0);
        expect(normal.z).toBeCloseTo(0);

        const coordinates = globe.getSurfaceCoordinates(
            globe.getSurfacePosition(35.2271, -80.8431, 2),
        );
        expect(coordinates.latitude).toBeCloseTo(35.2271, 8);
        expect(coordinates.longitude).toBeCloseTo(-80.8431, 8);
        expect(coordinates.elevation).toBeCloseTo(2, 8);

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
        expect(() => globe.getSurfaceCoordinates(Vector3.Zero())).toThrow(
            "position must be a finite, non-zero vector",
        );

        scene.dispose();
        engine.dispose();
    });

    it("can omit the backing surface for a higher-resolution overlay", () => {
        const { engine, scene, globe } = createGlobe({
            backingSurface: false,
            attribution: false,
        });

        expect(scene.getMeshByName("globe backing")).toBeNull();
        expect(scene.getMeshByName("globe north polar cap")).toBeNull();
        globe.updateRaster(0, 0, 2);
        expect(globe.ourAttribution.addAttribution).not.toHaveBeenCalled();
        expect(globe.ourAttribution.advancedTexture.layer?.isEnabled).toBe(false);

        scene.dispose();
        engine.dispose();
    });
});
