import { Color3 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import * as GeoJSON from './GeoJSON';
import { Observable } from "@babylonjs/core";
import { RetrievalLocation, RetrievalType } from "./TileSet";
//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";
export var BuildingRequestType;
(function (BuildingRequestType) {
    BuildingRequestType[BuildingRequestType["LoadTile"] = 0] = "LoadTile";
    BuildingRequestType[BuildingRequestType["CreateBuilding"] = 1] = "CreateBuilding";
    BuildingRequestType[BuildingRequestType["MergeAllBuildingsOnTile"] = 2] = "MergeAllBuildingsOnTile";
})(BuildingRequestType || (BuildingRequestType = {}));
export default class Buildings {
    constructor(name, tileSet, retrevialLocation) {
        this.name = name;
        this.tileSet = tileSet;
        this.retrevialLocation = retrevialLocation;
        //things the user might be interested in changing
        this.exaggeration = 1.0;
        this.doMerge = false;
        this.defaultBuildingHeight = 4.0;
        this.lineWidth = 0.0001; //TODO: this needs to be different for EPSG:4326 vs EPSG:3857
        this.pointDiameter = 0.5; //TODO: this is currently in game world units
        this.buildingsCreatedPerFrame = 10; //TODO: is there a better way to do this?
        this.cacheFiles = true;
        this.retrievalType = RetrievalType.IndividualTiles;
        this.buildingRequests = [];
        this.filesLoaded = [];
        this.requestsProcessedSinceCaughtUp = 0;
        this.onCaughtUpObservable = new Observable;
        this.sleepRequested = false;
        this.sleepDuration = 5000; //5 seconds
        this.scene = this.tileSet.scene;
        this.buildingMaterial = new StandardMaterial("buildingMaterial", this.scene);
        this.buildingMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8);
        this.buildingMaterial.freeze();
        this.ourGeoJSON = new GeoJSON.GeoJSON(tileSet, this.scene);
        const observer = this.scene.onBeforeRenderObservable.add(() => {
            this.processBuildingRequests();
        });
    }
    ProcessGeoJSON(request, topLevel) {
        if (request.tile.tileCoords.equals(request.tileCoords) == false) {
            console.warn(this.prettyName() + "tile coords have changed while we were loading, not adding buildings to queue!");
            return;
        }
        let index = 0;
        let addedBuildings = 0;
        const meshArray = [];
        for (const f of topLevel.features) {
            const brequest = {
                requestType: BuildingRequestType.CreateBuilding,
                tile: request.tile,
                tileCoords: request.tile.tileCoords.clone(),
                inProgress: false,
                epsgType: request.epsgType,
                feature: f,
                flipWinding: request.flipWinding
            };
            this.buildingRequests.push(brequest);
            addedBuildings++;
        }
        if (this.doMerge) {
            //console.log("queueing up merge request for tile: " + tile.tileCoords);
            const mrequest = {
                requestType: BuildingRequestType.MergeAllBuildingsOnTile, //request a merge
                tile: request.tile,
                tileCoords: request.tile.tileCoords.clone(),
                inProgress: false,
                flipWinding: request.flipWinding
            };
            this.buildingRequests.push(mrequest);
        }
        console.log(this.prettyName() + addedBuildings + " building generation requests queued for tile: " + request.tile.tileCoords);
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
    removePendingRequest(index = 0) {
        //console.log(this.prettyName() + "popping request off front of queue");
        this.requestsProcessedSinceCaughtUp++;
        //this.buildingRequests.shift(); //pop ourselves off the queue
        this.buildingRequests.splice(index, 1);
    }
    doSave(text) {
        var a = document.createElement("a");
        a.href = window.URL.createObjectURL(new Blob([text], { type: "text/plain" }));
        a.download = this.name + ".json";
        a.click();
    }
    handleLoadTileRequest(request) {
        if (!request.url) {
            console.error(this.prettyName() + "no valid URL specified in GeoJSON load request");
            this.removePendingRequest();
            return;
        }
        if (this.isURLLoaded(request.url)) { //is the file already cached?
            console.log(this.prettyName() + "we already have this GeoJSON loaded: " + this.stripFilePrefix(request.url));
            const topLevel = this.getFeatures(request.url);
            if (topLevel) {
                this.ProcessGeoJSON(request, topLevel);
            }
            else {
                console.error(this.prettyName() + "can't find topLevel in already loaded geojson file!");
            }
            this.removePendingRequest();
            return;
        }
        console.log(this.prettyName() + "trying to fetch: " + request.url);
        request.inProgress = true;
        fetch(request.url).then((res) => {
            if (res.status == 200) {
                res.text().then((text) => {
                    console.log(this.prettyName() + "fetch completed for buildings for tile: " + request.tileCoords);
                    if (text.length > 0) {
                        //console.log(this.prettyName() + "about to json parse for tile: " + request.tileCoords);
                        if (this.retrevialLocation == RetrievalLocation.Remote_and_Save && this.retrievalType == RetrievalType.AllData) {
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
                        this.ProcessGeoJSON(request, topLevel);
                    }
                    this.removePendingRequest();
                    return;
                });
            }
            else if (res.status >= 400 && res.status < 600) {
                console.log("Error code:" + res.status + " while requesting: " + request.url);
                console.log("but we will try again!");
                this.buildingRequests.push(request); //let's try again? maybe there should be a maximum number of retries?
                request.inProgress = false;
                this.timeStart = Date.now();
                this.sleepRequested = true;
                this.removePendingRequest(); //remove original request
                return;
            }
            else {
                console.error(this.prettyName() + "unable to fetch: " + request.url + " error code: " + res.status);
                this.removePendingRequest();
                return;
            }
        }).catch((error) => {
            console.error(this.prettyName() + "error during fetch! " + error);
            this.removePendingRequest();
            return;
        });
        return;
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
            let rIndex = 0;
            let request = this.buildingRequests[rIndex]; //peek at front of queue
            let foundWork = false;
            if (request.inProgress == true) {
                //TODO: this is where we could do some work while waiting (maybe process some buildings?)
                for (let e = 1; e < this.buildingRequests.length; e++) {
                    request = this.buildingRequests[e];
                    if (request.requestType == BuildingRequestType.CreateBuilding || request.requestType == BuildingRequestType.MergeAllBuildingsOnTile) {
                        console.log(this.prettyName() + "found some work to do while waiting!");
                        foundWork = true;
                        rIndex = e;
                        break;
                    }
                }
                if (foundWork == false) {
                    return; //nothing to do
                }
            }
            if (request.tile.tileCoords.equals(request.tileCoords) == false) { //make sure tile still has same coords
                console.warn(this.prettyName() + "tile coords: " + request.tileCoords + " are no longer around, we must have already changed tile");
                this.removePendingRequest(rIndex);
                return;
            }
            if (request.requestType == BuildingRequestType.LoadTile) {
                this.handleLoadTileRequest(request);
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
                    const merged = Mesh.MergeMeshes(allMeshes, false); //false=don't get rid of originals
                    if (merged) {
                        merged.setParent(request.tile.mesh);
                        merged.name = "all_buildings_merged";
                        request.tile.hideIndividualBuildings();
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