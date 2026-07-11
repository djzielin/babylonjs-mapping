import { Vector2 } from "@babylonjs/core/Maths/math.js";
import Raster from "./Raster.js";
import type TileSet from "../core/TileSet.js";
export default class RasterOSM extends Raster {
    private osmServers;
    private index;
    constructor(ts: TileSet);
    getRasterURL(tileCoords: Vector2, zoom: number): string;
}
