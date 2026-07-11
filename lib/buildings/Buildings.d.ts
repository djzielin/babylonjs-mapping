import { Vector3 } from "@babylonjs/core/Maths/math.js";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import * as GeoJSON from './GeoJSON.js';
import type Tile from "../core/Tile.js";
import type TileSet from "../core/TileSet.js";
import { EPSG_Type } from "../core/TileMath.js";
import { Observable } from "@babylonjs/core";
import { RetrievalLocation, RetrievalType } from "../shared/Retrieval.js";
export declare enum BuildingRequestType {
    LoadTile = 0,
    CreateBuilding = 1,
    MergeAllBuildingsOnTile = 2
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
    defaultBuildingHeight: number;
    /** Width of MultiLineString extrusions in Babylon world units. */
    lineWidth: number;
    /** Diameter of Point features in Babylon world units. */
    pointDiameter: number;
    buildingsCreatedPerFrame: number;
    cacheFiles: boolean;
    buildingMaterial: StandardMaterial;
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
    constructor(name: string, tileSet: TileSet, retrievalLocation: RetrievalLocation);
    get retrievalLocation(): RetrievalLocation;
    set retrievalLocation(value: RetrievalLocation);
    /** @deprecated Use retrievalLocation. */
    get retrevialLocation(): RetrievalLocation;
    set retrevialLocation(value: RetrievalLocation);
    abstract SubmitLoadTileRequest(tile: Tile): void;
    abstract SubmitLoadAllRequest(): void;
    ProcessGeoJSON(request: BuildingRequest, topLevel: GeoJSON.topLevel): void;
    protected prettyName(): string;
    private isURLLoaded;
    private getFeatures;
    protected stripFilePrefix(original: string): string;
    protected removePendingRequest(index?: number): void;
    protected doSave(text: string): void;
    protected handleLoadTileRequest(request: BuildingRequest): void;
    processBuildingRequests(): void;
    generateBuildings(): void;
}
export {};
