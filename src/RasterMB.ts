import { Vector2 } from "@babylonjs/core/Maths/math";
import Raster from "./Raster";
import TileSet from "./TileSet";

export default class RasterOSM extends Raster{
    public accessToken: string = "";
    public doResBoost=false;
    public mapType="mapbox.satellite";

    private mbServer: string = "https://api.mapbox.com/v4/";
    private skuToken: string;

    constructor(ts: TileSet) {
        super("MB",ts);

        this.skuToken = this.tileSet.ourTileMath.generateSKU();
    }

    //https://docs.mapbox.com/api/maps/raster-tiles/
    public override getRasterURL(tileCoords: Vector2, zoom: number): string {
        const prefix = this.mbServer;
        const boostParam = this.doResBoost ? "@2x" : "";
        let extension = ".jpg90"; //can do jpg70 to reduce quality & bandwidth
        const accessParam = "?access_token=" + this.accessToken;
        const skuParam = "?sku=" + this.skuToken;

        let url = prefix + this.mapType + "/" + zoom + "/" + (tileCoords.x) + "/" + (tileCoords.y) + boostParam + extension + accessParam;

        return url;
    }
}