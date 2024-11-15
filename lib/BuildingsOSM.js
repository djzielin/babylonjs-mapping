import { EPSG_Type } from "./TileMath";
import { RetrievalLocation } from "./Buildings";
import { BuildingRequestType } from "./Buildings";
import Buildings from "./Buildings";
export default class BuildingsOSM extends Buildings {
    constructor(tileSet, retrievalLocation = RetrievalLocation.Remote) {
        super("OSM", tileSet, retrievalLocation);
        this.serverNum = 0;
        this.accessToken = ""; //new for 2024 osmbuildings seem to now be onegeo
        this.osmBuildingServers = [
            "https://a-data.onegeo.co/maps/tiles/", //new for 2024 osmbuildings seem to now be onegeo
            "https://b-data.onegeo.co/maps/tiles/",
            "https://c-data.onegeo.co/maps/tiles/",
            "https://d-data.onegeo.co/maps/tiles/"
            //"https://a.data.osmbuildings.org/0.2/anonymous/tile/",
            //"https://b.data.osmbuildings.org/0.2/anonymous/tile/",
            //"https://c.data.osmbuildings.org/0.2/anonymous/tile/",
            //"https://d.data.osmbuildings.org/0.2/anonymous/tile/"
        ];
    }
    generateBuildings() {
        super.generateBuildings();
        this.tileSet.ourAttribution.addAttribution("OSMB");
    }
    stripFilePrefix(original) {
        const prefixLength = 35; //51
        const stripped = original.slice(prefixLength);
        //console.log("new file URL is: " + stripped);
        return stripped;
    }
    SubmitLoadTileRequest(tile) {
        if (tile.tileCoords.z > 16) {
            console.error(this.prettyName() + "Zoom level of: " + tile.tileCoords.z + " is too large! This means that buildings won't work!");
            return;
        }
        const storedCoords = tile.tileCoords.clone();
        const url = this.osmBuildingServers[this.serverNum] + storedCoords.z + "/" + storedCoords.x + "/" + storedCoords.y + ".json" + "?token=" + this.accessToken;
        this.serverNum = (this.serverNum + 1) % this.osmBuildingServers.length; //increment server to use with wrap around
        const request = {
            requestType: BuildingRequestType.LoadTile,
            tile: tile,
            tileCoords: storedCoords,
            epsgType: EPSG_Type.EPSG_4326,
            url: url,
            inProgress: false,
            flipWinding: true
        };
        this.buildingRequests.push(request);
    }
    SubmitLoadAllRequest() {
        console.error("asking for all OSM data doesn't make sense, you should use the individual request type!");
    }
}
//# sourceMappingURL=BuildingsOSM.js.map