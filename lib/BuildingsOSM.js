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
        const url = this.osmBuildingServers[this.serverNum] + tile.tileCoords.z + "/" + tile.tileCoords.x + "/" + tile.tileCoords.y + ".json";
        this.serverNum = (this.serverNum + 1) % this.osmBuildingServers.length; //increment server to use with wrap around
        const request = {
            requestType: BuildingRequestType.LoadTile,
            tile: tile,
            tileCoords: tile.tileCoords.clone(),
            projectionType: ProjectionType.EPSG_4326,
            url: url,
            inProgress: false
        };
        this.buildingRequests.push(request);
    }
    ProcessGeoJSON(request, topLevel) {
        if (request.tile.tileCoords.equals(request.tileCoords) == false) {
            console.warn(this.prettyName() + "tile coords have changed while we were loading, not adding buildings to queue!");
            return;
        }
        let index = 0;
        let addedBuildings = 0;
        const meshArray = [];
        for (const f of topLevel.features) {
            const brequest = {
                requestType: BuildingRequestType.CreateBuilding,
                tile: request.tile,
                tileCoords: request.tile.tileCoords.clone(),
                inProgress: false,
                projectionType: request.projectionType,
                feature: f
            };
            this.buildingRequests.push(brequest);
            addedBuildings++;
        }
        if (this.doMerge) {
            //console.log("queueing up merge request for tile: " + tile.tileCoords);
            const mrequest = {
                requestType: BuildingRequestType.MergeAllBuildingsOnTile,
                tile: request.tile,
                tileCoords: request.tile.tileCoords.clone(),
                inProgress: false
            };
            this.buildingRequests.push(mrequest);
        }
        console.log(this.prettyName() + addedBuildings + " building generation requests queued for tile: " + request.tile.tileCoords);
    }
}
//# sourceMappingURL=BuildingsOSM.js.map