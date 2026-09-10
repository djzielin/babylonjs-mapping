import { describe, it, expect, vi } from "vitest";
import {
    ArcRotateCamera,
    NullEngine,
    Scene,
    Vector2,
    Vector3,
    VertexBuffer,
} from "@babylonjs/core";
import GlobeSet from "../src/core/GlobeSet";
import GlobeNavigator from "../src/core/GlobeNavigator";
import GlobeDataController from "../src/core/GlobeDataController";
import TerrainRGB, { type ElevationGrid } from "../src/terrain/TerrainRGB";
import BuildingsOSM from "../src/buildings/BuildingsOSM";
import { GeoJSON, type feature } from "../src/buildings/GeoJSON";
import { EPSG_Type } from "../src/core/TileMath";

vi.mock("../src/core/Attribution", () => ({
    default: class {
        advancedTexture = {};
        addAttribution() {}
    },
}));
function setup(size = 1, latitude = 35, longitude = -79, zoom = 15) {
    const engine = new NullEngine({
            renderWidth: 512,
            renderHeight: 512,
            textureSize: 512,
            deterministicLockstep: false,
            lockstepMaxSteps: 4,
            useHighPrecisionMatrix: true,
        }),
        scene = new Scene(engine);
    const globe = new GlobeSet(scene, engine, {
        radius: 60,
        backingSurface: false,
    });
    globe.createGeometry(new Vector2(size, size), 20, 8);
    globe.updateRaster(latitude, longitude, zoom);
    return {
        globe,
        scene,
        dispose: () => {
            scene.dispose();
            engine.dispose();
        },
    };
}
function worldVertices(mesh: any): Vector3[] {
    const data = mesh.getVerticesData(VertexBuffer.PositionKind),
        matrix = mesh.computeWorldMatrix(true),
        points = [];
    for (let i = 0; i < data.length; i += 3)
        points.push(
            Vector3.TransformCoordinates(
                new Vector3(data[i], data[i + 1], data[i + 2]),
                matrix,
            ),
        );
    return points;
}
const grid = (height: number): ElevationGrid => ({
    data: [height, height, height, height],
    width: 2,
    height: 2,
});

