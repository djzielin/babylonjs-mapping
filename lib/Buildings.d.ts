import { Vector3 } from "@babylonjs/core/Maths/math";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import * as GeoJSON from './GeoJSON';
import Tile from "./Tile";
import TileSet from "./TileSet";
import { EPSG_Type } from "./TileMath";
import { Observable } from "@babylonjs/core";
export declare enum BuildingRequestType {
    LoadTile = 0,
    CreateBuilding = 1,
    MergeAllBuildingsOnTile = 2
}
export declare enum RetrievalType {
    IndividualTiles = 0,
    AllData = 1
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
export declare enum RetrievalLocation {
    Remote = 0,
    Local = 1,
    Remote_and_Save = 2
}
interface GeoFileLoaded {
    url: string;
    topLevel: GeoJSON.topLevel;
}
export default abstract class Buildings {
    name: string;
    protected tileSet: TileSet;
    retrevialLocation: RetrievalLocation;
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
    constructor(name: string, tileSet: TileSet, retrevialLocation: RetrievalLocation);
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
