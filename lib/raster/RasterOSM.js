import Raster from "./Raster.js";
export default class RasterOSM extends Raster {
    constructor(ts) {
        super("OSM", ts);
        this.osmServers = ["https://tile.openstreetmap.org/"];
        this.index = 0;
    }
    getRasterURL(tileCoords, zoom) {
        if (!Number.isInteger(zoom) || zoom < 0) {
            throw new RangeError("RasterOSM zoom must be a non-negative integer.");
        }
        const extension = ".png";
        const prefix = this.osmServers[this.index % this.osmServers.length];
        this.index++;
        const tileCount = 2 ** zoom;
        const tileX = ((Math.floor(tileCoords.x) % tileCount) + tileCount) % tileCount;
        const tileY = Math.max(0, Math.min(tileCount - 1, Math.floor(tileCoords.y)));
        const url = prefix + zoom + "/" + tileX + "/" + tileY + extension;
        return url;
    }
}
//# sourceMappingURL=RasterOSM.js.map