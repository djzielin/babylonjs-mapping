import { Scene } from "@babylonjs/core/scene.js";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.js";
import { Color3 } from "@babylonjs/core/Maths/math.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';

import * as GeoJSON from './GeoJSON.js';
import type Tile from "../core/Tile.js";
import type TileSet from "../core/TileSet.js";
import { EPSG_Type } from "../core/TileMath.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import { downloadBlob, isRetryableStatus } from "../shared/Download.js";
import { RetrievalLocation, RetrievalType } from "../shared/Retrieval.js";

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

export enum BuildingRequestType {
    LoadTile,
    CreateBuilding,
    MergeAllBuildingsOnTile
}

export interface BuildingRequestPagination {
    pageSize: number;
    startIndex: number;
}

export interface BuildingRequest {
    cancelled?: boolean;
    requestType: BuildingRequestType;
    tile: Tile;
    tileCoords: Vector3;
    sourceTileCoords?: Vector3;
    inProgress: boolean;
    flipWinding: boolean;
    feature?: GeoJSON.feature;
    epsgType?: EPSG_Type;
    url?: string;
    pagination?: BuildingRequestPagination;
    mergeAfterLoad?: boolean;
    retryCount?: number;
}

export interface BuildingLODOptions {
    /** Enables a rectangle billboard for each generated feature at a distance. */
    enabled?: boolean;
    /** Distance in Babylon world units at which the billboard is selected. */
    distance?: number;
    /** Babylon billboard mode, such as Mesh.BILLBOARDMODE_Y or Mesh.BILLBOARDMODE_ALL. */
    billboardMode?: number;
}

export interface BuildingOptimizationOptions {
    /** Freeze completed building world matrices. Disable this for moving tiles. */
    freezeWorldMatrices?: boolean;
    /** Freeze the shared building material after it is configured. */
    freezeMaterials?: boolean;
    /** Disable picking on generated detailed building meshes. Billboards remain non-pickable. */
    disablePicking?: boolean;
    /** Disable collision checks on generated building and billboard meshes. */
    disableCollisions?: boolean;
    /** Process requests nearest to the active camera instead of FIFO order. */
    prioritizeRequestsByDistance?: boolean;
}

export const DEFAULT_BUILDING_OPTIMIZATION_OPTIONS: Readonly<Required<BuildingOptimizationOptions>> = {
    // Tile meshes move in the endless demo. Keeping this off by default makes
    // the safe behavior the default while still allowing static maps to opt in.
    freezeWorldMatrices: false,
    freezeMaterials: true,
    // Preserve Babylon's existing pickable-by-default behavior; callers can
    // disable picking explicitly for fully static scenes.
    disablePicking: false,
    disableCollisions: true,
    prioritizeRequestsByDistance: false,
};

export interface BuildingPerformanceStats {
    requestsProcessed: number;
    peakQueueLength: number;
    detailedBuildingCount: number;
    billboardCount: number;
    detailedVertexCount: number;
    billboardVertexCount: number;
    estimatedVertexReductionPercent: number;
    lodSelections: number;
    detailedSelections: number;
    billboardSelections: number;
    culledSelections: number;
    frameSamples: number;
    totalFrameTimeMs: number;
    averageFrameTimeMs: number;
    minFrameTimeMs: number;
    maxFrameTimeMs: number;
}



interface GeoFileLoaded {
    url: string;
    topLevel: GeoJSON.topLevel;
}

export default abstract class Buildings {

