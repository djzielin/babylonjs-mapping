import { ProjectionType } from "./TileMath";
import { BuildingRequest } from "./Buildings";
import { BuildingRequestType } from "./Buildings";

import Tile from "./Tile";
import TileSet from "./TileSet";
import Buildings from "./Buildings";

export default class BuildingsWFS extends Buildings {
    public urlService = "service=WFS";
    public urlOutput = "";
    //public urlVersion = "&version=1.0.0";
    public urlRequest = "&request=GetFeature";
    public flipWinding = false;

    constructor(name: string, public url: string, public layerName: string, public projection: ProjectionType, tileSet: TileSet) {
        super(name, tileSet);

        this.setupGeoServer();
    }

    public setupAGOL() {
        this.urlOutput = "&outputFormat=GEOJSON";
        this.flipWinding = true;
    }

    public setupGeoServer() {
        this.urlOutput = "&outputFormat=application%2Fjson";
        this.flipWinding = false;
    }

    public SubmitLoadTileRequest(tile: Tile) {
        const bboxValues = this.tileSet.ourTileMath.computeBBOX_4326(tile.tileCoords);

        const urlFeature = "&typeName=" + this.layerName;
        const urlBox = "&bbox=" +
            bboxValues.x + "," +
            bboxValues.y + "," +
            bboxValues.z + "," +
            bboxValues.w + "," +
            "urn:ogc:def:crs:EPSG:4326";

        const urlWithBox = this.url + this.urlService + this.urlRequest + urlFeature + this.urlOutput + urlBox;

        const request: BuildingRequest = {
            requestType: BuildingRequestType.LoadTile,
            tile: tile,
            tileCoords: tile.tileCoords.clone(),
            projectionType: this.projection,
            url: urlWithBox,
            inProgress: false,
            flipWinding: this.flipWinding
        }
        this.buildingRequests.push(request);
    }
}
