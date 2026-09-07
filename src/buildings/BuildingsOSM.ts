import { EPSG_Type } from "../core/TileMath.js";
import { BuildingRequest } from "./Buildings.js";
import { BuildingRequestType } from "./Buildings.js";
import { RetrievalLocation } from "../shared/Retrieval.js";

import type Tile from "../core/Tile.js";
import type TileSet from "../core/TileSet.js";
import Buildings from "./Buildings.js";

export default class BuildingsOSM extends Buildings {
    private serverNum = 0;
    public accessToken: string = ""; //new for 2024 osmbuildings seem to now be onegeo

    constructor(tileSet: TileSet, retrievalLocation=RetrievalLocation.Remote) {
        super("OSM", tileSet,retrievalLocation);
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
        const url = new URL(original);
        return url.pathname + url.search;
    }

    public SubmitLoadTileRequest(tile: Tile) {
        const storedCoords = tile.tileCoords.clone();
        const source=storedCoords.clone();
        if(source.z>16){const factor=2**(source.z-16);source.x=Math.floor(source.x/factor);source.y=Math.floor(source.y/factor);source.z=16;}
        source.x=((source.x%2**source.z)+2**source.z)%2**source.z;

        const url = this.osmBuildingServers[this.serverNum] + source.z + "/" + source.x + "/" + source.y + ".json"+"?token="+encodeURIComponent(this.accessToken);
        this.serverNum = (this.serverNum + 1) % this.osmBuildingServers.length; //increment server to use with wrap around

        const request: BuildingRequest = {
            requestType: BuildingRequestType.LoadTile,
            tile: tile,
            tileCoords: storedCoords,
            sourceTileCoords: source,
            epsgType: EPSG_Type.EPSG_4326,
            url: url,
            inProgress: false,
            flipWinding: true
        }
        this.enqueueBuildingRequest(request);
    }       

    public SubmitLoadAllRequest() {
        console.error("asking for all OSM data doesn't make sense, you should use the individual request type!");
    }
}
