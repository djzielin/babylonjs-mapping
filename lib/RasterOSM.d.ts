import { Vector2 } from "@babylonjs/core/Maths/math";
import Raster from "./Raster";
import TileSet from "./TileSet";
export default class OpenStreetMap extends Raster {
    private osmServers;
    private index;
    constructor(ts: TileSet);
    getRasterURL(tileCoords: Vector2, zoom: number): string;
}
