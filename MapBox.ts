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
import {decode,DecodedPng} from 'fast-png';
import { FloatArray, Rotate2dBlock, VertexBuffer } from "@babylonjs/core";
import Earcut from 'earcut';
import { fetch } from 'cross-fetch'
import Tile from './Tile';
import TileSet from "./TileSet";

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

export default class MapBox {


    private mbServers: string[] = ["https://api.mapbox.com/v4/"];
    private index = 0;
    public accessToken: string = "";
    private heightScaleFixer=0;

    constructor(private tileSet: TileSet, private scene: Scene) {

    }

    public setExaggeration(tileScale: number, exaggeration: number) {
        this.heightScaleFixer = tileScale * exaggeration;
    }

    public getRasterURL(tileCoords: Vector2, zoom: number, doResBoost: boolean): string {
        let mapType = "mapbox.satellite";

        const prefix = this.mbServers[this.index % this.mbServers.length];
        const boostParam = doResBoost ? "@2x" : "";
        let extension = ".jpg90"; //can do jpg70 to reduce quality & bandwidth
        const accessParam = "?access_token=" + this.accessToken;

        let url = prefix + mapType + "/" + zoom + "/" + (tileCoords.x) + "/" + (tileCoords.y) + boostParam + extension + accessParam;
        this.index++;

        return url;
    }

    async getTileTerrain(tile: Tile) {
        tile.dem = []; //to reclaim memory?

        const prefix = this.mbServers[this.index % this.mbServers.length];

        const mapType = "mapbox.terrain-rgb";
        const extension = ".png";
        const accessParam = "?access_token=" + this.accessToken;
        const url = prefix + mapType + "/" + (tile.tileCoords.z) + "/" + (tile.tileCoords.x) + "/" + (tile.tileCoords.y) + extension + accessParam;

        console.log("trying to fetch: " + url);
        const res = await fetch(url);
        console.log("  fetch returned: " + res.status);

        if (res.status != 200) {
            return;
        }

        const abuf = await res.arrayBuffer();
        const u = new Uint8Array(abuf);

        this.convertRGBtoDEM(u, tile);
        this.applyHeightArrayToTile(tile);
    }

    /* 

        console.log("global min height: "+ this.globalMinHeight);

        index = 0;
        //let row=0;
       // let col=1;
        for (let row = 0; row < this.subdivisions.h; row++) {
            for (let col = 0; col < this.subdivisions.w; col++) {
                const tile=this.ourTiles[col+row*this.subdivisions.w];        

                this.applyHeightArrayToTile(tile);
      
            }
        }

        for (let row = 0; row < this.subdivisions.h; row++) {
            for (let col = 0; col < this.subdivisions.w; col++) {
                const tile=this.ourTiles[col+row*this.subdivisions.w];     
                
                if(row<this.subdivisions.h-1){
                const tileAbove=this.ourTiles[col+(row+1)*this.subdivisions.w];  
                this.fixRowSeams(tile,tileAbove);     
                }

                if(col<this.subdivisions.w-1){
                const tileRight=this.ourTiles[col+1+row*this.subdivisions.w];
                this.fixColSeams(tile,tileRight);  
                }
            }
        }
        */


  
    /*private fixRowSeams(tileLower: Tile, tileUpper: Tile){
        const positions1 = tileLower.mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;
        const positions2 = tileUpper.mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;

        const subdivisions = this.precision + 1;
        for (let x = 0; x < subdivisions; x++) {

            const pos1Index=1 + x*3;
            const pos2Index=(1 + x*3)+(subdivisions-1)*subdivisions*3;
            //console.log("pos1: "+ pos1Index + " pos2: " + pos2Index);
            const height1=positions1[pos1Index];
            const height2=positions2[pos2Index];
            const avg=(height1+height2)*0.5;

            positions1[pos1Index]=avg;
            positions2[pos2Index]=avg;            

        }
        tileLower.mesh.updateVerticesData(VertexBuffer.PositionKind, positions1);
        tileUpper.mesh.updateVerticesData(VertexBuffer.PositionKind, positions2);
    } */

