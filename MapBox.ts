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

import { FloatArray, Rotate2dBlock, VertexBuffer } from "@babylonjs/core";
import Earcut from 'earcut';
import { fetch } from 'cross-fetch'
import Tile from './Tile';
import TileSet from "./TileSet";

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

export default class MapBox {
    private mbServer: string = "https://api.mapbox.com/v4/";

    private index = 0;
    public accessToken: string = "";
    private heightScaleFixer=0;
    private skuToken: string;

    constructor(private tileSet: TileSet, private scene: Scene) {
        //sku code generation from:
        //https://github.com/mapbox/mapbox-gl-js/blob/992514ac5471c1231d8a1951bc6752a65aa9e3e6/src/util/sku_token.js

        const SKU_ID = '01';
        const TOKEN_VERSION = '1';
        const base62chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        // sessionRandomizer is a randomized 10-digit base-62 number
        let sessionRandomizer = '';
        for (let i = 0; i < 10; i++) {
            sessionRandomizer += base62chars[Math.floor(Math.random() * 62)];
        }
        
        this.skuToken = [TOKEN_VERSION, SKU_ID, sessionRandomizer].join('');       
    }  

    //https://docs.mapbox.com/api/maps/raster-tiles/
    public getRasterURL(tileCoords: Vector2, zoom: number, doResBoost: boolean): string {
        let mapType = "mapbox.satellite";

        const prefix = this.mbServer;
        const boostParam = doResBoost ? "@2x" : "";
        let extension = ".jpg90"; //can do jpg70 to reduce quality & bandwidth
        const accessParam = "?access_token=" + this.accessToken;

        let url = prefix + mapType + "/" + zoom + "/" + (tileCoords.x) + "/" + (tileCoords.y) + boostParam + extension + accessParam;
        this.index++;

        return url;
    }

    ///////////////////////////////////////////////////////////////////////////
    // TERRAIN
    ///////////////////////////////////////////////////////////////////////////

    public setExaggeration(tileScale: number, exaggeration: number) {
        this.heightScaleFixer = tileScale * exaggeration;
    }

    //based on code from
    //https://www.babylonjs-playground.com/#DXARSP#30
    private GetAsyncTexture (url: string) : Promise<Texture> {
        return new Promise((resolve, reject) => {
            var texture = new Texture(url, this.scene, true, false, Texture.NEAREST_SAMPLINGMODE, function() {
                resolve(texture);
            }, function(message) {
                reject(message);
            });    
        })
    }

    //https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-dem-v1/
    async getTileTerrain(tile: Tile, doResBoost: boolean) {
        if(tile.tileCoords.z>15 && doResBoost==false){            
            console.log("DEM not supported beyond level 15 (if not doing res boost)");
            return;
        }
        if(tile.tileCoords.z>14 && doResBoost==true){            
            console.log("DEM not supported beyond 14 (is doing res boost)");
            return;
        }

        tile.dem = []; //to reclaim memory?

        const prefix = this.mbServer;
        const boostParam = doResBoost ? "@2x" : "";

        //const mapType = "mapbox.terrain-rgb";
        const mapType = "mapbox.mapbox-terrain-dem-v1";

        const extension = ".pngraw";
        const skuParam = "?sku=" + this.skuToken;
        const accessParam = "&access_token=" + this.accessToken;
        const url = prefix + mapType + "/" + (tile.tileCoords.z) + "/" + (tile.tileCoords.x) + "/" + (tile.tileCoords.y) + boostParam + extension + skuParam + accessParam;

        console.log("trying to fetch: " + url);
        /*const res = await fetch(url);
        console.log("  fetch returned: " + res.status);

        if (res.status != 200) {
            return;
        }

        const abuf = await res.arrayBuffer();
        const u = new Uint8Array(abuf);
        */

        //const ourTex: Texture=new Texture(url,this.scene);
        const ourTex: Texture=await this.GetAsyncTexture(url); //wait for loading to be complete
        tile.demDimensions=new Vector2(ourTex.getSize().width,ourTex.getSize().height);       
        const ourBuff: Uint8Array = new Uint8Array(ourTex.readPixels().buffer);
  
        this.convertRGBtoDEM(ourBuff, tile);
    }      

