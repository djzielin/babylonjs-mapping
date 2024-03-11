import { Vector2 } from "@babylonjs/core/Maths/math";
import TileSet from "./TileSet";

export default class Raster {
    
    constructor(public name:string, public tileSet: TileSet){

    }

    public getRasterURL(tileCoords: Vector2, zoom: number): string {
       return "";
    }
}