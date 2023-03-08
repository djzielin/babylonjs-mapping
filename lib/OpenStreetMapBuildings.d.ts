import { Scene } from "@babylonjs/core/scene";
import { Observable } from "@babylonjs/core";
import { ProjectionType } from "./TileSet";
import Tile from "./Tile";
import TileSet from "./TileSet";
export default class OpenStreetMapBuildings {
    private tileSet;
    private scene;
    private buildingRequests;
    private previousRequestSize;
    onCustomLoaded: Observable<boolean>;
    private osmBuildingServers;
    private heightScaleFixer;
    private buildingMaterial;
    private defaultBuildingHeight;
    constructor(tileSet: TileSet, scene: Scene);
    setDefaultBuildingHeight(height: number): void;
    setExaggeration(tileScale: number, exaggeration: number): void;
    populateFromCustomServer(url: string, projection: ProjectionType, doMerge?: boolean): void;
    populateBuildingGenerationRequestsForTile(tile: Tile, doMerge?: boolean): void;
    processBuildingRequests(): void;
    private getFirstCoordinate;
    private getFirstCoordinateFromPolygonSet;
    private generateSingleBuilding;
    private processSinglePolygon;
}
