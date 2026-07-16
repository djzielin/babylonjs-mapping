import { EPSG_Type } from "../core/TileMath.js";
import { BuildingRequest} from "./Buildings.js";
import { BuildingRequestType } from "./Buildings.js";
import { Vector4 } from "@babylonjs/core";
import { RetrievalLocation, RetrievalType } from "../shared/Retrieval.js";

import type Tile from "../core/Tile.js";
import type TileSet from "../core/TileSet.js";
import Buildings from "./Buildings.js";

export default class BuildingsWFS extends Buildings {
    public urlService = "service=WFS";
    public urlVersion = "";
    public urlOutput = "";
    public urlRequest = "&request=GetFeature";
    public flipWinding = false;
    /** Enable WFS 2.0 result paging for services such as ArcGIS Online. */
    public paginateRequests = false;
    /** ArcGIS Online's hosted WFS feature limit; can be lowered for testing or smaller services. */
    public maxFeaturesPerRequest = 3000;

    constructor(name: string, public url: string, public layerName: string, public epsg: EPSG_Type, tileSet: TileSet, retrievalLocation=RetrievalLocation.Remote) {
        super(name, tileSet, retrievalLocation);

        this.setupGeoServer();
    } 

    public setupAGOL() {
        this.urlVersion = "&version=2.0.0";
        this.urlOutput = "&outputFormat=GEOJSON";
        this.flipWinding = true;
        this.paginateRequests = true;
    }

    public setupGeoServer() {
        this.urlVersion = "";
        this.urlOutput = "&outputFormat=application%2Fjson";
        this.flipWinding = false;
        this.paginateRequests = false;
    }

    public SubmitLoadTileRequest(tile: Tile) {
        const bboxValues = this.tileSet.ourTileMath.computeBBOX_4326(tile.tileCoords);

        this.loadHelper(tile,bboxValues);
    }

    public SubmitLoadAllRequest() {
        const tile=this.tileSet.ourTiles[0]; //lets just choose the first tile so it has something
        const bboxValues = this.tileSet.ourTileMath.computeBBOX_4326_Tileset();

        this.loadHelper(tile,bboxValues);       
    }

    protected override createNextPageRequest(request: BuildingRequest, featuresReturned: number): BuildingRequest | undefined {
        const pagination = request.pagination;
        if (!pagination || !request.url) {
            return undefined;
        }

        const startIndex = pagination.startIndex + featuresReturned;
        return {
            ...request,
            tileCoords: request.tileCoords.clone(),
            inProgress: false,
            url: this.withPaginationParameters(request.url, pagination.pageSize, startIndex),
            pagination: {
                pageSize: pagination.pageSize,
                startIndex
            },
            mergeAfterLoad: false
        };
    }

    protected override isPaginationEndResponse(request: BuildingRequest, response: Response): boolean {
        return request.pagination !== undefined &&
            request.pagination.startIndex > 0 &&
            (response.status === 400 || response.status === 416);
    }

    private loadHelper(tile: Tile, bboxValues: Vector4){

        const urlFeature = (this.paginateRequests ? "&typeNames=" : "&typeName=") + this.layerName;
        const urlBox = "&bbox=" +
            bboxValues.x + "," +
            bboxValues.y + "," +
            bboxValues.z + "," +
            bboxValues.w + "," +
            "urn:ogc:def:crs:EPSG:4326";

        let requestURL = this.url + this.urlService + this.urlVersion + this.urlRequest + urlFeature + this.urlOutput + urlBox;
        let pagination: BuildingRequest["pagination"];

        if(this.retrievalLocation==RetrievalLocation.Local && this.retrievalType==RetrievalType.AllData){
            const baseUrl = window.location.href.replace(/\/[^/]*\.[^/]*$/, "").replace(/\/$/, "") + "/"; //TODO make this a util function
            requestURL = baseUrl + "map_cache/"+this.name + ".json"; //override requestURL for local file
        } else if (this.paginateRequests) {
            const pageSize = this.getPageSize();
            pagination = {
                pageSize,
                startIndex: 0
            };
            requestURL = this.withPaginationParameters(requestURL, pageSize, pagination.startIndex);
        }

        const request: BuildingRequest = {
            requestType: BuildingRequestType.LoadTile,
            tile: tile, 
            tileCoords: tile.tileCoords.clone(),
            epsgType: this.epsg,
            url: requestURL,
            inProgress: false,
            flipWinding: this.flipWinding,
            pagination
        }
        this.buildingRequests.push(request);
    }

    private getPageSize(): number {
        if (!Number.isInteger(this.maxFeaturesPerRequest) || this.maxFeaturesPerRequest <= 0) {
            throw new RangeError("maxFeaturesPerRequest must be a positive integer.");
        }

        return this.maxFeaturesPerRequest;
    }

    private withPaginationParameters(requestURL: string, pageSize: number, startIndex: number): string {
        try {
            const parsedURL = new URL(requestURL);
            parsedURL.searchParams.set("count", pageSize.toString());
            parsedURL.searchParams.set("startIndex", startIndex.toString());
            return parsedURL.toString();
        } catch {
            const separator = requestURL.includes("?")
                ? (requestURL.endsWith("?") || requestURL.endsWith("&") ? "" : "&")
                : "?";
            return requestURL + separator + "count=" + pageSize + "&startIndex=" + startIndex;
        }
    }
}
