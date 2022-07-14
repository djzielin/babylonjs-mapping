import { Scene } from "@babylonjs/core/scene";
import { Vector2 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Color3 } from "@babylonjs/core/Maths/math";
import { Color4 } from "@babylonjs/core/Maths/math";

import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import * as GeoJSON from './GeoJSON';

import { fetch } from 'cross-fetch'
import { Observable } from "@babylonjs/core";

import { ProjectionType } from "./TileSet";
import Tile from "./Tile";
import TileSet from "./TileSet";

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";


interface GenerateBuildingRequest {
     requestType: number;  //TODO: replace this with enum
     tile: Tile;
     tileCoords: Vector3;
     features?: GeoJSON.features;
}

export default class OpenStreetMapBuildings {
    private buildingRequests: GenerateBuildingRequest[]=[];
    private previousRequestSize=0;

    public onCustomLoaded: Observable<boolean> = new Observable();

    //https://osmbuildings.org/documentation/data/
    //GET http(s)://({abcd}.)data.osmbuildings.org/0.2/anonymous/tile/15/{x}/{y}.json

    private osmBuildingServers: string[] = ["https://a.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://b.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://c.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://d.data.osmbuildings.org/0.2/anonymous/tile/"];

    //private heightScaleFixer = 1.0;
    public exaggeration=1.0;
    private buildingMaterial: StandardMaterial;
    private defaultBuildingHeight=4.0;

    constructor(private tileSet: TileSet, private scene: Scene) {
        this.buildingMaterial = new StandardMaterial("buildingMaterial", this.scene);
        this.buildingMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8);
        this.buildingMaterial.freeze();
        //this.setupBuildingGenerator();

    }

    public setDefaultBuildingHeight(height: number){
        this.defaultBuildingHeight=height;
    }

    public setExaggeration(exaggeration: number) {
        this.exaggeration=exaggeration;
    } 

    //for pulling in buildings from our geoserver
    //TODO: might want to use building request system so we don't do it all in one frame?
    public populateFromCustomServer(url: string, projection: ProjectionType, doMerge = true) {
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
                        const allBuildings: Mesh[]=[];
                        for (const f of tileBuildings.features) {
                            //const building = this.generateSingleBuilding(f, projection, null);
                            //allBuildings.push(building);                         
                        }
                        if(doMerge){
                            const merged = Mesh.MergeMeshes(allBuildings);
                            if (merged) {
                                merged.name = "merged_buildings";                               
                            } else {
                                console.error("unable to merge all building meshes!");
                            }
                        }

                        this.onCustomLoaded.notifyObservers(true);  
                    });
            }
            else {
                console.error("unable to fetch: " + url);
            }
        });
    }

    public populateBuildingGenerationRequestsForTile(tile: Tile, doMerge=true) {
        if (tile.tileCoords.z > 16) {
            console.error("Zoom level of: " + tile.tileCoords.z + " is too large! This means that buildings won't work!");
            return;
        }

        const storedCoords=tile.tileCoords.clone();

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

                        if(tile.tileCoords.equals(storedCoords)==false){
                            console.warn("tile coords have changed while we were loading, not adding buildings to queue!");
                            return;
                        }

                        let index = 0;
                        const meshArray: Mesh[] = [];
                        for (const f of tileBuildings.features) {
                            const request: GenerateBuildingRequest ={ 
                                requestType:0,
                                tile: tile,
                                tileCoords: tile.tileCoords.clone(),
                                features: f
                            }
                            this.buildingRequests.push(request);
                        }

                        if (doMerge) {
                            //console.log("queueing up merge request for tile: " + tile.tileCoords);
                            const request: GenerateBuildingRequest = {
                                requestType: 1, //request a merge
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

    public processBuildingRequests() {
        //const observer = this.scene.onBeforeRenderObservable.add(() => {
        //if (this.buildingRequests == null) {
        //return;
        //}

        if (this.buildingRequests.length == 0) {
            if (this.previousRequestSize > 0) {
                console.log("caught up on all building generation requests!");
                this.previousRequestSize = 0;
            }
            return;
        }

        for (let i = 0; i < 10; i++) { //process 10 requests per frame?
            const request = this.buildingRequests.shift();
            if (request === undefined) return;

            if (request.tile.tileCoords.equals(request.tileCoords) == false) { //make sure tile still has same coords
                console.warn("tile coords: " + request.tileCoords + " are no longer around, we must have already changed tile");
                return;
            }

            if (request.requestType == 0) { //generate single building
                if (request.features !== undefined) {
                    //console.log("generating single building for tile: " + request.tileCoords);
                    //const building = this.generateSingleBuilding(request.features,ProjectionType.EPSG_4326,request.tile);
                }
            }

            if (request.requestType == 1) { //merge all buildings on this tile
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

