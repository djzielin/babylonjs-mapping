import { Vector2 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo";
import TileBuilding from "./TileBuilding";

import { BoundingBox } from "@babylonjs/core/Culling/boundingBox";

import { FloatArray, Material, Rotate2dBlock, VertexBuffer } from "@babylonjs/core";
import Earcut from 'earcut';
import { fetch } from 'cross-fetch'
import Buildings from "./Buildings";
import TileSet from "./TileSet";
import { MeshBuilder } from "@babylonjs/core";

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

export default class Tile {
    public material: StandardMaterial;
    public tileCoords: Vector3;
    public box2D: BoundingBox;
    
    //////////////////////////////////
    // BUILDINGS
    //////////////////////////////////
    public buildings: TileBuilding[]=[];
    public mergedBuildingMesh: Mesh | undefined=undefined;

    //////////////////////////////////
    // TERRAIN 
    //////////////////////////////////
    public dem: number[];
    public demDimensions: Vector2;
    public minHeight: number;
    public maxHeight: number;
    public terrainLoaded=false;

    public eastSeamFixed = false;
    public northSeamFixed = false;
    public northEastSeamFixed = false;

    constructor(public mesh: Mesh, public tileSet: TileSet) {
        mesh.computeWorldMatrix(true); //we were previously missing this, which caused a bug in the computation of the tile bounds! 

        const originalBox: BoundingBox = mesh.getBoundingInfo().boundingBox;
        const originalMin: Vector3 = originalBox.minimumWorld;
        const originalMax: Vector3 = originalBox.maximumWorld;

        const newMin = new Vector3(originalMin.x, -1, originalMin.z);
        const newMax = new Vector3(originalMax.x, 1, originalMax.z);

        this.box2D = new BoundingBox(newMin, newMax);

        //code for debugging the tile bounds
        /*const p1 = new Vector3(originalMin.x, 0, originalMin.z);
        const p2 = new Vector3(originalMax.x, 0, originalMax.z);
        const p3 = new Vector3(originalMin.x, 0, originalMax.z);
        const p4 = new Vector3(originalMax.x, 0, originalMin.z);

        this.makeSphere(p1, this.mesh.name + " p1");
        this.makeSphere(p2, this.mesh.name + " p2");
        this.makeSphere(p3, this.mesh.name + " p3");
        this.makeSphere(p4, this.mesh.name + " p4");
        */
    }

    private makeSphere(p: Vector3, name: string) { //for debugging
        const sphere = MeshBuilder.CreateSphere("sphere", { diameter: 1.0 }, this.tileSet.scene);
        sphere.position = p;
        sphere.name = name;
    }

    public deleteBuildings(){
        for(let m of this.buildings){
            m.dispose();
        }
        this.buildings=[];

        if(this.mergedBuildingMesh!==undefined){
            this.mergedBuildingMesh.dispose();
        }
    }

    public hideIndividualBuildings(){
        for(let m of this.buildings){
            m.mesh.setEnabled(false);
        }
    }

    public getAllBuildingMeshes(){
        const ourMeshes: Mesh[]=[];

        for(let b of this.buildings){
            ourMeshes.push(b.mesh);
        }

        return ourMeshes;
    }   

    public isBuildingInsideTileBoundingBox(m: Mesh): Boolean {
        const b: BoundingInfo = m.getBoundingInfo();
   
        return true;
    }
}