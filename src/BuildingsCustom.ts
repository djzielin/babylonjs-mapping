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

export default class BuildingsCustom extends Buildings {
    private BuildingsPerTile: Map<string, GeoJSON.feature[]>;
    private projection: ProjectionType;

    constructor(tileSet: TileSet, scene: Scene) {
        super(tileSet, scene);
    }

    //calling function needs to await on this, to make sure we get all the GeoJSON data loaded
    public async loadGeoJSON(url: string, projection: ProjectionType){
        this.projection=projection;

        console.log("trying to fetch custom GeoJSON buildings: " + url);

        const res= await fetch(url); 
        
        if (res.status != 200) {
            console.error("unable to fetch custom buildings: " + url);
            return;

        }

        const text = await res.text();

        if (text.length == 0) {
            //console.log("no buildings in this tile!");
            return;
        }
        const tileBuildings: GeoJSON.topLevel = JSON.parse(text);

        const allBuildings: Mesh[] = [];
        for (const f of tileBuildings.features) {
            const tileCoord = this.ourGeoJSON.getFirstCoordinateTile(f, projection, this.tileSet.zoom);
            const tileCoordString = tileCoord.toString();

            let fArray = this.BuildingsPerTile.get(tileCoordString);
            if (fArray === undefined) { //first time seeing this tile, need to initialize the array
                fArray = [];
            }
            fArray.push(f);
        }
    }

    public generateBuildings() {            
        for (const t of this.tileSet.ourTiles) {
            this.populateBuildingGenerationRequestsForTile(t);
        }
    }

    public populateBuildingGenerationRequestsForTile(tile: Tile) {
        const tileCoordString = tile.tileCoords.toString();

        const fArray = this.BuildingsPerTile.get(tileCoordString);
        if (fArray) {
            for (const f of fArray) {
                const request: BuildingRequest = {
                    requestType: BuildingRequestType.CreateBuilding,
                    tile: tile,
                    tileCoords: tile.tileCoords.clone(),
                    projectionType: this.projection,
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
        }
    }
}
