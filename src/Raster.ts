import { Vector2 } from "@babylonjs/core/Maths/math";
import TileSet from "./TileSet";
import { RetrievalLocation } from "./TileSet";
import {TileRequest} from "./TileSet";

export default class Raster {
    
    constructor(public name:string, public tileSet: TileSet, public retrievalLocation=RetrievalLocation.Remote){

    }

    public getRasterURL(tileCoords: Vector2, zoom: number): string {
       return "";
    }

    public async doTileSave(request: TileRequest){

    }
}