    //https://docs.mapbox.com/data/tilesets/guides/access-elevation-data/
    private convertRGBtoDEM(ourBuff: Uint8Array, tile: Tile) {
        var heightDEM: number[] = [];
        let maxHeight = Number.NEGATIVE_INFINITY;
        let minHeight = Number.POSITIVE_INFINITY;

        console.log(`Converting Image Buffer to Height Array`);

        //const d: DecodedPng = decode(ourBuff);    
        //const image: Uint8Array = new Uint8Array(d.data);

        console.log("  image height: " + tile.demDimensions.y);
        console.log("  image width: " + tile.demDimensions.x);

        for (let i = 0; i < ourBuff.length; i += 4) {
            //documentation: height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)

            const R = ourBuff[i + 0];
            const G = ourBuff[i + 1];
            const B = ourBuff[i + 2];
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

    public applyHeightArrayToMesh(mesh: Mesh, tile: Tile, meshPrecision: number, heightAdjustment: number) {
        const positions = mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;
        const subdivisions = meshPrecision + 1;
        // console.log("height fixer: " + this.heightScaleFixer);
        //console.log("subdivisions: " + subdivisions);

        for (let y = 0; y < subdivisions; y++) {
            for (let x = 0; x < subdivisions; x++) {
                //console.log("---------------------------------------");
                const percent = new Vector2(x / (subdivisions - 1), y / (subdivisions - 1));
                const demIndex = this.computeIndexByPercent(percent, tile.demDimensions);
                //console.log("dem height: " + tile.dem[demIndex]);
                const height = (tile.dem[demIndex] + heightAdjustment) * this.heightScaleFixer;
                const meshIndex = 1 + (x + y * subdivisions) * 3;
                //console.log("mesh index: " + meshIndex);
                positions[meshIndex] = height;
            }
        }

        mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
    }

    private computeIndexByPercent(percent: Vector2, maxPixel: Vector2): number {
        const pixelX = Math.floor(percent.x * (maxPixel.x - 1));
        const pixelY = Math.floor(percent.y * (maxPixel.y - 1));

        const total = pixelY * maxPixel.x + pixelX;
        //console.log("Percent: " + percent.x + " " + percent.y + " Pixel: "+ pixelX + " " + pixelY + " Total: " + total);

        return total;
    }

    public fixNorthSeam(tile: Tile, tileUpper: Tile){
        const dem1=tile.dem;
        const dem2=tileUpper.dem;
        const dimensions=tile.demDimensions;

        for(let x=0; x<dimensions.x;x++){
            const pos1Index=x;
            const pos2Index=x+dimensions.x*(dimensions.y-1); //last row

            const height1=dem1[pos1Index];
            const height2=dem2[pos2Index];

            dem1[pos1Index]=height2;
        }      

        tile.northSeamFixed = true;
    }

    public fixEastSeam(tile: Tile, tileRight: Tile) {
        //console.log("fixing right seam!");
        //console.log("dem size: "+ tile.dem.length);
        const dem1 = tile.dem;
        const dem2 = tileRight.dem;
        const dimensions = tile.demDimensions;
        //console.log("dem dimensions: " + dimensions.x + " " + dimensions.y);

        for (let y = 0; y < dimensions.y; y++) {
            const pos1Index = (dimensions.x - 1) + y * dimensions.x; //right most col
            const pos2Index = y * dimensions.x; //left most col

            const height1=dem1[pos1Index];
            const height2 = dem2[pos2Index];

            dem1[pos1Index]=height2;
        }       

        tile.eastSeamFixed = true;
    }

    public fixNorthEastSeam(tile: Tile, tileUpperRight: Tile) {

        //console.log("dem size: "+ tile.dem.length);
        const dem1 = tile.dem;
        const dem2 = tileUpperRight.dem;
        const dimensions = tile.demDimensions;

        const pos1Index = (dimensions.x - 1); //upper right
        const pos2Index = (dimensions.y - 1) * dimensions.x; //lower left

        const height1 = dem1[pos1Index];
        const height2 = dem2[pos2Index];

        dem1[pos1Index] = height2;
    
        tile.northEastSeamFixed = true;
    }
}