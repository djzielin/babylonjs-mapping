import Raster from "./Raster";
export default class RasterAGOL extends Raster {
    constructor(ts) {
        super("WMTS", ts);
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
        return url;
    }
}
//# sourceMappingURL=RasterWMTS.js.map