    /*private fixColSeams(tile: Tile, tileRight: Tile){
        const positions1 = tile.mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;
        const positions2 = tileRight.mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;

        const subdivisions = this.precision + 1;
        for (let y = 0; y < subdivisions; y++) {

            const pos1Index=(subdivisions-1)*3+1 + (y*subdivisions*3);
            const pos2Index=1 + (y*subdivisions*3);
            //console.log("pos1: "+ pos1Index + " pos2: " + pos2Index);
            const height1=positions1[pos1Index];
            const height2=positions2[pos2Index];
            const avg=(height1+height2)*0.5;

            positions1[pos1Index]=avg;
            positions2[pos2Index]=avg;            

        }
        tile.mesh.updateVerticesData(VertexBuffer.PositionKind, positions1);
        tileRight.mesh.updateVerticesData(VertexBuffer.PositionKind, positions2);
    }
*/

    //https://docs.mapbox.com/data/tilesets/guides/access-elevation-data/
    private convertRGBtoDEM(ourBuff: Uint8Array, tile: Tile) {
        var heightDEM: number[] = [];
        let maxHeight = Number.NEGATIVE_INFINITY;
        let minHeight = Number.POSITIVE_INFINITY;

        console.log(`Converting Image Buffer to Height Array`);

        const d: DecodedPng = decode(ourBuff);
        const image: Uint8Array = new Uint8Array(d.data);

        console.log("  image height: " + d.height);
        console.log("  image width: " + d.width);
        tile.demDimensions = new Vector2(d.width, d.height);

        for (let i = 0; i < image.length; i += 4) {
            //documentation: height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)

            const R = image[i + 0];
            const G = image[i + 1];
            const B = image[i + 2];
            //const A = image[i + 3]; //unused

            const height = -10000.0 + ((R * 256.0 * 256.0 + G * 256.0 + B) * 0.1);
            if (height > maxHeight) {
                maxHeight = height;
            }
            if (height < minHeight) {
                minHeight = height;
            }

            heightDEM.push(height);
        }
        console.log("  terrain ranges from : " + minHeight.toFixed(2) + " to " + maxHeight.toFixed(2));
        console.log("  height delta: " + (maxHeight - minHeight).toFixed(2));

        tile.dem = heightDEM;
        tile.minHeight = minHeight;
        tile.maxHeight = maxHeight;
    }

    private applyHeightArrayToTile(tile: Tile) {
        const positions = tile.mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;
        const subdivisions = this.tileSet.meshPrecision;
        console.log("height fixer: " + this.heightScaleFixer);
        console.log("subdivisions: " + subdivisions);

        for (let y = 0; y <= subdivisions; y++) {
            for (let x = 0; x <= subdivisions; x++) {
                console.log("---------------------------------------");
                const percent = new Vector2(x / (subdivisions), y / (subdivisions));
                const demIndex = this.computeIndexByPercent(percent, tile.demDimensions);
                console.log("dem height: " + tile.dem[demIndex]);
                const height = (tile.dem[demIndex]) * this.heightScaleFixer;
                const meshIndex = 1 + (x + y * subdivisions) * 3;
                console.log("mesh index: " + meshIndex);
                positions[meshIndex] = height;
            }
        }

        tile.mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
    }

    private computeIndexByPercent(percent: Vector2, maxPixel: Vector2): number {
        const pixelX = Math.floor(percent.x * (maxPixel.x - 1));
        const pixelY = Math.floor(percent.y * (maxPixel.y - 1));

        const total = pixelY * maxPixel.x + pixelX;
        //console.log("Percent: " + percent.x + " " + percent.y + " Pixel: "+ pixelX + " " + pixelY + " Total: " + total);

        return total;
    }
}