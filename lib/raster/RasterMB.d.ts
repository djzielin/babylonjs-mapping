import { Vector2 } from "@babylonjs/core/Maths/math.js";
import Raster from "./Raster.js";
import type TileSet from "../core/TileSet.js";
export default class RasterMB extends Raster {
    accessToken: string;
    doResBoost: boolean;
    mapType: string;
    private mbServer;
    private skuToken;
    constructor(ts: TileSet);
    getRasterURL(tileCoords: Vector2, zoom: number): string;
}
