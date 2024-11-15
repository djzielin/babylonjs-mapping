import Raster from "./Raster";
export default class RasterMB extends Raster {
    constructor(ts) {
        super("MB", ts);
        this.accessToken = "";
        this.doResBoost = false;
        this.mapType = "mapbox.satellite";
        this.mbServer = "https://api.mapbox.com/v4/";
        this.skuToken = this.tileSet.ourTileMath.generateSKU();
    }
    //https://docs.mapbox.com/api/maps/raster-tiles/
    getRasterURL(tileCoords, zoom) {
        const prefix = this.mbServer;
        const boostParam = this.doResBoost ? "@2x" : "";
        let extension = ".jpg90"; //can do jpg70 to reduce quality & bandwidth
        const accessParam = "?access_token=" + this.accessToken;
        const skuParam = "?sku=" + this.skuToken;
        let url = prefix + this.mapType + "/" + zoom + "/" + (tileCoords.x) + "/" + (tileCoords.y) + boostParam + extension + accessParam;
        return url;
    }
}
//# sourceMappingURL=RasterMB.js.map