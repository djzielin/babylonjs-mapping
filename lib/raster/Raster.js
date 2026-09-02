import { RetrievalLocation } from "../shared/Retrieval.js";
export default class Raster {
    constructor(name, tileSet, retrievalLocation = RetrievalLocation.Remote) {
        this.name = name;
        this.tileSet = tileSet;
        this.retrievalLocation = retrievalLocation;
        /** Directory or URL prefix used for local cached raster assets. */
        this.localPathPrefix = "map_cache/";
    }
    getRasterURL(tileCoords, zoom) {
        return "";
    }
    doTileSave(request) {
    }
}
//# sourceMappingURL=Raster.js.map