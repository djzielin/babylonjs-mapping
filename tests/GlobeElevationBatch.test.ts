import { afterEach, expect, it, vi } from "vitest";
import { NullEngine, Scene, Vector2, VertexBuffer } from "@babylonjs/core";
import GlobeSet from "../src/core/GlobeSet";
import GlobeDataController from "../src/core/GlobeDataController";

vi.mock("../src/core/Attribution", () => ({ default: class { advancedTexture = {}; addAttribution() {} } }));
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(dispose => dispose()); vi.restoreAllMocks(); vi.useRealTimers(); });
function setup() {
    const engine = new NullEngine(), scene = new Scene(engine);
    const globe = new GlobeSet(scene, engine, { radius: 60, backingSurface: false });
    globe.createGeometry(new Vector2(2, 2), 20, 16); globe.updateRaster(35, -79, 13);
    cleanup.push(() => { scene.dispose(); engine.dispose(); });
    return globe;
}
const samples = (index: number) => Float32Array.from({ length: 16 }, (_, point) =>
    index * 41 + (point % 4) * 7.25 - Math.floor(point / 4) * 13.5);

it.each([false, true])("coalesces seam uploads without changing final DEM, positions, normals or queries (%s)", reverse => {
    const synchronous = setup(), batched = setup();
    const syncUpload = vi.spyOn(synchronous, "applyElevationGrid"), batchUpload = vi.spyOn(batched, "applyElevationGrid");
    const order = [0, 1, 2, 3]; if (reverse) order.reverse();
    for (const index of order) {
        synchronous.setElevationData(synchronous.ourTiles[index], samples(index), 4, 4, 1.5);
        batched.setElevationData(batched.ourTiles[index], samples(index), 4, 4, 1.5, true);
    }
    expect(syncUpload.mock.calls.length).toBeGreaterThan(4);
    expect(batchUpload).not.toHaveBeenCalled(); expect(batched.pendingElevationCount).toBe(4);
    batched.flushElevationData();
    expect(batchUpload).toHaveBeenCalledTimes(4); expect(batched.pendingElevationCount).toBe(0);
    for (let index = 0; index < 4; index++) {
        const a = synchronous.ourTiles[index], b = batched.ourTiles[index];
        expect(b.dem).toEqual(a.dem); expect(b.elevationHeights).toEqual(a.elevationHeights);
        expect(b.minHeight).toBe(a.minHeight); expect(b.maxHeight).toBe(a.maxHeight);
        expect(b.mesh.getVerticesData(VertexBuffer.PositionKind)).toEqual(a.mesh.getVerticesData(VertexBuffer.PositionKind));
        expect(b.mesh.getVerticesData(VertexBuffer.NormalKind)).toEqual(a.mesh.getVerticesData(VertexBuffer.NormalKind));
        expect(b.mesh.getIndices()).toEqual(a.mesh.getIndices());
        const point = synchronous.getSurfaceCoordinates(synchronous.getTileSurfacePosition(a.tileCoords));
        expect(batched.sampleElevation(point.latitude, point.longitude)).toBe(synchronous.sampleElevation(point.latitude, point.longitude));
    }
});

it("holds terrain display and controller readiness until posted source-burst uploads finish", async () => {
    vi.useFakeTimers();
    const globe = setup(); globe.setTerrainDisplayRequirement(true);
    const data = new GlobeDataController(globe, { featuresEnabled: false,
        elevation: async () => ({ data: samples(1), width: 4, height: 4 }) });
    cleanup.push(() => data.dispose());
    data.update(); await Promise.resolve(); await Promise.resolve();
    expect(data.stats.active).toBe(0); expect(globe.ourTiles.every(tile => tile.terrainLoaded)).toBe(true);
    expect(data.pendingTerrainCount).toBe(4); expect(data.isTerrainReady).toBe(false);
    expect(globe.ourTiles.every(tile => !globe.isTileDisplayReady(tile))).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(data.isTerrainReady).toBe(true); expect(globe.pendingElevationCount).toBe(0);
    expect(globe.ourTiles.every(tile => globe.isTileDisplayReady(tile))).toBe(true);
});

it("finishes recorded elevations when its controller is disposed before the posted upload refill", async () => {
    vi.useFakeTimers();
    const globe = setup(); globe.setTerrainDisplayRequirement(true);
    const data = new GlobeDataController(globe, { featuresEnabled: false,
        elevation: async () => ({ data: samples(1), width: 4, height: 4 }) });
    const upload = vi.spyOn(globe, "applyElevationGrid");
    data.update(); await Promise.resolve(); await Promise.resolve();
    expect(globe.pendingElevationCount).toBe(4); expect(upload).not.toHaveBeenCalled();
    data.dispose();
    expect(globe.pendingElevationCount).toBe(0); expect(upload).toHaveBeenCalledTimes(4);
    expect(globe.ourTiles.every(tile => globe.isTileDisplayReady(tile))).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(upload).toHaveBeenCalledTimes(4);
});

it("discards deferred uploads belonging to the replaced tile window", () => {
    const globe = setup(), upload = vi.spyOn(globe, "applyElevationGrid");
    globe.setElevationData(globe.ourTiles[0], samples(1), 4, 4, 1, true);
    globe.updateRaster(-33, 151, 13); globe.flushElevationData();
    expect(upload).not.toHaveBeenCalled(); expect(globe.pendingElevationCount).toBe(0);
    expect(globe.ourTiles.every(tile => !tile.terrainLoaded)).toBe(true);
});

it("keeps an explicit synchronous replacement immediate when that tile has a deferred upload", () => {
    const globe = setup(), tile = globe.ourTiles[0], upload = vi.spyOn(globe, "applyElevationGrid");
    globe.setElevationData(tile, samples(0), 4, 4, 1, true);
    expect(upload).not.toHaveBeenCalled();
    globe.setElevationData(tile, samples(2), 4, 4);
    expect(upload).toHaveBeenCalledOnce(); expect(globe.hasPendingElevationData(tile)).toBe(false);
    const positions = [...tile.mesh.getVerticesData(VertexBuffer.PositionKind)!];
    globe.flushElevationData();
    expect(upload).toHaveBeenCalledOnce(); expect([...tile.mesh.getVerticesData(VertexBuffer.PositionKind)!]).toEqual(positions);
});
