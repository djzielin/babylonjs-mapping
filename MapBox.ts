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

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

export default class MapBox {

    private widthMeters=100;

    private xmin: number = -this.widthMeters/2;
    private zmin: number = -this.widthMeters/2; 
    private xmax: number = this.widthMeters/2; 
    private zmax: number = this.widthMeters/2; 

    private exaggeration=1;

    private globalMinHeight=Infinity;

    //private groundTiles: Mesh[]=[];
    //private tileList: Vector3[]=[];

    private ourTiles: Tile[]=[];

    //https://docs.mapbox.com/api/maps/raster-tiles/
    private mbServers: string[]=["https://api.mapbox.com/v4/"];


    // Precision - number of subdivisions on the height and the width of each tile.
    private precision = 20;

    // Subdivisions - number of subdivisions (tiles) on the height and the width of the map.
    private subdivisions = { //TODO; try changing these and make sure things are ok
        'w': 4,
        'h': 4
    };

    private tiledGround: Mesh; 
    private multiMat: MultiMaterial;
    private zoom = 0;
    private tileCorner: Vector2;
    private buildingMaterial: StandardMaterial;

    constructor(private scene: Scene) {

    }

    public createBaseMap() {
        /*this.tiledGround = MeshBuilder.CreateTiledGround("Tiled Ground",
            {
                xmin: this.xmin,
                zmin: this.zmin,
                xmax: this.xmax,
                zmax: this.zmax,
                subdivisions: this.subdivisions,
                precision: this.precision,
                updatable: true
            },
            this.scene); //old method (above) is deprecated
        
        this.tiledGround.enableEdgesRendering();
        this.tiledGround.enableEdgesRendering(.95);
        this.tiledGround.edgesWidth = 2.0;
        this.tiledGround.edgesColor = new Color4(0, 0, 0, 1);

      
        // Needed variables to set subMeshes
        const verticesCount = this.tiledGround.getTotalVertices();
        const tileIndicesLength = this.tiledGround.getIndices()!.length / (this.subdivisions.w * this.subdivisions.h);

        // Set subMeshes of the tiled ground
        this.tiledGround.subMeshes = [];
        let index = 0;
        let base = 0;
        */

        const tileWidth=this.widthMeters/this.subdivisions.w;
        const tileHeight=this.widthMeters/this.subdivisions.h;

        for (var row = 0; row < this.subdivisions.h; row++) {
            for (var col = 0; col < this.subdivisions.w; col++) {
                const ground = MeshBuilder.CreateGround("ground", {width: tileWidth, height: tileHeight, updatable: true, subdivisions: this.precision}, this.scene);
                ground.position.z=this.zmin+(row+0.5)*tileHeight;
                ground.position.x=this.xmin+(col+0.5)*tileWidth; 
                //TODO: could bake this transform into the mesh as optimization?

                const t=new Tile();
                t.mesh=ground;
                t.colRow=new Vector2(col,row);

                this.ourTiles.push(t);
            }
        }



        this.buildingMaterial = new StandardMaterial("buildingMaterial", this.scene);
        this.buildingMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8);
        this.buildingMaterial.freeze();
        
    }

    //https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
    private lon2tile(lon: number, zoom: number): number { return (Math.floor((lon+180)/360*Math.pow(2,zoom))); }
    private lat2tile(lat: number, zoom: number): number { return (Math.floor((1-Math.log(Math.tan(lat*Math.PI/180) + 1/Math.cos(lat*Math.PI/180))/Math.PI)/2 *Math.pow(2,zoom))); }

    //without floor
    private lon2tileExact(lon: number, zoom: number): number { return (((lon + 180) / 360 * Math.pow(2, zoom))); }
    private lat2tileExact(lat: number, zoom: number): number { return (((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))); }

    public getTileFromLatLon(coordinates: Vector2, zoom: number) {

        console.log("computing for lon: " + coordinates.x + " lat: " + coordinates.y + " zoom: " + zoom);

        const x = this.lon2tile(coordinates.x, zoom);
        console.log("tile x: " + x);

        const y = this.lat2tile(coordinates.y, zoom);
        console.log("tile y: " + y);

        return new Vector2(x, y);
    }

    public computeCornerTile(coordinates: Vector2, zoom: number): Vector2 {
        console.log("computing corner tile: " + coordinates);

        const cornerTile = this.getTileFromLatLon(coordinates, zoom);
        console.log("center tile: " + cornerTile);

        cornerTile.x -= this.subdivisions.w / 2;
        cornerTile.y += this.subdivisions.h / 2;

        console.log("corner tile: " + cornerTile);

        return cornerTile;
    }

    //https://wiki.openstreetmap.org/wiki/Zoom_levels
    //Stile = C ∙ cos(latitude) / 2^zoomlevel

    public computeTileWidthMeters(coordinates: Vector2, zoom: number): number {
        const C = 40075016.686;
        const latRadians = coordinates.y * Math.PI / 180.0;
        return (C * Math.cos(latRadians) / Math.pow(2, zoom));
    }

    public computeTileScale(): number {
        const tileMeters = this.computeTileWidthMeters(this.tileCorner, this.zoom);
        console.log("tile (real world) width in meters: " + tileMeters);

        const tileWorldMeters = this.widthMeters / this.subdivisions.w;
        console.log("tile (in game) width in meteres: " + tileWorldMeters);

        const result = tileWorldMeters / tileMeters;
        console.log("scale of tile (in game) (1.0 would be true size): " + result);

        return result;
    }

    public GetWorldPosition(coordinates: Vector2): Vector2 {
        //console.log("computing world for lon: " + coordinates.x + " lat: " + coordinates.y + " zoom: " + this.zoom);

        const x: number = this.lon2tileExact(coordinates.x, this.zoom);
        const y: number = this.lat2tileExact(coordinates.y, this.zoom);

        //console.log("raw x: " + x + " raw y: " + y);

        const xFixed: number = (x - this.tileCorner.x) / this.subdivisions.w * this.widthMeters - this.widthMeters / 2;
        const yFixed: number = ((this.tileCorner.y + 1) - y) / this.subdivisions.h * this.widthMeters - this.widthMeters / 2;

        //console.log("fixed x: " + xFixed + " fixed y: " + yFixed);

        return new Vector2(xFixed, yFixed);
    }

    public async updateBaseMap(centerCoords: Vector2, zoom: number, doTerrain: boolean) {
        this.tileCorner = this.computeCornerTile(centerCoords, zoom);
        this.zoom = zoom;

        console.log("Tile Base: " + this.tileCorner);

        for (let t of this.ourTiles) {
            if (t.material) {
                t.material.dispose(true, true, false);
            }
        }
        let index = 0;

        for (let row = 0; row < this.subdivisions.h; row++) {
            for (let col = 0; col < this.subdivisions.w; col++) {

                const material = new StandardMaterial("material" + row + "-" + col, this.scene);

                let mapType = "mapbox.satellite";
                const tileX = this.tileCorner.x + col;
                const tileY = this.tileCorner.y - row;
                const prefix = this.mbServers[index % this.mbServers.length];
                let extension = ".jpg90"; //can do jpg70 to reduce quality & bandwidth
                const accessToken = "?access_token=" + "pk.eyJ1IjoiZGp6aWVsaW4iLCJhIjoiY2wwdHh2NDU4MGZlbjNicGF1bHU2enkzZSJ9.IiKpYveO-fNezdrqmTpmZg"

                let url = prefix + mapType + "/" + zoom + "/" + (tileX) + "/" + (tileY) +"@2x"+ extension + accessToken;

                console.log("trying to get: " + url);

                material.diffuseTexture = new Texture(url, this.scene);
                material.diffuseTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
                material.diffuseTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
                material.specularColor = new Color3(0, 0, 0);
                material.alpha = 1.0;
                // material.backFaceCulling = false;

                const tile=this.ourTiles[index];
                tile.mesh.material=material;
                tile.material=material;
                tile.tileNum=new Vector3(tileX, tileY, zoom); //store for later
            
                if(doTerrain){
                    mapType="mapbox.terrain-rgb";
                    extension = ".png";
                    url = prefix + mapType + "/" + zoom + "/" + (tileX) + "/" + (tileY) + extension + accessToken;

                    console.log("trying to fetch: " + url);
                    const res = await fetch(url);
                    console.log("  fetch returned: " + res.status);
            
                    if (res.status != 200) {
                        continue;
                    }
            
                    const abuf = await res.arrayBuffer();
                    const u=new Uint8Array(abuf);                  

                    this.convertImageBufferToHeightArray(u,tile);
                    
                    //this.applyHeightArrayToTile(tileDEM,this.groundTiles[index]);
                }

                index++;
            }
        }

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
    }

    private computeIndexByPercent(percent: Vector2, maxPixel: Vector2): number {
        const pixelX = Math.floor(percent.x * (maxPixel.x-1));
        const pixelY = Math.floor(percent.y * (maxPixel.y-1));
        
        const total = pixelY * maxPixel.x + pixelX;
        //console.log("Percent: " + percent.x + " " + percent.y + " Pixel: "+ pixelX + " " + pixelY + " Total: " + total);

        return total;
    }

    private fixRowSeams(tileLower: Tile, tileUpper: Tile){
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
    }

    private fixColSeams(tile: Tile, tileRight: Tile){
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



    private applyHeightArrayToTile(tile: Tile) {
        const positions = tile.mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;
        //console.log("Position length: " + positions.length);

        const subdivisions = this.precision + 1;

        const scaleFixer = this.computeTileScale() * this.exaggeration;

        let meshIndex = 0;
        for (let y = 0; y < subdivisions; y++) {
            for (let x = 0; x < subdivisions; x++) {
                const percent = new Vector2(x / (subdivisions - 1), y / (subdivisions - 1));
                //console.log("percent: " + percent);
                const demIndex = this.computeIndexByPercent(percent, tile.demDimensions);
                //console.log("dem index:" + demIndex + " out of: " + tile.dem.length);
                //console.log("dem value: " + tile.dem[demIndex]);
                const height = (tile.dem[demIndex] - this.globalMinHeight) * scaleFixer;
                //console.log("x: " + x + " y: " + y + " computed height: " + height);
                positions[1 + meshIndex * 3] = height;
                meshIndex++;
            }
        }
        
        tile.mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
    }

    //https://docs.mapbox.com/data/tilesets/guides/access-elevation-data/
    private convertImageBufferToHeightArray(ourBuff: Uint8Array, tile: Tile) {
        var heightDEM: number[] = [];

        console.log(`Converting Image Buffer to Height Array`);

        const d: DecodedPng=decode(ourBuff);
        const image: Uint8Array=new Uint8Array(d.data);

        console.log("  image height: " + d.height);
        console.log("  image width: " + d.width);
        tile.demDimensions=new Vector2(d.width,d.height);
    
        let minHeight = Infinity;
        let maxHeight = -1;

        for (let i = 0; i < image.length; i += 4) {
            //documentation: height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)

            const R = image[i + 0];
            const G = image[i + 1];
            const B = image[i + 2];
            //const A = image[i + 3];

            const height = -10000.0 + ((R * 256.0 * 256.0 + G * 256.0 + B) * 0.1);
            if (height > maxHeight) {
                maxHeight = height;
            }
            if (height < minHeight) {
                minHeight = height;

                if(minHeight<this.globalMinHeight){
                    this.globalMinHeight=minHeight;
                }
            }

            heightDEM.push(height); 
        }
        console.log("  terrain ranges from : " + minHeight.toFixed(2) + " to " + maxHeight.toFixed(2));
        console.log("  height delta: " + (maxHeight - minHeight).toFixed(2));

        tile.dem=heightDEM;
    }    
}