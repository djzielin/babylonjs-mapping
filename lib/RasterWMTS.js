import Raster from "./Raster";
import { RetrievalLocation } from "./TileSet";
export default class RasterWMTS extends Raster {
    constructor(ts, retrievalLocation = RetrievalLocation.Remote_and_Save) {
        super("WMTS", ts, retrievalLocation);
        this.tileMatrixSet = "default028mm";
        this.style = "default";
        this.extension = ".png";
        this.baseURL = "";
        this.layerName = "";
    }
    setup(url, layer) {
        this.baseURL = url;
        this.layerName = layer;
    }
    //https://developers.arcgis.com/rest/services-reference/enterprise/wmts-tile-map-service-.htm
    //https://<wmts-url>/tile/<wmts-version>/<layer>/<style>/<tilematrixset>/<tilematrix>/<tilerow>/<tilecol>.<format>
    getRasterURL(tileCoords, zoom) {
        let baseURL = this.baseURL + "/tile/1.0.0/" + this.layerName + "/" + this.style + "/" + this.tileMatrixSet;
        let url = baseURL + "/" + zoom + "/" + (tileCoords.y) + "/" + (tileCoords.x) + this.extension;
        if (this.retrievalLocation == RetrievalLocation.Local) {
            const baseUrl = window.location.href.replace(/\/[^/]*\.[^/]*$/, "").replace(/\/$/, "") + "/"; //TODO make this a util function
            url = baseUrl + "map_cache/" + zoom + "_" + (tileCoords.y) + "_" + (tileCoords.x) + this.extension;
        }
        return url;
    }
    //TODO, this should really be somewhere else so it works for all Raster subclasses, but we wanted to get the this.extension variable
    doTileSave(request) {
        fetch(request.url).then((res) => {
            if (res.status == 200) {
                res.blob().then((blob) => {
                    var a = document.createElement("a");
                    a.href = window.URL.createObjectURL(blob);
                    a.download = request.tileCoords.z + "_" + request.tileCoords.y + "_" + request.tileCoords.x + this.extension;
                    a.click();
                });
            }
        });
    }
}
//# sourceMappingURL=RasterWMTS.js.map