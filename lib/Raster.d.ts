import { Vector2 } from "@babylonjs/core/Maths/math";
import TileSet from "./TileSet";
import { RetrievalLocation } from "./TileSet";
import { TileRequest } from "./TileSet";
export default class Raster {
    name: string;
    tileSet: TileSet;
    retrievalLocation: RetrievalLocation;
    constructor(name: string, tileSet: TileSet, retrievalLocation?: RetrievalLocation);
    getRasterURL(tileCoords: Vector2, zoom: number): string;
    doTileSave(request: TileRequest): void;
}