describe("globe data fidelity", () => {
    it.each([false, true])("joins mismatched tile edges and corners regardless of arrival order (%s)", reverse => {
        const { globe, dispose } = setup(2);
        const tiles = [...globe.ourTiles];
        if (reverse) tiles.reverse();
        for (const tile of tiles) {
            const h = (tile.tileCoords.x % 10) * 10 + (tile.tileCoords.y % 10);
            globe.setElevationData(tile, [h, h + 30, h - 20, h + 10], 2, 2);
        }
        const p = globe.meshPrecision, n = p + 1;
        for (const tile of tiles) {
            const vertices = worldVertices(tile.mesh);
            expect(vertices).toHaveLength(n * n);
            for (const neighbor of tiles) {
                const other = worldVertices(neighbor.mesh);
                if (neighbor.tileCoords.x === tile.tileCoords.x + 1 && neighbor.tileCoords.y === tile.tileCoords.y) {
                    for (let y = 0; y <= p; y++) expect(Vector3.Distance(vertices[y * n + p], other[y * n])).toBeLessThan(1e-7);
                }
                if (neighbor.tileCoords.y === tile.tileCoords.y + 1 && neighbor.tileCoords.x === tile.tileCoords.x) {
                    for (let x = 0; x <= p; x++) expect(Vector3.Distance(vertices[p * n + x], other[x])).toBeLessThan(1e-7);
                }
            }
        }
        dispose();
    });
    it("has no vertical skirt walls on the visible terrain", () => {
        const { globe, dispose } = setup();
        const tile = globe.ourTiles[0];
        globe.setElevationData(tile, [200, 200, 200, 200], 2, 2);
        const points = worldVertices(tile.mesh);
        const normals = tile.mesh.getVerticesData(VertexBuffer.NormalKind)!;
        const surfaceCount = (globe.meshPrecision + 1) ** 2;
        // Include every edge and corner, where shared skirt normals caused a grid.
        for (let i = 0; i < surfaceCount; i++) {
            expect(Vector3.Dot(points[i].normalize(), Vector3.FromArray(normals, i * 3))).toBeGreaterThan(0.999);
        }
        const surfaceIndexCount = globe.meshPrecision ** 2 * 6;
        const skirtIndices = Array.from(tile.mesh.getIndices()!).slice(surfaceIndexCount);
        expect(skirtIndices).toHaveLength(0);
        expect(points).toHaveLength(surfaceCount);
        dispose();
    });
    it.each([0, 35, -60, 84])(
        "places signed elevations radially at latitude %i",
        (latitude) => {
            const { globe, dispose } = setup(1, latitude);
            const tile = globe.ourTiles[0];
            globe.setElevationData(tile, [-500, -500, -500, -500], 2, 2, 2);
            for (const point of worldVertices(tile.mesh).slice(0, 81))
                expect(point.length()).toBeCloseTo(
                    60 - 1000 * globe.metresToWorld,
                    7,
                );
            expect(tile.terrainLoaded).toBe(true);
            const center = globe.getSurfaceCoordinates(
                globe.getTileSurfacePosition(tile.tileCoords),
            );
            expect(
                globe.sampleElevation(center.latitude, center.longitude),
            ).toBeCloseTo(-1000 * globe.metresToWorld, 10);
            dispose();
        },
    );
    it("preserves building height, pitched roofs and geographic placement above terrain", () => {
        const { globe, scene, dispose } = setup();
        const tile = globe.ourTiles[0];
        globe.setElevationData(tile, [1000, 1000, 1000, 1000], 2, 2);
        const center = globe.getSurfaceCoordinates(
            globe.getTileSurfacePosition(tile.tileCoords),
        );
        const x = center.longitude,
            y = center.latitude,
            d = 0.0001;
        const f: feature = {
            id: "building",
            type: "Feature",
            properties: { height: 100, roofShape: "gabled", roofHeight: 20 },
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [x - d, y - d],
                        [x + d, y - d],
                        [x + d, y + d],
                        [x - d, y + d],
                        [x - d, y - d],
                    ],
                ],
            },
        };
        const settings = new BuildingsOSM(globe);
        new GeoJSON(globe, scene).generateSingleBuilding(
            "test",
            f,
            EPSG_Type.EPSG_4326,
            tile,
            false,
            settings,
        );
        expect(tile.buildings).toHaveLength(1);
        const heights = worldVertices(tile.buildings[0].mesh).map(
            (p) => (p.length() - globe.radius) / globe.metresToWorld,
        );
        expect(Math.min(...heights)).toBeCloseTo(1000, 2);
        expect(Math.max(...heights)).toBeCloseTo(1100, 2);
        const normals = tile.buildings[0].mesh.getVerticesData(VertexBuffer.NormalKind)!;
        const world = worldVertices(tile.buildings[0].mesh);
        const roofNormals = heights.map((h,i)=>h>1099 ? Vector3.Dot(new Vector3(normals[i*3],normals[i*3+1],normals[i*3+2]),world[i].normalizeToNew()) : -1);
        expect(Math.max(...roofNormals)).toBeGreaterThan(0.1);
        const vertices = tile.buildings[0].mesh.getVerticesData(
            VertexBuffer.PositionKind,
        )!;
        expect(Math.max(...Array.from(vertices).map(Math.abs))).toBeLessThan(
            0.01,
        );
        dispose();
    });
    it("keeps public coordinate round trips spherical and generation coordinates planar", () => {
        const { globe, dispose } = setup();
        const ll = new Vector2(-79, 35);
        const point = globe.ourTileMath.EPSG_to_Game(ll, EPSG_Type.EPSG_4326);
        expect(point.length()).toBeCloseTo(60, 9);
        expect(globe.ourTileMath.Game_to_LonLat(point).x).toBeCloseTo(ll.x, 9);
        expect(
            globe
                .getGeometryMath()
                .EPSG_to_Game(ll, EPSG_Type.EPSG_4326)
                .length(),
        ).toBeCloseTo(0, 9);
        dispose();
    });
    it("retains overlapping geometry, DEM and in-flight imagery when the view moves", () => {
        const { globe, dispose } = setup(3);
        const old = [...globe.ourTiles];
        const retained = old[4];
        globe.setElevationData(retained, [50, 50, 50, 50], 2, 2);
        const update = vi.spyOn(retained.mesh, "setVerticesData");
        const coords = retained.tileCoords.clone();
        const lon = globe.ourTileMath.tile_to_lon(coords.x + 1.5, coords.z);
        globe.updateRaster(35, lon, 15);
        expect(globe.ourTilesMap.get(coords.toString())).toBe(retained);
        expect(retained.terrainLoaded).toBe(true);
        expect(update).not.toHaveBeenCalled();
        expect((globe as any).tileRequests).toHaveLength(9);
        dispose();
    });
    it("does no reprojection for an unchanged view", () => {
        const { globe, dispose } = setup(3);
        const project = vi.spyOn(globe, "getTileSurfacePosition");
        for (let i = 0; i < 20; i++) globe.updateRaster(35, -79, 15);
        expect(project).not.toHaveBeenCalled();
        dispose();
    });
    it("stitches elevation rather than global Y and keeps globe LOD radial", () => {
        const { globe, dispose } = setup(2);
        for (const tile of globe.ourTiles)
            globe.setElevationData(tile, [200, 200, 200, 200], 2, 2);
        globe.ourTerrainMB.fixTileSeams();
        globe.setupTerrainLOD([4, 2], [1, 2], 0.001);
        for (const tile of globe.ourTiles) {
            for (const mesh of [tile.mesh, ...tile.terrainLODMeshes]) {
                const points = worldVertices(mesh);
                const normals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
                // Check the surface normal in each resolution.
                const index = mesh === tile.mesh ? 10 : mesh === tile.terrainLODMeshes[0] ? 6 : 4;
                expect(Vector3.Dot(points[index].normalize(), Vector3.FromArray(normals, index * 3))).toBeGreaterThan(0.99);
            }
            const points = worldVertices(tile.terrainLODMeshes[0]);
            for (const p of points.slice(0, 25))
                expect(p.length()).toBeCloseTo(
                    60 + 200 * globe.metresToWorld,
                    6,
                );
        }
        dispose();
    });
    it("retains coastline edges at every LOD without extruding tile walls", () => {
        const { globe, dispose } = setup(2, 40.7, -74, 11);
        for (const tile of globe.ourTiles) {
            const heights = Array.from({ length: 81 }, (_, i) =>
                i % 9 < 4 ? -40 : 20 + 15 * Math.sin(i));
            globe.setElevationData(tile, heights, 9, 9);
        }
        // Include a precision which does not divide the source grid.
        globe.setupTerrainLOD([4, 3, 2], [1, 2, 3], 10);
        for (const tile of globe.ourTiles) {
            const source = tile.mesh.getVerticesData(VertexBuffer.PositionKind)!;
            const fullWorld = worldVertices(tile.mesh);
            for (const lod of tile.terrainLODMeshes) {
                const points = worldVertices(lod);
                const positions = lod.getVerticesData(VertexBuffer.PositionKind)!;
                const uv = lod.getVerticesData(VertexBuffer.UVKind)!;
                const referenced = new Set(lod.getIndices()!);
                for (let y = 0; y <= 8; y++) for (let x = 0; x <= 8; x++) {
                    if (x !== 0 && x !== 8 && y !== 0 && y !== 8) continue;
                    expect(points.some((p, i) => referenced.has(i) &&
                        Vector3.Distance(p, fullWorld[y * 9 + x]) < 1e-7)).toBe(true);
                }
                // Every vertex must sample the original surface at its UV;
                // a lowered skirt vertex would fail even when its top edge matches.
                for (let i = 0; i < points.length; i++) {
                    const x = uv[i * 2] * 8, y = (1 - uv[i * 2 + 1]) * 8;
                    const x0 = Math.floor(x), y0 = Math.floor(y);
                    const x1 = Math.min(8, x0 + 1), y1 = Math.min(8, y0 + 1);
                    for (let axis = 0; axis < 3; axis++) {
                        const sample = (xx: number, yy: number) => source[(yy * 9 + xx) * 3 + axis];
                        const top = sample(x0, y0) * (1 - x + x0) + sample(x1, y0) * (x - x0);
                        const bottom = sample(x0, y1) * (1 - x + x0) + sample(x1, y1) * (x - x0);
                        expect(positions[i * 3 + axis]).toBeCloseTo(top * (1 - y + y0) + bottom * (y - y0), 6);
                    }
                }
            }
        }
        dispose();
    });
    it("rejects bad numeric grids without modifying terrain", () => {
        const { globe, dispose } = setup();
        const tile = globe.ourTiles[0];
        expect(() =>
            globe.setElevationData(tile, [0, NaN, 0, 0], 2, 2),
        ).toThrow();
        expect(() => globe.setElevationData(tile, [0, 0, 0], 2, 2)).toThrow();
        expect(tile.terrainLoaded).toBe(false);
        dispose();
    });
    it("keeps polar requests inside the Mercator grid", () => {
        const { globe, dispose } = setup(5, 89, 179, 3);
        expect(
            globe.ourTiles.every(
                (t) => t.tileCoords.y >= 0 && t.tileCoords.y < 8,
            ),
        ).toBe(true);
        dispose();
    });
});

