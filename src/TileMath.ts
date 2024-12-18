import { Vector2, Vector4 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { BoundingBox } from "@babylonjs/core";
import Tile from './Tile';
import TileSet from "./TileSet";

export enum EPSG_Type{
    EPSG_3857,
    EPSG_4326
}

// There are 3 main coordinate systems we deal with:
// EPSG - could be lon,lat (4326) or webmercator (3857)
// Tile - refers to specific tiling of basemap (based on zoom levels)
// Game - the game engine coordinates used in babylonJS

export default class TileMath {

    constructor(private tileSet: TileSet | undefined) {
    }

    //https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
    public lon_to_tile(lon: number, zoom: number): number { return (Math.floor((lon + 180) / 360 * Math.pow(2, zoom))); }
    public lat_to_tile(lat: number, zoom: number): number { return (Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))); }

    //without rounding
    public lon_to_tileExact(lon: number, zoom: number): number { return (((lon + 180) / 360 * Math.pow(2, zoom))); }
    public lat_to_tileExact(lat: number, zoom: number): number { return (((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))); }

    //inverse
    public tile_to_lon(x: number, z: number): number {
        return (x / Math.pow(2, z) * 360 - 180);
    }
    public tile_to_lat(y: number, z: number): number {
        var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
        return (180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))));
    }

    public tile_to_lonlat(tileCoords:Vector3):Vector2{
        const x=tileCoords.x;
        const y=tileCoords.y;
        const zoom=tileCoords.z;

        const lon=this.tile_to_lon(x,zoom);
        const lat=this.tile_to_lat(y,zoom);

        return new Vector2(lon,lat);
    }

    //from https://github.com/Turfjs/turf/blob/master/packages/turf-projection/index.ts
    public epsg3857_to_Epsg4326(coord3857: Vector2) {

        // 900913 properties.
        var R2D = 180 / Math.PI;
        var A = 6378137.0; //DJZ - this seems to be the equatorial radius? https://en.wikipedia.org/wiki/Earth_radius
        //var A = 6371008.8; //this is what maptiler uses: https://github.com/maptiler/maptiler-client-js/blob/main/src/services/math.ts

        return new Vector2(
            (coord3857.x * R2D) / A,
            (Math.PI * 0.5 - 2.0 * Math.atan(Math.exp(-coord3857.y / A))) * R2D
        );
    } 

    public epsg4326_to_Epsg3857(lonLat: Vector2) {
        var D2R = Math.PI / 180,
            // 900913 properties
            A = 6378137.0,
            MAXEXTENT = 20037508.342789244;

        // compensate longitudes passing the 180th meridian
        // from https://github.com/proj4js/proj4js/blob/master/lib/common/adjust_lon.js
        var adjusted =
            Math.abs(lonLat.x) <= 180 ? lonLat.x : lonLat.x - this.sign(lonLat.x) * 360;
        const xy: Vector2 = new Vector2(
            A * adjusted * D2R,
            A * Math.log(Math.tan(Math.PI * 0.25 + 0.5 * lonLat.y * D2R)),
        );

        // if xy value is beyond maxextent (e.g. poles), return maxextent
        if (xy.x > MAXEXTENT) xy.x = MAXEXTENT;
        if (xy.x < -MAXEXTENT) xy.x = -MAXEXTENT;
        if (xy.y > MAXEXTENT) xy.y = MAXEXTENT;
        if (xy.y < -MAXEXTENT) xy.y = -MAXEXTENT;

        return xy;
    }

    public sign(x: number): number {
        return x < 0 ? -1 : x > 0 ? 1 : 0;
    }

    public EPSG_to_Game(pos: Vector2, epsg: EPSG_Type, zoom?: number): Vector3 {
        if (zoom === undefined) {
            if (this.tileSet === undefined) {
                console.error("tileSet is undefined!");
                return new Vector3(0, 0, 0);
            }

            zoom = this.tileSet.zoom;
        }

        const exactTile = this.EPSG_to_TileExact(pos, epsg, zoom);
        return this.Tile_to_Game(exactTile);
    }

    public Game_to_LonLat(gamePos: Vector3){
        const t=this.Game_to_Tile(gamePos); 
        const lonlat=this.tile_to_lonlat(t);
        return lonlat; //whoops, forgot this line previously. 
    }

    public EPSG_to_Tile(pos: Vector2, epsg: EPSG_Type, zoom?: number): Vector2 {
        if (zoom === undefined) {
            if (this.tileSet === undefined) {
                console.error("tileSet is undefined!");
                return new Vector2(0, 0);
            }

            zoom = this.tileSet.zoom;
        }

        const exact = this.EPSG_to_TileExact(pos, epsg, zoom);

        return new Vector2(Math.floor(exact.x), Math.floor(exact.y));
    }   
    
    public EPSG_to_TileExact(pos: Vector2, epsg: EPSG_Type, zoom?: number): Vector2 {
        if (zoom === undefined) {
            if (this.tileSet === undefined) {
                console.error("tileSet is undefined!");
                return new Vector2(0, 0);
            }
            zoom = this.tileSet.zoom;
        }

        if (epsg == EPSG_Type.EPSG_4326 || epsg == EPSG_Type.EPSG_3857) {

            let lonLat: Vector2=pos;

            if(epsg==EPSG_Type.EPSG_3857) //if in meters
            {
                lonLat=this.epsg3857_to_Epsg4326(pos); //lets just get everything into 4326 (lat/lon), and then convert to tile
            }

            const x = this.lon_to_tileExact(lonLat.x, zoom);
            const y = this.lat_to_tileExact(lonLat.y, zoom);

            return new Vector2(x, y);
        } else {
            console.error("unknown projection type");
            return new Vector2(0, 0);
        }
    }    

    ////////////////////////////////////////////////////////
    // Tile to Game
    // Game to Tile
    ////////////////////////////////////////////////////////

    public Tile_to_Game(pos: Vector2): Vector3 {
        if(this.tileSet===undefined){
            console.error("tileSet is undefined!");
            return new Vector3(0,0,0);
        }

        const t = this.tileSet.ourTiles[0]; //just grab the first tile

        //console.log("corner tile coords: " + t.tileCoords);

        const tileDiffX = pos.x - t.tileCoords.x;
        const tileDiffY = pos.y - t.tileCoords.y;

        //console.log("tile diff: " + tileDiffX + " " + tileDiffY);

        const upperLeftCornerX = t.mesh.position.x - this.tileSet.tileWidth * 0.5;
        const upperLeftCornerY = t.mesh.position.z + this.tileSet.tileWidth * 0.5;

        //console.log("lower left corner: " + upperLeftCornerX + " " + upperLeftCornerY);

        const xFixed = upperLeftCornerX + tileDiffX * this.tileSet.tileWidth;
        const yFixed = upperLeftCornerY - tileDiffY * this.tileSet.tileWidth;

       // console.log("world position: " + xFixed +" " + yFixed);       

        return new Vector3(xFixed, 0, yFixed);
    }

    public Game_to_Tile(gPos: Vector3): Vector3 {
        if(this.tileSet===undefined){
            console.error("tileSet is undefined!");
            return new Vector3(0,0,0);
        }

        const t = this.tileSet.ourTiles[0]; //just grab the first tile

        const tileX = t.tileCoords.x;
        const tileY = t.tileCoords.y;

        const lowerLeftCornerGameX = t.mesh.position.x - this.tileSet.tileWidth * 0.5;
        const lowerLeftCornerGameY = t.mesh.position.z + this.tileSet.tileWidth * 0.5;
 
        const posDiffX = gPos.x-lowerLeftCornerGameX;
        const posDiffY = lowerLeftCornerGameY-gPos.z;
 
        const diffInTileCoordinatesX=posDiffX/this.tileSet.tileWidth;
        const diffinTileCoordinatesY=posDiffY/this.tileSet.tileWidth;

        const finalTileX=tileX+diffInTileCoordinatesX;
        const finalTileY=tileY+diffinTileCoordinatesY;

        return new Vector3(finalTileX, finalTileY, this.tileSet.zoom);
    }

    public computeBBOX_4326(tileCoords:Vector3): Vector4{
        console.log("In computeBBOX_4326!");
        console.log("   looking at tile: " + tileCoords);
    
        const tileBottomLeft=tileCoords.add(new Vector3(0,1,0));
        console.log("   proposed bottom left: " + tileBottomLeft);

        const bottomLeft=this.tile_to_lonlat(tileBottomLeft);
        console.log("   result: " + bottomLeft);

        const tileUpperRight=tileCoords.add(new Vector3(1,0,0));
        console.log("   proposed upper right: " + tileUpperRight);

        const topRight=this.tile_to_lonlat(tileUpperRight);
        console.log("   result: " + topRight);

        const finalResult = new Vector4(bottomLeft.y, bottomLeft.x, topRight.y, topRight.x); //note the swapped y,x and to get lat,lon ordering   
        console.log("   final result: " + finalResult);
        return finalResult;
    }

    //compute the bounding box of the entire tileset!
    public computeBBOX_4326_Tileset(): Vector4{
        if(this.tileSet===undefined){
            console.error("tileSet is undefined!");
            return new Vector4(0,0,0,0);
        }

        console.log("In computeBBOX_4326_Tileset!");

        const tile: Tile=this.tileSet.ourTiles[0];

        let left=tile.tileCoords.x; 
        let right=tile.tileCoords.x;
        let top=tile.tileCoords.y;
        let bottom=tile.tileCoords.y;
        const zoom=this.tileSet.zoom;

        for(const t of this.tileSet.ourTiles){
            const x=t.tileCoords.x;
            const y=t.tileCoords.y;

            if(x<left)   left=x;
            if(x>right)  right=x; 
            if(y<top)    top=y;
            if(y>bottom) bottom=y;
        }

        right++; //since tile origin is upper left of individual tile
        bottom++;

        const tileBottomLeft=new Vector3(left,bottom,zoom);
        console.log("  tile bottom left: " + tileBottomLeft);
        const bottomLeft=this.tile_to_lonlat(tileBottomLeft);
        console.log("    lon lat result: " + bottomLeft);

        const tileTopRight=new Vector3(right,top,zoom);
        console.log("  tile top right: " + tileTopRight);
        const topRight=this.tile_to_lonlat(tileTopRight);
        console.log("    lon lat result: " + topRight);

        const finalResult = new Vector4(bottomLeft.y, bottomLeft.x, topRight.y, topRight.x); //note the swapped y,x and to get lat,lon ordering   
        console.log("  final result: " + finalResult);
        return finalResult;
    }

    /*
    public computeBBOX_3857(tileCoords: Vector3): Vector4 {
        const answer4326 = this.computeBBOX_4326(tileCoords);

        const firstPair = new Vector2(answer4326.y, answer4326.x); //flip back to lon,lat
        const secondPair = new Vector2(answer4326.w, answer4326.z);

        const fixedFirst = this.epsg4326toEpsg3857(firstPair);
        const fixedSecond = this.epsg4326toEpsg3857(secondPair);

        const finalResult = new Vector4(fixedFirst.x, fixedFirst.y, fixedSecond.x, fixedSecond.y);    
        return finalResult;
    }*/

    //https://wiki.openstreetmap.org/wiki/Zoom_levels
    //Stile = C ∙ cos(latitude) / 2^zoomlevel
    public computeTileRealWidthMeters(lat: number, zoom: number): number {
        if (zoom == 0) {
            console.log("ERROR: zoom not setup yet!");
            return 0;
        }
        console.log("tryign to compute tile width for lat: " + lat);

        const C = 40075016.686;
        const latRadians = lat * Math.PI / 180.0;
        return C * Math.cos(latRadians) / Math.pow(2, zoom); //seems to need abs?
    }

    public computeCornerTile(pos: Vector2, epsg: EPSG_Type, zoom?: number): Vector2 {
        if (this.tileSet === undefined) {
            console.error("tileSet is undefined!");
            return new Vector2(0, 0);
        }

        if (zoom === undefined) {
            zoom = this.tileSet.zoom;
        }

        console.log("computing corner tile for: " + pos);

        let cornerTile = this.EPSG_to_Tile(pos, epsg, zoom);
        console.log("center tile: " + cornerTile);

        cornerTile.x -= Math.floor(this.tileSet.numTiles.x / 2); //use floor to handle odd tileset sizes
        cornerTile.y += Math.floor(this.tileSet.numTiles.y / 2);

        console.log("corner tile: " + cornerTile);

        return cornerTile;
    }

    public computeTileScale(): number {
        if(this.tileSet===undefined){
            console.error("tileSet is undefined!");
            return 0; 
        }

        const tileMeters = this.computeTileRealWidthMeters(this.tileSet.centerCoords.y, this.tileSet.zoom);
        console.log("tile (real world) width in meters: " + tileMeters);

        const tileWorldMeters = this.tileSet.tileWidth; //passed in a parameter in the constructor

        console.log("tile (in game) width in meteres: " + tileWorldMeters);

        const result = tileWorldMeters / tileMeters;
        console.log("scale of tile (in game) (1.0 would be true size): " + result);

        return result;
    }

    public findBestTile(position: Vector3): Tile | undefined{
        if(this.tileSet===undefined){
            console.error("tileSet is undefined!");
            return undefined;
        }
        position.y=0; //do a 2D analysis

        const tileHalfWidth=this.tileSet.tileWidth*0.500001; //make bounding box just a bit bigger, in the off chance something lands right on the line
        const addMax=new Vector3(this.tileSet.tileWidth*0.5,0,this.tileSet.tileWidth*0.5);
        const addMin=new Vector3(-this.tileSet.tileWidth*0.5,0,-this.tileSet.tileWidth*0.5);

        let closestTileDistance=Number.POSITIVE_INFINITY;
        let closestTile=this.tileSet.ourTiles[0];

        for (const t of this.tileSet.ourTiles) {
            const tp=t.mesh.position;
            const tMax=tp.add(addMax);
            const tMin=tp.add(addMin);
            
            tMax.y=1; //force to do a 2D analysis (ignore y)
            tMin.y=-1;

            const tileBox: BoundingBox=new BoundingBox(tMin,tMax);   
            //console.log("box: " + tileBox.center + " " + tileBox.centerWorld);   

            if(tileBox.intersectsPoint(position)){
                //console.log("found a tile that can contain this building!");
                return t;
            }

            const dist = Vector3.Distance(tp, position);
            if (dist < closestTileDistance) {
                closestTile = t;
            }
        }

        console.warn("couldn't find a tile for this building. choosing closest tile");
        return closestTile; //position wasn't inside tile, so we will send back the closest tile
    }

    public generateSKU(): string {
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

        let skuToken: string = [TOKEN_VERSION, SKU_ID, sessionRandomizer].join('');
        console.log("computed mapbox sku: " + skuToken);

        return skuToken;
    }

    // line intercept math by Paul Bourke http://paulbourke.net/geometry/pointlineplane/
    // Determine the intersection point of two line segments
    // Return FALSE if the lines don't intersect
    // updated by DJZ for TypeScript / BabylonJS
    public line_segment_intersect(p1: Vector2, p2: Vector2, p3: Vector2, p4: Vector2): Vector2 | false {

        const x1: number = p1.x;
        const y1: number = p1.y;
        const x2: number = p2.x;
        const y2: number = p2.y;
        const x3: number = p3.x;
        const y3: number = p3.y;
        const x4: number = p4.x;
        const y4: number = p4.y;

        // Check if none of the lines are of length 0
        if ((x1 === x2 && y1 === y2) || (x3 === x4 && y3 === y4)) {
            return false
        }

        const denominator = ((y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1))

        // Lines are parallel
        if (denominator === 0) {
            return false
        }

        let ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denominator
        let ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denominator

        // is the intersection along the segments
        if (ua < 0 || ua > 1 || ub < 0 || ub > 1) {
            return false;
        }

        // Return a object with the x and y coordinates of the intersection
        let x = x1 + ua * (x2 - x1);
        let y = y1 + ua * (y2 - y1);

        return new Vector2(x, y)
    }

    public v3_to_v2(v: Vector3): Vector2{
        return new Vector2(v.x,v.z);
    }

    public v2_to_v3(v: Vector2): Vector3{
        return new Vector3(v.x,0,v.y);
    }
}
