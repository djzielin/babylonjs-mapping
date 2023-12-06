import { ProjectionType } from "./TileMath";
import { BuildingRequest } from "./Buildings";
import { BuildingRequestType } from "./Buildings";

import Tile from "./Tile";
import TileSet from "./TileSet";
import Buildings from "./Buildings";

export default class BuildingsGeoServer extends Buildings {

    constructor(name: string, public url: string, public layerName:string, public projection: ProjectionType, tileSet: TileSet) {
        super(name, tileSet);
    }

    public SubmitLoadTileRequest(tile: Tile) {
        const bboxValues=this.tileSet.ourTileMath.computeBBOX_4326(tile.tileCoords);
        const urlService = "service=WFS";
        //const urlVersion = "&version=1.0.0";
        const urlRequest = "&request=GetFeature";
        const urlOutput =  "&outputFormat=application%2Fjson";
        const urlFeature = "&typeName=" + this.layerName;
        const urlBox =     "&bbox=" + 
            bboxValues.x + "," +  
            bboxValues.y + "," + 
            bboxValues.z + "," + 
            bboxValues.w + "," +
            "urn:ogc:def:crs:EPSG:4326";

        const urlWithBox = this.url + urlService + urlRequest + urlFeature + urlOutput + urlBox;

        const request: BuildingRequest = {
            requestType: BuildingRequestType.LoadTile,
            tile: tile,
            tileCoords: tile.tileCoords.clone(),
            projectionType: this.projection,
            url: urlWithBox,
            inProgress: false
        }
        this.buildingRequests.push(request);
    }       
}
