import { Color3 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import * as GeoJSON from './GeoJSON';
import { Observable } from "@babylonjs/core";
//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";
export var BuildingRequestType;
(function (BuildingRequestType) {
    BuildingRequestType[BuildingRequestType["LoadTile"] = 0] = "LoadTile";
    BuildingRequestType[BuildingRequestType["CreateBuilding"] = 1] = "CreateBuilding";
    BuildingRequestType[BuildingRequestType["MergeAllBuildingsOnTile"] = 2] = "MergeAllBuildingsOnTile";
})(BuildingRequestType || (BuildingRequestType = {}));
export default class Buildings {
    constructor(name, tileSet) {
        this.name = name;
        this.tileSet = tileSet;
        //things the user might be interested in changing
        this.exaggeration = 1.0;
        this.doMerge = false;
        this.defaultBuildingHeight = 4.0;
        this.buildingsCreatedPerFrame = 10;
        this.cacheFiles = true;
        this.buildingRequests = [];
        this.filesLoaded = [];
        this.requestsProcessedSinceCaughtUp = 0;
        this.onCaughtUpObservable = new Observable;
        this.scene = this.tileSet.scene;
        this.buildingMaterial = new StandardMaterial("buildingMaterial", this.scene);
        this.buildingMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8);
        this.buildingMaterial.freeze();
        this.ourGeoJSON = new GeoJSON.GeoJSON(tileSet, this.scene);
        const observer = this.scene.onBeforeRenderObservable.add(() => {
            this.processBuildingRequests();
        });
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
                    if (request.projectionType !== undefined) { //create building request must have a projectionType
                        //console.log("generating single building for tile: " + request.tileCoords);
                        const building = this.ourGeoJSON.generateSingleBuilding(request.feature, request.projectionType, request.tile, this.buildingMaterial, this.exaggeration, this.defaultBuildingHeight);
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
                    for (let m of request.tile.buildings) {
                        if (m.isReady() == false) {
                            console.error(this.prettyName() + "Mesh not ready!");
                        }
                    }
                    //console.log("about to do big merge");
                    const merged = Mesh.MergeMeshes(request.tile.buildings);
                    if (merged) {
                        merged.setParent(request.tile.mesh);
                        merged.name = "all_buildings_merged";
                        request.tile.buildings = [];
                        request.tile.buildings.push(merged);
                    }
                    else {
                        console.error(this.prettyName() + "unable to merge meshes!");
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
        for (const t of this.tileSet.ourTiles) {
            this.SubmitLoadTileRequest(t);
            console.log(this.prettyName() + "submitting geojson load request for tile: " + t.tileCoords);
        }
    }
}
//# sourceMappingURL=Buildings.js.map