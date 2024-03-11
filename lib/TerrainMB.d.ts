import { Scene } from "@babylonjs/core/scene";
import Tile from './Tile';
import TileSet from "./TileSet";
export default class TerrainMB {
    tileSet: TileSet;
    private scene;
    private mbServer;
    globalMinHeight: number;
    private index;
    accessToken: string;
    private heightScaleFixer;
    private skuToken;
    constructor(tileSet: TileSet, scene: Scene);
    setExaggeration(tileScale: number, exaggeration: number): void;
    private GetAsyncTexture;
    updateAllTerrainTiles(exaggeration: number): void;
    updateSingleTerrainTile(tile: Tile): Promise<void>;
    private fixTileSeams;
    private convertRGBtoDEM;
    applyDEMToMesh(tile: Tile, meshPrecision: number): void;
    private computeIndexByPercent;
    fixNorthSeam(tile: Tile, tileUpper: Tile): void;
    fixEastSeam(tile: Tile, tileRight: Tile): void;
    fixNorthEastSeam(tile: Tile, tileUpperRight: Tile): void;
}