    //things the user might be interested in changing
    /** Directory or URL prefix used for local cached building assets. */
    public localPathPrefix = "map_cache/";
    public exaggeration = 1.0;
    public doMerge = false;
    /**
     * Optional per-feature rectangle billboards for distant buildings.
     * LOD is disabled by default and should be configured before generation.
     */
    public buildingLOD: BuildingLODOptions = {
        enabled: false,
        distance: 100,
        billboardMode: Mesh.BILLBOARDMODE_Y,
    };
    public defaultBuildingHeight = 4.0;
    /** Width of MultiLineString extrusions in Babylon world units. */
    public lineWidth = 0.25;
    /** Diameter of Point features in Babylon world units. */
    public pointDiameter = 0.5;
    public buildingsCreatedPerFrame = 10; //TODO: is there a better way to do this?
    public cacheFiles = true;
    public maxCachedFiles = 64;
    /** Maximum retries for transient HTTP errors after the initial request. */
    public maxRetries = 3;
    public buildingMaterial: StandardMaterial;
    /** Controls optional mesh/material and request-queue optimizations. */
    public optimizationOptions: Required<BuildingOptimizationOptions> = {
        ...DEFAULT_BUILDING_OPTIMIZATION_OPTIONS,
    };
    /** Collect frame-time samples in getPerformanceStats(). */
    public performanceMonitoringEnabled = false;
    /**
     * Optional transform applied to each completed building mesh before LOD
     * generation, duplicate detection, and tile merging.
     */
    public buildingMeshTransform?: (mesh: Mesh) => void;
    /** Reject a generated footprint before it is registered or merged. */
    public buildingMeshFilter?: (mesh: Mesh) => boolean;
    public retrievalType: RetrievalType = RetrievalType.IndividualTiles;

    protected buildingRequests: BuildingRequest[] = [];
    protected filesLoaded: GeoFileLoaded[] = [];

    private requestsProcessedSinceCaughtUp = 0;
    protected ourGeoJSON: GeoJSON.GeoJSON;
    private scene: Scene;
    public onCaughtUpObservable: Observable<boolean> = new Observable;

    private sleepRequested = false;
    private timeStart: number;
    private sleepDuration=5000; //5 seconds
    private _retrievalLocation: RetrievalLocation;
    private performanceStats: BuildingPerformanceStats = {
        requestsProcessed: 0,
        peakQueueLength: 0,
        detailedBuildingCount: 0,
        billboardCount: 0,
        detailedVertexCount: 0,
        billboardVertexCount: 0,
        estimatedVertexReductionPercent: 0,
        lodSelections: 0,
        detailedSelections: 0,
        billboardSelections: 0,
        culledSelections: 0,
        frameSamples: 0,
        totalFrameTimeMs: 0,
        averageFrameTimeMs: 0,
        minFrameTimeMs: 0,
        maxFrameTimeMs: 0,
    };

    constructor(public name: string, protected tileSet: TileSet, retrievalLocation: RetrievalLocation) {
        this._retrievalLocation = retrievalLocation;
        this.scene = this.tileSet.scene;

        this.buildingMaterial = new StandardMaterial("buildingMaterial", this.scene);
        this.buildingMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8);
        this.applyOptimizationOptions();
        this.ourGeoJSON = new GeoJSON.GeoJSON(tileSet, this.scene);

