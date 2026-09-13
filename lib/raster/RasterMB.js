import Raster from "./Raster.js";
export default class RasterMB extends Raster {
    accessToken = "";
    doResBoost = false;
    mapType = "mapbox.satellite";
    mbServer = "https://api.mapbox.com/v4/";
    skuToken;
    constructor(ts) {
        super("MB", ts);
        this.skuToken = this.tileSet.ourTileMath.generateSKU();
    }
    //https://docs.mapbox.com/api/maps/raster-tiles/
    getRasterURL(tileCoords, zoom) {
        const prefix = this.mbServer;
        const boostParam = this.doResBoost ? "@2x" : "";
        const extension = ".jpg90"; //can do jpg70 to reduce quality & bandwidth
        const query = new URLSearchParams({
            sku: this.skuToken,
            access_token: this.accessToken
        });
        return prefix + this.mapType + "/" + zoom + "/" + (tileCoords.x) + "/" + (tileCoords.y) + boostParam + extension + "?" + query.toString();
    }
}
//# sourceMappingURL=RasterMB.js.map