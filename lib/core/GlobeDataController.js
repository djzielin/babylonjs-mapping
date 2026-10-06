import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
/** Shares a small, reprioritized feature admission window across globe LOD tiers. */
export class GlobeFeatureQueue {
    scene;
    options;
    requests = [];
    providers = new Set();
    observer;
    timer;
    timerIsFallback = false;
    disposed = false;
    constructor(scene, options = {}) {
        this.scene = scene;
        this.options = options;
        if (!Number.isInteger(options.maxPendingRequests ?? 8) || (options.maxPendingRequests ?? 8) < 1)
            throw new RangeError("Invalid globe feature queue limit");
        // Defer admission until all tier observers have offered their candidates.
        this.observer = scene.onBeforeRenderObservable.add(() => this.schedule());
        scene.onDisposeObservable.addOnce(() => this.dispose());
    }
    get pendingTileCount() { return this.requests.length; }
    get pendingRequestCount() {
        let count = 0;
        for (const provider of this.providers)
            count += provider.pendingRequestCount;
        return count;
    }
    enqueue(request) {
        if (this.disposed)
            return;
        this.requests.push(request);
        for (const provider of request.providers)
            this.providers.add(provider);
        this.schedule();
    }
    cancel(owner) {
        this.requests = this.requests.filter(request => request.owner !== owner);
    }
    schedule(delay = 0) {
        if (this.disposed || !this.requests.length)
            return;
        if (this.timer !== undefined) {
            if (delay !== 0 || !this.timerIsFallback)
                return;
            clearTimeout(this.timer);
        }
        this.timerIsFallback = delay > 0;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.flush();
        }, delay);
    }
    /** Admit the best currently useful tile as soon as a provider slot is free. */
    flush() {
        if (this.disposed)
            return;
        const max = this.options.maxPendingRequests ?? 8;
        // A full admission window has nothing to select. Avoid evaluating the
        // entire regional queue on every frame while useful work is in flight.
        if (this.pendingRequestCount >= max) {
            this.schedule(25);
            return;
        }
        const availableProviders = new Set([...this.providers].filter(provider => provider.pendingRequestCount < Math.max(1, provider.loadConcurrency)));
        if (!this.requests.some(request => request.providers.some(provider => availableProviders.has(provider)))) {
            this.schedule(25);
            return;
        }
        this.requests = this.requests.filter(request => {
            if (request.valid())
                return true;
            request.discarded();
            return false;
        });
        const priorities = new Map(this.requests.map(request => [request, request.priority()]));
        this.requests.sort((a, b) => priorities.get(a) - priorities.get(b));
        for (let index = 0; index < this.requests.length && this.pendingRequestCount < max;) {
            const request = this.requests[index];
            try {
                for (let providerIndex = 0; providerIndex < request.providers.length && this.pendingRequestCount < max;) {
                    const provider = request.providers[providerIndex];
                    // A full provider must not block another tier's useful work.
                    if (provider.pendingRequestCount >= Math.max(1, provider.loadConcurrency)) {
                        providerIndex++;
                        continue;
                    }
                    provider.SubmitLoadTileRequest(request.tile);
                    request.submitted(provider);
                    request.providers.splice(providerIndex, 1);
                }
                if (request.providers.length) {
                    index++;
                    continue;
                }
                this.requests.splice(index, 1);
                request.complete();
            }
            catch (error) {
                this.requests.splice(index, 1);
                request.failed(error);
            }
        }
        // Provider downloads can finish while the scene is render-throttled.
        if (this.requests.length)
            this.schedule(25);
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        clearTimeout(this.timer);
        this.requests = [];
        this.providers.clear();
        this.scene.onBeforeRenderObservable.remove(this.observer);
    }
}
/** Bounded camera-driven detail loading. Retained tiles keep all their data. */
export default class GlobeDataController {
    globe;
    options;
    onErrorObservable = new Observable();
    stats = {
        active: 0,
        completed: 0,
        cancelled: 0,
        failed: 0,
        postedRefills: 0,
        timerRefills: 0,
    };
    jobs = new Map();
    ready = new WeakMap();
    terrainReady = new WeakMap();
    queuedFeatures = new WeakMap();
    submittedFeatures = new WeakMap();
    retryAt = new WeakMap();
    observer;
    disposed = false;
    refillTimer;
    refillChannel;
    refillQueued = false;
    nextPriorityCheck = 0;
    priorityCamera;
    priorityRevision = -1;
    settled = false;
    tiles;
    positionObserver;
    providers = new Set();
    constructor(globe, options = {}) {
        this.globe = globe;
        this.options = options;
        if (!Number.isInteger(options.concurrency ?? 4) ||
            (options.concurrency ?? 4) < 1 ||
            !Number.isFinite(options.exaggeration ?? 1) ||
            (options.exaggeration ?? 1) < 0)
            throw new RangeError("Invalid globe detail options");
        this.positionObserver = globe.onTilePositionUpdatedObservable.add(() => {
            this.settled = false;
            this.nextPriorityCheck = 0;
        });
        this.observer = globe.scene.onBeforeRenderObservable.add(() => this.update());
    }
    /** Number of current tiles still waiting for geometry or required elevation. */
    get pendingTerrainCount() {
        return this.globe.ourTiles.reduce((count, tile) => count + Number(!tile.mesh.isDisposed()
            && (!this.globe.isTileGeometryReady(tile) || this.globe.hasPendingElevationData(tile)
                || this.needsTerrain(tile, tile.tileCoords.toString()))), 0);
    }
    get isTerrainReady() { return this.pendingTerrainCount === 0; }
    setEnabled(enabled) {
        if ((this.options.enabled !== false) === enabled)
            return;
        this.options.enabled = enabled;
        this.settled = false;
        this.nextPriorityCheck = 0;
        if (!enabled) {
            this.options.featureQueue?.cancel(this);
            this.queuedFeatures = new WeakMap();
        }
        else
            this.update();
    }
    setFeaturesEnabled(enabled) {
        if ((this.options.featuresEnabled !== false) === enabled)
            return;
        this.options.featuresEnabled = enabled;
        this.settled = false;
        this.nextPriorityCheck = 0;
        if (!enabled) {
            this.options.featureQueue?.cancel(this);
            this.queuedFeatures = new WeakMap();
        }
        else
            this.update();
    }
    /** Readmit a covered tile's features when its imagery replacement disappears. */
    requeueFeatures(tile) {
        if (this.disposed || tile.mesh.isDisposed())
            return;
        const key = tile.tileCoords.toString();
        if (this.queuedFeatures.get(tile) === key)
            return;
        this.ready.delete(tile);
        this.submittedFeatures.delete(tile);
        this.settled = false;
        // Coverage can uncover many tiles at once. Batch their readmission,
        // retaining the terrain cache and the shared admission limit.
        this.scheduleRefill();
    }
    needsTerrain(tile, key) {
        return !!this.options.elevation && tile.tileCoords.z >= (this.options.minTerrainZoom ?? 5)
            && this.terrainReady.get(tile) !== key;
    }
    update() {
        if (this.disposed)
            return;
        if (this.tiles !== this.globe.ourTiles) {
            // Drop the previous window's unsubmitted entries even when the
            // shared provider window is full and admission scans are skipped.
            // Retained tiles are offered again with their resident DEM intact.
            this.options.featureQueue?.cancel(this);
            this.queuedFeatures = new WeakMap();
            this.tiles = this.globe.ourTiles;
            this.settled = false;
        }
        // Posted refills coalesce all child completions from one source promise.
        // Finish useful in-flight terrain even if new admissions were paused.
        if (this.globe.pendingElevationCount > 0)
            this.globe.flushElevationData();
        if (this.options.enabled !== false && this.globe.pendingGeometryCount > 0) {
            this.globe.prepareGeometry();
            this.settled = false;
        }
        if (this.settled) {
            if (!this.options.featureFilter)
                return;
            const camera = this.globe.scene.activeCamera;
            camera?.getViewMatrix();
            if (camera === this.priorityCamera
                && (camera?.getTransformationMatrix().updateFlag ?? -1) === this.priorityRevision)
                return;
            this.settled = false;
        }
        for (const [tile, job] of this.jobs)
            if (tile.mesh.isDisposed() ||
                job.key !== tile.tileCoords.toString()) {
                job.abort.abort();
                this.jobs.delete(tile);
                this.stats.active--;
                this.stats.cancelled++;
            }
        if (this.options.enabled === false)
            return;
        const concurrency = this.options.concurrency ?? 4;
        const full = this.stats.active >= concurrency;
        const camera = this.globe.scene.activeCamera;
        camera?.getViewMatrix();
        const revision = camera?.getTransformationMatrix().updateFlag;
        const poseChanged = camera !== this.priorityCamera || revision !== this.priorityRevision;
        this.priorityCamera = camera ?? undefined;
        this.priorityRevision = revision ?? -1;
        if (full && !poseChanged && performance.now() < this.nextPriorityCheck)
            return;
        const centerX = this.globe.ourTileMath.lon_to_tileExact(this.globe.centerCoords.x, this.globe.zoom);
        const centerY = this.globe.ourTileMath.lat_to_tileExact(this.globe.centerCoords.y, this.globe.zoom);
        const count = 2 ** this.globe.zoom;
        const distance = (tile) => {
            if (camera)
                return Vector3.DistanceSquared(camera.globalPosition, tile.mesh.getBoundingInfo().boundingSphere.centerWorld);
            const dx = Math.abs(tile.tileCoords.x + 0.5 - centerX);
            return Math.min(dx, count - dx) ** 2 + (tile.tileCoords.y + 0.5 - centerY) ** 2;
        };
        // Load the area around the viewer before the far corners of large LOD grids.
        const now = performance.now();
        const candidates = [];
        for (const tile of this.globe.ourTiles) {
            if (tile.mesh.isDisposed() || !this.globe.isTileGeometryReady(tile) || this.jobs.has(tile))
                continue;
            const key = tile.tileCoords.toString(), retry = this.retryAt.get(tile);
            if (retry?.key === key && retry.after > now)
                continue;
            if (this.needsTerrain(tile, key) || (this.options.featuresEnabled !== false
                && this.ready.get(tile) !== key && this.queuedFeatures.get(tile) !== key
                && this.options.featureFilter?.(tile) !== false))
                candidates.push(tile);
        }
        if (candidates.length === 0 && this.jobs.size === 0 && this.globe.pendingGeometryCount === 0) {
            const delayed = this.globe.ourTiles.map(tile => {
                const retry = this.retryAt.get(tile);
                return retry?.key === tile.tileCoords.toString() ? retry : undefined;
            }).filter((retry) => !!retry && retry.after > now);
            if (!delayed.length)
                this.settled = true;
            else if (this.refillTimer === undefined)
                this.refillTimer = setTimeout(() => {
                    this.refillTimer = undefined;
                    this.update();
                }, Math.max(0, Math.min(...delayed.map(retry => retry.after)) - now));
            return;
        }
        if (full) {
            this.nextPriorityCheck = performance.now() + 250;
            // An in-window job remains useful to the full viewable disk. Let one
            // newly urgent tile start without aborting that useful download.
            if (candidates.length === 0 || this.stats.active >= concurrency + 1)
                return;
            const visible = (tile) => !!(this.options.prioritizeVisible && camera?.isInFrustum(tile.mesh));
            const better = (a, b) => Number(visible(a)) - Number(visible(b)) || distance(b) - distance(a);
            const best = candidates.reduce((a, b) => better(a, b) >= 0 ? a : b);
            const worst = [...this.jobs.keys()].reduce((a, b) => better(a, b) <= 0 ? a : b);
            const bestVisible = visible(best), worstVisible = visible(worst);
            if (!((bestVisible && !worstVisible)
                || (bestVisible === worstVisible && distance(best) * 4 < distance(worst))))
                return;
        }
        const distances = new Map(candidates.map(tile => [tile, distance(tile)]));
        const visible = new Set(this.options.prioritizeVisible && camera
            ? candidates.filter(tile => camera.isInFrustum(tile.mesh)) : candidates);
        candidates.sort((a, b) => Number(visible.has(b)) - Number(visible.has(a)) || distances.get(a) - distances.get(b));
        for (const tile of candidates) {
            if (!tile.tileCoords ||
                tile.mesh.isDisposed() ||
                !this.globe.isTileGeometryReady(tile))
                continue;
            const key = tile.tileCoords.toString();
            if (this.ready.get(tile) === key ||
                this.jobs.has(tile) ||
                this.stats.active >= concurrency + Number(full))
                continue;
            const abort = new AbortController();
            this.jobs.set(tile, { key, abort });
            this.stats.active++;
            void this.load(tile, key, abort);
        }
        // A source download must not leave unused controller slots waiting for
        // the next render/poll to prepare their geometry. Fill the requested
        // window with bounded slices, then resume when a DEM slot is released.
        if (this.globe.pendingGeometryCount > 0 && this.stats.active < concurrency)
            this.scheduleRefill();
    }
    async load(tile, key, abort) {
        const coords = tile.tileCoords.clone();
        try {
            if (this.options.elevation && this.terrainReady.get(tile) !== key &&
                coords.z >= (this.options.minTerrainZoom ?? 5)) {
                const grid = await this.options.elevation(coords, abort.signal);
                if (abort.signal.aborted ||
                    tile.mesh.isDisposed() ||
                    tile.tileCoords.toString() !== key)
                    return;
                this.globe.setElevationData(tile, grid.data, grid.width, grid.height, this.options.exaggeration ?? 1, true);
                this.terrainReady.set(tile, key);
            }
            if (abort.signal.aborted ||
                tile.mesh.isDisposed() ||
                tile.tileCoords.toString() !== key)
                return;
            if (this.options.enabled !== false && this.options.featuresEnabled !== false
                && this.options.featureFilter?.(tile) !== false) {
                const providers = [];
                if (this.options.buildings && coords.z >= (this.options.minBuildingZoom ?? 14)
                    && coords.z <= (this.options.maxBuildingZoom ?? Infinity))
                    providers.push(this.options.buildings);
                if (coords.z >= (this.options.minFeatureZoom ?? this.options.minBuildingZoom ?? 14)
                    && coords.z <= (this.options.maxFeatureZoom ?? this.options.maxBuildingZoom ?? Infinity))
                    providers.push(...(this.options.features ?? []));
                for (const provider of providers)
                    this.providers.add(provider);
                const submitted = this.submittedFeatures.get(tile);
                const remaining = [...new Set(providers)].filter(provider => submitted?.key !== key || !submitted.providers.has(provider));
                const recordSubmitted = (provider) => {
                    let record = this.submittedFeatures.get(tile);
                    if (record?.key !== key) {
                        record = { key, providers: new Set() };
                        this.submittedFeatures.set(tile, record);
                    }
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
                            if (this.queuedFeatures.get(tile) === key)
                                this.queuedFeatures.delete(tile);
                            this.settled = false;
                            this.scheduleRefill();
                        },
                        complete: () => {
                            this.queuedFeatures.delete(tile);
                            this.ready.set(tile, key);
                            this.retryAt.delete(tile);
                        },
                        failed: error => {
                            this.queuedFeatures.delete(tile);
                            this.settled = false;
                            this.recordFailure(tile, key, error);
                            this.scheduleRefill();
                        },
                    });
                }
                else {
                    for (const provider of remaining) {
                        provider.SubmitLoadTileRequest(tile);
                        recordSubmitted(provider);
                    }
                    this.ready.set(tile, key);
                    this.retryAt.delete(tile);
                }
            }
            else
                this.retryAt.delete(tile);
            this.stats.completed++;
        }
        catch (error) {
            if (!abort.signal.aborted) {
                this.recordFailure(tile, key, error);
            }
        }
        finally {
            if (this.jobs.get(tile)?.abort === abort) {
                this.jobs.delete(tile);
                this.stats.active--;
            }
            // Fill the released slot immediately, including when rendering is
            // throttled. update() reprioritizes from the latest camera each time.
            this.scheduleRefill();
        }
    }
    featureDistance(tile) {
        const camera = this.globe.scene.activeCamera;
        if (camera)
            return Vector3.DistanceSquared(camera.globalPosition, tile.mesh.getBoundingInfo().boundingSphere.centerWorld);
        const x = this.globe.ourTileMath.lon_to_tileExact(this.globe.centerCoords.x, this.globe.zoom);
        const y = this.globe.ourTileMath.lat_to_tileExact(this.globe.centerCoords.y, this.globe.zoom);
        const count = 2 ** this.globe.zoom;
        const dx = Math.abs(tile.tileCoords.x + 0.5 - x);
        return Math.min(dx, count - dx) ** 2 + (tile.tileCoords.y + 0.5 - y) ** 2;
    }
    recordFailure(tile, key, error) {
        this.stats.failed++;
        const previous = this.retryAt.get(tile);
        const failures = previous?.key === key ? previous.failures + 1 : 1;
        this.retryAt.set(tile, { key, failures,
            after: performance.now() + Math.min(8000, 250 * 2 ** Math.min(5, failures - 1)) });
        if (failures === 1)
            this.onErrorObservable.notifyObservers(error instanceof Error ? error : new Error(String(error)));
    }
    scheduleRefill() {
        if (this.disposed)
            return;
        // Nested browser timers are clamped to at least four milliseconds.
        // A regional window can need hundreds of geometry/DEM refill slices;
        // posted tasks yield to rendering without paying that delay per tile.
        if (typeof window !== "undefined" && typeof MessageChannel !== "undefined") {
            if (this.refillQueued)
                return;
            if (!this.refillChannel) {
                this.refillChannel = new MessageChannel();
                this.refillChannel.port1.onmessage = () => {
                    this.refillQueued = false;
                    if (!this.disposed) {
                        this.stats.postedRefills++;
                        this.update();
                    }
                };
            }
            this.refillQueued = true;
            this.refillChannel.port2.postMessage(null);
            return;
        }
        if (this.refillTimer === undefined)
            this.refillTimer = setTimeout(() => {
                this.refillTimer = undefined;
                this.stats.timerRefills++;
                this.update();
            }, 0);
    }
    /** Explicitly retry failures or reload after changing provider settings. */
    invalidate(preserveTerrain = false, preserveBuildings = false) {
        if (!preserveTerrain)
            this.terrainReady = new WeakMap();
        this.settled = false;
        for (const job of this.jobs.values())
            job.abort.abort();
        this.jobs.clear();
        this.stats.active = 0;
        this.nextPriorityCheck = 0;
        this.ready = new WeakMap();
        this.options.featureQueue?.cancel(this);
        this.queuedFeatures = new WeakMap();
        this.submittedFeatures = new WeakMap();
        this.retryAt = new WeakMap();
        for (const provider of this.providers)
            provider.cancelPendingRequests();
        if (!preserveBuildings)
            for (const tile of this.globe.ourTiles)
                tile.deleteBuildings();
    }
    dispose() {
        this.disposed = true;
        clearTimeout(this.refillTimer);
        this.refillChannel?.port1.close();
        this.refillChannel?.port2.close();
        // The globe can outlive its streaming controller. Do not strand DEM
        // data recorded just before its posted upload callback was cancelled.
        if (this.globe.pendingElevationCount > 0)
            this.globe.flushElevationData();
        this.options.featureQueue?.cancel(this);
        for (const provider of this.providers)
            provider.cancelPendingRequests();
        for (const job of this.jobs.values())
            job.abort.abort();
        this.jobs.clear();
        this.stats.active = 0;
        this.globe.scene.onBeforeRenderObservable.remove(this.observer);
        this.globe.onTilePositionUpdatedObservable.remove(this.positionObserver);
        this.onErrorObservable.clear();
    }
}
//# sourceMappingURL=GlobeDataController.js.map