        this.scene.onBeforeRenderObservable.add(() => { //fire every frame
            this.processBuildingRequests();
        });
        this.scene.onAfterRenderObservable.add(() => {
            if (!this.performanceMonitoringEnabled) {
                return;
            }

            const frameTimeMs = this.scene.getEngine().getDeltaTime();
            this.performanceStats.frameSamples++;
            this.performanceStats.totalFrameTimeMs += frameTimeMs;
            if (this.performanceStats.frameSamples === 1) {
                this.performanceStats.minFrameTimeMs = frameTimeMs;
                this.performanceStats.maxFrameTimeMs = frameTimeMs;
            } else {
                this.performanceStats.minFrameTimeMs = Math.min(this.performanceStats.minFrameTimeMs, frameTimeMs);
                this.performanceStats.maxFrameTimeMs = Math.max(this.performanceStats.maxFrameTimeMs, frameTimeMs);
            }
        });
    }

    /**
     * Merges optimization settings and applies the material setting immediately.
     * Mesh settings are applied to newly generated meshes and can be refreshed
     * on existing meshes with applyBuildingMeshOptions().
     */
    public setOptimizationOptions(options: BuildingOptimizationOptions): void {
        this.optimizationOptions = {
            ...this.optimizationOptions,
            ...options,
        };
        this.applyOptimizationOptions();
    }

    /** Applies the current material optimization setting. */
    public applyOptimizationOptions(): void {
        if (this.optimizationOptions.freezeMaterials) {
            this.buildingMaterial.freeze();
        } else {
            this.buildingMaterial.unfreeze();
        }
    }

    /** Applies picking, collision, and world-matrix settings to a mesh. */
    public applyBuildingMeshOptions(mesh: Mesh, freezeWorldMatrix = this.optimizationOptions.freezeWorldMatrices): void {
        mesh.isPickable = !this.optimizationOptions.disablePicking;
        mesh.checkCollisions = !this.optimizationOptions.disableCollisions;
        mesh.computeWorldMatrix(true);

        if (freezeWorldMatrix) {
            mesh.freezeWorldMatrix();
        } else {
            mesh.unfreezeWorldMatrix();
        }
    }

    /** Enables or disables collection of engine frame-time samples. */
    public setPerformanceMonitoringEnabled(enabled: boolean): void {
        this.performanceMonitoringEnabled = enabled;
    }

    /** Returns cumulative generation, LOD, queue, and optional frame metrics. */
    public getPerformanceStats(): BuildingPerformanceStats {
        const detailedVertices = this.performanceStats.detailedVertexCount;
        const estimatedVertexReductionPercent = detailedVertices === 0 || this.performanceStats.billboardCount === 0
            ? 0
            : Math.max(0, (1 - this.performanceStats.billboardVertexCount / detailedVertices) * 100);

        return {
            ...this.performanceStats,
            estimatedVertexReductionPercent,
            averageFrameTimeMs: this.performanceStats.frameSamples === 0
                ? 0
                : this.performanceStats.totalFrameTimeMs / this.performanceStats.frameSamples,
        };
    }

    /** Clears cumulative performance counters without changing optimization settings. */
    public resetPerformanceStats(): void {
        this.performanceStats = {
            requestsProcessed: 0,
            peakQueueLength: this.buildingRequests.length,
            detailedBuildingCount: 0,
            billboardCount: 0,
            detailedVertexCount: 0,
            billboardVertexCount: 0,
            estimatedVertexReductionPercent: 0,
            lodSelections: 0,
            detailedSelections: 0,
            billboardSelections: 0,
            culledSelections: 0,
            frameSamples: 0,
            totalFrameTimeMs: 0,
            averageFrameTimeMs: 0,
            minFrameTimeMs: 0,
            maxFrameTimeMs: 0,
        };
    }

    /** @internal Records a generated detailed mesh for performance reporting. */
    public recordDetailedBuilding(mesh: Mesh): void {
        this.performanceStats.detailedBuildingCount++;
        this.performanceStats.detailedVertexCount += mesh.getTotalVertices();
    }

    /** @internal Records a generated billboard for performance reporting. */
    public recordBuildingBillboard(mesh: Mesh): void {
        this.performanceStats.billboardCount++;
        this.performanceStats.billboardVertexCount += mesh.getTotalVertices();
    }

    /** @internal Records a Babylon LOD callback selection. */
    public recordLODSelection(selectedLevel: Mesh | null, detailedMesh: Mesh, billboardMesh: Mesh): void {
        this.performanceStats.lodSelections++;
        if (selectedLevel === null) {
            this.performanceStats.culledSelections++;
        } else if (selectedLevel === detailedMesh) {
            this.performanceStats.detailedSelections++;
        } else if (selectedLevel === billboardMesh) {
            this.performanceStats.billboardSelections++;
        }
    }

    public get retrievalLocation(): RetrievalLocation {
        return this._retrievalLocation;
    }

    public set retrievalLocation(value: RetrievalLocation) {
        this._retrievalLocation = value;
    }

    /** @deprecated Use retrievalLocation. */
    public get retrevialLocation(): RetrievalLocation {
        return this._retrievalLocation;
    }

    public set retrevialLocation(value: RetrievalLocation) {
        this._retrievalLocation = value;
    }

    /** Invalidate queued and in-flight feature work when replacing a layer. */
    public cancelPendingRequests(): void {
        for (const request of this.buildingRequests) request.cancelled = true;
        this.buildingRequests = [];
    }

    public abstract SubmitLoadTileRequest(tile: Tile): void;
    public abstract SubmitLoadAllRequest(): void;

    public ProcessGeoJSON(request: BuildingRequest, topLevel: GeoJSON.topLevel): void {
        if (request.cancelled || request.tile.mesh.isDisposed() || !request.tile.tileCoords.equals(request.tileCoords)) {
            console.warn(this.prettyName() + "tile coords have changed while we were loading, not adding buildings to queue!");
            return;
        }

        let addedBuildings = 0;
        const detectedEpsgType = request.epsgType ?? GeoJSON.detectProjection(topLevel);
        for (const f of topLevel.features) {
            if (request.sourceTileCoords && request.sourceTileCoords.z < request.tileCoords.z && !this.featureBelongsToTile(f, request.tileCoords, detectedEpsgType)) continue;
            const brequest: BuildingRequest = {
                requestType: BuildingRequestType.CreateBuilding,
                tile: request.tile,
                tileCoords: request.tile.tileCoords.clone(),
                inProgress: false,
                epsgType: detectedEpsgType,
                feature: f,
                flipWinding: request.flipWinding
            }
            this.enqueueBuildingRequest(brequest);
            addedBuildings++;
        }

        if (request.mergeAfterLoad !== false) {
            if (this.doMerge && this.buildingLOD.enabled) {
                console.warn(this.prettyName() + "building LOD is enabled, so individual buildings will be kept instead of merged.");
            } else {
                this.enqueueMergeRequest(request);
            }
        }
        console.log(this.prettyName() + addedBuildings + " building generation requests queued for tile: " + request.tile.tileCoords);
    }

    private featureBelongsToTile(feature: GeoJSON.feature, coords: Vector3, epsg?: EPSG_Type): boolean {
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        const stack:unknown[]=[feature.geometry?.coordinates];
        while(stack.length) {
            const value=stack.pop();if(!Array.isArray(value))continue;
            if(typeof value[0]==='number'&&typeof value[1]==='number'){
                minX=Math.min(minX,value[0]);maxX=Math.max(maxX,value[0]);minY=Math.min(minY,value[1]);maxY=Math.max(maxY,value[1]);
            } else for(const child of value)stack.push(child);
        }
        if(!Number.isFinite(minX))return false;
        if(feature.geometry.type==='LineString'||feature.geometry.type==='MultiLineString') {
            const a=this.tileSet.ourTileMath.EPSG_to_TileExact(new Vector2(minX,minY),epsg??EPSG_Type.EPSG_4326,coords.z);
            const b=this.tileSet.ourTileMath.EPSG_to_TileExact(new Vector2(maxX,maxY),epsg??EPSG_Type.EPSG_4326,coords.z);
            return Math.min(a.x,b.x)<=coords.x+1&&Math.max(a.x,b.x)>=coords.x&&Math.min(a.y,b.y)<=coords.y+1&&Math.max(a.y,b.y)>=coords.y;
        }
        const center=new Vector2((minX+maxX)/2,(minY+maxY)/2);
        const tile=this.tileSet.ourTileMath.EPSG_to_Tile(center,epsg??EPSG_Type.EPSG_4326,coords.z),n=2**coords.z;
        return ((tile.x%n)+n)%n===((coords.x%n)+n)%n&&tile.y===coords.y;
    }

    /**
     * Providers can override this to create the next request after a full
     * paginated response has been processed.
     */
    protected createNextPageRequest(_request: BuildingRequest, _featuresReturned: number): BuildingRequest | undefined {
        return undefined;
    }

    /**
     * Some paginated services report that an exact final page is out of range
     * instead of returning an empty FeatureCollection.
     */
    protected isPaginationEndResponse(_request: BuildingRequest, _response: Response): boolean {
        return false;
    }

    protected enqueueMergeRequest(request: BuildingRequest): void {
        if (!this.doMerge) {
            return;
        }

        const mergeRequest: BuildingRequest = {
            requestType: BuildingRequestType.MergeAllBuildingsOnTile,
            tile: request.tile,
            tileCoords: request.tile.tileCoords.clone(),
            inProgress: false,
            flipWinding: request.flipWinding
        };
        this.enqueueBuildingRequest(mergeRequest);
    }

    protected enqueueBuildingRequest(request: BuildingRequest): void {
        this.buildingRequests.push(request);
        this.performanceStats.peakQueueLength = Math.max(
            this.performanceStats.peakQueueLength,
            this.buildingRequests.length,
        );
    }

    protected prettyName(): string {
        return "[Buildings " + this.name + "] ";
    }

    private isURLLoaded(url: string): boolean {
        const stripped = this.stripFilePrefix(url);
        for (let f of this.filesLoaded) {
            if (f.url == stripped) {
                return true;
            }
        }

        return false;
    }

    private getFeatures(url: string): GeoJSON.topLevel | null {
        const stripped = this.stripFilePrefix(url);
        for (let f of this.filesLoaded) {
            if (f.url == stripped) {
                return f.topLevel;
            }
        }

        return null;
    }

    protected stripFilePrefix(original: string): string {
        return original;
    }

    protected removePendingRequest(index = 0, request?: BuildingRequest) {
        //console.log(this.prettyName() + "popping request off front of queue");
        const actualIndex = request ? this.buildingRequests.indexOf(request) : index;
        if (actualIndex < 0 || actualIndex >= this.buildingRequests.length) {
            return;
        }

        this.requestsProcessedSinceCaughtUp++;
        this.performanceStats.requestsProcessed++;

        //this.buildingRequests.shift(); //pop ourselves off the queue
        this.buildingRequests.splice(actualIndex, 1);
    }

    protected doSave(text: string){
        downloadBlob(new Blob([text], { type: "application/json" }), this.name + ".json");
    }

    private processLoadedGeoJSON(request: BuildingRequest, topLevel: GeoJSON.topLevel, requestIndex: number): void {
        if (request.cancelled || request.tile.mesh.isDisposed() || !request.tile.tileCoords.equals(request.tileCoords)) {
            console.warn(this.prettyName() + "tile coords have changed while we were loading, not adding buildings to queue!");
            this.removePendingRequest(requestIndex, request);
            return;
        }

        let nextRequest: BuildingRequest | undefined;
        if (request.pagination && topLevel.features.length >= request.pagination.pageSize) {
            nextRequest = this.createNextPageRequest(request, topLevel.features.length);
        }

        request.mergeAfterLoad = nextRequest === undefined;
        this.ProcessGeoJSON(request, topLevel);
        this.removePendingRequest(requestIndex, request);

        if (nextRequest) {
            this.enqueueBuildingRequest(nextRequest);
        }
    }

    protected handleLoadTileRequest(request: BuildingRequest, requestIndex = 0): void {
        if (!request.url) {
            console.error(this.prettyName() + "no valid URL specified in GeoJSON load request");

            this.removePendingRequest(requestIndex, request);
            return;
        }

        if (this.isURLLoaded(request.url)) { //is the file already cached?
            console.log(this.prettyName() + "using cached GeoJSON for tile: " + request.tileCoords);
            const topLevel = this.getFeatures(request.url);
            if (topLevel) {
                this.processLoadedGeoJSON(request, topLevel, requestIndex);
            } else {
                console.error(this.prettyName() + "can't find topLevel in already loaded geojson file!");
                this.removePendingRequest(requestIndex, request);
            }
            return;
        }

        console.log(this.prettyName() + "trying to fetch tile: " + request.tileCoords);
        request.inProgress = true;

        fetch(request.url).then(async (res) => {
            if (res.status == 200) {
                console.log(this.prettyName() + "fetch completed for buildings for tile: " + request.tileCoords);

                const text = await res.text();
                if (text.length > 0) {
                    if(this.retrievalLocation==RetrievalLocation.Remote_and_Save && this.retrievalType==RetrievalType.AllData){
                        this.doSave(text);
                    }

                    const topLevel: GeoJSON.topLevel = JSON.parse(text);

                    if (this.cacheFiles) {
                        const floaded: GeoFileLoaded = {
                            url: this.stripFilePrefix(request.url!),
                            topLevel: topLevel
                        };
                        this.filesLoaded.push(floaded);
                        while(this.filesLoaded.length>Math.max(0,this.maxCachedFiles))this.filesLoaded.shift();
                    }

                    this.processLoadedGeoJSON(request, topLevel, requestIndex);
                } else {
                    this.enqueueMergeRequest(request);
                    this.removePendingRequest(requestIndex, request);
                }
                return;
            }

            if (this.isPaginationEndResponse(request, res)) {
                console.log(this.prettyName() + "pagination has no more pages after: " + request.tileCoords);
                this.enqueueMergeRequest(request);
                this.removePendingRequest(requestIndex, request);
                return;
            }

            if (isRetryableStatus(res.status) && (request.retryCount ?? 0) < this.maxRetries) {
                request.retryCount = (request.retryCount ?? 0) + 1;
                console.log("Error code:" + res.status + " while requesting tile: " + request.tileCoords);
                console.log("but we will try again!");
                this.enqueueBuildingRequest(request); //let's try again? maybe there should be a maximum number of retries?
                request.inProgress=false;
                this.timeStart=Date.now();
                this.sleepRequested=true;
                this.removePendingRequest(requestIndex, request); //remove original request
                return;
            }
            else {
                console.error(this.prettyName() + "unable to fetch tile: " + request.tileCoords + " error code: " + res.status);
                this.removePendingRequest(requestIndex, request);
                return;
            }
        }
        ).catch((error) => {
            console.error(this.prettyName() + "error during fetch! " + error);

            this.removePendingRequest(requestIndex, request);
            return;
        });

        return;
    }

    private selectBuildingRequestIndex(): number | undefined {
        if (this.buildingRequests.length === 0) {
            return undefined;
        }

        if (!this.optimizationOptions.prioritizeRequestsByDistance) {
            if (!this.buildingRequests[0].inProgress) {
                return 0;
            }

            for (let index = 1; index < this.buildingRequests.length; index++) {
                const request = this.buildingRequests[index];
                if (!request.inProgress && (
                    request.requestType === BuildingRequestType.CreateBuilding ||
                    request.requestType === BuildingRequestType.MergeAllBuildingsOnTile
                )) {
                    return index;
                }
            }
            return undefined;
        }

        const loadInProgress = this.buildingRequests.some((request) =>
            request.requestType === BuildingRequestType.LoadTile && request.inProgress,
        );
        const activeCamera = this.scene.activeCamera;
        let bestIndex: number | undefined;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (let index = 0; index < this.buildingRequests.length; index++) {
            const request = this.buildingRequests[index];
            if (request.inProgress) {
                continue;
            }
            if (request.requestType === BuildingRequestType.LoadTile && loadInProgress) {
                continue;
            }
            if (request.requestType === BuildingRequestType.MergeAllBuildingsOnTile) {
                const hasPendingCreate = this.buildingRequests.some((candidate) =>
                    candidate.requestType === BuildingRequestType.CreateBuilding &&
                    !candidate.inProgress &&
                    candidate.tile === request.tile,
                );
                if (hasPendingCreate) {
                    continue;
                }
            }

            let distance = 0;
            if (activeCamera) {
                request.tile.mesh.computeWorldMatrix(true);
                const center = request.tile.mesh.getBoundingInfo().boundingSphere.centerWorld;
                distance = Vector3.DistanceSquared(center, activeCamera.globalPosition);
            }

            // Strictly less-than preserves queue order when distances tie.
            if (bestIndex === undefined || distance < bestDistance) {
                bestIndex = index;
                bestDistance = distance;
            }
        }

        return bestIndex;
    }

    /** CPU budget for feature creation; individual features are atomic. */
    public creationTimeBudgetMs = 4;
    public processBuildingRequests() {
        if (this.sleepRequested) { //lets take a nap for a bit (when we get a 500 server error)
            const timeDiff=Date.now()-this.timeStart;


            if(timeDiff>this.sleepDuration){
                console.log("done sleeping after: " + timeDiff);
                console.log("building request queue length: " + this.buildingRequests.length);
                this.sleepRequested=false;
            } else{
                return;
            }
        }

        if (this.buildingRequests.length == 0) {
            if (this.requestsProcessedSinceCaughtUp > 0) {
                console.log(this.prettyName() + "caught up on all building generation requests! (processed " + this.requestsProcessedSinceCaughtUp + " requests)");
                this.requestsProcessedSinceCaughtUp = 0;
                this.onCaughtUpObservable.notifyObservers(true);
            }
            return;
        }

        const deadline = performance.now() + this.creationTimeBudgetMs;
        for (let i = 0; i < this.buildingsCreatedPerFrame; i++) { //process certain number of requests per frame
            if (i > 0 && performance.now() >= deadline) return;
            //console.log("requests remaining in queue: " + this.buildingRequests.length);
            if (this.buildingRequests.length == 0) {
                return;
            }
            const rIndex = this.selectBuildingRequestIndex();
            if (rIndex === undefined) {
                return;
            }
            const request = this.buildingRequests[rIndex];

            if (request.cancelled || request.tile.mesh.isDisposed() || !request.tile.tileCoords.equals(request.tileCoords)) { //make sure tile still has same coords
                console.warn(this.prettyName() + "tile coords: " + request.tileCoords + " are no longer around, we must have already changed tile");

                this.removePendingRequest(rIndex);
                return;
            }

            if (request.requestType == BuildingRequestType.LoadTile) {

                this.handleLoadTileRequest(request, rIndex);
                return;
            }

            if (request.requestType == BuildingRequestType.CreateBuilding) {
                this.removePendingRequest(rIndex);

                if (request.feature !== undefined) {
                    if (request.epsgType !== undefined) { //create building request must have a projectionType
                        //console.log("generating single building for tile: " + request.tileCoords);

                        //TODO: passing too many parameters into this!
                        //maybe allow it to reference this class instead?
                        this.ourGeoJSON.generateSingleBuilding(this.name, request.feature, request.epsgType, request.tile, request.flipWinding, this);
                    } else {
                        console.error(this.prettyName() + "can't create a building with no projection specified!");
                    }
                } else {
                    console.error(this.prettyName() + "can't create a building with no feature data!");
                }

                //if (this.buildingRequests.length > 0) { //take a peek at next upcoming request
                //    if (this.buildingRequests[0].requestType != BuildingRequestType.CreateBuilding) { //if its not another building, end processing this frame
                //        return;
                //    }
                //}
            }

            if (request.requestType == BuildingRequestType.MergeAllBuildingsOnTile) {
                this.removePendingRequest(rIndex);

                console.log(this.prettyName() + "processing merge request for tile: " + request.tileCoords);
                //console.log("  number of buildings in merge: " + request.tile.buildings.length);

                if (request.tile.buildings.length > 1) {
                    for (let b of request.tile.buildings) {
                        if (b.mesh.isReady() == false) {
                            console.error(this.prettyName() + "ERROR: Mesh not ready!");
                        }
                    }
                    //console.log("about to do big merge");
                    const allMeshes: Mesh[] = request.tile.getAllBuildingMeshes();
                    const merged = Mesh.MergeMeshes(
                        allMeshes,
                        true,
                        true,
                    ); //dispose source meshes and allow dense 32-bit index buffers

                    if (merged) {
                        merged.renderingGroupId = allMeshes[0].renderingGroupId;
                        merged.setParent(request.tile.mesh);
                        merged.name = "all_buildings_merged";
                        this.applyBuildingMeshOptions(merged);

                        request.tile.mergedBuildingMesh = merged;
                    } else {
                        console.error(this.prettyName() + "ERROR: unable to merge meshes!");
                    }
                } else {
                    console.log(this.prettyName() + "not enough meshes to merge: " + request.tile.buildings.length);
                }

                return;
            }
        }
    }

    public generateBuildings() {
        this.tileSet.assertRasterSetup("generate buildings");
        console.log(this.prettyName() + "user would like to generate buildings for all tiles in tileset");

        if (this.retrievalType == RetrievalType.IndividualTiles) {
            console.log("we are going to issue a seperate request for each tile");
            for (const t of this.tileSet.ourTiles) {
                this.SubmitLoadTileRequest(t);
                console.log(this.prettyName() + "submitting geojson load request for tile: " + t.tileCoords);
            }
        }
        if (this.retrievalType == RetrievalType.AllData) {
            console.log("lets see if we can get all data pulled down at once");
            this.SubmitLoadAllRequest();
        }
    }
}
