import { Vector2 } from "@babylonjs/core/Maths/math";

export default class RasterProvider {
    
    constructor(public name:string){

    }

    public getRasterURL(tileCoords: Vector2, zoom: number): string {
       return "";
    }
}