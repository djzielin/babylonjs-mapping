import { Vector2 } from "@babylonjs/core/Maths/math";
import TileSet from "./TileSet";
export default class Raster {
    name: string;
    tileSet: TileSet;
    constructor(name: string, tileSet: TileSet);
    getRasterURL(tileCoords: Vector2, zoom: number): string;
}
