import { BuildingRequestType } from "./Buildings.js";
import { RetrievalLocation, RetrievalType } from "../shared/Retrieval.js";
import Buildings from "./Buildings.js";
export default class BuildingsWFS extends Buildings {
    constructor(name, url, layerName, epsg, tileSet, retrievalLocation = RetrievalLocation.Remote) {
        super(name, tileSet, retrievalLocation);
        this.url = url;
        this.layerName = layerName;
        this.epsg = epsg;
        this.urlService = "service=WFS";
        this.urlVersion = "";
        this.urlOutput = "";
        this.urlRequest = "&request=GetFeature";
        this.flipWinding = false;
        /** Enable WFS 2.0 result paging for services such as ArcGIS Online. */
        this.paginateRequests = false;
        /** ArcGIS Online's hosted WFS feature limit; can be lowered for testing or smaller services. */
        this.maxFeaturesPerRequest = 3000;
        this.setupGeoServer();
    }
    setupAGOL() {
        this.urlVersion = "&version=2.0.0";
        this.urlOutput = "&outputFormat=GEOJSON";
        this.flipWinding = true;
        this.paginateRequests = true;
    }
    setupGeoServer() {
        this.urlVersion = "";
        this.urlOutput = "&outputFormat=application%2Fjson";
        this.flipWinding = false;
        this.paginateRequests = false;
    }
    SubmitLoadTileRequest(tile) {
        const bboxValues = this.tileSet.ourTileMath.computeBBOX_4326(tile.tileCoords);
        this.loadHelper(tile, bboxValues);
    }
    SubmitLoadAllRequest() {
        const tile = this.tileSet.ourTiles[0]; //lets just choose the first tile so it has something
        const bboxValues = this.tileSet.ourTileMath.computeBBOX_4326_Tileset();
        this.loadHelper(tile, bboxValues);
    }
    createNextPageRequest(request, featuresReturned) {
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
    isPaginationEndResponse(request, response) {
        return request.pagination !== undefined &&
            request.pagination.startIndex > 0 &&
            (response.status === 400 || response.status === 416);
    }
    loadHelper(tile, bboxValues) {
        const urlFeature = (this.paginateRequests ? "&typeNames=" : "&typeName=") + this.layerName;
        const urlBox = "&bbox=" +
            bboxValues.x + "," +
            bboxValues.y + "," +
            bboxValues.z + "," +
            bboxValues.w + "," +
            "urn:ogc:def:crs:EPSG:4326";
        let requestURL = this.url + this.urlService + this.urlVersion + this.urlRequest + urlFeature + this.urlOutput + urlBox;
        let pagination;
        if (this.retrievalLocation == RetrievalLocation.Local && this.retrievalType == RetrievalType.AllData) {
            const baseUrl = window.location.href.replace(/\/[^/]*\.[^/]*$/, "").replace(/\/$/, "") + "/"; //TODO make this a util function
            requestURL = baseUrl + "map_cache/" + this.name + ".json"; //override requestURL for local file
        }
        else if (this.paginateRequests) {
            const pageSize = this.getPageSize();
            pagination = {
                pageSize,
                startIndex: 0
            };
            requestURL = this.withPaginationParameters(requestURL, pageSize, pagination.startIndex);
        }
        const request = {
            requestType: BuildingRequestType.LoadTile,
            tile: tile,
            tileCoords: tile.tileCoords.clone(),
            epsgType: this.epsg,
            url: requestURL,
            inProgress: false,
            flipWinding: this.flipWinding,
            pagination
        };
        this.buildingRequests.push(request);
    }
    getPageSize() {
        if (!Number.isInteger(this.maxFeaturesPerRequest) || this.maxFeaturesPerRequest <= 0) {
            throw new RangeError("maxFeaturesPerRequest must be a positive integer.");
        }
        return this.maxFeaturesPerRequest;
    }
    withPaginationParameters(requestURL, pageSize, startIndex) {
        try {
            const parsedURL = new URL(requestURL);
            parsedURL.searchParams.set("count", pageSize.toString());
            parsedURL.searchParams.set("startIndex", startIndex.toString());
            return parsedURL.toString();
        }
        catch {
            const separator = requestURL.includes("?")
                ? (requestURL.endsWith("?") || requestURL.endsWith("&") ? "" : "&")
                : "?";
            return requestURL + separator + "count=" + pageSize + "&startIndex=" + startIndex;
        }
    }
}
//# sourceMappingURL=BuildingsWFS.js.map