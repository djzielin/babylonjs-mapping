//based on this example: https://www.babylonjs-playground.com/#866PVL#5

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
//import {decode,DecodedPng} from 'fast-png';
import { FloatArray, Material, Rotate2dBlock, VertexBuffer } from "@babylonjs/core";
import Earcut from 'earcut';
import { fetch } from 'cross-fetch'

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

export default class Tile {

    public mesh: Mesh;
    public material: StandardMaterial;
    public tileCoords: Vector3;
    
    //////////////////////////////////
    // BUILDINGS
    //////////////////////////////////
    public buildings: Mesh[]=[];

    //////////////////////////////////
    // TERRAIN 
    //////////////////////////////////
    public dem: number[];
    public demDimensions: Vector2;
    public minHeight: number;
    public maxHeight: number;
    public terrainLoaded=false;

    public eastSeamFixed=false;
    public northSeamFixed=false;
    public northEastSeamFixed=false;  
    
    public deleteBuildings(){
        for(let m of this.buildings){
            m.dispose();
        }
        this.buildings=[];
    }
}