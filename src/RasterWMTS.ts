import { Vector2 } from "@babylonjs/core/Maths/math";
import Raster from "./Raster";
import TileSet from "./TileSet";

export default class RasterWMTS extends Raster {
    public tileMatrixSet: string = "default028mm";
    public style = "default";
    public extension = ".png";
    public baseURL="";
    public layerName="";

    constructor(ts:TileSet)  {
        super("WMTS",ts);
    }

    public setup(url: string, layer: string){
        this.baseURL=url;
        this.layerName=layer;
    }

    //https://developers.arcgis.com/rest/services-reference/enterprise/wmts-tile-map-service-.htm
    //https://<wmts-url>/tile/<wmts-version>/<layer>/<style>/<tilematrixset>/<tilematrix>/<tilerow>/<tilecol>.<format>

    public override getRasterURL(tileCoords: Vector2, zoom: number): string {
        let baseURL: string = this.baseURL + "/tile/1.0.0/" + this.layerName + "/" + this.style + "/" + this.tileMatrixSet;
        let url: string = baseURL +"/" + zoom + "/" + (tileCoords.y) + "/" + (tileCoords.x) + this.extension;

        return url;
    }
}