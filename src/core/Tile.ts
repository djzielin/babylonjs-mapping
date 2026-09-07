import { Vector2 } from "@babylonjs/core/Maths/math.js";
import { Vector3 } from "@babylonjs/core/Maths/math.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type TileBuilding from "./TileBuilding.js";

import { BoundingBox } from "@babylonjs/core/Culling/boundingBox.js";

import type TileSet from "./TileSet.js";

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
    public terrainLODMeshes: Array<Mesh | null> = [];

    constructor(public mesh: Mesh, public tileSet: TileSet) {
        this.refreshBoundingBox();
    }

    /** Refresh world-space bounds after moving a tile, including frozen meshes. */
    public refreshBoundingBox(): void {
        const wasFrozen = this.mesh.isWorldMatrixFrozen;
        this.mesh.unfreezeWorldMatrix();
        this.mesh.computeWorldMatrix(true);
        const bounds = this.mesh.getBoundingInfo().boundingBox;
        this.box2D = new BoundingBox(
            new Vector3(bounds.minimumWorld.x, -1, bounds.minimumWorld.z),
            new Vector3(bounds.maximumWorld.x, 1, bounds.maximumWorld.z),
        );
        if (wasFrozen) this.mesh.freezeWorldMatrix();
    }

    public deleteBuildings(){
        for(let m of this.buildings){
            m.dispose();
        }
        this.buildings=[];

        if(this.mergedBuildingMesh!==undefined){
            this.mergedBuildingMesh.dispose();
            this.mergedBuildingMesh = undefined;
        }
    }

    public clearTerrainLOD() {
        for (const lodMesh of this.terrainLODMeshes) {
            this.mesh.removeLODLevel(lodMesh);
            lodMesh?.dispose();
        }
        this.terrainLODMeshes = [];
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

    public isBuildingInsideTileBoundingBox(m: Mesh): boolean {
        const bounds = m.getBoundingInfo().boundingBox;

        for (const v of bounds.vectorsWorld) {
            if (!this.box2D.intersectsPoint(new Vector3(v.x, 0, v.z))) {
                return false;
            }
        }

        return true;
    }
}
