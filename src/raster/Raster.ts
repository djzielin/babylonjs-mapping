import { Vector2 } from "@babylonjs/core/Maths/math.js";
import { RetrievalLocation } from "../shared/Retrieval.js";
import type TileSet from "../core/TileSet.js";
import type { TileRequest } from "../core/TileSet.js";

export default class Raster {
    
    constructor(public name:string, public tileSet: TileSet, public retrievalLocation=RetrievalLocation.Remote){

    }

    public getRasterURL(tileCoords: Vector2, zoom: number): string {
       return "";
    }

    public doTileSave(request: TileRequest){

    }
}
