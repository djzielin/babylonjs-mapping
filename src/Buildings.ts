import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Color3 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

import * as GeoJSON from './GeoJSON';
import Tile from "./Tile";
import TileSet from "./TileSet";
import { ProjectionType } from "./TileMath";
import { Observable } from "@babylonjs/core";

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

export enum BuildingRequestType{
    LoadTile,
    CreateBuilding,
    MergeAllBuildingsOnTile
}

export interface BuildingRequest {
     requestType: BuildingRequestType;
     tile: Tile;
     tileCoords: Vector3;
     feature?: GeoJSON.feature;
     projectionType?: ProjectionType;
     url?: string;
}

interface GeoFileLoaded{
    url: string;
    topLevel: GeoJSON.topLevel;
}

export default abstract class Buildings {
        
    //things the user might be interested in changing
    public exaggeration=1.0;
    public doMerge=false;
    public defaultBuildingHeight=4.0;
    public buildingsCreatedPerFrame=10;
    public buildingMaterial: StandardMaterial;
    private lastRequestCompleted=true;

    protected buildingRequests: BuildingRequest[]=[];
    protected filesLoaded: GeoFileLoaded[]=[];

    private requestsProcessedSinceCaughtUp=0;
    protected ourGeoJSON: GeoJSON.GeoJSON;

    public onCaughtUpObservable: Observable<boolean>=new Observable;

    constructor(protected tileSet: TileSet, protected scene: Scene) {
        this.buildingMaterial = new StandardMaterial("buildingMaterial", this.scene);
        this.buildingMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8);
        this.buildingMaterial.freeze();
        this.ourGeoJSON=new GeoJSON.GeoJSON(tileSet,scene);

        const observer = this.scene.onBeforeRenderObservable.add(() => { //fire every frame
           this.processBuildingRequests();
        });
    }

    public abstract SubmitTileRequest(tile: Tile): void;
    public abstract ProcessGeoJSON(request: BuildingRequest, topLevel: GeoJSON.topLevel): void;

    private isURLLoaded(url: string): boolean{
        for(let f of this.filesLoaded){
            if(f.url==url){
                return true;
            }
        }

        return false;
    }
    
    private getFeatures(url: string): GeoJSON.topLevel | null{
        for(let f of this.filesLoaded){
            if(f.url==url){
                return f.topLevel;
            }
        }

        return null;
    }
    
    public processBuildingRequests() {
        if(this.lastRequestCompleted==false){
            return;
        }

        if (this.buildingRequests.length == 0) {
            if (this.requestsProcessedSinceCaughtUp > 0) {
                console.log("caught up on all building generation requests! (processed " + this.requestsProcessedSinceCaughtUp + " requests)");
                this.requestsProcessedSinceCaughtUp = 0;
                this.onCaughtUpObservable.notifyObservers(true);  
            }
            return;
        }

        for (let i = 0; i < this.buildingsCreatedPerFrame; i++) { //process certain number of requests per frame
            //console.log("requests remaining in queue: " + this.buildingRequests.length);
            const request = this.buildingRequests.shift();
            if (request === undefined) return; //no more requests waiting!
            
            this.requestsProcessedSinceCaughtUp++;

            if (request.tile.tileCoords.equals(request.tileCoords) == false) { //make sure tile still has same coords
                console.warn("tile coords: " + request.tileCoords + " are no longer around, we must have already changed tile");
                return;
            }

            if (request.requestType == BuildingRequestType.LoadTile) {
                if (!request.url) {
                    console.error("no valid URL specified in GeoJSON load request");
                    return;
                }
                                   
                if (this.isURLLoaded(request.url)) {
                    //console.log("we already have this GeoJSON loaded!");
                    const topLevel = this.getFeatures(request.url);
                    if (topLevel) {
                        this.ProcessGeoJSON(request, topLevel);
                        return;
                    } else{
                        console.error("can't find topLevel in already loaded geojson file!");
                        return;
                    }
                } else {
                    console.log("trying to fetch: " + request.url);

                    this.lastRequestCompleted=false;
                    fetch(request.url).then((res) => {
                        if (res.status == 200) {
                            res.text().then(
                                (text) => {                                                                   
                                    //console.log("about to json parse for tile: " + tile.tileCoords);
                                    if (text.length == 0) {
                                        //console.log("no buildings in this tile!");
                                        this.lastRequestCompleted=true;
                                        return;
                                    }
                                    const topLevel: GeoJSON.topLevel = JSON.parse(text);
                                   
                                    const floaded: GeoFileLoaded = {
                                        url: request.url!,
                                        topLevel: topLevel
                                    };
                                    this.filesLoaded.push(floaded);

                                    this.ProcessGeoJSON(request, topLevel);

                                    this.lastRequestCompleted = true;
                                    return;
                                }
                            );
                        } else {
                            console.error("unable to fetch: " + request.url + " error code: " + res.status);

                            this.lastRequestCompleted = true;
                            return;
                        }
                    }).catch((error) => {
                        console.error("error during fetch! " + error);

                        this.lastRequestCompleted = true;
                        return;
                    });

                    return;
                }
            }

            if (request.requestType == BuildingRequestType.CreateBuilding) {
                if (request.feature !== undefined) {
                    if (request.projectionType!==undefined){ //create building request must have a projectionType
                        //console.log("generating single building for tile: " + request.tileCoords);
                        const building = this.ourGeoJSON.generateSingleBuilding(request.feature, request.projectionType, request.tile, this.buildingMaterial, this.exaggeration, this.defaultBuildingHeight);
                    } else{
                        console.error("can't create a building with no projection specified!");
                    }
                } else{
                    console.error("can't create a building with no feature data!");
                }

                if(this.buildingRequests.length>0){ //take a peek at next upcoming request
                    if(this.buildingRequests[0].requestType!=BuildingRequestType.CreateBuilding){ //if its not another building, end processing this frame
                        return;
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

                return;
            }
        }
    }  

    public generateBuildings() {
        console.log("user would like to generate buildings for all tiles in tileset");

        for (const t of this.tileSet.ourTiles) {
            this.SubmitTileRequest(t);
            console.log("submitting geojson load request for tile: " + t.tileCoords);
        }
    }
}

