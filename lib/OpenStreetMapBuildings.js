import { Vector2 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Color3 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import Earcut from 'earcut';
import { fetch } from 'cross-fetch';
import { Observable } from "@babylonjs/core";
import { ProjectionType } from "./TileSet";
export default class OpenStreetMapBuildings {
    constructor(tileSet, scene) {
        this.tileSet = tileSet;
        this.scene = scene;
        this.buildingRequests = [];
        this.previousRequestSize = 0;
        this.onCustomLoaded = new Observable();
        //https://osmbuildings.org/documentation/data/
        //GET http(s)://({abcd}.)data.osmbuildings.org/0.2/anonymous/tile/15/{x}/{y}.json
        this.osmBuildingServers = ["https://a.data.osmbuildings.org/0.2/anonymous/tile/",
            "https://b.data.osmbuildings.org/0.2/anonymous/tile/",
            "https://c.data.osmbuildings.org/0.2/anonymous/tile/",
            "https://d.data.osmbuildings.org/0.2/anonymous/tile/"];
        this.heightScaleFixer = 1.0;
        this.defaultBuildingHeight = 4.0;
        this.buildingMaterial = new StandardMaterial("buildingMaterial", this.scene);
        this.buildingMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8);
        this.buildingMaterial.freeze();
        //this.setupBuildingGenerator();
    }
    setDefaultBuildingHeight(height) {
        this.defaultBuildingHeight = height;
    }
    setExaggeration(tileScale, exaggeration) {
        this.heightScaleFixer = tileScale * exaggeration;
    }
    //for pulling in buildings from our geoserver
    //TODO: might want to use building request system so we don't do it all in one frame?
    populateFromCustomServer(url, projection, doMerge = true) {
        console.log("trying to fetch: " + url);
        fetch(url).then((res) => {
            //console.log("  fetch returned: " + res.status);
            if (res.status == 200) {
                res.text().then((text) => {
                    //console.log("about to json parse for tile: " + tile.tileCoords);
                    if (text.length == 0) {
                        //console.log("no buildings in this tile!");
                        return;
                    }
                    const tileBuildings = JSON.parse(text);
                    //console.log("number of buildings in this tile: " + tileBuildings.features.length);
                    const allBuildings = [];
                    for (const f of tileBuildings.features) {
                        const building = this.generateSingleBuilding(f, projection, null);
                        allBuildings.push(building);
                    }
                    if (doMerge) {
                        const merged = Mesh.MergeMeshes(allBuildings);
                        if (merged) {
                            merged.name = "merged_buildings";
                        }
                        else {
                            console.error("unable to merge all building meshes!");
                        }
                    }
                    this.onCustomLoaded.notifyObservers(true);
                });
            }
            else {
                console.error("unable to fetch: " + url);
            }
        });
    }
    populateBuildingGenerationRequestsForTile(tile, doMerge = true) {
        if (tile.tileCoords.z > 16) {
            console.error("Zoom level of: " + tile.tileCoords.z + " is too large! This means that buildings won't work!");
            return;
        }
        const storedCoords = tile.tileCoords.clone();
        const url = this.osmBuildingServers[0] + tile.tileCoords.z + "/" + tile.tileCoords.x + "/" + tile.tileCoords.y + ".json";
        console.log("trying to fetch: " + url);
        fetch(url).then((res) => {
            //console.log("  fetch returned: " + res.status);
            if (res.status == 200) {
                res.text().then((text) => {
                    //console.log("about to json parse for tile: " + tile.tileCoords);
                    if (text.length == 0) {
                        //console.log("no buildings in this tile!");
                        return;
                    }
                    const tileBuildings = JSON.parse(text);
                    //console.log("number of buildings in this tile: " + tileBuildings.features.length);
                    if (tile.tileCoords.equals(storedCoords) == false) {
                        console.warn("tile coords have changed while we were loading, not adding buildings to queue!");
                        return;
                    }
                    let index = 0;
                    const meshArray = [];
                    for (const f of tileBuildings.features) {
                        const request = {
                            requestType: 0,
                            tile: tile,
                            tileCoords: tile.tileCoords.clone(),
                            features: f
                        };
                        this.buildingRequests.push(request);
                    }
                    if (doMerge) {
                        //console.log("queueing up merge request for tile: " + tile.tileCoords);
                        const request = {
                            requestType: 1,
                            tile: tile,
                            tileCoords: tile.tileCoords.clone()
                        };
                        this.buildingRequests.push(request);
                    }
                    console.log("all building generation requests queued for tile: " + tile.tileCoords);
                });
            }
            else {
                console.error("unable to fetch: " + url);
            }
        });
    }
    processBuildingRequests() {
        //const observer = this.scene.onBeforeRenderObservable.add(() => {
        //if (this.buildingRequests == null) {
        //return;
        //}
        if (this.buildingRequests.length == 0) {
            if (this.previousRequestSize > 0) {
                console.log("caught up on all building generation requests!");
                this.previousRequestSize = 0;
            }
            return;
        }
        for (let i = 0; i < 10; i++) { //process 10 requests per frame?
            const request = this.buildingRequests.shift();
            if (request === undefined)
                return;
            if (request.tile.tileCoords.equals(request.tileCoords) == false) { //make sure tile still has same coords
                console.warn("tile coords: " + request.tileCoords + " are no longer around, we must have already changed tile");
                return;
            }
            if (request.requestType == 0) { //generate single building
                if (request.features !== undefined) {
                    //console.log("generating single building for tile: " + request.tileCoords);
                    const building = this.generateSingleBuilding(request.features, ProjectionType.EPSG_4326, request.tile);
                }
            }
            if (request.requestType == 1) { //merge all buildings on this tile
                console.log("processing merge request for tile: " + request.tileCoords);
                //console.log("  number of buildings in merge: " + request.tile.buildings.length);
                if (request.tile.buildings.length > 1) {
                    for (let m of request.tile.buildings) {
                        if (m.isReady() == false) {
                            console.error("Mesh not reading!");
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
                        console.error("unable to merge meshes!");
                    }
                }
                else {
                    console.log("not enough meshes to merge: " + request.tile.buildings.length);
                }
            }
        }
        this.previousRequestSize = this.buildingRequests.length;
    }
    getFirstCoordinate(f, projection) {
        if (f.geometry.type == "Polygon") {
            const ps = f.geometry.coordinates;
            return this.getFirstCoordinateFromPolygonSet(ps, projection);
        }
        else if (f.geometry.type == "MultiPolygon") {
            const mp = f.geometry.coordinates;
            return this.getFirstCoordinateFromPolygonSet(mp[0], projection);
        }
        else {
            console.error("unknown geometry type: " + f.geometry.type);
        }
        return new Vector3();
    }
    getFirstCoordinateFromPolygonSet(ps, projection) {
        const v2 = new Vector2(ps[0][0][0], ps[0][0][1]);
        let v2World = new Vector2();
        if (projection == ProjectionType.EPSG_4326) {
            v2World = this.tileSet.GetWorldPosition(v2.y, v2.x); //lat lon
        }
        if (projection == ProjectionType.EPSG_3857) {
            v2World = this.tileSet.GetWorldPositionFrom3857(v2.x, v2.y);
        }
        const coord = new Vector3(v2World.x, 0.0, v2World.y);
        return coord;
    }
    generateSingleBuilding(f, projection, tile) {
        let name = "Building";
        let finalMesh = new Mesh("empty mesh", this.scene);
        if (f.id !== undefined) {
            name = f.id;
        }
        if (f.properties.name !== undefined) {
            name = f.properties.name;
        }
        let height = this.defaultBuildingHeight;
        if (f.properties.height !== undefined) {
            height = f.properties.height;
        }
        if (f.geometry.type == "Polygon") {
            const ps = f.geometry.coordinates;
            finalMesh.dispose();
            finalMesh = this.processSinglePolygon(ps, projection, name, height);
        }
        else if (f.geometry.type == "MultiPolygon") {
            const mp = f.geometry.coordinates;
            const allMeshes = [];
            for (let i = 0; i < mp.length; i++) {
                const singleMesh = this.processSinglePolygon(mp[i], projection, name, height);
                allMeshes.push(singleMesh);
            }
            if (allMeshes.length == 0) {
                console.error("found 0 meshes for MultiPolygon, something went wrong in JSON parsing!");
            }
            else if (allMeshes.length == 1) {
                finalMesh.dispose();
                finalMesh = allMeshes[0];
            }
            else {
                const merged = Mesh.MergeMeshes(allMeshes);
                if (merged) {
                    merged.name = name;
                    finalMesh.dispose();
                    finalMesh = merged;
                }
                else {
                    console.error("unable to merge meshes!");
                }
            }
        }
        else {
            //TODO: support other geometry types? 
            console.error("unknown building geometry type: " + f.geometry.type);
        }
        if (f.properties !== undefined) {
            finalMesh.metadata = f.properties; //store for user to use later!
        }
        if (tile !== null) {
            tile.buildings.push(finalMesh);
            finalMesh.setParent(tile.mesh);
        }
        else {
            const firstCoord = this.getFirstCoordinate(f, projection);
            const tile = this.tileSet.findBestTile(firstCoord);
            finalMesh.setParent(tile.mesh);
            const result = tile.buildings.push(finalMesh);
            //console.log("just added building to tile, building array now: " + result);
        }
        finalMesh.freezeWorldMatrix();
        return finalMesh;
    }
    processSinglePolygon(ps, projection, name, height) {
        const holeArray = [];
        const positions3D = [];
        for (let i = 0; i < ps.length; i++) {
            const hole = [];
            //skip final coord (as it seems to duplicate the first)
            //also need to do this backwards to get normals / winding correct
            for (let e = ps[i].length - 2; e >= 0; e--) {
                const v2 = new Vector2(ps[i][e][0], ps[i][e][1]);
                let v2World = new Vector2();
                if (projection == ProjectionType.EPSG_4326) {
                    v2World = this.tileSet.GetWorldPosition(v2.y, v2.x); //lat lon
                }
                if (projection == ProjectionType.EPSG_3857) {
                    v2World = this.tileSet.GetWorldPositionFrom3857(v2.x, v2.y);
                }
                const coord = new Vector3(v2World.x, 0.0, v2World.y);
                if (i == 0) {
                    positions3D.push(coord);
                }
                else {
                    hole.push(coord);
                }
            }
            //we were previous doing this incorrectly,
            //actully the second polygon is not to be "merged", 
            //but actually specifies additional holes
            //see: https://datatracker.ietf.org/doc/html/rfc7946#page-25
            if (i > 0) {
                holeArray.push(hole);
            }
        }
        window.earcut = Earcut;
        var orientation = Mesh.DEFAULTSIDE;
        if (holeArray.length > 0) {
            orientation = Mesh.DOUBLESIDE; //otherwise we see inside the holes
        }
        const ourMesh = MeshBuilder.ExtrudePolygon(name, {
            shape: positions3D,
            depth: height * this.heightScaleFixer,
            holes: holeArray,
            sideOrientation: orientation
        }, this.scene);
        ourMesh.position.y = height * this.heightScaleFixer;
        ourMesh.material = this.buildingMaterial; //all buildings will use same material
        ourMesh.isPickable = false;
        return ourMesh;
    }
}
//# sourceMappingURL=OpenStreetMapBuildings.js.map