//TODO: compile down to javascript as part of build process see links
// https://dev.to/monisnap/5-min-typescript-npm-package-4ce4
// https://itnext.io/step-by-step-building-and-publishing-an-npm-typescript-package-44fe7164964c

import { Scene } from "@babylonjs/core/scene";
import { Engine, EngineStore, Tools } from "@babylonjs/core";
import { Vector2 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Color3 } from "@babylonjs/core/Maths/math";
import { Color4 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder"
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

import Tile from './Tile';
import OpenStreetMap from "./OpenStreetMap";
import MapBox from "./MapBox";
import OpenStreetMapBuildings from "./OpenStreetMapBuildings";
import Attribution from "./Attribution";

import "@babylonjs/core/Materials/standardMaterial"
import "@babylonjs/inspector";
import '@babylonjs/core/Debug/debugLayer';
import { AdvancedDynamicTexture } from "@babylonjs/gui";

export enum ProjectionType{
    EPSG_3857,
    EPSG_4326
}

export default class TileSet {

    private xmin: number;
    private zmin: number;
    private xmax: number; 
    private zmax: number;

    public ourTiles: Tile[]=[];
    public ourTilesMap: Map<string,Tile>=new Map();

    public doRasterResBoost=true;
    public doTerrainResBoost=false;

    // Subdivisions - number of subdivisions (tiles) on the height and the width of the map.
    private subdivisions: Vector2;
    
    private zoom = 0;
    private tileCorner: Vector2;
    private centerCoords: Vector2;
    
    //private buildingMaterial: StandardMaterial;

    private rasterProvider: string;
    private accessToken: string;

    private osmBuildings: OpenStreetMapBuildings;
    private ourMB: MapBox;
    private totalWidthMeters: number;
    private ourAttribution: Attribution;


    constructor(subdivisions: number, private tileWidth: number, public meshPrecision: number, private scene: Scene, private engine: Engine) {
        /*if(subdivisions%2==1){
            console.error("we don't yet support non-even number of tiles");
            return;
        }*/

        EngineStore._LastCreatedScene=this.scene; //gets around a babylonjs bug where we aren't in the same context between the main app and the mapping library
        EngineStore.Instances.push(this.engine);

        
        this.subdivisions = new Vector2(subdivisions,subdivisions); //TODO: in future support differring tile numbers in X and Y
        this.totalWidthMeters=tileWidth*subdivisions;

        //this.tileWidth = this.totalWidthMeters / this.subdivisions.x;

        this.xmin = -this.totalWidthMeters / 2;
        this.zmin = -this.totalWidthMeters / 2;
        this.xmax = this.totalWidthMeters / 2;
        this.zmax = this.totalWidthMeters / 2;


        for (let y = 0; y < this.subdivisions.y; y++) {
            for (let x = 0; x < this.subdivisions.x; x++) {
                const ground=this.makeSingleTileMesh(x,y,this.meshPrecision);
                const t = new Tile();
                t.mesh = ground;
                this.ourTiles.push(t);               
            }
        }

        this.osmBuildings = new OpenStreetMapBuildings(this, this.scene);
        this.ourMB = new MapBox(this, this.scene);      
        this.ourAttribution = new Attribution(this.scene);
    }   

    public getAdvancedDynamicTexture(): AdvancedDynamicTexture{
        return this.ourAttribution.advancedTexture;
    }

    public makeSingleTileMesh(x: number, y: number, precision: number): Mesh {
        const ground = MeshBuilder.CreateGround("ground", { width: this.tileWidth, height: this.tileWidth, updatable: true, subdivisions: precision }, this.scene);
        ground.position.z = this.zmin + (y + 0.5) * this.tileWidth;
        ground.position.x = this.xmin + (x + 0.5) * this.tileWidth;
       
        //ground.bakeCurrentTransformIntoVertices(); //optimization
        //ground.freezeWorldMatrix(); //optimization

        return ground;
    }

    public disableGroundCulling(){
        for(let t of this.ourTiles){
            t.mesh.alwaysSelectAsActiveMesh = true;
        }
    }

    public setRasterProvider(providerName: string, accessToken?: string){
        this.rasterProvider=providerName;
        this.accessToken=accessToken ?? "";
        this.ourMB.accessToken=this.accessToken;

        this.ourAttribution.showAttribution(providerName);
    }

    //https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
    public lon2tile(lon: number, zoom: number): number { return (Math.floor((lon+180)/360*Math.pow(2,zoom))); }
    public lat2tile(lat: number, zoom: number): number { return (Math.floor((1-Math.log(Math.tan(lat*Math.PI/180) + 1/Math.cos(lat*Math.PI/180))/Math.PI)/2 *Math.pow(2,zoom))); }

    //without rounding
    public lon2tileExact(lon: number, zoom: number): number { return (((lon + 180) / 360 * Math.pow(2, zoom))); }
    public lat2tileExact(lat: number, zoom: number): number { return (((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))); }

    public getTileFromLatLon(lat: number, lon: number, zoom: number) {

        console.log("computing for lon: " + lon + " lat: " + lat + " zoom: " + zoom);

        const x = this.lon2tile(lon, zoom);
        console.log("tile x: " + x);

        const y = this.lat2tile(lat, zoom);
        console.log("tile y: " + y);

        return new Vector2(x, y);
    }

    public computeCornerTile(lat: number, lon: number, zoom: number): Vector2 {
        console.log("computing corner tile for lat: " + lat + " lon: " + lon);

        const cornerTile = this.getTileFromLatLon(lat, lon, zoom);
        console.log("center tile: " + cornerTile);

        cornerTile.x -= Math.floor(this.subdivisions.x / 2); //use floor to handle odd tileset sizes
        cornerTile.y += Math.floor(this.subdivisions.y / 2);

        console.log("corner tile: " + cornerTile);

        return cornerTile;
    }

    //https://wiki.openstreetmap.org/wiki/Zoom_levels
    //Stile = C ∙ cos(latitude) / 2^zoomlevel

    public computeTileRealWidthMeters(lat: number, zoom: number): number {
        if(zoom==0){
            console.log("ERROR: zoom not setup yet!");
            return 0;
        }
        console.log("tryign to compute tile width for lat: " + lat);

        const C = 40075016.686;
        const latRadians = lat * Math.PI / 180.0;
        return C * Math.cos(latRadians) / Math.pow(2, zoom); //seems to need abs?
    }

    public computeTileScale(): number {
        const tileMeters = this.computeTileRealWidthMeters(this.centerCoords.y, this.zoom);
        console.log("tile (real world) width in meters: " + tileMeters);

        const tileWorldMeters = this.totalWidthMeters / this.subdivisions.x;
        console.log("tile (in game) width in meteres: " + tileWorldMeters);

        const result = tileWorldMeters / tileMeters;
        console.log("scale of tile (in game) (1.0 would be true size): " + result);

        return result;
    }

    public GetWorldPosition(lat: number, lon: number): Vector2 {
       
        //console.log("computing world for lon: " + lon + " lat: " + lat + " zoom: " + this.zoom);

        const x: number = this.lon2tileExact(lon, this.zoom); //this gets things in terms of tile coordinates
        const y: number = this.lat2tileExact(lat, this.zoom);

        return this.GetWorldPositionFromTile(x,y);
    } 
    
    //see https://stackoverflow.com/questions/37523872/converting-coordinates-from-epsg-3857-to-4326
    public GetWorldPositionFrom3857(x: number, y: number): Vector2{
        console.log("trying to compute world position for: " + x + " " + y);
        const max = 20037508.34;
        
        const xAdjusted=x/max;
        const yAdjusted=y/max;

        const xShifted=0.5*xAdjusted+0.5;
        const yShifted=0.5-0.5*yAdjusted;

        const n=Math.pow(2,this.zoom);

        const worldPos=this.GetWorldPositionFromTile(n*xShifted,n*yShifted);
        console.log("world pos is: " + worldPos);
        return worldPos;
    }

    private GetWorldPositionFromTile(x: number, y:number): Vector2{
        const t = this.ourTiles[0]; //just grab the first tile

        const tileDiffX = x - t.tileCoords.x;
        const tileDiffY = y - t.tileCoords.y;

        //console.log("tile diff: " + tileDiffX + " " + tileDiffY);

        const upperLeftCornerX = t.mesh.position.x - this.tileWidth * 0.5;
        const upperLeftCornerY = t.mesh.position.z + this.tileWidth * 0.5;

        //console.log("lower left corner: " + upperLeftCornerX + " " + upperLeftCornerY);

        const xFixed = upperLeftCornerX + tileDiffX * this.tileWidth;
        const yFixed = upperLeftCornerY - tileDiffY * this.tileWidth;

        //console.log("world position: " + xFixed +" " + yFixed);       

        return new Vector2(xFixed, yFixed);
    }

    /**
    * update all the tiles in the tileset
    * @param lat latitude. conceptually the y position in decimal
    * @param lon longitude. conceptually the x position in decimal
    * @param zoom standard tile mapping zoom levels 0 (whole earth) - 20 (building)
    */
    public updateRaster(lat: number, lon: number, zoom: number) {
        this.centerCoords = new Vector2(lon, lat); 
        this.tileCorner = this.computeCornerTile(lat,lon, zoom);
        this.zoom = zoom;

        //console.log("Tile Base: " + this.tileCorner);

        let tileIndex = 0;
        for (let y = 0; y < this.subdivisions.y; y++) {
            for (let x = 0; x < this.subdivisions.x; x++) {
                const tileX = this.tileCorner.x + x;
                const tileY = this.tileCorner.y - y;
                const tile=this.ourTiles[tileIndex];
                this.updateSingleRasterTile(tileX,tileY,tile);
                tileIndex++;
            }
        }
    }

    private updateSingleRasterTile(tileX: number, tileY: number, tile: Tile) {
        tile.tileCoords = new Vector3(tileX, tileY, this.zoom); //store for later     
        this.ourTilesMap.set(tile.tileCoords.toString(),tile);

        tile.mesh.setEnabled(false);
        let material: StandardMaterial;

        if (tile.material) {
            material = tile.material;
            const text = material.diffuseTexture;
            if (text) {
                text.dispose(); //get rid of texture if it already exists  
            }
            material.unfreeze();
        }
        else {
            material = new StandardMaterial("material" + tileX + "-" + tileY, this.scene);
            material!.specularColor = new Color3(0, 0, 0);
            material.alpha = 1.0;
            // material.backFaceCulling = false;
        }

        let url: string = "";

        if (this.rasterProvider == "OSM") {
            url = OpenStreetMap.getRasterURL(new Vector2(tileX, tileY), this.zoom)
        } else if (this.rasterProvider == "MB") {
            url = this.ourMB.getRasterURL(new Vector2(tileX, tileY), this.zoom, this.doRasterResBoost);
        }

        const texture=new Texture(url, this.scene); 
        texture.onLoadObservable.addOnce((tx)=>{ 
            tile.mesh.setEnabled(true); //show it!
        });

        material.diffuseTexture = texture; 
          
        material.diffuseTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
        material.diffuseTexture.wrapV = Texture.CLAMP_ADDRESSMODE;

        material.freeze(); //optimization

        tile.mesh.material = material;
        tile.material = material;    
    }

    /**
    * moves all the tiles in the set. when a tile reaches the edge, it is moved
    * to the opposite side of the tileset, e.g. a tile comes off the right 
    * edge and moves to the left edge. useful for trying to achieve an endless
    * scrolling type effect, where the user doesn't move but the ground 
    * underneath does
    * @param movX x, ie left-right amount to move
    * @param movZ z, ie forward-back amount to move 
    * @param oneReloadPerFrame should we only allow one tile wrap around and 
    * reload? this is useful when trying to limit how much activity we are 
    * doing per frame, assuming we are calling this function every frame
    */
    public moveAllTiles(movX: number, movZ: number, oneReloadPerFrame: boolean, doBuildings: boolean, doMerge: boolean) {
        for (const t of this.ourTiles) {
            t.mesh.position.x += movX;
            t.mesh.position.z += movZ;
        }

        for (const t of this.ourTiles) {
            if (t.mesh.position.x<this.xmin){
                console.log("Tile: " + t.tileCoords + " is below xMin");
                if(doBuildings){
                    this.deleteBuildings(t);
                }
                t.mesh.position.x+=this.totalWidthMeters;
                this.ourTilesMap.delete(t.tileCoords.toString());
                this.updateSingleRasterTile(t.tileCoords.x+this.subdivisions.x,t.tileCoords.y,t);  
                
                if(doBuildings){
                    this.osmBuildings.populateBuildingGenerationRequestsForTile(t,doMerge);
                }
                if(oneReloadPerFrame){ //limit how many reload we try to do in a single frame
                    return;         
                }    
            }
            if(t.mesh.position.x>this.xmax){
                console.log("Tile: " + t.tileCoords + " is above xMax");
                if(doBuildings){
                    this.deleteBuildings(t);
                }
                t.mesh.position.x-=this.totalWidthMeters;
                this.updateSingleRasterTile(t.tileCoords.x-this.subdivisions.x,t.tileCoords.y,t);   

                if(doBuildings){
                    this.osmBuildings.populateBuildingGenerationRequestsForTile(t,doMerge);
                }
                if(oneReloadPerFrame){
                    return;         
                }                
            }
            if(t.mesh.position.z<this.zmin){
                console.log("Tile: " + t.tileCoords + " is below zmin");
                if(doBuildings){
                    this.deleteBuildings(t);
                }
                t.mesh.position.z+=this.totalWidthMeters;
                this.updateSingleRasterTile(t.tileCoords.x,t.tileCoords.y-this.subdivisions.y,t);   

                if(doBuildings){
                    this.osmBuildings.populateBuildingGenerationRequestsForTile(t,doMerge);
                }
                if(oneReloadPerFrame){
                    return;         
                }                
            }
            if(t.mesh.position.z>this.zmax){
                console.log("Tile: " + t.tileCoords + " is above zmax");
                if(doBuildings){
                    this.deleteBuildings(t);
                }
                t.mesh.position.z-=this.totalWidthMeters;
                this.updateSingleRasterTile(t.tileCoords.x,t.tileCoords.y+this.subdivisions.y,t);   

                if(doBuildings){
                    this.osmBuildings.populateBuildingGenerationRequestsForTile(t,doMerge);
                }
                if(oneReloadPerFrame){
                    return;         
                }               
            }           
        }        
    }

    private deleteBuildings(t: Tile){
        for(let m of t.buildings){
            m.dispose();
        }
        t.buildings=[];
    }

    public processBuildingRequests(){
        this.osmBuildings.processBuildingRequests();
    }

    public generateBuildings(exaggeration: number, doMerge=true) {
        this.osmBuildings.setExaggeration(this.computeTileScale(), exaggeration);

        for (const t of this.ourTiles) {
            //this.osmBuildings.generateBuildingsForTile(t,doMerge);
            this.osmBuildings.populateBuildingGenerationRequestsForTile(t,doMerge);
        }
    }
    public generateBuildingsCustom(url: string, projection: ProjectionType, exaggeration: number, doMerge=true) {
        this.osmBuildings.setExaggeration(this.computeTileScale(), exaggeration);

        this.osmBuildings.populateFromCustomServer(url, projection, doMerge);        
    }

    public async generateTerrain(exaggeration: number){
        await this.ourMB.updateAllTerrainTiles(exaggeration);
    }   

    public getTerrainLowestY(): number{
        return this.ourMB.globalMinHeight;
    }
}