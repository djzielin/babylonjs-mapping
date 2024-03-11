import Raster from "./Raster";
class OpenStreetMap extends Raster {
    constructor(ts) {
        super("OSM", ts);
    }
    static getRasterURL(tileCoords, zoom) {
        const extension = ".png";
        const prefix = this.osmServers[this.index % 3];
        this.index++;
        const url = prefix + zoom + "/" + (tileCoords.x) + "/" + (tileCoords.y) + extension;
        return url;
    }
}
OpenStreetMap.osmServers = ["https://a.tile.openstreetmap.org/", "https://b.tile.openstreetmap.org/", "https://c.tile.openstreetmap.org/"];
OpenStreetMap.index = 0;
export default OpenStreetMap;
//# sourceMappingURL=RasterOSM.js.map