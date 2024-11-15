import { RetrievalLocation } from "./TileSet";
export default class Raster {
    constructor(name, tileSet, retrievalLocation = RetrievalLocation.Remote) {
        this.name = name;
        this.tileSet = tileSet;
        this.retrievalLocation = retrievalLocation;
    }
    getRasterURL(tileCoords, zoom) {
        return "";
    }
    doTileSave(request) {
    }
}
//# sourceMappingURL=Raster.js.map