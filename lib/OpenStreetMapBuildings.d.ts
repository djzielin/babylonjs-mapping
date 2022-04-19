import { Scene } from "@babylonjs/core/scene";
import Tile from "./Tile";
import TileSet from "./TileSet";
export default class OpenStreetMap {
    private tileSet;
    private scene;
    private osmBuildingServers;
    private heightScaleFixer;
    private buildingMaterial;
    constructor(tileSet: TileSet, scene: Scene);
    setExaggeration(tileScale: number, exaggeration: number): void;
    generateBuildingsForTile(tile: Tile): void;
    private generateSingleBuilding;
}
