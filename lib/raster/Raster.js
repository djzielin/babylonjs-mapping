import { RetrievalLocation } from "../shared/Retrieval.js";
export default class Raster {
    name;
    tileSet;
    retrievalLocation;
    /** Directory or URL prefix used for local cached raster assets. */
    localPathPrefix = "map_cache/";
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