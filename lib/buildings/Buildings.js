import { Vector3 } from "@babylonjs/core/Maths/math.js";
import { Color3 } from "@babylonjs/core/Maths/math.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import * as GeoJSON from './GeoJSON.js';
import { Observable } from "@babylonjs/core/Misc/observable.js";
import { RetrievalLocation, RetrievalType } from "../shared/Retrieval.js";
//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";
export var BuildingRequestType;
(function (BuildingRequestType) {
    BuildingRequestType[BuildingRequestType["LoadTile"] = 0] = "LoadTile";
    BuildingRequestType[BuildingRequestType["CreateBuilding"] = 1] = "CreateBuilding";
    BuildingRequestType[BuildingRequestType["MergeAllBuildingsOnTile"] = 2] = "MergeAllBuildingsOnTile";
})(BuildingRequestType || (BuildingRequestType = {}));
export const DEFAULT_BUILDING_OPTIMIZATION_OPTIONS = {
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
export default class Buildings {
    constructor(name, tileSet, retrievalLocation) {
        this.name = name;
        this.tileSet = tileSet;
        //things the user might be interested in changing
        /** Directory or URL prefix used for local cached building assets. */
        this.localPathPrefix = "map_cache/";
        this.exaggeration = 1.0;
        this.doMerge = false;
        /**
         * Optional per-feature rectangle billboards for distant buildings.
         * LOD is disabled by default and should be configured before generation.
         */
        this.buildingLOD = {
            enabled: false,
            distance: 100,
            billboardMode: Mesh.BILLBOARDMODE_Y,
        };
        this.defaultBuildingHeight = 4.0;
        /** Width of MultiLineString extrusions in Babylon world units. */
        this.lineWidth = 0.25;
        /** Diameter of Point features in Babylon world units. */
        this.pointDiameter = 0.5;
        this.buildingsCreatedPerFrame = 10; //TODO: is there a better way to do this?
        this.cacheFiles = true;
        /** Controls optional mesh/material and request-queue optimizations. */
        this.optimizationOptions = {
            ...DEFAULT_BUILDING_OPTIMIZATION_OPTIONS,
        };
        /** Collect frame-time samples in getPerformanceStats(). */
        this.performanceMonitoringEnabled = false;
        this.retrievalType = RetrievalType.IndividualTiles;
        this.buildingRequests = [];
        this.filesLoaded = [];
        this.requestsProcessedSinceCaughtUp = 0;
        this.onCaughtUpObservable = new Observable;
        this.sleepRequested = false;
        this.sleepDuration = 5000; //5 seconds
        this.performanceStats = {
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
        this._retrievalLocation = retrievalLocation;
        this.scene = this.tileSet.scene;
        this.buildingMaterial = new StandardMaterial("buildingMaterial", this.scene);
        this.buildingMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8);
        this.applyOptimizationOptions();
        this.ourGeoJSON = new GeoJSON.GeoJSON(tileSet, this.scene);
        this.scene.onBeforeRenderObservable.add(() => {
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
            }
            else {
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
    setOptimizationOptions(options) {
        this.optimizationOptions = {
            ...this.optimizationOptions,
            ...options,
        };
        this.applyOptimizationOptions();
    }
    /** Applies the current material optimization setting. */
    applyOptimizationOptions() {
        if (this.optimizationOptions.freezeMaterials) {
            this.buildingMaterial.freeze();
        }
        else {
            this.buildingMaterial.unfreeze();
        }
    }
    /** Applies picking, collision, and world-matrix settings to a mesh. */
    applyBuildingMeshOptions(mesh, freezeWorldMatrix = this.optimizationOptions.freezeWorldMatrices) {
        mesh.isPickable = !this.optimizationOptions.disablePicking;
        mesh.checkCollisions = !this.optimizationOptions.disableCollisions;
        mesh.computeWorldMatrix(true);
        if (freezeWorldMatrix) {
            mesh.freezeWorldMatrix();
        }
        else {
            mesh.unfreezeWorldMatrix();
        }
    }
    /** Enables or disables collection of engine frame-time samples. */
    setPerformanceMonitoringEnabled(enabled) {
        this.performanceMonitoringEnabled = enabled;
    }
    /** Returns cumulative generation, LOD, queue, and optional frame metrics. */
    getPerformanceStats() {
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
    resetPerformanceStats() {
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
    recordDetailedBuilding(mesh) {
        this.performanceStats.detailedBuildingCount++;
        this.performanceStats.detailedVertexCount += mesh.getTotalVertices();
    }
    /** @internal Records a generated billboard for performance reporting. */
    recordBuildingBillboard(mesh) {
        this.performanceStats.billboardCount++;
        this.performanceStats.billboardVertexCount += mesh.getTotalVertices();
    }
    /** @internal Records a Babylon LOD callback selection. */
    recordLODSelection(selectedLevel, detailedMesh, billboardMesh) {
        this.performanceStats.lodSelections++;
        if (selectedLevel === null) {
            this.performanceStats.culledSelections++;
        }
        else if (selectedLevel === detailedMesh) {
            this.performanceStats.detailedSelections++;
        }
        else if (selectedLevel === billboardMesh) {
            this.performanceStats.billboardSelections++;
        }
    }
    get retrievalLocation() {
        return this._retrievalLocation;
    }
    set retrievalLocation(value) {
        this._retrievalLocation = value;
    }
    /** @deprecated Use retrievalLocation. */
    get retrevialLocation() {
        return this._retrievalLocation;
    }
    set retrevialLocation(value) {
        this._retrievalLocation = value;
    }
    ProcessGeoJSON(request, topLevel) {
        if (request.tile.tileCoords.equals(request.tileCoords) == false) {
            console.warn(this.prettyName() + "tile coords have changed while we were loading, not adding buildings to queue!");
            return;
        }
        let index = 0;
        let addedBuildings = 0;
        const detectedEpsgType = request.epsgType ?? GeoJSON.detectProjection(topLevel);
        const meshArray = [];
        for (const f of topLevel.features) {
            const brequest = {
                requestType: BuildingRequestType.CreateBuilding,
                tile: request.tile,
                tileCoords: request.tile.tileCoords.clone(),
                inProgress: false,
                epsgType: detectedEpsgType,
                feature: f,
                flipWinding: request.flipWinding
            };
            this.enqueueBuildingRequest(brequest);
            addedBuildings++;
        }
        if (request.mergeAfterLoad !== false) {
            if (this.doMerge && this.buildingLOD.enabled) {
                console.warn(this.prettyName() + "building LOD is enabled, so individual buildings will be kept instead of merged.");
            }
            else {
                this.enqueueMergeRequest(request);
            }
        }
        console.log(this.prettyName() + addedBuildings + " building generation requests queued for tile: " + request.tile.tileCoords);
    }
    /**
     * Providers can override this to create the next request after a full
     * paginated response has been processed.
     */
    createNextPageRequest(_request, _featuresReturned) {
        return undefined;
    }
    /**
     * Some paginated services report that an exact final page is out of range
     * instead of returning an empty FeatureCollection.
     */
    isPaginationEndResponse(_request, _response) {
        return false;
    }
    enqueueMergeRequest(request) {
        if (!this.doMerge) {
            return;
        }
        const mergeRequest = {
            requestType: BuildingRequestType.MergeAllBuildingsOnTile,
            tile: request.tile,
            tileCoords: request.tile.tileCoords.clone(),
            inProgress: false,
            flipWinding: request.flipWinding
        };
        this.enqueueBuildingRequest(mergeRequest);
    }
    enqueueBuildingRequest(request) {
        this.buildingRequests.push(request);
        this.performanceStats.peakQueueLength = Math.max(this.performanceStats.peakQueueLength, this.buildingRequests.length);
    }
    prettyName() {
        return "[Buildings " + this.name + "] ";
    }
    isURLLoaded(url) {
        const stripped = this.stripFilePrefix(url);
        for (let f of this.filesLoaded) {
            if (f.url == stripped) {
                return true;
            }
        }
        return false;
    }
    getFeatures(url) {
        const stripped = this.stripFilePrefix(url);
        for (let f of this.filesLoaded) {
            if (f.url == stripped) {
                return f.topLevel;
            }
        }
        return null;
    }
    stripFilePrefix(original) {
        return original;
    }
    removePendingRequest(index = 0, request) {
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
    doSave(text) {
        var a = document.createElement("a");
        a.href = window.URL.createObjectURL(new Blob([text], { type: "text/plain" }));
        a.download = this.name + ".json";
        a.click();
    }
    processLoadedGeoJSON(request, topLevel, requestIndex) {
        if (request.tile.tileCoords.equals(request.tileCoords) == false) {
            console.warn(this.prettyName() + "tile coords have changed while we were loading, not adding buildings to queue!");
            this.removePendingRequest(requestIndex, request);
            return;
        }
        let nextRequest;
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
    handleLoadTileRequest(request, requestIndex = 0) {
        if (!request.url) {
            console.error(this.prettyName() + "no valid URL specified in GeoJSON load request");
            this.removePendingRequest(requestIndex, request);
            return;
        }
        if (this.isURLLoaded(request.url)) { //is the file already cached?
            console.log(this.prettyName() + "we already have this GeoJSON loaded: " + this.stripFilePrefix(request.url));
            const topLevel = this.getFeatures(request.url);
            if (topLevel) {
                this.processLoadedGeoJSON(request, topLevel, requestIndex);
            }
            else {
                console.error(this.prettyName() + "can't find topLevel in already loaded geojson file!");
                this.removePendingRequest(requestIndex, request);
            }
            return;
        }
        console.log(this.prettyName() + "trying to fetch: " + request.url);
        request.inProgress = true;
        fetch(request.url).then(async (res) => {
            if (res.status == 200) {
                console.log(this.prettyName() + "fetch completed for buildings for tile: " + request.tileCoords);
                const text = await res.text();
                if (text.length > 0) {
                    if (this.retrievalLocation == RetrievalLocation.Remote_and_Save && this.retrievalType == RetrievalType.AllData) {
                        this.doSave(text);
                    }
                    const topLevel = JSON.parse(text);
                    if (this.cacheFiles) {
                        const floaded = {
                            url: this.stripFilePrefix(request.url),
                            topLevel: topLevel
                        };
                        this.filesLoaded.push(floaded);
                    }
                    this.processLoadedGeoJSON(request, topLevel, requestIndex);
                }
                else {
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
            if (res.status >= 400 && res.status < 600) {
                console.log("Error code:" + res.status + " while requesting: " + request.url);
                console.log("but we will try again!");
                this.enqueueBuildingRequest(request); //let's try again? maybe there should be a maximum number of retries?
                request.inProgress = false;
                this.timeStart = Date.now();
                this.sleepRequested = true;
                this.removePendingRequest(requestIndex, request); //remove original request
                return;
            }
            else {
                console.error(this.prettyName() + "unable to fetch: " + request.url + " error code: " + res.status);
                this.removePendingRequest(requestIndex, request);
                return;
            }
        }).catch((error) => {
            console.error(this.prettyName() + "error during fetch! " + error);
            this.removePendingRequest(requestIndex, request);
            return;
        });
        return;
    }
    selectBuildingRequestIndex() {
        if (this.buildingRequests.length === 0) {
            return undefined;
        }
        if (!this.optimizationOptions.prioritizeRequestsByDistance) {
            if (!this.buildingRequests[0].inProgress) {
                return 0;
            }
            for (let index = 1; index < this.buildingRequests.length; index++) {
                const request = this.buildingRequests[index];
                if (!request.inProgress && (request.requestType === BuildingRequestType.CreateBuilding ||
                    request.requestType === BuildingRequestType.MergeAllBuildingsOnTile)) {
                    return index;
                }
            }
            return undefined;
        }
        const loadInProgress = this.buildingRequests.some((request) => request.requestType === BuildingRequestType.LoadTile && request.inProgress);
        const activeCamera = this.scene.activeCamera;
        let bestIndex;
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
                const hasPendingCreate = this.buildingRequests.some((candidate) => candidate.requestType === BuildingRequestType.CreateBuilding &&
                    !candidate.inProgress &&
                    candidate.tile === request.tile);
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
    processBuildingRequests() {
        if (this.sleepRequested) { //lets take a nap for a bit (when we get a 500 server error)
            const timeDiff = Date.now() - this.timeStart;
            console.log("we've slept for: " + timeDiff);
            if (timeDiff > this.sleepDuration) {
                console.log("done sleeping after: " + timeDiff);
                console.log("building request queue length: " + this.buildingRequests.length);
                this.sleepRequested = false;
            }
            else {
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
        for (let i = 0; i < this.buildingsCreatedPerFrame; i++) { //process certain number of requests per frame
            //console.log("requests remaining in queue: " + this.buildingRequests.length);
            if (this.buildingRequests.length == 0) {
                return;
            }
            const rIndex = this.selectBuildingRequestIndex();
            if (rIndex === undefined) {
                return;
            }
            const request = this.buildingRequests[rIndex];
            if (request.tile.tileCoords.equals(request.tileCoords) == false) { //make sure tile still has same coords
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
                    }
                    else {
                        console.error(this.prettyName() + "can't create a building with no projection specified!");
                    }
                }
                else {
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
                    const allMeshes = request.tile.getAllBuildingMeshes();
                    const merged = Mesh.MergeMeshes(allMeshes, true, true); //dispose source meshes and allow dense 32-bit index buffers
                    if (merged) {
                        merged.setParent(request.tile.mesh);
                        merged.name = "all_buildings_merged";
                        this.applyBuildingMeshOptions(merged);
                        request.tile.mergedBuildingMesh = merged;
                    }
                    else {
                        console.error(this.prettyName() + "ERROR: unable to merge meshes!");
                    }
                }
                else {
                    console.log(this.prettyName() + "not enough meshes to merge: " + request.tile.buildings.length);
                }
                return;
            }
        }
    }
    generateBuildings() {
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
//# sourceMappingURL=Buildings.js.map