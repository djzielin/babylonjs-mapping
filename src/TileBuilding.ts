import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Color3 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { BoundingBox } from "@babylonjs/core/Culling/boundingBox";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import * as GeoJSON from './GeoJSON';
import Tile from "./Tile";
import TileSet from "./TileSet";
import { ProjectionType } from "./TileMath";
import { Observable } from "@babylonjs/core";
import { TreeItemComponent } from "@babylonjs/inspector/components/sceneExplorer/treeItemComponent";

export default class TileBuilding {
    public isBBoxContainedOnTile: boolean=false;

    public verticies: Vector3[]=[];

    constructor(public mesh: Mesh, public tile: Tile) {
        this.getVerticies();
        this.computeBuildingBoxInsideTile();     
    }

    public dispose(){
        this.mesh.dispose();
        this.verticies=[];
    }

    //https://forum.babylonjs.com/t/is-there-any-way-to-get-the-vertices-of-a-given-mesh-facet-or-get-neighbouring-facets/19888/4
    public getVerticies() {
        const vd = this.mesh.getVerticesData(VertexBuffer.PositionKind);
        if (vd === null) {
            return;
        }

        const worldMatrix=this.mesh.getWorldMatrix();

        for (var i = 0; i < vd.length; i += 3) {
            const x = vd[i + 0];
            const y = vd[i + 1];
            const z = vd[+ 2];

            const localVector=new Vector3(x, y, z);
            const worldVector=Vector3.TransformCoordinates(localVector,worldMatrix);

            this.verticies.push(worldVector);
        }
    }

    public computeBuildingBoxInsideTile() {
        const mBounds=this.mesh.getBoundingInfo().boundingBox;

        let bboxPointsInsideTile=0;

        for(let v of mBounds.vectorsWorld){
            const vNoY=new Vector3(v.x,0,v.z);

            if(this.tile.box2D.intersectsPoint(vNoY)){
                bboxPointsInsideTile++;
            }
        }
        if(bboxPointsInsideTile==8){
            this.isBBoxContainedOnTile=true;
        } else{
            this.isBBoxContainedOnTile=false;
        }
    }

    public doVerticesMatch( otherBuilding: TileBuilding): boolean{
        if(this.verticies.length!=otherBuilding.verticies.length){
            return false;
        }

        let accumulatedError=0.0;

        for(let i=0;i<this.verticies.length;i++){
            const v1=this.verticies[i];
            const v2=otherBuilding.verticies[i];

            const diffVector=v1.subtract(v2);
            const length=diffVector.length();
            accumulatedError+=length;
        }

        //console.log("accumulated error: " + accumulatedError);

        if(accumulatedError<0.00001){
            return true;
        }

        return false;
    }
}

