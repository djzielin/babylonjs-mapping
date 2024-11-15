import { Vector2 } from "@babylonjs/core/Maths/math";
import Raster from "./Raster";
import TileSet from "./TileSet";
export default class RasterWMTS extends Raster {
    tileMatrixSet: string;
    style: string;
    extension: string;
    baseURL: string;
    layerName: string;
    constructor(ts: TileSet);
    setup(url: string, layer: string): void;
    getRasterURL(tileCoords: Vector2, zoom: number): string;
}
