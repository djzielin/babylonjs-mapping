import { Scene } from "@babylonjs/core/scene";
import { Vector2 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Color3 } from "@babylonjs/core/Maths/math";
import { Color4 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder"
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

import Earcut from 'earcut';
import { fetch } from 'cross-fetch'

import Tile from "./Tile";
import TileSet from "./TileSet";

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

interface coordinatePair extends Array<number> { }
interface coordinateSet extends Array<coordinatePair> { }

interface geometryJSON {
    "type": string;
    "coordinates": coordinateSet[];
}

interface featurePropertiesJSON {
    "name": string;
    "type": string;
    "height": number;
    "levels": number;
}

interface featuresJSON {
    "id": string;
    "type": string;
    "properties": featurePropertiesJSON;
    "geometry": geometryJSON;
}

interface BuildingsJSON {
    "type": string;
    "features": featuresJSON[];
}

interface GenerateBuildingRequest {
     requestType:number;  //TODO: replace this with enum
     tile: Tile;
     tileCoords: Vector3;
     features?: featuresJSON;
}

export default class OpenStreetMap {
    private buildingRequests: GenerateBuildingRequest[]=[];
    private previousRequestSize=0;

    //https://osmbuildings.org/documentation/data/
    //GET http(s)://({abcd}.)data.osmbuildings.org/0.2/anonymous/tile/15/{x}/{y}.json

    private osmBuildingServers: string[] = ["https://a.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://b.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://c.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://d.data.osmbuildings.org/0.2/anonymous/tile/"];

    private heightScaleFixer = 1.0;
    private buildingMaterial: StandardMaterial;

    constructor(private tileSet: TileSet, private scene: Scene) {
        this.buildingMaterial = new StandardMaterial("buildingMaterial", this.scene);
        this.buildingMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8);
        this.buildingMaterial.freeze();
        //this.setupBuildingGenerator();

    }

    public setExaggeration(tileScale: number, exaggeration: number) {
        this.heightScaleFixer = tileScale * exaggeration;
    }

    public processBuildingRequests() {
        //const observer = this.scene.onBeforeRenderObservable.add(() => {
            //if (this.buildingRequests == null) {
            //return;
            //}

            if(this.buildingRequests.length==0 && this.previousRequestSize>0){
                this.previousRequestSize=0;
                console.log("caught up on all building generation requests!");
                return;
            }    
            
            if (this.buildingRequests.length == 0) { //nothing to do this frame
                //console.log("nothing to do this frame");
                return;
            }

            for (let i = 0; i < 20; i++) { //process 10 requests per frame?
                const request = this.buildingRequests.shift();
                if (request === undefined) return;

                if (request.tile.tileCoords.equals(request.tileCoords) == false) { //make sure tile still has same coords
                    console.log("tile coords: " + request.tileCoords + " are no longer around, we must have already changed tile");
                    return;
                }

                if (request.requestType == 0) { //generate single building
                    if (request.features !== undefined) {
                        console.log("generating single building for tile: " + request.tileCoords);
                        const building=this.generateSingleBuilding(request.features, request.tile);
                        request.tile.buildings.push(building);
                        console.log("tile building list is now: " + request.tile.buildings.length);
                    }
                }

                if (request.requestType == 1) { //merge all buildings on this tile
                    console.log("processing merge request for tile: " + request.tileCoords);
      
                    if (request.tile.buildings.length > 1) {
                        const merged = Mesh.MergeMeshes(request.tile.buildings,true);                  
                        if (merged) {
                            merged.setParent(request.tile.mesh);
                            merged.name="all_buildings_merged";

                            for(let m of request.tile.buildings){
                                m.dispose(); //WHY DOESN'T THIS WORK!!!!
                            }

                            request.tile.buildings=[];
                            request.tile.buildings.push(merged);
                        } else{
                            console.error("unable to merge meshes!");
                        }
                    } else {
                        console.log("not enough meshes to merge: " + request.tile.buildings.length);
                    }
                }
            }
            this.previousRequestSize = this.buildingRequests.length;
    
    }

    /*public generateBuildingsForTile(tile: Tile, doMerge: boolean) {
        if (tile.tileCoords.z > 16) {
            console.error("Zoom level of: " + tile.tileCoords.z + " is too large! This means that buildings won't work!");
            return;
        }

        const url = this.osmBuildingServers[0] + tile.tileCoords.z + "/" + tile.tileCoords.x + "/" + tile.tileCoords.y + ".json";

        console.log("trying to fetch: " + url);

        fetch(url).then((res) => {
            //console.log("  fetch returned: " + res.status);

            if (res.status == 200) {
                res.text().then(
                    (text) => {
                        console.log("about to json parse for tile: " + tile.tileCoords);
                        if (text.length == 0) {
                            console.log("no buildings in this tile!");
                            return;
                        }
                        const tileBuildings: BuildingsJSON = JSON.parse(text);
                        console.log("number of buildings in this tile: " + tileBuildings.features.length);

                        let index = 0;
                        const meshArray: Mesh[] = [];
                        for (const f of tileBuildings.features) {
                            const ourMesh = this.generateSingleBuilding(f, tile);

                            if (doMerge) {
                                if (ourMesh) {
                                    meshArray.push(ourMesh);
                                }
                            } else {
                                ourMesh?.setParent(tile.mesh);
                            }
                        }
                        if (doMerge) {
                            const merged = Mesh.MergeMeshes(meshArray);
                            if (merged) {
                                merged.setParent(tile.mesh);
                            }
                        }
                    });
            }
            else {
                console.error("unable to fetch: " + url);
            }
        });
    }*/

    public populateBuildingGenerationRequestsForTile(tile: Tile, doMerge: boolean) {
        if (tile.tileCoords.z > 16) {
            console.error("Zoom level of: " + tile.tileCoords.z + " is too large! This means that buildings won't work!");
            return;
        }

        const url = this.osmBuildingServers[0] + tile.tileCoords.z + "/" + tile.tileCoords.x + "/" + tile.tileCoords.y + ".json";

        console.log("trying to fetch: " + url);

        fetch(url).then((res) => {
            //console.log("  fetch returned: " + res.status);

            if (res.status == 200) {
                res.text().then(
                    (text) => {
                        console.log("about to json parse for tile: " + tile.tileCoords);
                        if (text.length == 0) {
                            console.log("no buildings in this tile!");
                            return;
                        }
                        const tileBuildings: BuildingsJSON = JSON.parse(text);
                        console.log("number of buildings in this tile: " + tileBuildings.features.length);

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

                            const ourMesh = this.generateSingleBuilding(f, tile);
                        }

                        if (doMerge) {
                            console.log("queueing up merge request for tile: " + tile.tileCoords);
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


    private generateSingleBuilding(f: featuresJSON, tile: Tile): Mesh {
        const meshArray: Mesh[] = [];

        if (f.geometry.type == "Polygon") {
            for (let i = 0; i < f.geometry.coordinates.length; i++) {
                //var customMesh = new Mesh("custom", this.scene);

                const numPoints = f.geometry.coordinates[i].length;

                const positions: number[] = [];
                const positions3D: Vector3[] = [];

                //skip final coord (as it seems to duplicate the first)
                //also need to do this backwards to get normals / winding correct
                for (let e = f.geometry.coordinates[i].length - 2; e >= 0; e--) {

                    const v2 = new Vector2(f.geometry.coordinates[i][e][0], f.geometry.coordinates[i][e][1]);
                    //const v2World = this.tileSet.GetPositionOnTile(v2, new Vector2(tile.tileNum.x, tile.tileNum.y));
                    const v2World = this.tileSet.GetWorldPosition(v2);
                    //console.log("  v2world: " + v2World);

                    positions.push(v2World.x);
                    positions.push(v2World.y);

                    positions3D.push(new Vector3(v2World.x, 0.0, v2World.y));
                }
                (window as any).earcut = Earcut;
                let name = "Building";
                if (f.properties.name !== undefined) {
                    name = f.properties.name;
                }

                var ourMesh = MeshBuilder.ExtrudePolygon(name,
                    {
                        shape: positions3D,
                        depth: f.properties.height * this.heightScaleFixer
                    },
                    this.scene);

                ourMesh.position.y = f.properties.height * this.heightScaleFixer;
                ourMesh.bakeCurrentTransformIntoVertices(); //optimizations
                ourMesh.material = this.buildingMaterial; //all buildings will use same material
                ourMesh.isPickable = false;
                
                meshArray.push(ourMesh);
            }
        }
        else {
            //TODO: support other geometry types?
            console.error("unknown building geometry type: " + f.geometry.type);
        }

        if (meshArray.length > 1) {
            const merge = Mesh.MergeMeshes(meshArray,true);
            if (merge) {
                merge.setParent(tile.mesh);
                return merge;
            } else{
                console.error("failed to merge mesh on tile: " + tile.tileCoords);
            }
        } else if (meshArray.length == 1) {
            meshArray[0].setParent(tile.mesh);
            return meshArray[0];
        }

        const finalMesh = new Mesh("empty mesh", this.scene);
        finalMesh.setParent(tile.mesh);
        
        return finalMesh;

    }
}