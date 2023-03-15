import { Vector3 } from "@babylonjs/core/Maths/math";
import { Vector2 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import Earcut from 'earcut';
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
    generateSingleBuilding(f, projection, tile, buildingMaterial, exaggeration, defaultBuildingHeight) {
        let name = "Building";
        let finalMesh = null;
        if (f.id !== undefined) {
            name = f.id;
        }
        if (f.properties.name !== undefined) {
            name = f.properties.name;
        }
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
            finalMesh = this.processSinglePolygon(ps, projection, buildingMaterial, exaggeration, height);
            finalMesh.name = name;
        }
        else if (f.geometry.type == "MultiPolygon") {
            const mp = f.geometry.coordinates;
            const allMeshes = [];
            for (let i = 0; i < mp.length; i++) {
                const singleMesh = this.processSinglePolygon(mp[i], projection, buildingMaterial, exaggeration, height);
                allMeshes.push(singleMesh);
            }
            if (allMeshes.length == 0) {
                console.error("found 0 meshes for MultiPolygon, something went wrong in JSON parsing!");
            }
            else if (allMeshes.length == 1) {
                finalMesh = allMeshes[0];
                finalMesh.name = name;
            }
            else {
                const merged = Mesh.MergeMeshes(allMeshes);
                if (merged) {
                    merged.name = name;
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
            finalMesh = new Mesh("empty mesh", this.scene);
        }
        if (f.properties !== undefined) {
            finalMesh.metadata = f.properties; //store for user to use later!
        }
        tile.buildings.push(finalMesh);
        finalMesh.setParent(tile.mesh);
        finalMesh.freezeWorldMatrix(); //optimization? might want to skip here? hmmm...
        //console.log("created " + finalMesh.name);
        return finalMesh;
    }
    processSinglePolygon(ps, projection, buildingMaterial, exaggeration, height) {
        const holeArray = [];
        const positions3D = [];
        for (let i = 0; i < ps.length; i++) {
            const hole = [];
            //skip final coord (as it seems to duplicate the first)
            //also need to do this backwards to get normals / winding correct
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