describe("seafloor navigation",()=>{
    it("picks the near seafloor when the camera is below sea level",()=>{
        const {globe,scene,dispose}=setup();
        globe.setElevationData(globe.ourTiles[0],[-1000,-1000,-1000,-1000],2,2);
        const center=globe.getSurfaceCoordinates(globe.getTileSurfacePosition(globe.ourTiles[0].tileCoords));
        const camera=new ArcRotateCamera('camera',0,1,80,Vector3.Zero(),scene);
        const navigator=new GlobeNavigator(globe,camera,{autoUpdateRaster:false});
        navigator.setView(center.latitude,center.longitude,{zoom:18});
        expect(camera.radius).toBeLessThan(globe.radius);
        const picked=navigator.getCoordinatesAtScreenPoint(256,256)!;
        expect(picked.latitude).toBeCloseTo(center.latitude,5);
        expect(picked.longitude).toBeCloseTo(center.longitude,5);
        navigator.dispose();dispose();
    });
});

describe("bounded detail streaming", () => {
    it("spreads patch generation across budgets and exposes readiness to loaders", () => {
        const { scene, dispose } = setup();
        let time = 0;
        const clock = vi
            .spyOn(performance, "now")
            .mockImplementation(() => (time += 3));
        const globe = new GlobeSet(scene, scene.getEngine() as any, {
            backingSurface: false,
            geometryBudgetMs: 1,
        });
        globe.createGeometry(new Vector2(2, 2), 20, 8);
        globe.updateRaster(35, -79, 15);
        expect(
            globe.ourTiles.filter((t) => globe.isTileGeometryReady(t)),
        ).toHaveLength(1);
        expect(globe.pendingGeometryCount).toBe(3);
        for (let i = 0; i < 3; i++) (globe as any).flushGeometry();
        expect(globe.ourTiles.every((t) => globe.isTileGeometryReady(t))).toBe(
            true,
        );
        clock.mockRestore();
        dispose();
    });

    it("limits concurrency and drops late results after relocation", async () => {
        const { globe, dispose } = setup(2);
        const pending: Array<{
            resolve: (grid: ElevationGrid) => void;
            signal: AbortSignal;
        }> = [];
        const loader = vi.fn(
            (_c: Vector3, signal: AbortSignal) =>
                new Promise<ElevationGrid>((resolve) =>
                    pending.push({ resolve, signal }),
                ),
        );
        const data = new GlobeDataController(globe, {
            elevation: loader,
            concurrency: 2,
        });
        data.update();
        data.update();
        expect(loader).toHaveBeenCalledTimes(2);
        globe.updateRaster(-33, 151, 15);
        data.update();
        expect(pending.every((p) => p.signal.aborted)).toBe(true);
        pending.forEach((p) => p.resolve(grid(999)));
        await Promise.resolve();
        await Promise.resolve();
        expect(globe.ourTiles.every((t) => !t.terrainLoaded)).toBe(true);
        data.update();
        expect(loader).toHaveBeenCalledTimes(4);
        pending.slice(2).forEach((p) => p.resolve(grid(-100)));
        await Promise.resolve();
        await Promise.resolve();
        expect(globe.ourTiles.filter((t) => t.terrainLoaded)).toHaveLength(2);
        expect(data.stats.active).toBe(0);
        data.dispose();
        dispose();
    });
    it("starts terrain nearest the viewer before distant grid corners", () => {
        const { globe, dispose } = setup(5);
        const loader = vi.fn((_coords: Vector3, _signal: AbortSignal) => new Promise<ElevationGrid>(() => {}));
        const data = new GlobeDataController(globe, { elevation: loader, concurrency: 1 });
        data.update();
        const first = loader.mock.calls[0][0] as unknown as Vector3;
        const cx = globe.ourTileMath.lon_to_tile(globe.centerCoords.x, globe.zoom);
        const cy = globe.ourTileMath.lat_to_tile(globe.centerCoords.y, globe.zoom);
        expect(first.x).toBe(cx);
        expect(first.y).toBe(cy);
        data.dispose(); dispose();
    });
    it("reports errors once and explicitly retries on invalidation", async () => {
        const { globe, dispose } = setup();
        const loader = vi.fn(async () => {
            throw new Error("offline");
        });
        const data = new GlobeDataController(globe, { elevation: loader });
        const error = vi.fn();
        data.onErrorObservable.add(error);
        data.update();
        await Promise.resolve();
        await Promise.resolve();
        data.update();
        expect(loader).toHaveBeenCalledOnce();
        expect(error).toHaveBeenCalledOnce();
        data.invalidate();
        data.update();
        await Promise.resolve();
        await Promise.resolve();
        expect(loader).toHaveBeenCalledTimes(2);
        data.dispose();
        dispose();
    });
});

