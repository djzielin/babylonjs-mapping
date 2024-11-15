import { Vector2 } from "@babylonjs/core/Maths/math";
import Raster from "./Raster";
import TileSet from "./TileSet";
import { RetrievalLocation } from "./TileSet";
import { TileRequest } from "./TileSet";
export default class RasterWMTS extends Raster {
    tileMatrixSet: string;
    style: string;
    extension: string;
    baseURL: string;
    layerName: string;
    downloadCount: number;
    downloadComplete: boolean;
    downloadQueue: TileRequest[];
    constructor(ts: TileSet, retrievalLocation?: RetrievalLocation);
    setup(url: string, layer: string): void;
    getRasterURL(tileCoords: Vector2, zoom: number): string;
    doTileSave(request: TileRequest): void;
    processSingleRequest(request: TileRequest): Promise<void>;
}
