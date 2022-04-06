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
import MapBox from "./MapBox";
import OpenStreetMapBuildings from "./OpenStreetMapBuildings";

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

export default class TileSet {

    private tileWidth: number;

    private xmin: number;
    private zmin: number;
    private xmax: number; 
    private zmax: number;

    //for terrain DEM
    private globalMinHeight=Number.POSITIVE_INFINITY;;

    private ourTiles: Tile[]=[];

    private exaggeration=3;    

    // Subdivisions - number of subdivisions (tiles) on the height and the width of the map.
    private subdivisions: Vector2;
    
    private zoom = 0;
    private tileCorner: Vector2;
    
    //private buildingMaterial: StandardMaterial;

    private rasterProvider: string;
    private accessToken: string;

    private osmBuildings: OpenStreetMapBuildings;
    private ourMB: MapBox;



    constructor(subdivisions: number, private totalWidthMeters: number, public meshPrecision: number, private scene: Scene) {
        this.subdivisions = new Vector2(subdivisions,subdivisions); //TODO: in future support differring tile numbers in X and Y

        this.tileWidth = this.totalWidthMeters / this.subdivisions.x;

        this.xmin = -this.totalWidthMeters / 2;
        this.zmin = -this.totalWidthMeters / 2;
        this.xmax = this.totalWidthMeters / 2;
        this.zmax = this.totalWidthMeters / 2;


        for (let y = 0; y < this.subdivisions.y; y++) {
            for (let x = 0; x < this.subdivisions.x; x++) {
                const ground=this.makeSingleTileMesh(x,y,this.meshPrecision);
                const t = new Tile();
                t.mesh = ground;
                t.colRow = new Vector2(x, y);    
                this.ourTiles.push(t);               
            }
        }

        this.osmBuildings = new OpenStreetMapBuildings(this, this.scene);
        this.ourMB = new MapBox(this, this.scene);
    }

    public makeSingleTileMesh(x: number, y: number, precision:number): Mesh {
        const ground = MeshBuilder.CreateGround("ground", { width: this.tileWidth, height: this.tileWidth, updatable: true, subdivisions: precision }, this.scene);
        ground.position.z = this.zmin + (y + 0.5) * this.tileWidth;
        ground.position.x = this.xmin + (x + 0.5) * this.tileWidth;
        ground.bakeCurrentTransformIntoVertices(); 
        ground.freezeWorldMatrix();

        //ground.cullingStrategy=Mesh.CULLINGSTRATEGY_STANDARD; //experimenting with differnt culling
        //ground.alwaysSelectAsActiveMesh=true; //trying to eliminate mesh popping when close by

        return ground;
    }

    public setRasterProvider(providerName: string, accessToken?: string){
        this.rasterProvider=providerName;
        this.accessToken=accessToken ?? "";
        this.ourMB.accessToken=this.accessToken;
    }

    //https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
    public lon2tile(lon: number, zoom: number): number { return (Math.floor((lon+180)/360*Math.pow(2,zoom))); }
    public lat2tile(lat: number, zoom: number): number { return (Math.floor((1-Math.log(Math.tan(lat*Math.PI/180) + 1/Math.cos(lat*Math.PI/180))/Math.PI)/2 *Math.pow(2,zoom))); }

    //without rounding
    public lon2tileExact(lon: number, zoom: number): number { return (((lon + 180) / 360 * Math.pow(2, zoom))); }
    public lat2tileExact(lat: number, zoom: number): number { return (((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))); }

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
        return Math.abs(C * Math.cos(latRadians) / Math.pow(2, zoom)); //seems to need abs?
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

        for (let y = 0; y < this.subdivisions.y; y++) {
            for (let x = 0; x < this.subdivisions.x; x++) {

                const material = new StandardMaterial("material" + y + "-" + x, this.scene);
              
                const tileX = this.tileCorner.x + x;
                const tileY = this.tileCorner.y - y;

                let url:string = "";

                if(this.rasterProvider=="OSM"){
                    url=OpenStreetMap.getRasterURL(new Vector2(tileX,tileY),this.zoom)
                } else if(this.rasterProvider=="MB"){
                    url=this.ourMB.getRasterURL(new Vector2(tileX,tileY),this.zoom,false);
                }

                material.diffuseTexture = new Texture(url, this.scene);
                material.diffuseTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
                material.diffuseTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
                material.specularColor = new Color3(0, 0, 0);
                material.alpha = 1.0;
                // material.backFaceCulling = false;
                material.freeze(); //optimization

                const tileIndex=x+y*this.subdivisions.x;
                const tile=this.ourTiles[tileIndex];

                tile.mesh.material=material;
                tile.material=material;
                tile.tileCoords=new Vector3(tileX, tileY, zoom); //store for later              
            }
        }
    }

    public generateBuildings(exaggeration: number) {
        this.osmBuildings.setExaggeration(this.computeTileScale(), exaggeration);

        for (const t of this.ourTiles) {
            this.osmBuildings.generateBuildingsForTile(t);
        }
    }

    public async updateTerrain(exaggeration: number) {
        this.ourMB.setExaggeration(this.computeTileScale(), exaggeration);

        for (let t of this.ourTiles) {
            await this.ourMB.getTileTerrain(t);
        }

        for (let t of this.ourTiles) {
            if(t.minHeight<this.globalMinHeight){
                this.globalMinHeight=t.minHeight;
            }
        }
        console.log("lowest point in tileset is: " + this.globalMinHeight);

        //Fix Seams Here
        for (let t of this.ourTiles) {
            for (let t2 of this.ourTiles) {
                if ((t.tileCoords.x == (t2.tileCoords.x - 1)) && (t.tileCoords.y == t2.tileCoords.y)) {
                    if (t.eastSeamFixed == false) {
                        this.ourMB.fixEastSeam(t,t2);
                    }
                }
                if ((t.tileCoords.x == t2.tileCoords.x) && (t.tileCoords.y == (t2.tileCoords.y+1))) {
                    if (t.northSeamFixed == false) {
                        this.ourMB.fixNorthSeam(t,t2);
                    }
                }
                if ((t.tileCoords.x == (t2.tileCoords.x - 1)) && (t.tileCoords.y == (t2.tileCoords.y+1))) {
                    if (t.northEastSeamFixed == false) {
                        this.ourMB.fixNorthEastSeam(t,t2);
                    }
                }
            }
        }

        for (let t of this.ourTiles) {
            this.ourMB.applyHeightArrayToMesh(t.mesh, t, this.meshPrecision, -this.globalMinHeight);
        }

        //this.ourMB.getTileTerrain(this.ourTiles[0]); //just one for testing
    }

    public setupTerrainLOD(precisions: number[], distances:number[]) {
        for (let t of this.ourTiles) {

            for (let i = 0; i < precisions.length; i++) {
                const precision = precisions[i];
                const distance = distances[i];

                if(precision>0){
                    const loadMesh = this.makeSingleTileMesh(t.colRow.x, t.colRow.y, precision);
                    this.ourMB.applyHeightArrayToMesh(loadMesh, t, precision, -this.globalMinHeight);
                    loadMesh.material = t.material;
                    t.mesh.addLODLevel(distance, loadMesh);
                }
                else{
                    t.mesh.addLODLevel(distance,null);
                }
            }
        }
    }
}