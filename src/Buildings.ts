import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Color3 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

import * as GeoJSON from './GeoJSON';
import Tile from "./Tile";
import TileSet from "./TileSet";
import { ProjectionType } from "./TileMath";
import { Observable } from "@babylonjs/core";
import { TreeItemComponent } from "@babylonjs/inspector/components/sceneExplorer/treeItemComponent";

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

export enum BuildingRequestType {
    LoadTile,
    CreateBuilding,
    MergeAllBuildingsOnTile
}

export interface BuildingRequest {
    requestType: BuildingRequestType;
    tile: Tile;
    tileCoords: Vector3;
    inProgress: boolean;
    feature?: GeoJSON.feature;
    projectionType?: ProjectionType;
    url?: string;
}

interface GeoFileLoaded {
    url: string;
    topLevel: GeoJSON.topLevel;
}

export default abstract class Buildings {

    //things the user might be interested in changing
    public exaggeration = 1.0;
    public doMerge = false;
    public defaultBuildingHeight = 4.0;
    public buildingsCreatedPerFrame = 10;
    public cacheFiles = true;
    public buildingMaterial: StandardMaterial;

    protected buildingRequests: BuildingRequest[] = [];
    protected filesLoaded: GeoFileLoaded[] = [];

    private requestsProcessedSinceCaughtUp = 0;
    protected ourGeoJSON: GeoJSON.GeoJSON;

    public onCaughtUpObservable: Observable<boolean> = new Observable;

    constructor(public name: string, protected tileSet: TileSet, protected scene: Scene) {
        this.buildingMaterial = new StandardMaterial("buildingMaterial", this.scene);
        this.buildingMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8);
        this.buildingMaterial.freeze();
        this.ourGeoJSON = new GeoJSON.GeoJSON(tileSet, scene);

        const observer = this.scene.onBeforeRenderObservable.add(() => { //fire every frame
            this.processBuildingRequests();
        });
    }

    public abstract SubmitLoadTileRequest(tile: Tile): void;
    public abstract ProcessGeoJSON(request: BuildingRequest, topLevel: GeoJSON.topLevel): void;

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

    protected popPendingRequest() {
        //console.log(this.prettyName() + "popping request off front of queue");
        this.requestsProcessedSinceCaughtUp++;
        this.buildingRequests.shift(); //pop ourselves off the queue
    }

    protected handleLoadTileRequest(request: BuildingRequest): void {
        if (!request.url) {
            console.error(this.prettyName() + "no valid URL specified in GeoJSON load request");

            this.popPendingRequest();
            return;
        }

        if (this.isURLLoaded(request.url)) { //is the file already cached?
            console.log(this.prettyName() + "we already have this GeoJSON loaded: " + this.stripFilePrefix(request.url));
            const topLevel = this.getFeatures(request.url);
            if (topLevel) {
                this.ProcessGeoJSON(request, topLevel);
            } else {
                console.error(this.prettyName() + "can't find topLevel in already loaded geojson file!");
            }

            this.popPendingRequest();
            return;
        }

        console.log(this.prettyName() + "trying to fetch: " + request.url);
        request.inProgress = true;

        fetch(request.url).then((res) => {
            if (res.status == 200) {
                res.text().then(
                    (text) => {
                        console.log(this.prettyName() + "fetch completed for buildings for tile: " + request.tileCoords);

                        if (text.length > 0) {
                            //console.log(this.prettyName() + "about to json parse for tile: " + request.tileCoords);

                            const topLevel: GeoJSON.topLevel = JSON.parse(text);

                            if (this.cacheFiles) {
                                const floaded: GeoFileLoaded = {
                                    url: this.stripFilePrefix(request.url!),
                                    topLevel: topLevel
                                };
                                this.filesLoaded.push(floaded);
                            }

                            this.ProcessGeoJSON(request, topLevel);
                        }

                        this.popPendingRequest();
                        return;
                    }
                );
            } else {
                console.error(this.prettyName() + "unable to fetch: " + request.url + " error code: " + res.status);
                this.popPendingRequest();
                return;
            }
        }
        ).catch((error) => {
            console.error(this.prettyName() + "error during fetch! " + error);

            this.popPendingRequest();
            return;
        });

        return;
    }

    public processBuildingRequests() {
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
            const request = this.buildingRequests[0]; //peek at front of queue
            
            if (request.inProgress == true) {
                //TODO: this is where we could do some work while waiting (maybe process some buildings?)
                return;
            }

            if (request.tile.tileCoords.equals(request.tileCoords) == false) { //make sure tile still has same coords
                console.warn(this.prettyName() + "tile coords: " + request.tileCoords + " are no longer around, we must have already changed tile");

                this.popPendingRequest();
                return;
            }

            if (request.requestType == BuildingRequestType.LoadTile) {  

                this.handleLoadTileRequest(request);
                return;
            }

            if (request.requestType == BuildingRequestType.CreateBuilding) {
                this.popPendingRequest();

                if (request.feature !== undefined) {
                    if (request.projectionType !== undefined) { //create building request must have a projectionType
                        //console.log("generating single building for tile: " + request.tileCoords);
                        const building = this.ourGeoJSON.generateSingleBuilding(request.feature, request.projectionType, request.tile, this.buildingMaterial, this.exaggeration, this.defaultBuildingHeight);
                    } else {
                        console.error(this.prettyName() + "can't create a building with no projection specified!");
                    }
                } else {
                    console.error(this.prettyName() + "can't create a building with no feature data!");
                }

                if (this.buildingRequests.length > 0) { //take a peek at next upcoming request
                    if (this.buildingRequests[0].requestType != BuildingRequestType.CreateBuilding) { //if its not another building, end processing this frame
                        return;
                    }
                }
            }

            if (request.requestType == BuildingRequestType.MergeAllBuildingsOnTile) {
                this.popPendingRequest();

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
                    } else {
                        console.error(this.prettyName() + "unable to merge meshes!");
                    }
                } else {
                    console.log(this.prettyName() + "not enough meshes to merge: " + request.tile.buildings.length);
                }

                return;
            }
        }
    }

    public generateBuildings() {
        console.log(this.prettyName() + "user would like to generate buildings for all tiles in tileset");

        for (const t of this.tileSet.ourTiles) {
            this.SubmitLoadTileRequest(t);
            console.log(this.prettyName() + "submitting geojson load request for tile: " + t.tileCoords);
        }
    }
}