describe("terrain encodings and overzoom", () => {
    it("decodes genuine signed Terrarium and Mapbox values", () => {
        expect(
            Array.from(
                TerrainRGB.decode(
                    [128, 0, 0, 255, 127, 255, 0, 255, 128, 1, 128, 255],
                    "terrarium",
                ),
            ),
        ).toEqual([0, -1, 1.5]);
        expect(TerrainRGB.decode([0, 0, 0, 255], "mapbox")[0]).toBe(-10000);
    });
    it("samples the correct ancestor quadrant when overzooming", () => {
        const data = Array.from({ length: 16 }, (_, i) => i);
        const left = TerrainRGB.crop(
            { data, width: 4, height: 4 },
            new Vector3(0, 0, 1),
            0,
        );
        const right = TerrainRGB.crop(
            { data, width: 4, height: 4 },
            new Vector3(1, 0, 1),
            0,
        );
        expect(left.data[0]).toBe(0);
        expect(right.data[0]).toBe(2);
        expect(left.data[left.width - 1]).toBe(right.data[0]);
    });
});


it("parks a completed detail queue and wakes it when the globe moves", async () => {
    const { globe, dispose } = setup();
    const elevation = vi.fn(async () => grid(100));
    const data = new GlobeDataController(globe, { elevation });
    data.update();
    await Promise.resolve();
    data.update();
    const scan = vi.spyOn(globe, "isTileGeometryReady");
    for (let i = 0; i < 100; i++) data.update();
    expect(scan).not.toHaveBeenCalled();
    globe.updateRaster(36, -78, 15);
    data.update();
    await Promise.resolve();
    expect(elevation).toHaveBeenCalledTimes(2);
    data.invalidate();
    data.update();
    await Promise.resolve();
    expect(elevation).toHaveBeenCalledTimes(3);
    data.dispose(); dispose();
});
