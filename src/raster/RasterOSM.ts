import { Vector2 } from "@babylonjs/core/Maths/math.js";
import Raster from "./Raster.js";
import type TileSet from "../core/TileSet.js";

export default class RasterOSM extends Raster {

    private osmServers: string[] = ["https://tile.openstreetmap.org/"];
    private index = 0;

    constructor(ts: TileSet) {
        super("OSM", ts);
    }

    public override getRasterURL(tileCoords: Vector2, zoom: number): string {
        const extension = ".png";
        const prefix = this.osmServers[this.index % this.osmServers.length];
        this.index++;

        const url = prefix + zoom + "/" + (tileCoords.x) + "/" + (tileCoords.y) + extension;

        return url;
    }
}
