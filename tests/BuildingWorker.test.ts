import { afterEach, expect, it, vi } from "vitest";
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
import GlobeSet from "../src/core/GlobeSet";
import { GlobeBuildingBatch } from "../src/buildings/GlobeBuildingBatch";
import { buildBuildingGeometry, type BuildingGeometryJob } from "../src/buildings/GlobeBuildingWorker";
import { BuildingWorkerPool } from "../src/buildings/BuildingWorkerPool";
import type { feature } from "../src/buildings/GeoJSON";
vi.mock("../src/core/Attribution", () => ({ default: class { advancedTexture = {}; addAttribution() {} } }));
afterEach(() => vi.unstubAllGlobals());

it("produces identical worker geometry over varying terrain, including holes and raised floors", () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    const globe = new GlobeSet(scene, engine, { radius: 60, attribution: false });
    const origin = globe.getSurfacePosition(40.7484, -73.9857);
    const features: feature[] = [], elevations = new Map<string, number>();
    for (let i = 0; i < 100; i++) {
        const lon = -73.9857 + (i % 10) * 0.001, lat = 40.7484 + Math.floor(i / 10) * 0.001;
        const rings = [[[lon, lat], [lon + 0.0005, lat], [lon + 0.0005, lat + 0.0005], [lon, lat + 0.0005], [lon, lat]],
            [[lon + 0.0001, lat + 0.0001], [lon + 0.0002, lat + 0.0001], [lon + 0.0002, lat + 0.0002], [lon + 0.0001, lat + 0.0002]]];
        for (const ring of rings) for (const [x, y] of ring) elevations.set(`${y}/${x}`, (10 + (x - lon) * 5000) * globe.metresToWorld);
        features.push({ type: "Feature", properties: { height: 20 + i, min_height: i % 2 ? 3 : 0 }, geometry: { type: "Polygon", coordinates: rings } });
    }
    vi.spyOn(globe, "sampleElevation").mockImplementation((lat, lon) => elevations.get(`${lat}/${lon}`) ?? 0);
    const direct = new GlobeBuildingBatch(globe, origin);
    features.forEach(feature => direct.append(feature, 8, 1.2));
    const result = buildBuildingGeometry({ features, elevations, radius: globe.radius, metresToWorld: globe.metresToWorld,
        origin: origin.asArray(), defaultHeight: 8, exaggeration: 1.2 });
    const expected = direct.vertexData();
    expect(result.positions).toEqual(expected.positions);
    expect(result.normals).toEqual(expected.normals);
    expect(result.indices).toEqual(expected.indices);
    expect(result.ranges).toEqual(direct.ranges);
    expect(result.featureCount).toBe(100);
    scene.dispose(); engine.dispose();
});

it("prioritizes queued workers, skips superseded tiles and terminates with its scene", async () => {
    class FakeWorker {
        static all: FakeWorker[] = [];
        onmessage?: (event: { data: unknown }) => void;
        onerror?: () => void;
        jobs: BuildingGeometryJob[] = [];
        terminate = vi.fn();
        constructor() { FakeWorker.all.push(this); }
        postMessage(job: BuildingGeometryJob) { this.jobs.push(job); }
        complete() { this.onmessage?.({ data: { result: { featureCount: 1 } } }); }
    }
    vi.stubGlobal("Worker", FakeWorker); vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
    const engine = new NullEngine(), scene = new Scene(engine);
    const pool = BuildingWorkerPool.forScene(scene)!;
    const job = (height: number) => ({ defaultHeight: height }) as BuildingGeometryJob;
    const first = pool.run(job(1), () => true, () => 0);
    let near = 10, valid = true;
    const far = pool.run(job(2), () => true, () => near);
    const cancelled = pool.run(job(3), () => valid, () => -1);
    const next = pool.run(job(4), () => true, () => 5);
    near = 20; valid = false;
    const worker = FakeWorker.all[0]; worker.complete();
    expect(worker.jobs.map(job => job.defaultHeight)).toEqual([1, 4]);
    await expect(cancelled).resolves.toBeUndefined();
    worker.complete(); expect(worker.jobs.map(job => job.defaultHeight)).toEqual([1, 4, 2]);
    worker.complete(); await Promise.all([first, next, far]);
    const pending = pool.run(job(5), () => true, () => 0);
    const rejected = expect(pending).rejects.toThrow("stopped");
    scene.dispose(); await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    engine.dispose();
});
