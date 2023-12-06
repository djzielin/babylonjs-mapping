import { BuildingRequestType } from "./Buildings";
import Buildings from "./Buildings";
export default class BuildingsGeoServer extends Buildings {
    constructor(name, url, layerName, projection, tileSet) {
        super(name, tileSet);
        this.url = url;
        this.layerName = layerName;
        this.projection = projection;
    }
    SubmitLoadTileRequest(tile) {
        const bboxValues = this.tileSet.ourTileMath.computeBBOX_4326(tile.tileCoords);
        const urlService = "service=WFS";
        //const urlVersion = "&version=1.0.0";
        const urlRequest = "&request=GetFeature";
        const urlOutput = "&outputFormat=application%2Fjson";
        const urlFeature = "&typeName=" + this.layerName;
        const urlBox = "&bbox=" +
            bboxValues.x + "," +
            bboxValues.y + "," +
            bboxValues.z + "," +
            bboxValues.w + "," +
            "urn:ogc:def:crs:EPSG:4326";
        const urlWithBox = this.url + urlService + urlRequest + urlFeature + urlOutput + urlBox;
        const request = {
            requestType: BuildingRequestType.LoadTile,
            tile: tile,
            tileCoords: tile.tileCoords.clone(),
            projectionType: this.projection,
            url: urlWithBox,
            inProgress: false
        };
        this.buildingRequests.push(request);
    }
}
//# sourceMappingURL=BuildingsGeoServer.js.map