import { Vector2 } from "@babylonjs/core/Maths/math";
import Raster from "./Raster";
import TileSet from "./TileSet";
export default class RasterMB extends Raster {
    accessToken: string;
    doResBoost: boolean;
    mapType: string;
    private mbServer;
    private skuToken;
    constructor(ts: TileSet);
    getRasterURL(tileCoords: Vector2, zoom: number): string;
}
