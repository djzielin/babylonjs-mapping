import { Vector2 } from "@babylonjs/core/Maths/math";
import { RetrievalLocation } from "../shared/Retrieval";
import type TileSet from "../core/TileSet";
import type { TileRequest } from "../core/TileSet";

export default class Raster {
    
    constructor(public name:string, public tileSet: TileSet, public retrievalLocation=RetrievalLocation.Remote){

    }

    public getRasterURL(tileCoords: Vector2, zoom: number): string {
       return "";
    }

    public doTileSave(request: TileRequest){

    }
}
