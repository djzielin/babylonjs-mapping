import { Vector2 } from "@babylonjs/core/Maths/math";
import Raster from "./Raster";
import TileSet from "./TileSet";
import { RetrievalLocation } from "./TileSet";
import { TileRequest } from "./TileSet";

export default class RasterWMTS extends Raster {
    public tileMatrixSet: string = "default028mm";
    public style = "default";
    public extension = ".png";
    public baseURL = "";
    public layerName = "";

    constructor(ts: TileSet, retrievalLocation = RetrievalLocation.Remote_and_Save) {
        super("WMTS", ts, retrievalLocation);
    }

    public setup(url: string, layer: string) {
        this.baseURL = url;
        this.layerName = layer;
    }

    //https://developers.arcgis.com/rest/services-reference/enterprise/wmts-tile-map-service-.htm
    //https://<wmts-url>/tile/<wmts-version>/<layer>/<style>/<tilematrixset>/<tilematrix>/<tilerow>/<tilecol>.<format>

    public override getRasterURL(tileCoords: Vector2, zoom: number): string {
        let baseURL: string = this.baseURL + "/tile/1.0.0/" + this.layerName + "/" + this.style + "/" + this.tileMatrixSet;
        let url: string = baseURL + "/" + zoom + "/" + (tileCoords.y) + "/" + (tileCoords.x) + this.extension;

        if (this.retrievalLocation == RetrievalLocation.Local) {
            const baseUrl = window.location.href.replace(/\/[^/]*\.[^/]*$/, "").replace(/\/$/, "") + "/"; //TODO make this a util function
            url = baseUrl + "map_cache/" + zoom + "_" + (tileCoords.y) + "_" + (tileCoords.x) + this.extension;
        }

        return url;
    }

    //TODO, this should really be somewhere else so it works for all Raster subclasses, but we wanted to get the this.extension variable
    public override doTileSave(request: TileRequest) {
        fetch(request.url).then((res) => {
            if (res.status == 200) {
                res.blob().then((blob) => {
                    var a = document.createElement("a");
                    a.href = window.URL.createObjectURL(blob);
                    a.download = request.tileCoords.z + "_" + request.tileCoords.y+"_" + request.tileCoords.x + this.extension;
                    a.click();
                });
            }
        });
    }
}