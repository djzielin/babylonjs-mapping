import { Vector2 } from "@babylonjs/core/Maths/math";

import Tile from './Tile';
import TileSet from "./TileSet";

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

export default class TileMath {

    constructor(private tileSet: TileSet) {
    }

    //https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
    public lon2tile(lon: number, zoom: number): number { return (Math.floor((lon + 180) / 360 * Math.pow(2, zoom))); }
    public lat2tile(lat: number, zoom: number): number { return (Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))); }

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

    public computeCornerTile(lat: number, lon: number, zoom?: number): Vector2 {
        if(zoom===undefined){
            zoom = this.tileSet.zoom;
        }
        
        console.log("computing corner tile for lat: " + lat + " lon: " + lon);

        const cornerTile = this.getTileFromLatLon(lat, lon, zoom);
        console.log("center tile: " + cornerTile);

        cornerTile.x -= Math.floor(this.tileSet.subdivisions.x / 2); //use floor to handle odd tileset sizes
        cornerTile.y += Math.floor(this.tileSet.subdivisions.y / 2);

        console.log("corner tile: " + cornerTile);

        return cornerTile;
    }
 
    public GetWorldPositionFrom4326(lat: number, lon: number, zoom?: number) {
        if(zoom===undefined){
            zoom = this.tileSet.zoom;
        }
        //console.log("computing world for lon: " + lon + " lat: " + lat + " zoom: " + this.zoom);

        const x: number = this.lon2tileExact(lon, zoom); //this gets things in terms of tile coordinates
        const y: number = this.lat2tileExact(lat, zoom);

        return this.GetWorldPositionFromTile(x, y);
    }

    //see https://stackoverflow.com/questions/37523872/converting-coordinates-from-epsg-3857-to-4326
    public GetWorldPositionFrom3857(x: number, y: number, zoom?: number): Vector2 {
        if(zoom===undefined){
            zoom = this.tileSet.zoom;
        }

        //console.log("trying to compute world position for: " + x + " " + y);
        const max = 20037508.34;

        const xAdjusted = x / max;
        const yAdjusted = y / max;

        const xShifted = 0.5 * xAdjusted + 0.5;
        const yShifted = 0.5 - 0.5 * yAdjusted;

        const n = Math.pow(2, zoom);

        const worldPos = this.GetWorldPositionFromTile(n * xShifted, n * yShifted);
        //console.log("world pos is: " + worldPos);
        return worldPos;
    }

    public GetWorldPositionFromTile(x: number, y: number): Vector2 {
        const t = this.tileSet.ourTiles[0]; //just grab the first tile

        const tileDiffX = x - t.tileCoords.x;
        const tileDiffY = y - t.tileCoords.y;

        //console.log("tile diff: " + tileDiffX + " " + tileDiffY);

        const upperLeftCornerX = t.mesh.position.x - this.tileSet.tileWidth * 0.5;
        const upperLeftCornerY = t.mesh.position.z + this.tileSet.tileWidth * 0.5;

        //console.log("lower left corner: " + upperLeftCornerX + " " + upperLeftCornerY);

        const xFixed = upperLeftCornerX + tileDiffX * this.tileSet.tileWidth;
        const yFixed = upperLeftCornerY - tileDiffY * this.tileSet.tileWidth;

        //console.log("world position: " + xFixed +" " + yFixed);       

        return new Vector2(xFixed, yFixed);
    }

    public computeTileScale(): number {
        const tileMeters = this.computeTileRealWidthMeters(this.tileSet.centerCoords.y, this.tileSet.zoom);
        console.log("tile (real world) width in meters: " + tileMeters);

        const tileWorldMeters = this.tileSet.tileWidth; //passed in a parameter in the constructor

        console.log("tile (in game) width in meteres: " + tileWorldMeters);

        const result = tileWorldMeters / tileMeters;
        console.log("scale of tile (in game) (1.0 would be true size): " + result);

        return result;
    }
}
