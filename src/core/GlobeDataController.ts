import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type GlobeSet from "./GlobeSet.js";
import type Tile from "./Tile.js";
import type Buildings from "../buildings/Buildings.js";
import type { ElevationLoader } from "../terrain/TerrainRGB.js";

export interface GlobeFeatureQueueOptions {
    /** Bound queued and in-flight provider work across every participating globe tier. */
    maxPendingRequests?: number;
}
interface GlobeFeatureRequest {
    owner: GlobeDataController;
    tile: Tile;
    providers: Buildings[];
    valid: () => boolean;
    priority: () => number;
    submitted: (provider: Buildings) => void;
    discarded: () => void;
    complete: () => void;
    failed: (error: unknown) => void;
}
/** Shares a small, reprioritized feature admission window across globe LOD tiers. */
export class GlobeFeatureQueue {
    private requests: GlobeFeatureRequest[] = [];
    private providers = new Set<Buildings>();
    private observer;
    private timer?: ReturnType<typeof setTimeout>;
    private timerIsFallback = false;
    private disposed = false;
    constructor(private readonly scene: Scene, public readonly options: GlobeFeatureQueueOptions = {}) {
        if (!Number.isInteger(options.maxPendingRequests ?? 8) || (options.maxPendingRequests ?? 8) < 1)
            throw new RangeError("Invalid globe feature queue limit");
        // Defer admission until all tier observers have offered their candidates.
        this.observer = scene.onBeforeRenderObservable.add(() => this.schedule());
        scene.onDisposeObservable.addOnce(() => this.dispose());
    }
    public get pendingTileCount(): number { return this.requests.length; }
    public get pendingRequestCount(): number {
        let count = 0;
        for (const provider of this.providers) count += provider.pendingRequestCount;
        return count;
    }
    public enqueue(request: GlobeFeatureRequest): void {
        if (this.disposed) return;
        this.requests.push(request);
        for (const provider of request.providers) this.providers.add(provider);
        this.schedule();
    }
    public cancel(owner: GlobeDataController): void {
        this.requests = this.requests.filter(request => request.owner !== owner);
    }
    private schedule(delay = 0): void {
        if (this.disposed || !this.requests.length) return;
        if (this.timer !== undefined) {
            if (delay !== 0 || !this.timerIsFallback) return;
            clearTimeout(this.timer);
        }
        this.timerIsFallback = delay > 0;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.flush();
        }, delay);
    }
    /** Admit the best currently useful tile as soon as a provider slot is free. */
    public flush(): void {
        if (this.disposed) return;
        const max = this.options.maxPendingRequests ?? 8;
        // A full admission window has nothing to select. Avoid evaluating the
        // entire regional queue on every frame while useful work is in flight.
        if (this.pendingRequestCount >= max) { this.schedule(25); return; }
        const availableProviders = new Set([...this.providers].filter(provider =>
            provider.pendingRequestCount < Math.max(1, provider.loadConcurrency)));
        if (!this.requests.some(request => request.providers.some(provider => availableProviders.has(provider)))) {
            this.schedule(25);
            return;
        }
        this.requests = this.requests.filter(request => {
            if (request.valid()) return true;
            request.discarded();
            return false;
        });
        const priorities = new Map(this.requests.map(request => [request, request.priority()]));
        this.requests.sort((a, b) => priorities.get(a)! - priorities.get(b)!);
        for (let index = 0; index < this.requests.length && this.pendingRequestCount < max;) {
            const request = this.requests[index];
            try {
                for (let providerIndex = 0; providerIndex < request.providers.length && this.pendingRequestCount < max;) {
                    const provider = request.providers[providerIndex];
                    // A full provider must not block another tier's useful work.
                    if (provider.pendingRequestCount >= Math.max(1, provider.loadConcurrency)) { providerIndex++; continue; }
                    provider.SubmitLoadTileRequest(request.tile);
                    request.submitted(provider);
                    request.providers.splice(providerIndex, 1);
                }
                if (request.providers.length) { index++; continue; }
                this.requests.splice(index, 1);
                request.complete();
            } catch (error) {
                this.requests.splice(index, 1);
                request.failed(error);
            }
        }
        // Provider downloads can finish while the scene is render-throttled.
        if (this.requests.length) this.schedule(25);
    }
    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        clearTimeout(this.timer);
        this.requests = [];
        this.providers.clear();
        this.scene.onBeforeRenderObservable.remove(this.observer);
    }
}

