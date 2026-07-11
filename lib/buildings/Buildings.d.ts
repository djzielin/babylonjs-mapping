import { Vector3 } from "@babylonjs/core/Maths/math";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import * as GeoJSON from './GeoJSON';
import type Tile from "../core/Tile";
import type TileSet from "../core/TileSet";
import { EPSG_Type } from "../core/TileMath";
import { Observable } from "@babylonjs/core";
import { RetrievalLocation, RetrievalType } from "../shared/Retrieval";
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
    lineWidth: number;
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
