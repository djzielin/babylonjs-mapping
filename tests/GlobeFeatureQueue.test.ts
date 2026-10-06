import { afterEach, describe, expect, it, vi } from "vitest";
import { FreeCamera, NullEngine, Scene, Vector2, Vector3 } from "@babylonjs/core";
import GlobeSet from "../src/core/GlobeSet";
import GlobeDataController, { GlobeFeatureQueue } from "../src/core/GlobeDataController";
import type Buildings from "../src/buildings/Buildings";
import BuildingsOverture from "../src/buildings/BuildingsOverture";
import type Tile from "../src/core/Tile";
import type { ElevationGrid } from "../src/terrain/TerrainRGB";

vi.mock("../src/core/Attribution", () => ({
    default: class { advancedTexture = {}; addAttribution() {} },
}));

const cleanup: (() => void)[] = [];
afterEach(() => {
    for (const dispose of cleanup.splice(0).reverse()) dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

function setup(size = 2, geometryBudgetMs?: number) {
    const engine = new NullEngine(), scene = new Scene(engine);
    const tier = () => {
        const globe = new GlobeSet(scene, engine, { radius: 60, backingSurface: false, geometryBudgetMs });
        globe.createGeometry(new Vector2(size, size), 20, 8);
        globe.updateRaster(35, -79, 15);
        return globe;
    };
    cleanup.push(() => { scene.dispose(); engine.dispose(); });
    return { scene, tier, globe: tier() };
}
function provider(loadConcurrency = 2) {
    let pending = 0;
    const requests: Tile[] = [];
    const source = {
        loadConcurrency,
        get pendingRequestCount() { return pending; },
        SubmitLoadTileRequest: vi.fn((tile: Tile) => { requests.push(tile); pending++; }),
        cancelPendingRequests: vi.fn(() => { pending = 0; }),
    } as unknown as Buildings;
    return { source, requests, finish: (count = pending) => { pending = Math.max(0, pending - count); } };
}
const grid: ElevationGrid = { width: 2, height: 2, data: [10, 10, 10, 10] };
function controller(globe: GlobeSet, options: ConstructorParameters<typeof GlobeDataController>[1]) {
    const data = new GlobeDataController(globe, options);
    cleanup.push(() => data.dispose());
    return data;
}
function featureQueue(scene: Scene, maxPendingRequests: number) {
    const queue = new GlobeFeatureQueue(scene, { maxPendingRequests });
    cleanup.push(() => queue.dispose());
    return queue;
}

describe("staged globe data loading", () => {
    it("advances budgeted geometry and DEM without rendering while honoring a disabled controller", async () => {
        vi.useFakeTimers();
        let time = 0;
        vi.spyOn(performance, "now").mockImplementation(() => (time += 3));
        const { globe, scene } = setup(2, 1);
        const prepare = vi.spyOn(globe, "prepareGeometry");
        const render = vi.spyOn(scene.onBeforeRenderObservable, "notifyObservers");
        let resolveFirst!: (result: ElevationGrid) => void;
        const elevation = vi.fn().mockImplementationOnce(() => new Promise<ElevationGrid>(resolve => { resolveFirst = resolve; }))
            .mockResolvedValue(grid);
        const data = controller(globe, { elevation, concurrency: 1, enabled: false, featuresEnabled: false });
        expect(globe.pendingGeometryCount).toBe(3);
        data.update();
        expect(prepare).not.toHaveBeenCalled();
        expect(elevation).not.toHaveBeenCalled();
        data.setEnabled(true);
        expect(globe.pendingGeometryCount).toBe(2);
        expect(prepare).toHaveBeenCalledOnce();
        expect(elevation).toHaveBeenCalledOnce();
        // One expensive patch still fits each slice; completing the useful
        // in-flight DEM must not advance paused geometry or start another DEM.
        data.setEnabled(false); resolveFirst(grid);
        await vi.advanceTimersByTimeAsync(10);
        data.update();
        expect(globe.pendingGeometryCount).toBe(2);
        expect(prepare).toHaveBeenCalledOnce();
        expect(elevation).toHaveBeenCalledOnce();
        data.setEnabled(true);
        expect(globe.pendingGeometryCount).toBe(1);
        await vi.advanceTimersByTimeAsync(10);
        expect(globe.pendingGeometryCount).toBe(0);
        expect(data.isTerrainReady).toBe(true);
        expect(elevation).toHaveBeenCalledTimes(4);
        expect(prepare).toHaveBeenCalledTimes(3);
        expect(render).not.toHaveBeenCalled();
    });

    it("finishes terrain behind the feature gate and resumes buildings and roads without downloading DEM again", async () => {
        vi.useFakeTimers();
        const { globe } = setup();
        const buildings = provider(), roads = provider();
        const elevation = vi.fn(async () => grid);
        const data = controller(globe, { elevation, buildings: buildings.source, features: [roads.source], featuresEnabled: false });
        expect(data.pendingTerrainCount).toBe(4);
        data.update();
        await vi.advanceTimersByTimeAsync(1);
        expect(data.isTerrainReady).toBe(true);
        expect(globe.ourTiles.every(tile => tile.terrainLoaded)).toBe(true);
        expect(buildings.requests).toHaveLength(0);
        expect(roads.requests).toHaveLength(0);
        data.setFeaturesEnabled(true);
        expect(buildings.requests).toHaveLength(4);
        expect(roads.requests).toHaveLength(4);
        expect(elevation).toHaveBeenCalledTimes(4);
    });

    it("pauses new terrain work while preserving an in-flight useful DEM", async () => {
        vi.useFakeTimers();
        const { globe } = setup();
        const pending: ((result: ElevationGrid) => void)[] = [];
        const elevation = vi.fn(() => new Promise<ElevationGrid>(resolve => pending.push(resolve)));
        const data = controller(globe, { elevation, concurrency: 1, enabled: false, featuresEnabled: false });
        data.update();
        expect(elevation).not.toHaveBeenCalled();
        data.setEnabled(true);
        expect(elevation).toHaveBeenCalledOnce();
        data.setEnabled(false);
        pending[0](grid);
        await vi.advanceTimersByTimeAsync(1);
        expect(data.pendingTerrainCount).toBe(3);
        expect(elevation).toHaveBeenCalledOnce();
        data.setEnabled(true);
        expect(elevation).toHaveBeenCalledTimes(2);
    });
});

describe("shared globe feature admission", () => {
    it("prioritizes across tiers, caps total provider work, and reprioritizes the next free slot", () => {
        const { globe, scene, tier } = setup();
        const medium = provider(), far = provider();
        const queue = featureQueue(scene, 2);
        let mediumPriority = 0, farPriority = 100;
        const farData = controller(globe, { buildings: far.source, featureQueue: queue, featurePriority: () => farPriority });
        const mediumData = controller(tier(), { buildings: medium.source, featureQueue: queue, featurePriority: () => mediumPriority });
        // Observer/submission order must not let the far tier consume the window.
        farData.update(); mediumData.update(); queue.flush();
        expect(medium.requests).toHaveLength(2);
        expect(far.requests).toHaveLength(0);
        expect(queue.pendingRequestCount).toBe(2);
        mediumPriority = 100; farPriority = 0;
        medium.finish(1); queue.flush();
        expect(far.requests).toHaveLength(1);
        expect(queue.pendingRequestCount).toBe(2);
        for (let pass = 0; pass < 8; pass++) {
            medium.finish(); far.finish(); queue.flush();
            expect(queue.pendingRequestCount).toBeLessThanOrEqual(2);
            expect(medium.source.pendingRequestCount).toBeLessThanOrEqual(2);
            expect(far.source.pendingRequestCount).toBeLessThanOrEqual(2);
        }
        expect(queue.pendingTileCount).toBe(0);
        expect(new Set(medium.requests).size).toBe(4);
        expect(new Set(far.requests).size).toBe(4);
    });

    it("lets a different tier use capacity when the preferred provider is full", () => {
        const { globe, scene, tier } = setup();
        const preferred = provider(1), alternate = provider(2);
        const queue = featureQueue(scene, 2);
        controller(globe, { buildings: preferred.source, featureQueue: queue, featurePriority: () => 0 }).update();
        controller(tier(), { buildings: alternate.source, featureQueue: queue, featurePriority: () => 10 }).update();
        queue.flush();
        expect(preferred.requests).toHaveLength(1);
        expect(alternate.requests).toHaveLength(1);
        expect(queue.pendingRequestCount).toBe(2);
    });

    it("skips regional distance and eligibility scans while all useful providers are full", () => {
        const { globe, scene } = setup();
        const buildings = provider(1), queue = featureQueue(scene, 8);
        const priority = vi.fn(() => 0), eligible = vi.fn(() => true);
        controller(globe, { buildings: buildings.source, featureQueue: queue,
            featurePriority: priority, featureFilter: eligible }).update();
        queue.flush();
        const priorityChecks = priority.mock.calls.length, eligibilityChecks = eligible.mock.calls.length;
        expect(buildings.requests).toHaveLength(1);
        for (let frame = 0; frame < 60; frame++) queue.flush();
        expect(priority).toHaveBeenCalledTimes(priorityChecks);
        expect(eligible).toHaveBeenCalledTimes(eligibilityChecks);
        buildings.finish(); queue.flush();
        expect(buildings.requests).toHaveLength(2);
        expect(priority.mock.calls.length).toBeGreaterThan(priorityChecks);
    });

    it("bounds unsubmitted backlog to the current tile window while providers stall during movement", () => {
        const { globe, scene } = setup();
        const buildings = provider(1), queue = featureQueue(scene, 1);
        const data = controller(globe, { buildings: buildings.source, featureQueue: queue });
        data.update(); queue.flush();
        expect(queue.pendingTileCount).toBe(3);
        for (let move = 0; move < 20; move++) {
            globe.updateRaster(-33 + move, 151 - move, 15);
            data.update(); queue.flush();
            expect(queue.pendingTileCount).toBe(4);
            expect(buildings.requests).toHaveLength(1);
        }
        buildings.finish(); queue.flush();
        expect(buildings.requests).toHaveLength(2);
        expect(globe.ourTiles).toContain(buildings.requests[1]);
        expect(queue.pendingTileCount).toBe(3);
    });

    it("drains completed provider slots without another rendered frame", async () => {
        vi.useFakeTimers();
        const { globe, scene } = setup();
        const buildings = provider(1), queue = featureQueue(scene, 1);
        controller(globe, { buildings: buildings.source, featureQueue: queue }).update();
        await vi.advanceTimersByTimeAsync(1);
        expect(buildings.requests).toHaveLength(1);
        for (let index = 0; index < 3; index++) {
            buildings.finish();
            await vi.advanceTimersByTimeAsync(25);
            expect(buildings.requests).toHaveLength(index + 2);
        }
        expect(queue.pendingTileCount).toBe(0);
    });

    it("resumes a partially admitted tile without submitting its completed provider twice", () => {
        const { globe, scene } = setup(1);
        const buildings = provider(1), roads = provider(1), queue = featureQueue(scene, 1);
        const data = controller(globe, { buildings: buildings.source, features: [roads.source], featureQueue: queue });
        data.update(); queue.flush();
        expect(buildings.requests).toHaveLength(1);
        expect(roads.requests).toHaveLength(0);
        data.setFeaturesEnabled(false); buildings.finish(); queue.flush();
        expect(queue.pendingTileCount).toBe(0);
        data.setFeaturesEnabled(true); queue.flush();
        expect(buildings.requests).toHaveLength(1);
        expect(roads.requests).toHaveLength(1);
    });

    it("reconsiders filtered tiles after a camera move, including discarded queue entries", async () => {
        vi.useFakeTimers();
        const { globe, scene } = setup(1);
        const camera = new FreeCamera("viewer", new Vector3(0, 0, 61), scene);
        const buildings = provider(), queue = featureQueue(scene, 1);
        let eligible = true;
        const data = controller(globe, { buildings: buildings.source, featureQueue: queue, featureFilter: () => eligible });
        data.update(); eligible = false; queue.flush();
        await vi.advanceTimersByTimeAsync(1);
        expect(buildings.requests).toHaveLength(0);
        expect(queue.pendingTileCount).toBe(0);
        eligible = true; camera.position.x += 1;
        data.update(); queue.flush();
        expect(buildings.requests).toHaveLength(1);
    });

    it("keeps uncovered Google tiles behind the gate and shared limit when Overture visibility requests reloads", async () => {
        vi.useFakeTimers();
        const { globe, scene } = setup();
        const buildings = new BuildingsOverture(globe, "https://example.test/buildings.pmtiles");
        buildings.loadConcurrency = 4;
        const submit = vi.spyOn(buildings, "SubmitLoadTileRequest");
        const queue = featureQueue(scene, 2);
        const data = controller(globe, { buildings, featureQueue: queue });
        buildings.onTileReloadRequested = tile => data.requeueFeatures(tile);
        let covered = true;
        buildings.tileCoverageFilter = () => covered;
        data.update(); queue.flush();
        expect(buildings.pendingRequestCount).toBe(0);
        expect(submit).toHaveBeenCalledTimes(4);
        data.setFeaturesEnabled(false);
        covered = false;
        buildings.updateBatchVisibility();
        await vi.advanceTimersByTimeAsync(1);
        expect(buildings.pendingRequestCount).toBe(0);
        expect(submit).toHaveBeenCalledTimes(4);
        data.setFeaturesEnabled(true); queue.flush();
        expect(buildings.pendingRequestCount).toBe(2);
        expect(queue.pendingTileCount).toBe(2);
        buildings.updateBatchVisibility();
        await vi.advanceTimersByTimeAsync(1);
        expect(queue.pendingTileCount).toBe(2);
        buildings.cancelPendingRequests(); queue.flush();
        expect(buildings.pendingRequestCount).toBe(2);
        expect(queue.pendingTileCount).toBe(0);
        expect(submit).toHaveBeenCalledTimes(8);
    });

    it("retains direct uncovered-tile reloads when no Overture admission hook is installed", () => {
        const { globe } = setup(1);
        const buildings = new BuildingsOverture(globe, "https://example.test/default-buildings.pmtiles");
        let covered = true;
        buildings.tileCoverageFilter = () => covered;
        buildings.SubmitLoadTileRequest(globe.ourTiles[0]);
        expect(buildings.pendingRequestCount).toBe(0);
        covered = false; buildings.updateBatchVisibility();
        expect(buildings.pendingRequestCount).toBe(1);
        buildings.cancelPendingRequests();
    });

    it("backs off failed admissions and retries them without redownloading terrain", async () => {
        vi.useFakeTimers();
        vi.spyOn(performance, "now").mockImplementation(() => Date.now());
        const { globe, scene } = setup(1);
        const buildings = provider(), queue = featureQueue(scene, 1);
        vi.mocked(buildings.source.SubmitLoadTileRequest)
            .mockImplementationOnce(() => { throw new Error("temporary failure"); })
            .mockImplementationOnce(() => { throw new Error("temporary failure"); });
        const elevation = vi.fn(async () => grid);
        const data = controller(globe, { elevation, buildings: buildings.source, featureQueue: queue });
        const error = vi.fn(); data.onErrorObservable.add(error);
        data.update();
        await vi.advanceTimersByTimeAsync(1);
        expect(buildings.source.SubmitLoadTileRequest).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(251);
        expect(buildings.source.SubmitLoadTileRequest).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(501);
        expect(buildings.source.SubmitLoadTileRequest).toHaveBeenCalledTimes(3);
        expect(buildings.requests).toHaveLength(1);
        expect(data.stats.failed).toBe(2);
        expect(error).toHaveBeenCalledOnce();
        expect(elevation).toHaveBeenCalledOnce();
    });
});
