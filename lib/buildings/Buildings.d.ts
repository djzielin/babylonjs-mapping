import { Vector3 } from "@babylonjs/core/Maths/math.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import * as GeoJSON from './GeoJSON.js';
import type Tile from "../core/Tile.js";
import type TileSet from "../core/TileSet.js";
import { EPSG_Type } from "../core/TileMath.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import { RetrievalLocation, RetrievalType } from "../shared/Retrieval.js";
export declare enum BuildingRequestType {
    LoadTile = 0,
    CreateBuilding = 1,
    MergeAllBuildingsOnTile = 2
}
export interface BuildingRequestPagination {
    pageSize: number;
    startIndex: number;
}
export interface BuildingRequest {
    requestType: BuildingRequestType;
    tile: Tile;
    tileCoords: Vector3;
    inProgress: boolean;
    flipWinding: boolean;
    feature?: GeoJSON.feature;
    epsgType?: EPSG_Type;
    url?: string;
    pagination?: BuildingRequestPagination;
    mergeAfterLoad?: boolean;
}
export interface BuildingLODOptions {
    /** Enables a rectangle billboard for each generated feature at a distance. */
    enabled?: boolean;
    /** Distance in Babylon world units at which the billboard is selected. */
    distance?: number;
    /** Babylon billboard mode, such as Mesh.BILLBOARDMODE_Y or Mesh.BILLBOARDMODE_ALL. */
    billboardMode?: number;
}
export interface BuildingOptimizationOptions {
    /** Freeze completed building world matrices. Disable this for moving tiles. */
    freezeWorldMatrices?: boolean;
    /** Freeze the shared building material after it is configured. */
    freezeMaterials?: boolean;
    /** Disable picking on generated building and billboard meshes. */
    disablePicking?: boolean;
    /** Disable collision checks on generated building and billboard meshes. */
    disableCollisions?: boolean;
    /** Process requests nearest to the active camera instead of FIFO order. */
    prioritizeRequestsByDistance?: boolean;
}
export declare const DEFAULT_BUILDING_OPTIMIZATION_OPTIONS: Readonly<Required<BuildingOptimizationOptions>>;
export interface BuildingPerformanceStats {
    requestsProcessed: number;
    peakQueueLength: number;
    detailedBuildingCount: number;
    billboardCount: number;
    detailedVertexCount: number;
    billboardVertexCount: number;
    estimatedVertexReductionPercent: number;
    lodSelections: number;
    detailedSelections: number;
    billboardSelections: number;
    culledSelections: number;
    frameSamples: number;
    totalFrameTimeMs: number;
    averageFrameTimeMs: number;
    minFrameTimeMs: number;
    maxFrameTimeMs: number;
}
interface GeoFileLoaded {
    url: string;
    topLevel: GeoJSON.topLevel;
}
export default abstract class Buildings {
    name: string;
    protected tileSet: TileSet;
    exaggeration: number;
    doMerge: boolean;
    /**
     * Optional per-feature rectangle billboards for distant buildings.
     * LOD is disabled by default and should be configured before generation.
     */
    buildingLOD: BuildingLODOptions;
    defaultBuildingHeight: number;
    /** Width of MultiLineString extrusions in Babylon world units. */
    lineWidth: number;
    /** Diameter of Point features in Babylon world units. */
    pointDiameter: number;
    buildingsCreatedPerFrame: number;
    cacheFiles: boolean;
    buildingMaterial: StandardMaterial;
    /** Controls optional mesh/material and request-queue optimizations. */
    optimizationOptions: Required<BuildingOptimizationOptions>;
    /** Collect frame-time samples in getPerformanceStats(). */
    performanceMonitoringEnabled: boolean;
    /**
     * Optional transform applied to each completed building mesh before LOD
     * generation, duplicate detection, and tile merging.
     */
    buildingMeshTransform?: (mesh: Mesh) => void;
    retrievalType: RetrievalType;
    protected buildingRequests: BuildingRequest[];
    protected filesLoaded: GeoFileLoaded[];
    private requestsProcessedSinceCaughtUp;
    protected ourGeoJSON: GeoJSON.GeoJSON;
    private scene;
    onCaughtUpObservable: Observable<boolean>;
    private sleepRequested;
    private timeStart;
    private sleepDuration;
    private _retrievalLocation;
    private performanceStats;
    constructor(name: string, tileSet: TileSet, retrievalLocation: RetrievalLocation);
    /**
     * Merges optimization settings and applies the material setting immediately.
     * Mesh settings are applied to newly generated meshes and can be refreshed
     * on existing meshes with applyBuildingMeshOptions().
     */
    setOptimizationOptions(options: BuildingOptimizationOptions): void;
    /** Applies the current material optimization setting. */
    applyOptimizationOptions(): void;
    /** Applies picking, collision, and world-matrix settings to a mesh. */
    applyBuildingMeshOptions(mesh: Mesh, freezeWorldMatrix?: boolean): void;
    /** Enables or disables collection of engine frame-time samples. */
    setPerformanceMonitoringEnabled(enabled: boolean): void;
    /** Returns cumulative generation, LOD, queue, and optional frame metrics. */
    getPerformanceStats(): BuildingPerformanceStats;
    /** Clears cumulative performance counters without changing optimization settings. */
    resetPerformanceStats(): void;
    /** @internal Records a generated detailed mesh for performance reporting. */
    recordDetailedBuilding(mesh: Mesh): void;
    /** @internal Records a generated billboard for performance reporting. */
    recordBuildingBillboard(mesh: Mesh): void;
    /** @internal Records a Babylon LOD callback selection. */
    recordLODSelection(selectedLevel: Mesh | null, detailedMesh: Mesh, billboardMesh: Mesh): void;
    get retrievalLocation(): RetrievalLocation;
    set retrievalLocation(value: RetrievalLocation);
    /** @deprecated Use retrievalLocation. */
    get retrevialLocation(): RetrievalLocation;
    set retrevialLocation(value: RetrievalLocation);
    abstract SubmitLoadTileRequest(tile: Tile): void;
    abstract SubmitLoadAllRequest(): void;
    ProcessGeoJSON(request: BuildingRequest, topLevel: GeoJSON.topLevel): void;
    /**
     * Providers can override this to create the next request after a full
     * paginated response has been processed.
     */
    protected createNextPageRequest(_request: BuildingRequest, _featuresReturned: number): BuildingRequest | undefined;
    /**
     * Some paginated services report that an exact final page is out of range
     * instead of returning an empty FeatureCollection.
     */
    protected isPaginationEndResponse(_request: BuildingRequest, _response: Response): boolean;
    protected enqueueMergeRequest(request: BuildingRequest): void;
    protected enqueueBuildingRequest(request: BuildingRequest): void;
    protected prettyName(): string;
    private isURLLoaded;
    private getFeatures;
    protected stripFilePrefix(original: string): string;
    protected removePendingRequest(index?: number, request?: BuildingRequest): void;
    protected doSave(text: string): void;
    private processLoadedGeoJSON;
    protected handleLoadTileRequest(request: BuildingRequest, requestIndex?: number): void;
    private selectBuildingRequestIndex;
    processBuildingRequests(): void;
    generateBuildings(): void;
}
export {};
