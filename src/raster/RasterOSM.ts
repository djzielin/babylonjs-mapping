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
        if (!Number.isInteger(zoom) || zoom < 0) {
            throw new RangeError("RasterOSM zoom must be a non-negative integer.");
        }

        const extension = ".png";
        const prefix = this.osmServers[this.index % this.osmServers.length];
        this.index++;

        const tileCount = 2 ** zoom;
        const tileX = ((Math.floor(tileCoords.x) % tileCount) + tileCount) % tileCount;
        const tileY = Math.max(0, Math.min(tileCount - 1, Math.floor(tileCoords.y)));

        const url = prefix + zoom + "/" + tileX + "/" + tileY + extension;

        return url;
    }
}
