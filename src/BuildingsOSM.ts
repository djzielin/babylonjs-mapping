import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { fetch } from 'cross-fetch'

import { ProjectionType } from "./TileMath";
import { BuildingRequest } from "./Buildings";
import { BuildingRequestType } from "./Buildings";

import Tile from "./Tile";
import TileSet from "./TileSet";
import Buildings from "./Buildings";
import * as GeoJSON from './GeoJSON';
import { SliderLineComponent } from "@babylonjs/inspector/lines/sliderLineComponent";

export default class BuildingsOSM extends Buildings {
    private serverNum=0;
    
    constructor(tileSet: TileSet, scene: Scene) {
        super(tileSet, scene);
    }

    public generateBuildings() {
        super.generateBuildings();

        this.tileSet.ourAttribution.addAttribution("OSMB");       
    }

    private osmBuildingServers: string[] = ["https://a.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://b.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://c.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://d.data.osmbuildings.org/0.2/anonymous/tile/"];

    protected stripFilePrefix(original: string): string {
        const stripped=original.slice(51);
        //console.log("new file URL is: " + stripped);
        return stripped;
    }

    public SubmitTileRequest(tile: Tile) {
        if (tile.tileCoords.z > 16) {
            console.error("Zoom level of: " + tile.tileCoords.z + " is too large! This means that buildings won't work!");
            return;
        }

        const storedCoords = tile.tileCoords.clone();

        const url = this.osmBuildingServers[this.serverNum] + tile.tileCoords.z + "/" + tile.tileCoords.x + "/" + tile.tileCoords.y + ".json";
        this.serverNum = (this.serverNum + 1) % this.osmBuildingServers.length; //increment server to use with wrap around

        const request: BuildingRequest = {
            requestType: BuildingRequestType.LoadTile,
            tile: tile,
            tileCoords: tile.tileCoords.clone(),
            projectionType: ProjectionType.EPSG_4326,
            url: url
        }
        this.buildingRequests.push(request);
    }

    public ProcessGeoJSON(request: BuildingRequest, topLevel: GeoJSON.topLevel): void {

        if (request.tile.tileCoords.equals(request.tileCoords) == false) {
            console.warn("tile coords have changed while we were loading, not adding buildings to queue!");
            return;
        }

        let index = 0;
        let addedBuildings=0;
        const meshArray: Mesh[] = [];
        for (const f of topLevel.features) {
            const brequest: BuildingRequest = {
                requestType: BuildingRequestType.CreateBuilding,
                tile: request.tile,
                tileCoords: request.tile.tileCoords.clone(),
                projectionType: request.projectionType,
                feature: f
            }
            this.buildingRequests.push(brequest);
            addedBuildings++;
        }

        if (this.doMerge) {
            //console.log("queueing up merge request for tile: " + tile.tileCoords);
            const mrequest: BuildingRequest = {
                requestType: BuildingRequestType.MergeAllBuildingsOnTile, //request a merge
                tile: request.tile,
                tileCoords: request.tile.tileCoords.clone()
            }
            this.buildingRequests.push(mrequest)
        }
        console.log(addedBuildings + " building generation requests queued for tile: " + request.tile.tileCoords);
    }
}
