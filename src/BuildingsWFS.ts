import { EPSG_Type } from "./TileMath";
import { BuildingRequest, RetrievalType } from "./Buildings";
import { BuildingRequestType } from "./Buildings";
import { Vector4 } from "@babylonjs/core";

import Tile from "./Tile";
import TileSet from "./TileSet";
import Buildings from "./Buildings";

export default class BuildingsWFS extends Buildings {
    public urlService = "service=WFS";
    public urlOutput = "";
    //public urlVersion = "&version=1.0.0";
    public urlRequest = "&request=GetFeature";
    public flipWinding = false;

    constructor(name: string, public url: string, public layerName: string, public epsg: EPSG_Type, tileSet: TileSet) {
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

        this.loadHelper(tile,bboxValues);
    }

    public SubmitLoadAllRequest() {
        const tile=this.tileSet.ourTiles[0]; //lets just choose the first tile so it has something
        const bboxValues = this.tileSet.ourTileMath.computeBBOX_4326_Tileset();

        this.loadHelper(tile,bboxValues);       
    }

    private loadHelper(tile: Tile, bboxValues: Vector4){

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
            epsgType: this.epsg,
            url: urlWithBox,
            inProgress: false,
            flipWinding: this.flipWinding
        }
        this.buildingRequests.push(request);
    }
}
