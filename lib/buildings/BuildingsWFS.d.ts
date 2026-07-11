import { EPSG_Type } from "../core/TileMath.js";
import { RetrievalLocation } from "../shared/Retrieval.js";
import type Tile from "../core/Tile.js";
import type TileSet from "../core/TileSet.js";
import Buildings from "./Buildings.js";
export default class BuildingsWFS extends Buildings {
    url: string;
    layerName: string;
    epsg: EPSG_Type;
    urlService: string;
    urlOutput: string;
    urlRequest: string;
    flipWinding: boolean;
    constructor(name: string, url: string, layerName: string, epsg: EPSG_Type, tileSet: TileSet, retrievalLocation?: RetrievalLocation);
    setupAGOL(): void;
    setupGeoServer(): void;
    SubmitLoadTileRequest(tile: Tile): void;
    SubmitLoadAllRequest(): void;
    private loadHelper;
}