export interface GlobeDataOptions {
    elevation?: ElevationLoader;
    buildings?: Buildings;
    features?: Buildings[];
    minTerrainZoom?: number;
    minBuildingZoom?: number;
    maxBuildingZoom?: number;
    minFeatureZoom?: number;
    maxFeatureZoom?: number;
    concurrency?: number;
    /** Suspend new terrain and feature work while retaining useful resident data. */
    enabled?: boolean;
    /** Keep terrain streaming while deferring buildings and roads. */
    featuresEnabled?: boolean;
    /** Share bounded feature admissions across all LOD tiers. */
    featureQueue?: GlobeFeatureQueue;
    /** Lower scores win shared feature slots; recomputed when the queue drains. */
    featurePriority?: (tile: Tile) => number;
    /** Omit feature tiles outside the current useful area without delaying DEM. */
    featureFilter?: (tile: Tile) => boolean;
    /** Prefer the active camera frustum when streaming large landscape windows. */
    prioritizeVisible?: boolean;
    exaggeration?: number;
}
/** Bounded camera-driven detail loading. Retained tiles keep all their data. */
export default class GlobeDataController {
    public readonly onErrorObservable = new Observable<Error>();
    public readonly stats = {
        active: 0,
        completed: 0,
        cancelled: 0,
        failed: 0,
    };
    private jobs = new Map<Tile, { key: string; abort: AbortController }>();
    private ready = new WeakMap<Tile, string>();
    private terrainReady = new WeakMap<Tile, string>();
    private queuedFeatures = new WeakMap<Tile, string>();
    private submittedFeatures = new WeakMap<Tile, { key: string; providers: Set<Buildings> }>();
    private retryAt = new WeakMap<Tile, { key: string; after: number; failures: number }>();
    private observer;
    private disposed = false;
    private refillTimer?: ReturnType<typeof setTimeout>;
    private nextPriorityCheck = 0;
    private priorityCamera?: Camera;
    private priorityRevision = -1;
    private settled = false;
    private tiles: Tile[] | undefined;
    private positionObserver;
    private providers = new Set<Buildings>();
    constructor(
        public readonly globe: GlobeSet,
        public readonly options: GlobeDataOptions = {},
    ) {
        if (
            !Number.isInteger(options.concurrency ?? 4) ||
            (options.concurrency ?? 4) < 1 ||
            !Number.isFinite(options.exaggeration ?? 1) ||
            (options.exaggeration ?? 1) < 0
        )
            throw new RangeError("Invalid globe detail options");
        this.positionObserver = globe.onTilePositionUpdatedObservable.add(() => {
            this.settled = false;
            this.nextPriorityCheck = 0;
        });
        this.observer = globe.scene.onBeforeRenderObservable.add(() =>
            this.update(),
        );
    }
    /** Number of current tiles still waiting for geometry or required elevation. */
    public get pendingTerrainCount(): number {
        return this.globe.ourTiles.reduce((count, tile) => count + Number(!tile.mesh.isDisposed()
            && (!this.globe.isTileGeometryReady(tile) || this.needsTerrain(tile, tile.tileCoords.toString()))), 0);
    }
    public get isTerrainReady(): boolean { return this.pendingTerrainCount === 0; }
    public setEnabled(enabled: boolean): void {
        if ((this.options.enabled !== false) === enabled) return;
        this.options.enabled = enabled;
        this.settled = false;
        this.nextPriorityCheck = 0;
        if (!enabled) {
            this.options.featureQueue?.cancel(this);
            this.queuedFeatures = new WeakMap();
        } else this.update();
    }
    public setFeaturesEnabled(enabled: boolean): void {
        if ((this.options.featuresEnabled !== false) === enabled) return;
        this.options.featuresEnabled = enabled;
        this.settled = false;
        this.nextPriorityCheck = 0;
        if (!enabled) {
            this.options.featureQueue?.cancel(this);
            this.queuedFeatures = new WeakMap();
        } else this.update();
    }
    /** Readmit a covered tile's features when its imagery replacement disappears. */
    public requeueFeatures(tile: Tile): void {
        if (this.disposed || tile.mesh.isDisposed()) return;
        const key = tile.tileCoords.toString();
        if (this.queuedFeatures.get(tile) === key) return;
        this.ready.delete(tile);
        this.submittedFeatures.delete(tile);
        this.settled = false;
        // Coverage can uncover many tiles at once. Batch their readmission,
        // retaining the terrain cache and the shared admission limit.
        this.scheduleRefill();
    }
    private needsTerrain(tile: Tile, key: string): boolean {
        return !!this.options.elevation && tile.tileCoords.z >= (this.options.minTerrainZoom ?? 5)
            && this.terrainReady.get(tile) !== key;
    }
    public update(): void {
        if (this.disposed) return;
        if (this.tiles !== this.globe.ourTiles) {
            // Drop the previous window's unsubmitted entries even when the
            // shared provider window is full and admission scans are skipped.
            // Retained tiles are offered again with their resident DEM intact.
            this.options.featureQueue?.cancel(this);
            this.queuedFeatures = new WeakMap();
            this.tiles = this.globe.ourTiles;
            this.settled = false;
        }
        if (this.options.enabled !== false && this.globe.pendingGeometryCount > 0) {
            this.globe.prepareGeometry();
            this.settled = false;
        }
        if (this.settled) {
            if (!this.options.featureFilter) return;
            const camera = this.globe.scene.activeCamera;
            camera?.getViewMatrix();
            if (camera === this.priorityCamera
                && (camera?.getTransformationMatrix().updateFlag ?? -1) === this.priorityRevision) return;
            this.settled = false;
        }
        for (const [tile, job] of this.jobs)
            if (
                tile.mesh.isDisposed() ||
                job.key !== tile.tileCoords.toString()
            ) {
                job.abort.abort();
                this.jobs.delete(tile);
                this.stats.active--;
                this.stats.cancelled++;
            }
        if (this.options.enabled === false) return;
        const concurrency = this.options.concurrency ?? 4;
        const full = this.stats.active >= concurrency;
        const camera = this.globe.scene.activeCamera;
        camera?.getViewMatrix();
        const revision = camera?.getTransformationMatrix().updateFlag;
        const poseChanged = camera !== this.priorityCamera || revision !== this.priorityRevision;
        this.priorityCamera = camera ?? undefined;
        this.priorityRevision = revision ?? -1;
        if (full && !poseChanged && performance.now() < this.nextPriorityCheck) return;
        const centerX = this.globe.ourTileMath.lon_to_tileExact(this.globe.centerCoords.x, this.globe.zoom);
        const centerY = this.globe.ourTileMath.lat_to_tileExact(this.globe.centerCoords.y, this.globe.zoom);
        const count = 2 ** this.globe.zoom;
        const distance = (tile: Tile) => {
            if (camera) return Vector3.DistanceSquared(camera.globalPosition, tile.mesh.getBoundingInfo().boundingSphere.centerWorld);
            const dx = Math.abs(tile.tileCoords.x + 0.5 - centerX);
            return Math.min(dx, count - dx) ** 2 + (tile.tileCoords.y + 0.5 - centerY) ** 2;
        };
        // Load the area around the viewer before the far corners of large LOD grids.
        const now = performance.now();
        const candidates = this.globe.ourTiles.filter(tile => !tile.mesh.isDisposed() && this.globe.isTileGeometryReady(tile)
            && (this.needsTerrain(tile, tile.tileCoords.toString())
                || (this.options.featuresEnabled !== false && this.options.featureFilter?.(tile) !== false
                    && this.ready.get(tile) !== tile.tileCoords.toString()
                    && this.queuedFeatures.get(tile) !== tile.tileCoords.toString())) && !this.jobs.has(tile)
            && (this.retryAt.get(tile)?.key !== tile.tileCoords.toString() || this.retryAt.get(tile)!.after <= now));
        if (candidates.length === 0 && this.jobs.size === 0 && this.globe.pendingGeometryCount === 0) {
            const delayed = this.globe.ourTiles.map(tile => {
                const retry = this.retryAt.get(tile);
                return retry?.key === tile.tileCoords.toString() ? retry : undefined;
            }).filter((retry): retry is { key: string; after: number; failures: number } => !!retry && retry.after > now);
            if (!delayed.length) this.settled = true;
            else if (this.refillTimer === undefined) this.refillTimer = setTimeout(() => {
                this.refillTimer = undefined;
                this.update();
            }, Math.max(0, Math.min(...delayed.map(retry => retry.after)) - now));
            return;
        }
        if (full) {
            this.nextPriorityCheck = performance.now() + 250;
            // An in-window job remains useful to the full viewable disk. Let one
            // newly urgent tile start without aborting that useful download.
            if (candidates.length === 0 || this.stats.active >= concurrency + 1) return;
            const visible = (tile: Tile) => !!(this.options.prioritizeVisible && camera?.isInFrustum(tile.mesh));
            const better = (a: Tile, b: Tile) => Number(visible(a)) - Number(visible(b)) || distance(b) - distance(a);
            const best = candidates.reduce((a, b) => better(a, b) >= 0 ? a : b);
            const worst = [...this.jobs.keys()].reduce((a, b) => better(a, b) <= 0 ? a : b);
            const bestVisible = visible(best), worstVisible = visible(worst);
            if (!((bestVisible && !worstVisible)
                || (bestVisible === worstVisible && distance(best) * 4 < distance(worst)))) return;
        }
        const distances = new Map(candidates.map(tile => [tile, distance(tile)]));
        const visible = new Set(this.options.prioritizeVisible && camera
            ? candidates.filter(tile => camera.isInFrustum(tile.mesh)) : candidates);
        candidates.sort((a, b) => Number(visible.has(b)) - Number(visible.has(a)) || distances.get(a)! - distances.get(b)!);
        for (const tile of candidates) {
            if (
                !tile.tileCoords ||
                tile.mesh.isDisposed() ||
                !this.globe.isTileGeometryReady(tile)
            )
                continue;
            const key = tile.tileCoords.toString();
            if (
                this.ready.get(tile) === key ||
                this.jobs.has(tile) ||
                this.stats.active >= concurrency + Number(full)
            )
                continue;
            const abort = new AbortController();
            this.jobs.set(tile, { key, abort });
            this.stats.active++;
            void this.load(tile, key, abort);
        }
    }
    private async load(
        tile: Tile,
        key: string,
        abort: AbortController,
    ): Promise<void> {
        const coords = tile.tileCoords.clone();
        try {
            if (
                this.options.elevation && this.terrainReady.get(tile) !== key &&
                coords.z >= (this.options.minTerrainZoom ?? 5)
            ) {
                const grid = await this.options.elevation(coords, abort.signal);
                if (
                    abort.signal.aborted ||
                    tile.mesh.isDisposed() ||
                    tile.tileCoords.toString() !== key
                )
                    return;
                this.globe.setElevationData(
                    tile,
                    grid.data,
                    grid.width,
                    grid.height,
                    this.options.exaggeration ?? 1,
                );
                this.terrainReady.set(tile, key);
            }
            if (
                abort.signal.aborted ||
                tile.mesh.isDisposed() ||
                tile.tileCoords.toString() !== key
            )
                return;
            if (this.options.enabled !== false && this.options.featuresEnabled !== false
                && this.options.featureFilter?.(tile) !== false) {
                const providers: Buildings[] = [];
                if (this.options.buildings && coords.z >= (this.options.minBuildingZoom ?? 14)
                    && coords.z <= (this.options.maxBuildingZoom ?? Infinity)) providers.push(this.options.buildings);
                if (coords.z >= (this.options.minFeatureZoom ?? this.options.minBuildingZoom ?? 14)
                    && coords.z <= (this.options.maxFeatureZoom ?? this.options.maxBuildingZoom ?? Infinity))
                    providers.push(...(this.options.features ?? []));
                for (const provider of providers) this.providers.add(provider);
                const submitted = this.submittedFeatures.get(tile);
                const remaining = [...new Set(providers)].filter(provider => submitted?.key !== key || !submitted.providers.has(provider));
                const recordSubmitted = (provider: Buildings) => {
                    let record = this.submittedFeatures.get(tile);
                    if (record?.key !== key) { record = { key, providers: new Set() }; this.submittedFeatures.set(tile, record); }
                    record.providers.add(provider);
                };
                if (this.options.featureQueue && remaining.length) {
                    this.queuedFeatures.set(tile, key);
                    this.options.featureQueue.enqueue({ owner: this, tile, providers: remaining,
                        valid: () => !this.disposed && this.options.enabled !== false && this.options.featuresEnabled !== false
                            && !tile.mesh.isDisposed() && tile.tileCoords.toString() === key
                            && this.options.featureFilter?.(tile) !== false,
                        priority: () => this.options.featurePriority?.(tile) ?? this.featureDistance(tile),
                        submitted: recordSubmitted,
                        discarded: () => {
                            if (this.queuedFeatures.get(tile) === key) this.queuedFeatures.delete(tile);
                            this.settled = false; this.scheduleRefill();
                        },
                        complete: () => {
                            this.queuedFeatures.delete(tile); this.ready.set(tile, key); this.retryAt.delete(tile);
                        },
                        failed: error => {
                            this.queuedFeatures.delete(tile);
                            this.settled = false;
                            this.recordFailure(tile, key, error);
                            this.scheduleRefill();
                        },
                    });
                } else {
                    for (const provider of remaining) { provider.SubmitLoadTileRequest(tile); recordSubmitted(provider); }
                    this.ready.set(tile, key);
                    this.retryAt.delete(tile);
                }
            } else this.retryAt.delete(tile);
            this.stats.completed++;
        } catch (error) {
            if (!abort.signal.aborted) {
                this.recordFailure(tile, key, error);
            }
        } finally {
            if (this.jobs.get(tile)?.abort === abort) {
                this.jobs.delete(tile);
                this.stats.active--;
            }
            // Fill the released slot immediately, including when rendering is
            // throttled. update() reprioritizes from the latest camera each time.
            this.scheduleRefill();
        }
    }
    private featureDistance(tile: Tile): number {
        const camera = this.globe.scene.activeCamera;
        if (camera) return Vector3.DistanceSquared(camera.globalPosition, tile.mesh.getBoundingInfo().boundingSphere.centerWorld);
        const x = this.globe.ourTileMath.lon_to_tileExact(this.globe.centerCoords.x, this.globe.zoom);
        const y = this.globe.ourTileMath.lat_to_tileExact(this.globe.centerCoords.y, this.globe.zoom);
        const count = 2 ** this.globe.zoom;
        const dx = Math.abs(tile.tileCoords.x + 0.5 - x);
        return Math.min(dx, count - dx) ** 2 + (tile.tileCoords.y + 0.5 - y) ** 2;
    }
    private recordFailure(tile: Tile, key: string, error: unknown): void {
        this.stats.failed++;
        const previous = this.retryAt.get(tile);
        const failures = previous?.key === key ? previous.failures + 1 : 1;
        this.retryAt.set(tile, { key, failures,
            after: performance.now() + Math.min(8000, 250 * 2 ** Math.min(5, failures - 1)) });
        if (failures === 1) this.onErrorObservable.notifyObservers(
            error instanceof Error ? error : new Error(String(error)),
        );
    }
    private scheduleRefill(): void {
        if (!this.disposed && this.refillTimer === undefined) this.refillTimer = setTimeout(() => {
            this.refillTimer = undefined;
            this.update();
        }, 0);
    }
    /** Explicitly retry failures or reload after changing provider settings. */
    public invalidate(preserveTerrain = false, preserveBuildings = false): void {
        if (!preserveTerrain) this.terrainReady = new WeakMap();
        this.settled = false;
        for (const job of this.jobs.values()) job.abort.abort();
        this.jobs.clear();
        this.stats.active = 0;
        this.nextPriorityCheck = 0;
        this.ready = new WeakMap();
        this.options.featureQueue?.cancel(this);
        this.queuedFeatures = new WeakMap();
        this.submittedFeatures = new WeakMap();
        this.retryAt = new WeakMap();
        for (const provider of this.providers) provider.cancelPendingRequests();
        if (!preserveBuildings) for (const tile of this.globe.ourTiles) tile.deleteBuildings();
    }
    public dispose(): void {
        this.disposed = true;
        clearTimeout(this.refillTimer);
        this.options.featureQueue?.cancel(this);
        for (const provider of this.providers) provider.cancelPendingRequests();
        for (const job of this.jobs.values()) job.abort.abort();
        this.jobs.clear();
        this.stats.active = 0;
        this.globe.scene.onBeforeRenderObservable.remove(this.observer);
        this.globe.onTilePositionUpdatedObservable.remove(this.positionObserver);
        this.onErrorObservable.clear();
    }
}
