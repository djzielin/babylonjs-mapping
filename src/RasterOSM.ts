import { Vector2 } from "@babylonjs/core/Maths/math";
import Raster from "./Raster";
import TileSet from "./TileSet";

export default class OpenStreetMap extends Raster {

    private osmServers: string[] = ["https://a.tile.openstreetmap.org/", "https://b.tile.openstreetmap.org/", "https://c.tile.openstreetmap.org/"];
    private index=0;

    constructor(ts:TileSet) {
        super("OSM",ts);
    }

    public override getRasterURL(tileCoords: Vector2, zoom: number): string {
        const extension = ".png";
        const prefix = this.osmServers[this.index % 3];
        this.index++;

        const url = prefix + zoom + "/" + (tileCoords.x) + "/" + (tileCoords.y) + extension;    
        
        return url;
    }
}