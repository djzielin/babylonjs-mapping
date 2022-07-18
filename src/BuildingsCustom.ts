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
    private BuildingsPerTile: Map<string, GeoJSON.feature[]> = new Map();
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
        const allBuildings: GeoJSON.topLevel = JSON.parse(text);

        console.log("buildings found: " + allBuildings.features.length);

        for (const f of allBuildings.features) {
            const tileCoord = this.ourGeoJSON.getFirstCoordinateTile(f, projection, this.tileSet.zoom);
            const tileCoordString = tileCoord.toString();
            //console.log("this building is for tile: " + tileCoordString);

            let fArray = this.BuildingsPerTile.get(tileCoordString);
            if (fArray === undefined) { //first time seeing this tile, need to initialize the array
                fArray = [];
            }
            fArray.push(f);
            this.BuildingsPerTile.set(tileCoordString,fArray);
        }
        
        console.log("map size: " + this.BuildingsPerTile.size);
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
            console.log("building generation requests queued for tile: " + tile.tileCoords);
            console.log("total creation requests are now: " + this.buildingRequests.length);

        }
    }
}
