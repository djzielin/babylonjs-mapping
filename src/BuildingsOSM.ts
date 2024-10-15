import { ProjectionType } from "./TileMath";
import { BuildingRequest } from "./Buildings";
import { BuildingRequestType } from "./Buildings";

import Tile from "./Tile";
import TileSet from "./TileSet";
import Buildings from "./Buildings";

export default class BuildingsOSM extends Buildings {
    private serverNum = 0;
    public accessToken: string = ""; //new for 2024 osmbuildings seem to now be onegeo

    constructor(tileSet: TileSet) {
        super("OSM", tileSet);
    }

    public override generateBuildings() {
        super.generateBuildings();

        this.tileSet.ourAttribution.addAttribution("OSMB");
    }

    private osmBuildingServers: string[] = [
        "https://a-data.onegeo.co/maps/tiles/", //new for 2024 osmbuildings seem to now be onegeo
        "https://b-data.onegeo.co/maps/tiles/",
        "https://c-data.onegeo.co/maps/tiles/",
        "https://d-data.onegeo.co/maps/tiles/"
        
        //"https://a.data.osmbuildings.org/0.2/anonymous/tile/",
        //"https://b.data.osmbuildings.org/0.2/anonymous/tile/",
        //"https://c.data.osmbuildings.org/0.2/anonymous/tile/",
        //"https://d.data.osmbuildings.org/0.2/anonymous/tile/"
    ];

    protected override stripFilePrefix(original: string): string {
        const prefixLength=35; //51
        const stripped = original.slice(prefixLength);
        //console.log("new file URL is: " + stripped);
        return stripped;
    }

    public SubmitLoadTileRequest(tile: Tile) {
        if (tile.tileCoords.z > 16) {
            console.error(this.prettyName() + "Zoom level of: " + tile.tileCoords.z + " is too large! This means that buildings won't work!");
            return;
        }

        const storedCoords = tile.tileCoords.clone();

        const url = this.osmBuildingServers[this.serverNum] + storedCoords.z + "/" + storedCoords.x + "/" + storedCoords.y + ".json"+"?token="+this.accessToken;
        this.serverNum = (this.serverNum + 1) % this.osmBuildingServers.length; //increment server to use with wrap around

        const request: BuildingRequest = {
            requestType: BuildingRequestType.LoadTile,
            tile: tile,
            tileCoords: storedCoords,
            projectionType: ProjectionType.EPSG_4326,
            url: url,
            inProgress: false,
            flipWinding: true
        }
        this.buildingRequests.push(request);
    }       
}

