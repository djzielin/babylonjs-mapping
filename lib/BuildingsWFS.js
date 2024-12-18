import { BuildingRequestType } from "./Buildings";
import { RetrievalLocation, RetrievalType } from "./TileSet";
import Buildings from "./Buildings";
export default class BuildingsWFS extends Buildings {
    constructor(name, url, layerName, epsg, tileSet, retrievalLocation = RetrievalLocation.Remote) {
        super(name, tileSet, retrievalLocation);
        this.url = url;
        this.layerName = layerName;
        this.epsg = epsg;
        this.urlService = "service=WFS";
        this.urlOutput = "";
        //public urlVersion = "&version=1.0.0";
        this.urlRequest = "&request=GetFeature";
        this.flipWinding = false;
        this.setupGeoServer();
    }
    setupAGOL() {
        this.urlOutput = "&outputFormat=GEOJSON";
        this.flipWinding = true;
    }
    setupGeoServer() {
        this.urlOutput = "&outputFormat=application%2Fjson";
        this.flipWinding = false;
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
    loadHelper(tile, bboxValues) {
        const urlFeature = "&typeName=" + this.layerName;
        const urlBox = "&bbox=" +
            bboxValues.x + "," +
            bboxValues.y + "," +
            bboxValues.z + "," +
            bboxValues.w + "," +
            "urn:ogc:def:crs:EPSG:4326";
        let requestURL = this.url + this.urlService + this.urlRequest + urlFeature + this.urlOutput + urlBox;
        if (this.retrevialLocation == RetrievalLocation.Local && this.retrievalType == RetrievalType.AllData) {
            const baseUrl = window.location.href.replace(/\/[^/]*\.[^/]*$/, "").replace(/\/$/, "") + "/"; //TODO make this a util function
            requestURL = baseUrl + "map_cache/" + this.name + ".json"; //override requestURL for local file
        }
        const request = {
            requestType: BuildingRequestType.LoadTile,
            tile: tile,
            tileCoords: tile.tileCoords.clone(),
            epsgType: this.epsg,
            url: requestURL,
            inProgress: false,
            flipWinding: this.flipWinding
        };
        this.buildingRequests.push(request);
    }
}
//# sourceMappingURL=BuildingsWFS.js.map