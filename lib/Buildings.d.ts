import { Vector3 } from "@babylonjs/core/Maths/math";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import * as GeoJSON from './GeoJSON';
import Tile from "./Tile";
import TileSet from "./TileSet";
import { ProjectionType } from "./TileMath";
import { Observable } from "@babylonjs/core";
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
    feature?: GeoJSON.feature;
    projectionType?: ProjectionType;
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
    buildingsCreatedPerFrame: number;
    cacheFiles: boolean;
    buildingMaterial: StandardMaterial;
    protected buildingRequests: BuildingRequest[];
    protected filesLoaded: GeoFileLoaded[];
    private requestsProcessedSinceCaughtUp;
    protected ourGeoJSON: GeoJSON.GeoJSON;
    private scene;
    onCaughtUpObservable: Observable<boolean>;
    constructor(name: string, tileSet: TileSet);
    abstract SubmitLoadTileRequest(tile: Tile): void;
    abstract ProcessGeoJSON(request: BuildingRequest, topLevel: GeoJSON.topLevel): void;
    protected prettyName(): string;
    private isURLLoaded;
    private getFeatures;
    protected stripFilePrefix(original: string): string;
    protected removePendingRequest(index?: number): void;
    protected handleLoadTileRequest(request: BuildingRequest): void;
    processBuildingRequests(): void;
    generateBuildings(): void;
}
export {};
