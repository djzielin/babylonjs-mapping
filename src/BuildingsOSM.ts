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

export default class BuildingsOSM extends Buildings {
    constructor(tileSet: TileSet, scene: Scene) {
        super(tileSet, scene);
    }

    public generateBuildings() {
        this.tileSet.ourAttribution.addAttribution("OSMB");

        for (const t of this.tileSet.ourTiles) {
            this.populateBuildingGenerationRequestsForTile(t);
        }
    }

    private osmBuildingServers: string[] = ["https://a.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://b.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://c.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://d.data.osmbuildings.org/0.2/anonymous/tile/"];

    public populateBuildingGenerationRequestsForTile(tile: Tile) {
        if (tile.tileCoords.z > 16) {
            console.error("Zoom level of: " + tile.tileCoords.z + " is too large! This means that buildings won't work!");
            return;
        }

        const storedCoords = tile.tileCoords.clone();

        const url = this.osmBuildingServers[0] + tile.tileCoords.z + "/" + tile.tileCoords.x + "/" + tile.tileCoords.y + ".json";

        console.log("trying to fetch: " + url);

        fetch(url).then((res) => {
            //console.log("  fetch returned: " + res.status);

            if (res.status == 200) {
                res.text().then(
                    (text) => {
                        //console.log("about to json parse for tile: " + tile.tileCoords);
                        if (text.length == 0) {
                            //console.log("no buildings in this tile!");
                            return;
                        }
                        const tileBuildings: GeoJSON.topLevel = JSON.parse(text);
                        //console.log("number of buildings in this tile: " + tileBuildings.features.length);

                        if (tile.tileCoords.equals(storedCoords) == false) {
                            console.warn("tile coords have changed while we were loading, not adding buildings to queue!");
                            return;
                        }

                        let index = 0;
                        const meshArray: Mesh[] = [];
                        for (const f of tileBuildings.features) {
                            const request: BuildingRequest = {
                                requestType: BuildingRequestType.CreateBuilding,
                                tile: tile,
                                tileCoords: tile.tileCoords.clone(),
                                projectionType: ProjectionType.EPSG_4326,
                                feature: f
                            }
                            this.buildingRequests.push(request);
                        }

                        if (this.doMerge) {
                            //console.log("queueing up merge request for tile: " + tile.tileCoords);
                            const request: BuildingRequest = {
                                requestType: BuildingRequestType.MergeAllBuildingsOnTile, //request a merge
                                tile: tile,
                                tileCoords: tile.tileCoords.clone()
                            }
                            this.buildingRequests.push(request)
                        }
                        console.log("all building generation requests queued for tile: " + tile.tileCoords);
                    });
            }
            else {
                console.error("unable to fetch: " + url);
            }
        });
    }
}

