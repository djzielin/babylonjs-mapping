import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Color3 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

import * as GeoJSON from './GeoJSON';
import Tile from "./Tile";
import TileSet from "./TileSet";
import { ProjectionType } from "./TileMath";

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

export enum BuildingRequestType{
    CreateBuilding,
    MergeAllBuildingsOnTile
}

export interface BuildingRequest {
     requestType: BuildingRequestType;
     tile: Tile;
     tileCoords: Vector3;
     feature?: GeoJSON.feature;
     projectionType?: ProjectionType;
}

export default abstract class Buildings {
        
    //things the user might be interested in changing
    public exaggeration=1.0;
    public doMerge=false;
    public defaultBuildingHeight=4.0;
    public buildingsCreatedPerFrame=10;
    public buildingMaterial: StandardMaterial;

    protected buildingRequests: BuildingRequest[]=[];
    private previousRequestSize=0;   
    protected ourGeoJSON: GeoJSON.GeoJSON;

    constructor(protected tileSet: TileSet, protected scene: Scene) {
        this.buildingMaterial = new StandardMaterial("buildingMaterial", this.scene);
        this.buildingMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8);
        this.buildingMaterial.freeze();
        this.ourGeoJSON=new GeoJSON.GeoJSON(tileSet,scene);

        const observer = this.scene.onBeforeRenderObservable.add(() => { //fire every frame
           this.processBuildingRequests();
        });
    }

    public abstract populateBuildingGenerationRequestsForTile(tile: Tile): void;

    public processBuildingRequests() {
        if (this.buildingRequests.length == 0) {
            if (this.previousRequestSize > 0) {
                console.log("caught up on all building generation requests!");
                this.previousRequestSize = 0;
            }
            return;
        }

        for (let i = 0; i < this.buildingsCreatedPerFrame; i++) { //process 10 requests per frame?
            const request = this.buildingRequests.shift();
            if (request === undefined) return;

            if (request.tile.tileCoords.equals(request.tileCoords) == false) { //make sure tile still has same coords
                console.warn("tile coords: " + request.tileCoords + " are no longer around, we must have already changed tile");
                return;
            }

            if (request.requestType == BuildingRequestType.CreateBuilding) {
                if (request.feature !== undefined) {
                    //console.log("generating single building for tile: " + request.tileCoords);

                    if (request.projectionType){ //create building request must have a projectionType
                        const building = this.ourGeoJSON.generateSingleBuilding(request.feature, request.projectionType, request.tile, this.buildingMaterial, this.exaggeration, this.defaultBuildingHeight);
                    }
                }
            }

            if (request.requestType == BuildingRequestType.MergeAllBuildingsOnTile) {
                console.log("processing merge request for tile: " + request.tileCoords);
                //console.log("  number of buildings in merge: " + request.tile.buildings.length);
                
                if (request.tile.buildings.length > 1) {
                    for(let m of request.tile.buildings){
                        if(m.isReady()==false){
                            console.error("Mesh not reading!");
                        }
                    }
                    //console.log("about to do big merge");
                    const merged = Mesh.MergeMeshes(request.tile.buildings);
                    if (merged) {
                        merged.setParent(request.tile.mesh);
                        merged.name = "all_buildings_merged";
                        request.tile.buildings = [];
                        request.tile.buildings.push(merged);
                    } else {
                        console.error("unable to merge meshes!");
                    }
                } else {
                    console.log("not enough meshes to merge: " + request.tile.buildings.length);
                }
            }
        }
        this.previousRequestSize = this.buildingRequests.length;
    }  
}

