import { ProjectionType } from "./TileMath";
import { BuildingRequestType } from "./Buildings";
import Buildings from "./Buildings";
export default class BuildingsOSM extends Buildings {
    constructor(tileSet) {
        super("OSM", tileSet);
        this.serverNum = 0;
        this.osmBuildingServers = ["https://a.data.osmbuildings.org/0.2/anonymous/tile/",
            "https://b.data.osmbuildings.org/0.2/anonymous/tile/",
            "https://c.data.osmbuildings.org/0.2/anonymous/tile/",
            "https://d.data.osmbuildings.org/0.2/anonymous/tile/"];
    }
    generateBuildings() {
        super.generateBuildings();
        this.tileSet.ourAttribution.addAttribution("OSMB");
    }
    stripFilePrefix(original) {
        const stripped = original.slice(51);
        //console.log("new file URL is: " + stripped);
        return stripped;
    }
    SubmitLoadTileRequest(tile) {
        if (tile.tileCoords.z > 16) {
            console.error(this.prettyName() + "Zoom level of: " + tile.tileCoords.z + " is too large! This means that buildings won't work!");
            return;
        }
        const storedCoords = tile.tileCoords.clone();
        const url = this.osmBuildingServers[this.serverNum] + storedCoords.z + "/" + storedCoords.x + "/" + storedCoords.y + ".json";
        this.serverNum = (this.serverNum + 1) % this.osmBuildingServers.length; //increment server to use with wrap around
        const request = {
            requestType: BuildingRequestType.LoadTile,
            tile: tile,
            tileCoords: storedCoords,
            projectionType: ProjectionType.EPSG_4326,
            url: url,
            inProgress: false,
            flipWinding: false
        };
        this.buildingRequests.push(request);
    }
}
//# sourceMappingURL=BuildingsOSM.js.map