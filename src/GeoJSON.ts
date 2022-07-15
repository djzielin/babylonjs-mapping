import { Vector3 } from "@babylonjs/core/Maths/math";
import { Vector2 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder"
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import Earcut from 'earcut';

import Tile from './Tile';
import TileSet from "./TileSet";
import { ProjectionType } from "./TileSet";

export interface topLevel {
    "type": string;
    "features": features[];
}

export interface features {
    "id": string;
    "type": string;
    "properties": any;
    "geometry": geometry;
}

export interface propertiesOSM {
    "name": string;
    "type": string;
    "height": number;
    "levels": number;
}

export interface geometry {
    "type": string;
    "coordinates": unknown;
}

export interface multiPolygonSet extends Array<polygonSet> { } 
export interface polygonSet extends Array<coordinateSet> { }
export interface coordinateSet extends Array<coordinatePair> { }
export interface coordinatePair extends Array<number> { }

export default class GeoJSON {
    constructor(private tileSet: TileSet) {
    }

    private getFirstCoordinate(f: features, projection: ProjectionType): Vector3 {
        if (f.geometry.type == "Polygon") {
            const ps: polygonSet = f.geometry.coordinates as polygonSet;
            return this.getFirstCoordinateFromPolygonSet(ps, projection);
        }
        else if (f.geometry.type == "MultiPolygon") {
            const mp: multiPolygonSet = f.geometry.coordinates as multiPolygonSet;
            return this.getFirstCoordinateFromPolygonSet(mp[0], projection);
        }
        else {
            console.error("unknown geometry type: " + f.geometry.type);
        }

        return new Vector3();
    }

    private getFirstCoordinateFromPolygonSet(ps: polygonSet, projection: ProjectionType): Vector3 {

        const v2 = new Vector2(ps[0][0][0], ps[0][0][1]);

        let v2World: Vector2 = new Vector2();

        if (projection == ProjectionType.EPSG_4326) {
            v2World = this.tileSet.GetWorldPosition(v2.y, v2.x); //lat lon
        }
        if (projection == ProjectionType.EPSG_3857) {
            v2World = this.tileSet.ourTileMath.GetWorldPositionFrom3857(v2.x, v2.y);
        }
        const coord = new Vector3(v2World.x, 0.0, v2World.y);

        return coord;
    }

    public generateSingleBuilding(f: features, projection: ProjectionType, tile: Tile | null, buildingMaterial: StandardMaterial, exaggeration=1.0, defaultBuildingHeight=4.5): Mesh {
        let name = "Building";
        let finalMesh: Mesh | null = null;

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

        if (f.geometry.type == "Polygon") {
            const ps: polygonSet = f.geometry.coordinates as polygonSet;
            finalMesh = this.processSinglePolygon(ps, projection, buildingMaterial, exaggeration, height);
            finalMesh.name=name;

        }
        else if (f.geometry.type == "MultiPolygon") {
            const mp: multiPolygonSet = f.geometry.coordinates as multiPolygonSet;

            const allMeshes: Mesh[] = [];

            for (let i = 0; i < mp.length; i++) {
                const singleMesh = this.processSinglePolygon(mp[i], projection, buildingMaterial, exaggeration, height);
                allMeshes.push(singleMesh);
            }

            if (allMeshes.length == 0) {
                console.error("found 0 meshes for MultiPolygon, something went wrong in JSON parsing!");
            }
            else if (allMeshes.length == 1) {
                finalMesh = allMeshes[0];
                finalMesh.name=name;
            } else {
                const merged = Mesh.MergeMeshes(allMeshes);
                if (merged) {
                    merged.name = name;
                    finalMesh = merged;
                } else {
                    console.error("unable to merge meshes!");
                }
            }
        }
        else {
            //TODO: support other geometry types? 
            console.error("unknown building geometry type: " + f.geometry.type);
        }
        
        if(finalMesh==null){
            finalMesh = new Mesh("empty mesh", this.tileSet.scene);
        }

        if (f.properties !== undefined) {
            finalMesh.metadata = f.properties; //store for user to use later!
        }

        if (tile !== null) {
            tile.buildings.push(finalMesh);
            finalMesh.setParent(tile.mesh);
        } else {
            const firstCoord = this.getFirstCoordinate(f, projection);
            const tile = this.tileSet.ourTileMath.findBestTile(firstCoord);

            finalMesh.setParent(tile.mesh);
            const result = tile.buildings.push(finalMesh);
            //console.log("just added building to tile, building array now: " + result);
        }

        finalMesh.freezeWorldMatrix(); //optimization? might want to skip here? hmmm...

        return finalMesh;
    }

    private processSinglePolygon(ps: polygonSet, projection: ProjectionType, buildingMaterial: StandardMaterial, exaggeration: number, height: number): Mesh {
        const holeArray: Vector3[][] = [];
        const positions3D: Vector3[] = [];

        for (let i = 0; i < ps.length; i++) {
            const hole: Vector3[] = [];

            //skip final coord (as it seems to duplicate the first)
            //also need to do this backwards to get normals / winding correct
            for (let e = ps[i].length - 2; e >= 0; e--) {

                const v2 = new Vector2(ps[i][e][0], ps[i][e][1]);

                let v2World: Vector2 = new Vector2();

                if (projection == ProjectionType.EPSG_4326) {
                    v2World = this.tileSet.GetWorldPosition(v2.y, v2.x); //lat lon
                }
                if (projection == ProjectionType.EPSG_3857) {
                    v2World = this.tileSet.ourTileMath.GetWorldPositionFrom3857(v2.x, v2.y);
                }
                const coord = new Vector3(v2World.x, 0.0, v2World.y);

                if (i == 0) {
                    positions3D.push(coord);
                } else {
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

        (window as any).earcut = Earcut;

        var orientation = Mesh.DEFAULTSIDE;
        if (holeArray.length > 0) {
            orientation = Mesh.DOUBLESIDE; //otherwise we see inside the holes
        }

        const heightScaleFixer=exaggeration * this.tileSet.tileScale;

        const ourMesh: Mesh = MeshBuilder.ExtrudePolygon("extruded polygon",
            {
                shape: positions3D,
                depth: height * heightScaleFixer,
                holes: holeArray,
                sideOrientation: orientation
            },
            this.tileSet.scene);

        ourMesh.position.y = height * heightScaleFixer;
        ourMesh.material = buildingMaterial; //all buildings will use same material
        ourMesh.isPickable = false;

        return ourMesh;
    }
}

