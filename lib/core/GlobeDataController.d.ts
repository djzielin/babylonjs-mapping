import { Observable } from '@babylonjs/core/Misc/observable.js';
import type GlobeSet from './GlobeSet.js';
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
    readonly globe: GlobeSet;
    readonly options: GlobeDataOptions;
    readonly onErrorObservable: Observable<Error>;
    readonly stats: {
        active: number;
        completed: number;
        cancelled: number;
        failed: number;
    };
    private jobs;
    private ready;
    private observer;
    private disposed;
    constructor(globe: GlobeSet, options?: GlobeDataOptions);
    update(): void;
    private load;
    /** Explicitly retry failures or reload after changing provider settings. */
    invalidate(): void;
    dispose(): void;
}
