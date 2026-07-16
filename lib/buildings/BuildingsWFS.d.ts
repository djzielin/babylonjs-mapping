import { EPSG_Type } from "../core/TileMath.js";
import { BuildingRequest } from "./Buildings.js";
import { RetrievalLocation } from "../shared/Retrieval.js";
import type Tile from "../core/Tile.js";
import type TileSet from "../core/TileSet.js";
import Buildings from "./Buildings.js";
export default class BuildingsWFS extends Buildings {
    url: string;
    layerName: string;
    epsg: EPSG_Type;
    urlService: string;
    urlVersion: string;
    urlOutput: string;
    urlRequest: string;
    flipWinding: boolean;
    /** Enable WFS 2.0 result paging for services such as ArcGIS Online. */
    paginateRequests: boolean;
    /** ArcGIS Online's hosted WFS feature limit; can be lowered for testing or smaller services. */
    maxFeaturesPerRequest: number;
    constructor(name: string, url: string, layerName: string, epsg: EPSG_Type, tileSet: TileSet, retrievalLocation?: RetrievalLocation);
    setupAGOL(): void;
    setupGeoServer(): void;
    SubmitLoadTileRequest(tile: Tile): void;
    SubmitLoadAllRequest(): void;
    protected createNextPageRequest(request: BuildingRequest, featuresReturned: number): BuildingRequest | undefined;
    protected isPaginationEndResponse(request: BuildingRequest, response: Response): boolean;
    private loadHelper;
    private getPageSize;
    private withPaginationParameters;
}
