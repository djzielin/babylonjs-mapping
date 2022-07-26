import { Scene } from "@babylonjs/core/scene";
import { fetch } from 'cross-fetch'

import { ProjectionType } from "./TileMath";
import { BuildingRequest } from "./Buildings";
import { BuildingRequestType } from "./Buildings";

import Tile from "./Tile";
import TileSet from "./TileSet";
import Buildings from "./Buildings";
import * as GeoJSON from './GeoJSON';

export default class BuildingsCustom extends Buildings {
    private BuildingsOnTile: Map<string, GeoJSON.feature[]> = new Map();


    constructor(public name: string, public url: string, public projection: ProjectionType, tileSet: TileSet, scene: Scene) {
        super(tileSet, scene);
    }

    private setupMap(request: BuildingRequest, topLevel: GeoJSON.topLevel) {
        for (const f of topLevel.features) {
            if (request.projectionType!==undefined) {
                const tileCoord = this.ourGeoJSON.getFirstCoordinateTile(f, request.projectionType, this.tileSet.zoom);
                const tileCoordString = tileCoord.toString();
                console.log("this building is for tile: " + tileCoordString);

                let fArray = this.BuildingsOnTile.get(tileCoordString);
                if (fArray === undefined) { //first time seeing this tile, need to initialize the array
                    fArray = [];
                }
                fArray.push(f);
                this.BuildingsOnTile.set(tileCoordString, fArray);
            }
        }
        console.log("map is now setup with size: " + this.BuildingsOnTile.size);
    }

    public SubmitTileRequest(tile: Tile): void {
        const request: BuildingRequest = {
            requestType: BuildingRequestType.LoadTile,
            tile: tile,
            tileCoords: tile.tileCoords.clone(),
            projectionType: this.projection,
            url: this.url
        }
        this.buildingRequests.push(request);
    }
    private prettyName(): string{
        return "[" + this.name + "] ";
    }

    public ProcessGeoJSON(request: BuildingRequest, topLevel: GeoJSON.topLevel): void {
        if (request.tile.tileCoords.equals(request.tileCoords) == false) {
            console.warn(this.prettyName() + "tile coords have changed while we were loading, not adding buildings to queue!");
            return;
        }

        console.log(this.prettyName() + "trying to submit building requests for tile: " + request.tileCoords);

        let buildingsAdded=0;

        //if we want to filter each time we get called, instead of using the map (cached sorting) of features into appropriate tiles
        /*for (const f of topLevel.features) {
            const tileCoord = this.ourGeoJSON.getFirstCoordinateTile(f, this.projection, this.tileSet.zoom);

            if (tileCoord.equals(request.tileCoords)) { //check if this feature is in our requested tile
                const brequest: BuildingRequest = {
                    requestType: BuildingRequestType.CreateBuilding,
                    tile: request.tile,
                    tileCoords: request.tile.tileCoords.clone(),
                    projectionType: request.projectionType,
                    feature: f
                }
                this.buildingRequests.push(brequest);
                buildingsAdded++;
            }
        }*/

        if (this.BuildingsOnTile.size == 0) {
            console.log("map hasn't yet been setup!");
            this.setupMap(request, topLevel);
        }

        const features = this.BuildingsOnTile.get(request.tileCoords.toString());
        if (features) {
            for (const f of features) {
                const brequest: BuildingRequest = {
                    requestType: BuildingRequestType.CreateBuilding,
                    tile: request.tile,
                    tileCoords: request.tile.tileCoords.clone(),
                    projectionType: request.projectionType,
                    feature: f
                }
                this.buildingRequests.push(brequest);
                buildingsAdded++;
            }
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
        console.log(this.prettyName() + buildingsAdded + " building generation requests queued for tile: " + request.tile.tileCoords);
    }   
}
