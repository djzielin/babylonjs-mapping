import { Observable } from "@babylonjs/core/Misc/observable.js";
/** Bounded camera-driven detail loading. Retained tiles keep all their data. */
export default class GlobeDataController {
    constructor(globe, options = {}) {
        this.globe = globe;
        this.options = options;
        this.onErrorObservable = new Observable();
        this.stats = {
            active: 0,
            completed: 0,
            cancelled: 0,
            failed: 0,
        };
        this.jobs = new Map();
        this.ready = new WeakMap();
        this.terrainReady = new WeakMap();
        this.disposed = false;
        this.settled = false;
        this.providers = new Set();
        if (!Number.isInteger(options.concurrency ?? 4) ||
            (options.concurrency ?? 4) < 1 ||
            !Number.isFinite(options.exaggeration ?? 1) ||
            (options.exaggeration ?? 1) < 0)
            throw new RangeError("Invalid globe detail options");
        this.positionObserver = globe.onTilePositionUpdatedObservable.add(() => { this.settled = false; });
        this.observer = globe.scene.onBeforeRenderObservable.add(() => this.update());
    }
    update() {
        if (this.disposed)
            return;
        if (this.tiles !== this.globe.ourTiles) {
            this.tiles = this.globe.ourTiles;
            this.settled = false;
        }
        if (this.settled)
            return;
        for (const [tile, job] of this.jobs)
            if (tile.mesh.isDisposed() ||
                job.key !== tile.tileCoords.toString()) {
                job.abort.abort();
                this.jobs.delete(tile);
                this.stats.cancelled++;
            }
        if (this.stats.active >= (this.options.concurrency ?? 4))
            return;
        const centerX = this.globe.ourTileMath.lon_to_tileExact(this.globe.centerCoords.x, this.globe.zoom);
        const centerY = this.globe.ourTileMath.lat_to_tileExact(this.globe.centerCoords.y, this.globe.zoom);
        const count = 2 ** this.globe.zoom;
        const distance = (tile) => {
            const dx = Math.abs(tile.tileCoords.x + 0.5 - centerX);
            return Math.min(dx, count - dx) ** 2 + (tile.tileCoords.y + 0.5 - centerY) ** 2;
        };
        // Load the area around the viewer before the far corners of large LOD grids.
        const candidates = this.globe.ourTiles.filter(tile => !tile.mesh.isDisposed() && this.globe.isTileGeometryReady(tile)
            && this.ready.get(tile) !== tile.tileCoords.toString() && !this.jobs.has(tile));
        if (candidates.length === 0 && this.jobs.size === 0 && this.globe.pendingGeometryCount === 0) {
            this.settled = true;
            return;
        }
        const camera = this.globe.scene.activeCamera;
        const visible = new Set(this.options.prioritizeVisible && camera
            ? candidates.filter(tile => camera.isInFrustum(tile.mesh)) : candidates);
        candidates.sort((a, b) => Number(visible.has(b)) - Number(visible.has(a)) || distance(a) - distance(b));
        for (const tile of candidates) {
            if (!tile.tileCoords ||
                tile.mesh.isDisposed() ||
                !this.globe.isTileGeometryReady(tile))
                continue;
            const key = tile.tileCoords.toString();
            if (this.ready.get(tile) === key ||
                this.jobs.has(tile) ||
                this.stats.active >= (this.options.concurrency ?? 4))
                continue;
            const abort = new AbortController();
            this.jobs.set(tile, { key, abort });
            this.stats.active++;
            void this.load(tile, key, abort);
        }
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
                this.globe.setElevationData(tile, grid.data, grid.width, grid.height, this.options.exaggeration ?? 1);
                this.terrainReady.set(tile, key);
            }
            if (abort.signal.aborted ||
                tile.mesh.isDisposed() ||
                tile.tileCoords.toString() !== key)
                return;
            if (coords.z >= (this.options.minBuildingZoom ?? 14) && coords.z <= (this.options.maxBuildingZoom ?? Infinity)) {
                for (const provider of [
                    this.options.buildings,
                    ...(this.options.features ?? []),
                ])
                    if (provider) {
                        this.providers.add(provider);
                        provider.SubmitLoadTileRequest(tile);
                    }
            }
            this.ready.set(tile, key);
            this.stats.completed++;
        }
        catch (error) {
            if (!abort.signal.aborted) {
                this.stats.failed++;
                this.ready.set(tile, key);
                this.onErrorObservable.notifyObservers(error instanceof Error ? error : new Error(String(error)));
            }
        }
        finally {
            if (this.jobs.get(tile)?.abort === abort)
                this.jobs.delete(tile);
            this.stats.active--;
            // Fill the released slot immediately, including when rendering is
            // throttled. update() reprioritizes from the latest camera each time.
            if (!this.disposed && this.refillTimer === undefined)
                this.refillTimer = setTimeout(() => {
                    this.refillTimer = undefined;
                    this.update();
                }, 0);
        }
    }
    /** Explicitly retry failures or reload after changing provider settings. */
    invalidate(preserveTerrain = false) {
        if (!preserveTerrain)
            this.terrainReady = new WeakMap();
        this.settled = false;
        for (const job of this.jobs.values())
            job.abort.abort();
        this.jobs.clear();
        this.ready = new WeakMap();
        for (const provider of this.providers)
            provider.cancelPendingRequests();
        for (const tile of this.globe.ourTiles)
            tile.deleteBuildings();
    }
    dispose() {
        this.disposed = true;
        clearTimeout(this.refillTimer);
        for (const provider of this.providers)
            provider.cancelPendingRequests();
        for (const job of this.jobs.values())
            job.abort.abort();
        this.jobs.clear();
        this.globe.scene.onBeforeRenderObservable.remove(this.observer);
        this.globe.onTilePositionUpdatedObservable.remove(this.positionObserver);
        this.onErrorObservable.clear();
    }
}
//# sourceMappingURL=GlobeDataController.js.map