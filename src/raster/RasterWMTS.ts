import { Vector2 } from "@babylonjs/core/Maths/math.js";
import Raster from "./Raster.js";
import { RetrievalLocation } from "../shared/Retrieval.js";
import { downloadBlob, isRetryableStatus } from "../shared/Download.js";
import { getLocalResourceURL } from "../shared/LocalRetrieval.js";
import type TileSet from "../core/TileSet.js";
import type { TileRequest } from "../core/TileSet.js";

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
        this.baseURL = url.replace(/\/+$/, "");
        this.layerName = layer;
    }

    //https://developers.arcgis.com/rest/services-reference/enterprise/wmts-tile-map-service-.htm
    //https://<wmts-url>/tile/<wmts-version>/<layer>/<style>/<tilematrixset>/<tilematrix>/<tilerow>/<tilecol>.<format>

    public override getRasterURL(tileCoords: Vector2, zoom: number): string {
        let baseURL: string = this.baseURL + "/tile/1.0.0/" + this.layerName + "/" + this.style + "/" + this.tileMatrixSet;
        let url: string = baseURL + "/" + zoom + "/" + (tileCoords.y) + "/" + (tileCoords.x) + this.extension;

        if (this.retrievalLocation == RetrievalLocation.Local) {
            url = getLocalResourceURL(
                this.localPathPrefix,
                zoom + "_" + tileCoords.y + "_" + tileCoords.x + this.extension,
            );
        }

        return url;
    }

    public override doTileSave(request: TileRequest){
        this.downloadQueue.push(request);
    }

    public async processSingleRequest(request: TileRequest) {
        const maxAttempts = 10;
        this.downloadComplete = false;
        try {
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    const response = await fetch(request.url);
                    if (response.ok) {
                        downloadBlob(await response.blob(),
                            `${request.tileCoords.z}_${request.tileCoords.y}_${request.tileCoords.x}${this.extension}`);
                        this.downloadCount++;
                        return;
                    }
                    if (!isRetryableStatus(response.status)) {
                        console.error(`WMTS download failed: HTTP ${response.status}`);
                        return;
                    }
                } catch (error) {
                    console.warn(`WMTS download attempt ${attempt} failed:`, error);
                }
                if (attempt < maxAttempts) {
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
            }
            console.error(`WMTS download failed after ${maxAttempts} attempts.`);
        } finally {
            // A failed download must never block the rest of the queue.
            this.downloadComplete = true;
        }
    }
}
