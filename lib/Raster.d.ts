import { Vector2 } from "@babylonjs/core/Maths/math";
import { RetrievalLocation } from "./Retrieval";
import type TileSet from "./TileSet";
import type { TileRequest } from "./TileSet";
export default class Raster {
    name: string;
    tileSet: TileSet;
    retrievalLocation: RetrievalLocation;
    constructor(name: string, tileSet: TileSet, retrievalLocation?: RetrievalLocation);
    getRasterURL(tileCoords: Vector2, zoom: number): string;
    doTileSave(request: TileRequest): void;
}
