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

import OpenStreetMap from "./OpenStreetMap";
import OpenStreetMapBuildings from "./OpenStreetMapBuildings";

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

export default class TileSet {

    private totalWidthMeters: number;
    private tileWidth: number;

    private xmin: number;
    private zmin: number;
    private xmax: number; 
    private zmax: number;

    //for terrain DEM
    private globalMinHeight=Infinity;

    private ourTiles: Tile[]=[];

    // Precision - number of subdivisions on the height and the width of each tile.
    // more useful when using terrain
    private precision = 20;     
    

    // Subdivisions - number of subdivisions (tiles) on the height and the width of the map.
    private subdivisions: Vector2;
    
    private zoom = 0;
    private tileCorner: Vector2;
    
    //private buildingMaterial: StandardMaterial;

    private rasterProvider: string;
    private accessToken: string;

    private osmBuildings: OpenStreetMapBuildings;

    constructor(subdivisions: number, totalWidth: number, private scene: Scene) {
        this.subdivisions = new Vector2(subdivisions,subdivisions); //TODO: in future support differring tiles in X and Y

        this.totalWidthMeters = totalWidth;

        this.tileWidth = this.totalWidthMeters / this.subdivisions.x;

        this.xmin = -this.totalWidthMeters / 2;
        this.zmin = -this.totalWidthMeters / 2;
        this.xmax = this.totalWidthMeters / 2;
        this.zmax = this.totalWidthMeters / 2;


        for (var row = 0; row < this.subdivisions.y; row++) {
            for (var col = 0; col < this.subdivisions.x; col++) {
                const ground = MeshBuilder.CreateGround("ground", { width: this.tileWidth, height: this.tileWidth, updatable: true, subdivisions: this.precision }, this.scene);
                ground.position.z = this.zmin + (row + 0.5) * this.tileWidth;
                ground.position.x = this.xmin + (col + 0.5) * this.tileWidth;

                const t = new Tile();
                t.mesh = ground;
                t.colRow = new Vector2(col, row);

                this.ourTiles.push(t);

                ground.bakeCurrentTransformIntoVertices(); //does this work?
                ground.freezeWorldMatrix();   
            }
        }

        this.osmBuildings=new OpenStreetMapBuildings(this.scene, this);
    }

    public setRasterProvider(providerName: string, accessToken?: string){
        this.rasterProvider=providerName;
        this.accessToken=accessToken ?? "";
    }

    //https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
    private lon2tile(lon: number, zoom: number): number { return (Math.floor((lon+180)/360*Math.pow(2,zoom))); }
    private lat2tile(lat: number, zoom: number): number { return (Math.floor((1-Math.log(Math.tan(lat*Math.PI/180) + 1/Math.cos(lat*Math.PI/180))/Math.PI)/2 *Math.pow(2,zoom))); }

    //without rounding
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

        cornerTile.x -= this.subdivisions.x / 2;
        cornerTile.y += this.subdivisions.y / 2;

        console.log("corner tile: " + cornerTile);

        return cornerTile;
    }

    //https://wiki.openstreetmap.org/wiki/Zoom_levels
    //Stile = C ∙ cos(latitude) / 2^zoomlevel

    public computeTiletotalWidthMeters(coordinates: Vector2, zoom: number): number {
        const C = 40075016.686;
        const latRadians = coordinates.y * Math.PI / 180.0;
        return (C * Math.cos(latRadians) / Math.pow(2, zoom));
    }

    public computeTileScale(): number {
        const tileMeters = this.computeTiletotalWidthMeters(this.tileCorner, this.zoom);
        console.log("tile (real world) width in meters: " + tileMeters);

        const tileWorldMeters = this.totalWidthMeters / this.subdivisions.x;
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

        const xFixed: number = (x - this.tileCorner.x) / this.subdivisions.x * this.totalWidthMeters - this.totalWidthMeters / 2;
        const yFixed: number = ((this.tileCorner.y + 1) - y) / this.subdivisions.y * this.totalWidthMeters - this.totalWidthMeters / 2;

        //console.log("fixed x: " + xFixed + " fixed y: " + yFixed);

        return new Vector2(xFixed, yFixed);
    }    

    public updateRaster(centerCoords: Vector2, zoom: number) {
        this.tileCorner = this.computeCornerTile(centerCoords, zoom);
        this.zoom = zoom;

        console.log("Tile Base: " + this.tileCorner);

        for (let t of this.ourTiles) {
            if (t.material) {
                t.material.dispose(true, true, false);
            }
        }
        let index = 0;

        for (let row = 0; row < this.subdivisions.y; row++) {
            for (let col = 0; col < this.subdivisions.x; col++) {

                const material = new StandardMaterial("material" + row + "-" + col, this.scene);
              
                const tileX = this.tileCorner.x + col;
                const tileY = this.tileCorner.y - row;

                let url:string = "";

                if(this.rasterProvider=="OSM"){
                    url=OpenStreetMap.getRasterURL(new Vector2(tileX,tileY),this.zoom)
                }

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

                index++;
            }
        }
    }   

    public generateBuildings(exaggeration: number)
    {
        this.osmBuildings.setExaggeration(this.computeTileScale(),exaggeration);
        
        for (const t of this.ourTiles){
            this.osmBuildings.generateBuildingsForTile(t);
        }
    }
}