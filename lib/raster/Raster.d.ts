import { Vector2 } from "@babylonjs/core/Maths/math.js";
import { RetrievalLocation } from "../shared/Retrieval.js";
import type TileSet from "../core/TileSet.js";
import type { TileRequest } from "../core/TileSet.js";
export default class Raster {
    name: string;
    tileSet: TileSet;
    retrievalLocation: RetrievalLocation;
    constructor(name: string, tileSet: TileSet, retrievalLocation?: RetrievalLocation);
    getRasterURL(tileCoords: Vector2, zoom: number): string;
    doTileSave(request: TileRequest): void;
}
