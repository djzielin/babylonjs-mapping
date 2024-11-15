import Raster from "./Raster";
export default class RasterOSM extends Raster {
    constructor(ts) {
        super("OSM", ts);
        this.osmServers = ["https://a.tile.openstreetmap.org/", "https://b.tile.openstreetmap.org/", "https://c.tile.openstreetmap.org/"];
        this.index = 0;
    }
    getRasterURL(tileCoords, zoom) {
        const extension = ".png";
        const prefix = this.osmServers[this.index % 3];
        this.index++;
        const url = prefix + zoom + "/" + (tileCoords.x) + "/" + (tileCoords.y) + extension;
        return url;
    }
}
//# sourceMappingURL=RasterOSM.js.map