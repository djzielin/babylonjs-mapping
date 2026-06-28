import { Vector2 } from "@babylonjs/core/Maths/math";
import { RetrievalLocation } from "../shared/Retrieval";
import type TileSet from "../core/TileSet";
import type { TileRequest } from "../core/TileSet";
export default class Raster {
    name: string;
    tileSet: TileSet;
    retrievalLocation: RetrievalLocation;
    constructor(name: string, tileSet: TileSet, retrievalLocation?: RetrievalLocation);
    getRasterURL(tileCoords: Vector2, zoom: number): string;
    doTileSave(request: TileRequest): void;
}
