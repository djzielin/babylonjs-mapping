import { describe, it, expect, vi } from "vitest";
import {
    ArcRotateCamera,
    NullEngine,
    MeshBuilder,
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
    it("keeps ready building batches through a reload until the caller explicitly clears them", () => {
        const { globe, scene, dispose } = setup();
        const tile = globe.ourTiles[0];
        const ready = MeshBuilder.CreateBox("ready Overture batch", {}, scene);
        ready.setParent(tile.mesh);
        tile.buildingBatches.push(ready);
        const data = new GlobeDataController(globe);
        data.invalidate(false, true);
        expect(ready.isDisposed()).toBe(false);
        expect(tile.buildingBatches).toContain(ready);
        data.invalidate();
        expect(ready.isDisposed()).toBe(true);
        data.dispose(); dispose();
    });
    it("places a marker sphere at a requested latitude and longitude", () => {
        const { globe, scene, dispose } = setup(1, 40.7484, -73.9857, 17);
        expect(globe.getSurfacePosition(0, 0).subtract(new Vector3(0, 0, globe.radius)).length()).toBeLessThan(1e-10);
        expect(globe.getSurfacePosition(0, 90).subtract(new Vector3(-globe.radius, 0, 0)).length()).toBeLessThan(1e-10);
        expect(globe.getSurfacePosition(90, 0).subtract(new Vector3(0, globe.radius, 0)).length()).toBeLessThan(1e-10);
        const marker = MeshBuilder.CreateSphere("Empire State marker", { diameter: 0.001 }, scene);
        marker.position.copyFrom(globe.getSurfacePosition(40.7484, -73.9857, 100 * globe.metresToWorld));
        const result = globe.getSurfaceCoordinates(Vector3.TransformCoordinates(Vector3.Zero(), marker.computeWorldMatrix(true)));
        expect(result.latitude).toBeCloseTo(40.7484, 7);
        expect(result.longitude).toBeCloseTo(-73.9857, 7);
        expect(result.elevation / globe.metresToWorld).toBeCloseTo(100, 5);
        expect(marker.position.length()).toBeGreaterThan(globe.radius);
        dispose();
    });
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
    it("samples resident terrain while geometry precision changes", () => {
        const { globe, dispose } = setup();
        const tile = globe.ourTiles[0];
        globe.setElevationData(tile, [120, 120, 120, 120], 2, 2);
        const center = globe.getSurfaceCoordinates(globe.getTileSurfacePosition(tile.tileCoords));
        globe.meshPrecision = 64;
        expect(globe.sampleElevation(center.latitude, center.longitude)).toBeCloseTo(120 * globe.metresToWorld, 10);
        dispose();
    });
    it("stores an independent compact copy of Float32 elevation grids", () => {
        const { globe, dispose } = setup();
        const tile = globe.ourTiles[0];
        const source = new Float32Array([1.25, -2.5, 3.75, 4.5]);
        globe.setElevationData(tile, source, 2, 2);
        expect(tile.dem).toBeInstanceOf(Float32Array);
        expect(Array.from(tile.dem)).toEqual([1.25, -2.5, 3.75, 4.5]);
        source[0] = 100;
        expect(tile.dem[0]).toBe(1.25);
        expect(tile.minHeight).toBe(-2.5);
        expect(tile.maxHeight).toBe(4.5);
        globe.setElevationData(tile, [Math.PI, 0, 0, 0], 2, 2);
        expect(tile.dem).toBeInstanceOf(Float64Array);
        expect(tile.dem[0]).toBe(Math.PI);
        const bounds = tile.mesh.getBoundingInfo().boundingBox;
        for (const point of worldVertices(tile.mesh)) for (const axis of ["x", "y", "z"] as const) {
            expect(point[axis]).toBeGreaterThanOrEqual(bounds.minimumWorld[axis] - 1e-6);
            expect(point[axis]).toBeLessThanOrEqual(bounds.maximumWorld[axis] + 1e-6);
        }
        dispose();
    });
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
        const bounds = tile.buildings[0].mesh.getBoundingInfo().boundingBox;
        for (const point of world) for (const axis of ["x", "y", "z"] as const) {
            expect(point[axis]).toBeGreaterThanOrEqual(bounds.minimumWorld[axis] - 1e-6);
            expect(point[axis]).toBeLessThanOrEqual(bounds.maximumWorld[axis] + 1e-6);
        }
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
        expect(pending.slice(0, 2).every((p) => p.signal.aborted)).toBe(true);
        expect(loader).toHaveBeenCalledTimes(4);
        expect(data.stats.active).toBe(2);
        pending.slice(0, 2).forEach((p) => p.resolve(grid(999)));
        await Promise.resolve();
        await Promise.resolve();
        expect(globe.ourTiles.every((t) => !t.terrainLoaded)).toBe(true);
        data.update();
        expect(loader).toHaveBeenCalledTimes(4);
        expect(data.stats.active).toBe(2);
        pending.slice(2).forEach((p) => p.resolve(grid(-100)));
        await Promise.resolve();
        await Promise.resolve();
        expect(globe.ourTiles.filter((t) => t.terrainLoaded)).toHaveLength(2);
        expect(data.stats.active).toBe(0);
        data.dispose();
        dispose();
    });
    it("starts the replacement view while aborted requests remain unresolved", async () => {
        const { globe, dispose } = setup();
        const pending: Array<{ resolve: (value: ElevationGrid) => void; signal: AbortSignal }> = [];
        const loader = vi.fn((_c: Vector3, signal: AbortSignal) =>
            new Promise<ElevationGrid>(resolve => pending.push({ resolve, signal })));
        const data = new GlobeDataController(globe, { elevation: loader, concurrency: 1 });
        try {
            data.update();
            expect(loader).toHaveBeenCalledTimes(1);
            data.invalidate();
            data.update();
            expect(pending[0].signal.aborted).toBe(true);
            expect(loader).toHaveBeenCalledTimes(2);
            expect(data.stats.active).toBe(1);
            pending[0].resolve(grid(999));
            await Promise.resolve(); await Promise.resolve();
            expect(data.stats.active).toBe(1);
            expect(globe.ourTiles[0].terrainLoaded).toBe(false);
            pending[1].resolve(grid(25));
            await Promise.resolve(); await Promise.resolve();
            expect(data.stats.active).toBe(0);
            expect(globe.ourTiles[0].terrainLoaded).toBe(true);
        } finally { data.dispose(); dispose(); }
    });
    it("refills completed downloads without waiting for another rendered frame", async () => {
        vi.useFakeTimers();
        const { globe, dispose } = setup(2);
        const pending: ((value: ElevationGrid) => void)[] = [];
        const loader = vi.fn(() => new Promise<ElevationGrid>(resolve => pending.push(resolve)));
        const data = new GlobeDataController(globe, { elevation: loader, concurrency: 1 });
        try {
            data.update();
            expect(loader).toHaveBeenCalledTimes(1);
            pending[0](grid(10));
            await Promise.resolve();
            await vi.advanceTimersByTimeAsync(1);
            expect(loader).toHaveBeenCalledTimes(2);
            expect(data.stats.active).toBe(1);
        } finally { data.dispose(); dispose(); vi.useRealTimers(); }
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
    it("prioritizes the camera eye over a distant orbit target", () => {
        const { globe, scene, dispose } = setup(5);
        const nearest = globe.ourTiles[0];
        const camera = new ArcRotateCamera("eye", 0, 1, 1, globe.getSurfacePosition(35, -79), scene);
        const center = nearest.mesh.getBoundingInfo().boundingSphere.centerWorld;
        camera.setPosition(center.scale(1.00001)); camera.getViewMatrix(true);
        const loader = vi.fn((_coords: Vector3, _signal: AbortSignal) => new Promise<ElevationGrid>(() => {}));
        const data = new GlobeDataController(globe, { elevation: loader, concurrency: 1 });
        try { data.update(); expect(loader.mock.calls[0]?.[0]).toEqual(nearest.tileCoords); }
        finally { data.dispose(); dispose(); }
    });
    it("promotes newly nearby terrain without cancelling an in-window request", async () => {
        const { globe, scene, dispose } = setup(5);
        const first = globe.ourTiles[0], nearby = globe.ourTiles.at(-1)!;
        const camera = new ArcRotateCamera("moving eye", 0, 1, 1, globe.getSurfacePosition(35, -79), scene);
        camera.setPosition(first.mesh.getBoundingInfo().boundingSphere.centerWorld.scale(1.00001));
        camera.getViewMatrix(true);
        const pending: Array<{ resolve: (value: ElevationGrid) => void; signal: AbortSignal }> = [];
        const loader = vi.fn((_coords: Vector3, signal: AbortSignal) =>
            new Promise<ElevationGrid>(resolve => pending.push({ resolve, signal })));
        const data = new GlobeDataController(globe, { elevation: loader, concurrency: 1 });
        try {
            data.update();
            expect(loader.mock.calls[0][0]).toEqual(first.tileCoords);
            camera.setPosition(nearby.mesh.getBoundingInfo().boundingSphere.centerWorld.scale(1.00001));
            camera.getViewMatrix(true);
            data.update();
            expect(pending[0].signal.aborted).toBe(false);
            expect(loader.mock.calls[1][0]).toEqual(nearby.tileCoords);
            expect(data.stats.active).toBe(2);
            pending[0].resolve(grid(999));
            await Promise.resolve(); await Promise.resolve();
            expect(data.stats.active).toBe(1);
            expect(first.terrainLoaded).toBe(true);
            pending[1].resolve(grid(25));
            await Promise.resolve(); await Promise.resolve();
            expect(nearby.terrainLoaded).toBe(true);
            expect(data.stats.active).toBe(0);
        } finally { data.dispose(); dispose(); }
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
    it("automatically retries a transient terrain error without a manual reload", async () => {
        const { globe, dispose } = setup();
        const loader = vi.fn().mockRejectedValueOnce(new Error("temporary outage"))
            .mockResolvedValueOnce(grid(42));
        const data = new GlobeDataController(globe, { elevation: loader });
        const error = vi.fn();
        data.onErrorObservable.add(error);
        data.update();
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2), { timeout: 2000 });
        await vi.waitFor(() => expect(globe.ourTiles[0].terrainLoaded).toBe(true), { timeout: 2000 });
        expect(error).toHaveBeenCalledOnce();
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
    it("repairs isolated pixels and connected DEM pits while retaining broad bathymetry", () => {
        const width = 11, data = new Float32Array(width * width).fill(10);
        data[5 * width + 5] = -272;
        for (let y = 3; y <= 7; y++) data[y * width + 8] = -170;
        for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) data[y * width + x] = -180;
        const source = { data, width, height: width };
        expect(TerrainRGB.repairIsolatedSpikes(source, 7)).toBe(source);
        expect(TerrainRGB.repairIsolatedSpikes(source, 8).data[5 * width + 5]).toBe(10);
        const repaired = TerrainRGB.repairIsolatedSpikes(source, 14);
        expect(repaired.data[5 * width + 5]).toBe(10);
        for (let y = 3; y <= 7; y++) expect(repaired.data[y * width + 8]).toBe(10);
        expect(repaired.data[2 * width + 2]).toBe(10);
        expect(source.data[5 * width + 5]).toBe(-272);
        const broad = new Float32Array(64 * 64).fill(0);
        for (let y = 12; y < 44; y++) for (let x = 12; x < 44; x++) broad[y * 64 + x] = -180;
        const broadSource = { data: broad, width: 64, height: 64 };
        expect(TerrainRGB.repairIsolatedSpikes(broadSource, 14)).toBe(broadSource);
        const impossible = new Float32Array(broad);
        for (let y = 12; y < 44; y++) for (let x = 12; x < 44; x++) impossible[y * 64 + x] = -20000;
        for (let y = 12; y < 44; y++) impossible[y * 64 + 44] = -75;
        expect(TerrainRGB.repairIsolatedSpikes({ data: impossible, width: 64, height: 64 }, 14).data[20 * 64 + 20]).toBe(0);
        expect(TerrainRGB.repairIsolatedSpikes({ data: impossible, width: 64, height: 64 }, 14).data[20 * 64 + 44]).toBe(0);
        // Newport's source DEM contained a 3,430-sample pit reaching the tile
        // edge; its raw adjoining-tile jump exceeded 15 km.
        const waterfront = new Float32Array(256 * 256).fill(2);
        for (let y = 0; y < 36; y++) for (let x = 0; x < 96; x++)
            waterfront[y * 256 + x] = -15400;
        const repairedWaterfront = TerrainRGB.repairIsolatedSpikes({
            data: waterfront, width: 256, height: 256,
        }, 15);
        expect(repairedWaterfront.data[0]).toBe(2);
        expect(repairedWaterfront.data[35 * 256 + 95]).toBe(2);
        expect(waterfront[0]).toBe(-15400);
        const narrowRiverbank = new Float32Array(64 * 64).fill(2);
        for (let y = 8; y < 56; y++) narrowRiverbank[y * 64 + 32] = -76;
        const riverbank = TerrainRGB.repairIsolatedSpikes({ data: narrowRiverbank, width: 64, height: 64 }, 15);
        expect(riverbank.data[30 * 64 + 32]).toBe(2);
        const raisedCoast = new Float32Array(64 * 64).fill(0);
        for (let y = 20; y < 26; y++) for (let x = 20; x < 25; x++) raisedCoast[y * 64 + x] = 71;
        const raised = TerrainRGB.repairIsolatedSpikes({ data: raisedCoast, width: 64, height: 64 }, 13);
        expect(raised.data[23 * 64 + 22]).toBe(0);
        expect(raised.data[23 * 64 + 26]).toBe(0);
        expect(TerrainRGB.repairIsolatedSpikes({ data: raisedCoast, width: 64, height: 64 }, 11).data[23 * 64 + 22]).toBe(0);
        expect(TerrainRGB.repairIsolatedSpikes({ data: raisedCoast, width: 64, height: 64 }, 8).data).toBe(raisedCoast);
        // A Newport z15 source tile leaves a 36 m wall against nearly level
        // ground when only peaks above the old 40 m threshold are repaired.
        const lowRidge = new Float32Array(64 * 64).fill(2);
        for (let y = 20; y < 28; y++) for (let x = 20; x < 27; x++)
            lowRidge[y * 64 + x] = 36;
        expect(TerrainRGB.repairIsolatedSpikes({ data: lowRidge, width: 64, height: 64 }, 15)
            .data[23 * 64 + 23]).toBe(2);
        expect(TerrainRGB.repairIsolatedSpikes({ data: lowRidge, width: 64, height: 64 }, 13)
            .data[23 * 64 + 23]).toBe(2);
        const regionalCoast = new Float32Array(64 * 64).fill(2);
        regionalCoast[33 * 64 + 34] = 21;
        expect(TerrainRGB.repairIsolatedSpikes({ data: regionalCoast, width: 64, height: 64 }, 12)
            .data[33 * 64 + 34]).toBe(2);
        // The Greenpoint regional DEM has adjacent 29-33 m outliers on its
        // southern edge; no sample exists below that edge within this tile.
        const regionalEdge = new Float32Array(64 * 64).fill(6);
        regionalEdge[63 * 64 + 7] = 33;
        regionalEdge[63 * 64 + 8] = 29;
        const repairedEdge = TerrainRGB.repairIsolatedSpikes({ data: regionalEdge, width: 64, height: 64 }, 12);
        expect(repairedEdge.data[63 * 64 + 7]).toBe(6);
        expect(repairedEdge.data[63 * 64 + 8]).toBe(6);
        const shortCoastalSeam = new Float32Array(64 * 64).fill(0);
        for (let y = 15; y < 22; y++) shortCoastalSeam[y * 64 + 15] = 12;
        for (let y = 32; y < 39; y++) shortCoastalSeam[y * 64 + 32] = -16;
        const repairedSeam = TerrainRGB.repairIsolatedSpikes({
            data: shortCoastalSeam, width: 64, height: 64,
        }, 15);
        expect(repairedSeam.data[18 * 64 + 15]).toBe(0);
        expect(repairedSeam.data[35 * 64 + 32]).toBe(0);
        const broadHill = new Float32Array(64 * 64).fill(0);
        for (let y = 8; y < 48; y++) for (let x = 8; x < 48; x++) broadHill[y * 64 + x] = 71;
        expect(TerrainRGB.repairIsolatedSpikes({ data: broadHill, width: 64, height: 64 }, 13).data[25 * 64 + 25]).toBe(71);
        expect(TerrainRGB.repairIsolatedSpikes({ data: broadHill, width: 64, height: 64 }, 10).data[25 * 64 + 25]).toBe(71);
        expect(TerrainRGB.repairIsolatedSpikes({ data: broadHill, width: 64, height: 64 }, 15).data[25 * 64 + 25]).toBe(71);
        const coarseCoast = new Float32Array(64 * 64).fill(1);
        for (const [x, y, height] of [[30, 29, 252], [31, 30, 299], [30, 31, 220],
            [30, 30, -51], [29, 31, -40], [32, 29, -126]]) coarseCoast[y * 64 + x] = height;
        const coarse = TerrainRGB.repairIsolatedSpikes({ data: coarseCoast, width: 64, height: 64 }, 11);
        for (let y = 29; y <= 31; y++) for (let x = 29; x <= 32; x++)
            expect(Math.abs(coarse.data[y * 64 + x] - 1)).toBeLessThan(5);
        const coastalSamples = new Float32Array([-300, -30, -5, 0, 5, 30, 300]);
        const coast = TerrainRGB.smoothNearSeaLevel(coastalSamples, 15);
        expect(coast).toBeDefined();
        expect(coast![2]).toBeGreaterThan(-5);
        expect(coast![4]).toBeLessThan(5);
        expect(coast![0]).toBe(-300);
        expect(coast![6]).toBe(300);
        const deepSea = new Float32Array(11 * 11).fill(-300);
        deepSea[5 * 11 + 5] = -700;
        expect(TerrainRGB.repairIsolatedSpikes({ data: deepSea, width: 11, height: 11 }, 14).data[60]).toBe(-300);
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


it("coalesces overzoom DEM requests without one caller cancelling its neighbours", async () => {
    const terrain = new TerrainRGB({ maxZoom: 0 });
    const crop = vi.spyOn(TerrainRGB, "crop");
    let resolve!: (grid: ElevationGrid) => void;
    const fetchGrid = vi.spyOn(terrain as any, "fetchGrid").mockImplementation(() => new Promise<ElevationGrid>(done => { resolve = done; }));
    const cancelled = new AbortController();
    const first = terrain.load(new Vector3(0, 0, 1), cancelled.signal);
    const second = terrain.load(new Vector3(1, 0, 1), new AbortController().signal);
    cancelled.abort();
    resolve({ data: [0, 1, 2, 3], width: 2, height: 2 });
    await expect(first).rejects.toThrow();
    const child = await second;
    expect(child.data[0]).toBe(1);
    expect(await terrain.load(new Vector3(1, 0, 1), new AbortController().signal)).toBe(child);
    await terrain.load(new Vector3(0, 0, 1), new AbortController().signal);
    expect(fetchGrid).toHaveBeenCalledTimes(1);
    expect(crop).toHaveBeenCalledTimes(2);
    crop.mockRestore();
});


it("overzooms DEM at its source resolution instead of manufacturing redundant samples", () => {
    const data = Float32Array.from({ length: 256 * 256 }, (_, i) => (i % 256) + Math.floor(i / 256) * 2);
    const cropped = TerrainRGB.crop({ data, width: 256, height: 256 }, new Vector3(3, 4, 18), 15);
    expect(cropped.width).toBe(33);
    expect(cropped.height).toBe(33);
    for (let y = 0; y < 33; y++) for (let x = 0; x < 33; x++)
        expect(cropped.data[y * 33 + x]).toBe(96 + x + 2 * (128 + y));
});

it("keeps higher-resolution imagery from duplicating the full-detail building tier", async () => {
    const {globe, dispose} = setup(1,35,-79,15);
    const buildings={SubmitLoadTileRequest:vi.fn(),cancelPendingRequests:vi.fn()} as any;
    const data=new GlobeDataController(globe,{buildings,minBuildingZoom:10,maxBuildingZoom:14});
    data.update();await Promise.resolve();
    expect(buildings.SubmitLoadTileRequest).not.toHaveBeenCalled();
    globe.updateRaster(35,-79,14);data.update();await Promise.resolve();
    expect(buildings.SubmitLoadTileRequest).toHaveBeenCalledOnce();
    data.dispose();dispose();
});

it("loads road features at street zoom without duplicating the Overture building tier", async () => {
    const { globe, dispose } = setup(1, 40.7484, -73.9857, 17);
    const buildings = { SubmitLoadTileRequest: vi.fn(), cancelPendingRequests: vi.fn() } as any;
    const roads = { SubmitLoadTileRequest: vi.fn(), cancelPendingRequests: vi.fn() } as any;
    const data = new GlobeDataController(globe, {
        buildings, features: [roads], minBuildingZoom: 10, maxBuildingZoom: 14,
        minFeatureZoom: 10, maxFeatureZoom: 18,
    });
    data.update();
    await Promise.resolve();
    expect(buildings.SubmitLoadTileRequest).not.toHaveBeenCalled();
    expect(roads.SubmitLoadTileRequest).toHaveBeenCalledOnce();
    data.dispose(); dispose();
});
