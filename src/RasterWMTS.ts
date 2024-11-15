import { Vector2 } from "@babylonjs/core/Maths/math";
import Raster from "./Raster";
import TileSet from "./TileSet";
import { RetrievalLocation } from "./TileSet";
import { TileRequest } from "./TileSet";

export default class RasterWMTS extends Raster {
    public tileMatrixSet: string = "default028mm";
    public style = "default";
    public extension = ".png";
    public baseURL = "";
    public layerName = "";
    static downloadCount=0;

    constructor(ts: TileSet, retrievalLocation = RetrievalLocation.Remote_and_Save) {
        super("WMTS", ts, retrievalLocation);
    }

    public setup(url: string, layer: string) {
        this.baseURL = url;
        this.layerName = layer;
    }

    //https://developers.arcgis.com/rest/services-reference/enterprise/wmts-tile-map-service-.htm
    //https://<wmts-url>/tile/<wmts-version>/<layer>/<style>/<tilematrixset>/<tilematrix>/<tilerow>/<tilecol>.<format>

    public override getRasterURL(tileCoords: Vector2, zoom: number): string {
        let baseURL: string = this.baseURL + "/tile/1.0.0/" + this.layerName + "/" + this.style + "/" + this.tileMatrixSet;
        let url: string = baseURL + "/" + zoom + "/" + (tileCoords.y) + "/" + (tileCoords.x) + this.extension;

        if (this.retrievalLocation == RetrievalLocation.Local) {
            const baseUrl = window.location.href.replace(/\/[^/]*\.[^/]*$/, "").replace(/\/$/, "") + "/"; //TODO make this a util function
            url = baseUrl + "map_cache/" + zoom + "_" + (tileCoords.y) + "_" + (tileCoords.x) + this.extension;
        }

        return url;
    }

    //TODO, this should really be somewhere else so it works for all Raster subclasses, but we wanted to get the this.extension variable
    public override async doTileSave(request: TileRequest) {
        //now with retries per ChatGPT
        const maxRetries=10;
        const delay=1000;

        let attempts = 0;
        while (attempts < maxRetries) {
            try {
                const res = await fetch(request.url);
    
                if (res.status === 200) {
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${request.tileCoords.z}_${request.tileCoords.y}_${request.tileCoords.x}${this.extension}`;
                    a.click();
                    window.URL.revokeObjectURL(url);
                    console.log("File downloaded successfully!");
                    RasterWMTS.downloadCount++;
                    console.log("  WMTS Download Count: " + RasterWMTS.downloadCount);
                    return; // Exit the function after successful download
                } else {
                    console.warn(`Attempt ${attempts + 1}: HTTP status ${res.status}`);
                }
            } catch (error) {
                console.error(`Attempt ${attempts + 1} failed:`, error);
            }
    
            // Increment attempts and wait before retrying
            attempts++;
            if (attempts < maxRetries) {
                console.log(`Retrying in ${delay}ms...`);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    
        console.error(`Failed to download file after ${maxRetries} attempts.`);


        /*fetch(request.url).then((res) => {
            if (res.status == 200) {
                res.blob().then((blob) => {
                    var a = document.createElement("a");
                    a.href = window.URL.createObjectURL(blob);
                    a.download = request.tileCoords.z + "_" + request.tileCoords.y+"_" + request.tileCoords.x + this.extension;
                    a.click();
                });
            }
        });*/
    }
}