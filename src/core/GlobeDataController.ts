import { Observable } from '@babylonjs/core/Misc/observable.js';
import type GlobeSet from './GlobeSet.js';
import type Tile from './Tile.js';
import type Buildings from '../buildings/Buildings.js';
import type { ElevationLoader } from '../terrain/TerrainRGB.js';

export interface GlobeDataOptions {
    elevation?: ElevationLoader;
    buildings?: Buildings;
    features?: Buildings[];
    minTerrainZoom?: number;
    minBuildingZoom?: number;
    concurrency?: number;
    exaggeration?: number;
}
/** Bounded camera-driven detail loading. Retained tiles keep all their data. */
export default class GlobeDataController {
    public readonly onErrorObservable = new Observable<Error>();
    public readonly stats = {active:0,completed:0,cancelled:0,failed:0};
    private jobs = new Map<Tile,{key:string;abort:AbortController}>();
    private ready = new WeakMap<Tile,string>();
    private observer;
    private disposed=false;
    private providers = new Set<Buildings>();
    constructor(public readonly globe: GlobeSet, public readonly options: GlobeDataOptions = {}) {
        if (!Number.isInteger(options.concurrency ?? 4) || (options.concurrency ?? 4)<1 || !Number.isFinite(options.exaggeration ?? 1) || (options.exaggeration ?? 1)<0) throw new RangeError('Invalid globe detail options');
        this.observer=globe.scene.onBeforeRenderObservable.add(()=>this.update());
    }
    public update(): void {
        if (this.disposed) return;
        for (const [tile,job] of this.jobs) if (tile.mesh.isDisposed() || job.key!==tile.tileCoords.toString()) { job.abort.abort(); this.jobs.delete(tile); this.stats.cancelled++; }
        for (const tile of this.globe.ourTiles) {
            if (!tile.tileCoords || tile.mesh.isDisposed()) continue;
            const key=tile.tileCoords.toString();
            if (this.ready.get(tile)===key || this.jobs.has(tile) || this.stats.active >= (this.options.concurrency??4)) continue;
            const abort=new AbortController();
            this.jobs.set(tile,{key,abort}); this.stats.active++;
            void this.load(tile,key,abort);
        }
    }
    private async load(tile: Tile,key: string,abort: AbortController): Promise<void> {
        const coords=tile.tileCoords.clone();
        try {
            if (this.options.elevation && coords.z >= (this.options.minTerrainZoom??5)) {
                const grid=await this.options.elevation(coords,abort.signal);
                if (abort.signal.aborted || tile.mesh.isDisposed() || tile.tileCoords.toString()!==key) return;
                this.globe.setElevationData(tile,grid.data,grid.width,grid.height,this.options.exaggeration??1);
            }
            if (abort.signal.aborted || tile.mesh.isDisposed() || tile.tileCoords.toString()!==key) return;
            if (coords.z >= (this.options.minBuildingZoom??14)) {
                for (const provider of [this.options.buildings,...(this.options.features??[])]) if (provider) { this.providers.add(provider); provider.SubmitLoadTileRequest(tile); }
            }
            this.ready.set(tile,key); this.stats.completed++;
        } catch(error) {
            if (!abort.signal.aborted) {
                this.stats.failed++; this.ready.set(tile,key);
                this.onErrorObservable.notifyObservers(error instanceof Error ? error : new Error(String(error)));
            }
        } finally {
            if (this.jobs.get(tile)?.abort===abort) this.jobs.delete(tile);
            this.stats.active--;
        }
    }
    /** Explicitly retry failures or reload after changing provider settings. */
    public invalidate(): void {
        for (const job of this.jobs.values()) job.abort.abort();
        this.jobs.clear(); this.ready=new WeakMap();
        for (const provider of this.providers) provider.cancelPendingRequests();
        for (const tile of this.globe.ourTiles) tile.deleteBuildings();
    }
    public dispose(): void {
        this.disposed=true;
        for (const provider of this.providers) provider.cancelPendingRequests();
        for (const job of this.jobs.values()) job.abort.abort();
        this.jobs.clear(); this.globe.scene.onBeforeRenderObservable.remove(this.observer); this.onErrorObservable.clear();
    }
}
