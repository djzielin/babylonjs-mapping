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
    private BuildingsPerTile: Map<string, GeoJSON.feature[]>;

    constructor(url: string, projection: ProjectionType, tileSet: TileSet, scene: Scene) {
        super(tileSet, scene);

        console.log("trying to fetch custom buildings: " + url);

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
                        const allBuildings: Mesh[] = [];
                        for (const f of tileBuildings.features) {
                            //getFirstCoordinate(f, projection);

                            //public getTileFromLatLon(lat: number, lon: number, zoom: number) {
   
                        }
                    });
            }
            else {
                console.error("unable to fetch custom buildings: " + url);
            }
        });
    }

    public generateBuildings() {
        /*this.tileSet.ourAttribution.addAttribution("OSMB");
    
        for (const t of this.tileSet.ourTiles) {
            this.populateBuildingGenerationRequestsForTile(t);
        }*/
    }

    public populateBuildingGenerationRequestsForTile(tile: Tile) {
       
    }
}
