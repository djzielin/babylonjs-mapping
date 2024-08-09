import { Vector3 } from "@babylonjs/core/Maths/math";
import { Vector2 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import Earcut from 'earcut';
import TileBuilding from "./TileBuilding";
export class GeoJSON {
    constructor(tileSet, scene) {
        this.tileSet = tileSet;
        this.scene = scene;
    }
    getFirstCoordinateWorld(f, projection, zoom) {
        if (zoom === undefined) {
            zoom = this.tileSet.zoom;
        }
        if (f.geometry.type == "Polygon") {
            const ps = f.geometry.coordinates;
            return this.getFirstCoordinateWorldFromPolygonSet(ps, projection);
        }
        else if (f.geometry.type == "MultiPolygon") {
            const mp = f.geometry.coordinates;
            return this.getFirstCoordinateWorldFromPolygonSet(mp[0], projection);
        }
        else {
            console.error("unknown geometry type: " + f.geometry.type);
        }
        return new Vector3(0, 0, 0);
    }
    getFirstCoordinateWorldFromPolygonSet(ps, projection, zoom) {
        const v2 = new Vector2(ps[0][0][0], ps[0][0][1]);
        return this.tileSet.ourTileMath.GetWorldPosition(v2, projection, zoom);
    }
    getFirstCoordinateTile(f, projection, zoom) {
        if (zoom === undefined) {
            zoom = this.tileSet.zoom;
        }
        if (f.geometry.type == "Polygon") {
            const ps = f.geometry.coordinates;
            return this.getFirstCoordinateTileFromPolygonSet(ps, projection, zoom);
        }
        else if (f.geometry.type == "MultiPolygon") {
            const mp = f.geometry.coordinates;
            return this.getFirstCoordinateTileFromPolygonSet(mp[0], projection, zoom);
        }
        else {
            console.error("unknown geometry type: " + f.geometry.type);
        }
        return new Vector3(0, 0, 0);
    }
    getFirstCoordinateTileFromPolygonSet(ps, projection, zoom) {
        const v2 = new Vector2(ps[0][0][0], ps[0][0][1]);
        const tileXY = this.tileSet.ourTileMath.GetTilePosition(v2, projection, zoom); //lat lon
        return new Vector3(tileXY.x, tileXY.y, zoom);
    }
    convertCoordinatePairToVector2(cp) {
        const v1 = new Vector2(cp[0], cp[1]);
        return v1;
    }
    convertVector2ToCoordinatePair(v) {
        const cp = [];
        cp.push(v.x);
        cp.push(v.y);
        return cp;
    }
    computeOffset(v1, v2) {
        const diff = v2.subtract(v1);
        const perp = new Vector2(diff.y * -1.0, diff.x * 1.0);
        const perpNormalized = perp.normalize();
        const offset = perpNormalized.multiplyByFloats(0.0001, 0.0001); //TODO: Make this a parameter (ie line width)
        return offset;
    }
    convertLineToPolygonSet(cs) {
        const newPS = [];
        //if(doVerbose) console.log("original line has number of points: " + cs.length);
        const newCS = [];
        for (let p = 0; p < cs.length - 1; p++) { //go forward down the line
            //if(doVerbose) console.log("point index: " + p);
            const v1 = this.convertCoordinatePairToVector2(cs[p]);
            const v2 = this.convertCoordinatePairToVector2(cs[p + 1]);
            //if(doVerbose) console.log("  v1: " + v1);
            //if(doVerbose) console.log("  v2: " + v2);
            const offset = this.computeOffset(v1, v2);
            //if(doVerbose) console.log("  offset: " + offset);
            const newV1 = v1.add(offset);
            const newV2 = v2.add(offset);
            //if(doVerbose) console.log("  new_v1: " + newV1);
            //if(doVerbose) console.log("  new_v2: " + newV2);
            newCS.push(this.convertVector2ToCoordinatePair(newV1));
            newCS.push(this.convertVector2ToCoordinatePair(newV2));
        }
        for (let p = cs.length - 1; p > 0; p--) { //now lets go back towards the start
            //if(doVerbose) console.log("point index: " + p);
            const v1 = this.convertCoordinatePairToVector2(cs[p]);
            const v2 = this.convertCoordinatePairToVector2(cs[p - 1]);
            //if(doVerbose) console.log("  v1: " + v1);
            //if(doVerbose) console.log("  v2: " + v2);
            const offset = this.computeOffset(v1, v2);
            const newV1 = v1.add(offset);
            const newV2 = v2.add(offset);
            //if(doVerbose) console.log("  new_v1: " + newV1);
            //if(doVerbose) console.log("  new_v2: " + newV2);
            newCS.push(this.convertVector2ToCoordinatePair(newV1));
            newCS.push(this.convertVector2ToCoordinatePair(newV2));
        }
        newCS.push(newCS[0]); //add starting coord to close the loop
        newPS.push(newCS);
        return newPS;
    }
    generateSingleBuilding(f, projection, tile, buildingMaterial, exaggeration, defaultBuildingHeight, flipWinding) {
        let finalMesh = null;
        let height = defaultBuildingHeight;
        if (f.properties.height !== undefined) {
            height = f.properties.height;
        }
        if (f.properties.Story !== undefined) {
            let stories = f.properties.Story;
            if (stories == 0) { //0 just means undefined
                stories = 1;
            }
            height = (stories + 0.5) * 3.0; //not sure if we should do this to account for roof height?
        }
        if (f.geometry.type == "Polygon") {
            const ps = f.geometry.coordinates;
            finalMesh = this.processSinglePolygon(ps, projection, buildingMaterial, exaggeration, height, flipWinding);
        }
        else if (f.geometry.type == "MultiPolygon" || f.geometry.type == "MultiLineString") {
            const allMeshes = [];
            if (f.geometry.type == "MultiPolygon") {
                const mp = f.geometry.coordinates;
                for (let i = 0; i < mp.length; i++) {
                    const singleMesh = this.processSinglePolygon(mp[i], projection, buildingMaterial, exaggeration, height, flipWinding);
                    allMeshes.push(singleMesh);
                }
            }
            if (f.geometry.type == "MultiLineString") {
                //console.log("NEW GEOMETRY TYPE: MultiLineString");
                const ps = f.geometry.coordinates;
                //console.log("lineset set of length: " + ps.length);
                for (let i = 0; i < ps.length; i++) {
                    //console.log("  we are looking at lineset: " + i);
                    const cs = ps[i];
                    const newPS = this.convertLineToPolygonSet(cs);
                    const singleMesh = this.processSinglePolygon(newPS, projection, buildingMaterial, exaggeration, height, flipWinding);
                    allMeshes.push(singleMesh);
                }
            }
            if (allMeshes.length == 0) {
                console.error("found 0 meshes for MultiPolygon, something went wrong in JSON parsing!");
            }
            else if (allMeshes.length == 1) {
                finalMesh = allMeshes[0];
            }
            else {
                const merged = Mesh.MergeMeshes(allMeshes);
                if (merged) {
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
        if (finalMesh == null) {
            return;
        }
        if (f.properties !== undefined) {
            finalMesh.metadata = f.properties; //store for user to use later!
        }
        finalMesh.refreshBoundingInfo();
        finalMesh.setParent(tile.mesh);
        finalMesh.freezeWorldMatrix(); //optimization? might want to skip here? hmmm...
        finalMesh.name = "Building";
        if (f.id !== undefined) {
            finalMesh.name = f.id;
        }
        if (f.properties.name !== undefined) {
            finalMesh.name = f.properties.name;
        }
        if (f.properties.Name !== undefined) {
            finalMesh.name = f.properties.Name;
        }
        const building = new TileBuilding(finalMesh, tile);
        if (building.isBBoxContainedOnTile == false) {
            //TODO: check if building is a duplicate
            if (this.tileSet.isBuildingDuplicate(building)) {
                console.log("building already exists on another tile! deleting!");
                building.dispose();
                return;
            }
        }
        console.log("building is an original, adding to tile!");
        tile.buildings.push(building);
        console.log("created " + finalMesh.name);
    }
    processSinglePolygon(ps, projection, buildingMaterial, exaggeration, height, flipWinding) {
        const holeArray = [];
        const positions3D = [];
        for (let i = 0; i < ps.length; i++) {
            const hole = [];
            //skip final coord (as it seems to duplicate the first)
            //also need to do this backwards to get normals / winding correct
            if (flipWinding == false) {
                for (let e = ps[i].length - 2; e >= 0; e--) {
                    const v2 = new Vector2(ps[i][e][0], ps[i][e][1]);
                    const coord = this.tileSet.ourTileMath.GetWorldPosition(v2, projection);
                    if (i == 0) {
                        positions3D.push(coord);
                    }
                    else {
                        hole.push(coord);
                    }
                }
            }
            else {
                for (let e = 0; e < ps[i].length - 1; e++) {
                    const v2 = new Vector2(ps[i][e][0], ps[i][e][1]);
                    const coord = this.tileSet.ourTileMath.GetWorldPosition(v2, projection);
                    if (i == 0) {
                        positions3D.push(coord);
                    }
                    else {
                        hole.push(coord);
                    }
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
        const heightScaleFixer = exaggeration * this.tileSet.tileScale;
        const ourMesh = MeshBuilder.ExtrudePolygon("extruded polygon", {
            shape: positions3D,
            depth: height * heightScaleFixer,
            holes: holeArray,
            sideOrientation: orientation
        }, this.scene);
        ourMesh.position.y = height * heightScaleFixer;
        ourMesh.material = buildingMaterial; //all buildings will use same material
        ourMesh.isPickable = false;
        return ourMesh;
    }
}
//# sourceMappingURL=GeoJSON.js.map