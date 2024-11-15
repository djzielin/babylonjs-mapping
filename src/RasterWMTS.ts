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
    public downloadCount = 0;
    public downloadComplete = true;

    public downloadQueue: TileRequest[] = [];

    constructor(ts: TileSet, retrievalLocation = RetrievalLocation.Remote_and_Save) {
        super("WMTS", ts, retrievalLocation);

        if (retrievalLocation == RetrievalLocation.Remote_and_Save) {
            this.tileSet.scene.onBeforeRenderObservable.add(() => {
                // Your code here
                console.log("This runs before every frame.");
                if (this.downloadComplete==true) {
                    if (this.downloadQueue.length > 0) {
                        this.downloadComplete = false;
                        const request = this.downloadQueue.shift();
                        if (request) {
                            this.processSingleRequest(request);
                        }
                    }
                }
            });
        }
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

    public override doTileSave(request: TileRequest){
        this.downloadQueue.push(request);
    }

    public async processSingleRequest(request: TileRequest) {
        //now with retries per ChatGPT
        const maxRetries = 10;
        const delay = 1000;

        let attempts = 0;
        while (attempts < maxRetries) {
            try {
                const res = await fetch(request.url);

                if (res.status === 200) {
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(new Blob([blob], { type: blob.type }));
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${request.tileCoords.z}_${request.tileCoords.y}_${request.tileCoords.x}${this.extension}`;
                    await new Promise((resolve) => setTimeout(resolve, 250)); //wait for just a bit
                    a.click();

                    console.log("File downloaded successfully!");
                    this.downloadCount++;
                    console.log("  WMTS Download Count: " + this.downloadCount);
                    this.downloadComplete = true;
                    return;
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
    }
}