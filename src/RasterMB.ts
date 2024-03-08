import { Vector2 } from "@babylonjs/core/Maths/math";
import RasterProvider from "./RasterProvider";

export default class RasterOSM extends RasterProvider{
    public accessToken: string = "";
    public doResBoost=false;
    public mapType="mapbox.satellite";

    private mbServer: string = "https://api.mapbox.com/v4/";
    private skuToken: string;

    constructor() {
        super("MB");

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

        this.skuToken = [TOKEN_VERSION, SKU_ID, sessionRandomizer].join('');
    }

    //https://docs.mapbox.com/api/maps/raster-tiles/
    public getRasterURL(tileCoords: Vector2, zoom: number): string {
        const prefix = this.mbServer;
        const boostParam = this.doResBoost ? "@2x" : "";
        let extension = ".jpg90"; //can do jpg70 to reduce quality & bandwidth
        const accessParam = "?access_token=" + this.accessToken;
        const skuParam = "?sku=" + this.skuToken;

        let url = prefix + this.mapType + "/" + zoom + "/" + (tileCoords.x) + "/" + (tileCoords.y) + boostParam + extension + + skuParam + accessParam;

        return url;
    }
}