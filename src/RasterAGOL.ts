import { Vector2 } from "@babylonjs/core/Maths/math";
import RasterProvider from "./RasterProvider";

export default class RasterAGOL extends RasterProvider {
    public tileMatrixSet: string = "default028mm";
    public style = "default";
    public extension = ".png";

    constructor(public name: string, public baseURL: string, public layerName: string) {
        super(name);
    }


    //https://developers.arcgis.com/rest/services-reference/enterprise/wmts-tile-map-service-.htm

    //2 examples:
    //https://sampleserver6.arcgisonline.com/arcgis/rest/services/WorldTimeZones/MapServer/WMTS/tile/1.0.0/WorldTimeZones/default/default028mm/1/0/0.png
    //https://sampleserver6.arcgisonline.com/arcgis/rest/services/WorldTimeZones/MapServer/WMTS?service=WMTS&version=1.0.0&request=GetTile&layer=WorldTimeZones&style=default&tileMatrixSet=default028mm&tileMatrix=1&TileRow=0&TileCol=0&format=image/png

    public getRasterURL(tileCoords: Vector2, zoom: number): string {
        let baseURL: string = this.baseURL + "/tile/1.0.0/" + this.layerName + "/" + this.style + "/";
        let url: string = baseURL + zoom + "/" + (tileCoords.x) + "/" + (tileCoords.y) + this.extension;

        return url;
    }
}