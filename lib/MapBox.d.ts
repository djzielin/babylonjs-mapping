import { Scene } from "@babylonjs/core/scene";
import { Vector2 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import Tile from './Tile';
import TileSet from "./TileSet";
export default class MapBox {
    private tileSet;
    private scene;
    private mbServer;
    private index;
    accessToken: string;
    private heightScaleFixer;
    private skuToken;
    constructor(tileSet: TileSet, scene: Scene);
    getRasterURL(tileCoords: Vector2, zoom: number, doResBoost: boolean): string;
    setExaggeration(tileScale: number, exaggeration: number): void;
    private GetAsyncTexture;
    getTileTerrain(tile: Tile, doResBoost: boolean): Promise<void>;
    private convertRGBtoDEM;
    applyHeightArrayToMesh(mesh: Mesh, tile: Tile, meshPrecision: number, heightAdjustment: number): void;
    private computeIndexByPercent;
    fixNorthSeam(tile: Tile, tileUpper: Tile): void;
    fixEastSeam(tile: Tile, tileRight: Tile): void;
    fixNorthEastSeam(tile: Tile, tileUpperRight: Tile): void;
}
