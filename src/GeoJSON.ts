import { Vector3 } from "@babylonjs/core/Maths/math";
import { Vector2 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder"
import { Scene } from "@babylonjs/core";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import Earcut from 'earcut';

import Tile from './Tile';
import TileSet from "./TileSet";
import { ProjectionType } from "./TileMath";
import TileMath from "./TileMath";
import TileBuilding from "./TileBuilding";

export interface topLevel {
    "type": string;
    "features": feature[];
}

export interface feature {
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

export interface coordinateArray extends Array<Vector3> { } 
export interface coordinateArrayOfArrays extends Array<coordinateArray> {  }

export class GeoJSON {
    constructor(private tileSet: TileSet, private scene: Scene) {
    }
    
    /*private getFirstCoordinateWorld(f: feature, projection: ProjectionType, zoom?: number): Vector3 {
        if (zoom === undefined) {
            zoom = this.tileSet.zoom;
        }

        if (f.geometry.type == "Polygon") {
            const ps: polygonSet = f.geometry.coordinates as polygonSet;
            return this.getFirstCoordinateWorldFromPolygonSet(ps, projection);
        }
        else if (f.geometry.type == "MultiPolygon") {
            const mp: multiPolygonSet = f.geometry.coordinates as multiPolygonSet;
            return this.getFirstCoordinateWorldFromPolygonSet(mp[0], projection);
        }
        else {
            console.error("unknown geometry type: " + f.geometry.type);
        }

        return new Vector3(0,0,0);
    }

    private getFirstCoordinateWorldFromPolygonSet(ps: polygonSet, projection: ProjectionType, zoom?: number): Vector3 {
        const v2 = new Vector2(ps[0][0][0], ps[0][0][1]);
        return this.tileSet.ourTileMath.GetWorldPosition(v2, projection, zoom)
    }

    public getFirstCoordinateTile(f: feature, projection: ProjectionType, zoom: number): Vector3 {
        if (zoom === undefined) {
            zoom = this.tileSet.zoom;
        }

        if (f.geometry.type == "Polygon") {
            const ps: polygonSet = f.geometry.coordinates as polygonSet;
            return this.getFirstCoordinateTileFromPolygonSet(ps, projection, zoom);
        }
        else if (f.geometry.type == "MultiPolygon") {
            const mp: multiPolygonSet = f.geometry.coordinates as multiPolygonSet;
            return this.getFirstCoordinateTileFromPolygonSet(mp[0], projection, zoom);
        }
        else {
            console.error("unknown geometry type: " + f.geometry.type);
        }

        return new Vector3(0,0,0);
    }

    private getFirstCoordinateTileFromPolygonSet(ps: polygonSet, projection: ProjectionType, zoom: number): Vector3 {
        const v2 = new Vector2(ps[0][0][0], ps[0][0][1]);
        const tileXY= this.tileSet.ourTileMath.GetTilePosition(v2, projection, zoom); //lat lon
        return new Vector3(tileXY.x, tileXY.y, zoom);
    }*/

    private convertCoordinatePairToVector2(cp:coordinatePair):Vector2{
        const v1=new Vector2(cp[0],cp[1]);
        return v1;
    }

    private convertVector2ToCoordinatePair(v: Vector2): coordinatePair{
        const cp:coordinatePair=[];
        cp.push(v.x);
        cp.push(v.y);

        return cp;
    }

    private computeOffset(v1: Vector2, v2: Vector2, lineWidth: number): Vector2 {
        const diff = v2.subtract(v1);
        const perp = new Vector2(diff.y*-1.0,diff.x*1.0);
        const perpNormalized = perp.normalize();
        const halfLineWidth=lineWidth*0.5;
        const offset = perpNormalized.multiplyByFloats(halfLineWidth, halfLineWidth); //TODO: Make this a parameter (ie line width)

        return offset;
    }

    private convertLineToPolygonSet(cs: coordinateSet, lineWidth: number): polygonSet {
        const newPS: polygonSet = [];

        //if(doVerbose) console.log("original line has number of points: " + cs.length);

        const newCS:coordinateSet=[];


        for (let p=0;p<cs.length-1;p++){ //go forward down the line
            const v1=this.convertCoordinatePairToVector2(cs[p]);
            const v2=this.convertCoordinatePairToVector2(cs[p+1]);

            const offset=this.computeOffset(v1,v2, lineWidth);

            const newV1=v1.add(offset);
            const newV2=v2.add(offset);

            newCS.push(this.convertVector2ToCoordinatePair(newV1));
            newCS.push(this.convertVector2ToCoordinatePair(newV2));            
        }

        for (let p=cs.length-1;p>0;p--){ //now lets go back towards the start

            const v1=this.convertCoordinatePairToVector2(cs[p]);
            const v2=this.convertCoordinatePairToVector2(cs[p-1]);

            const offset=this.computeOffset(v1,v2, lineWidth);

            const newV1=v1.add(offset);
            const newV2=v2.add(offset);

            newCS.push(this.convertVector2ToCoordinatePair(newV1));
            newCS.push(this.convertVector2ToCoordinatePair(newV2));            
        }

        newCS.push(newCS[0]); //add starting coord to close the loop
        newPS.push(newCS);

        return newPS;
    }

    public generateSingleBuilding(shapeType: string, f: feature, projection: ProjectionType, tile: Tile, buildingMaterial: StandardMaterial, exaggeration: number, defaultBuildingHeight: number, flipWinding: boolean, lineWidth: number, pointDiameter: number) {
        let finalMesh: Mesh | null = null;
        const arrayOfLines: coordinateArrayOfArrays=[];

        let height = defaultBuildingHeight;
        if (f.properties.height !== undefined) {
            height = f.properties.height;
        }
        if(f.properties.Story !== undefined){
            let stories=f.properties.Story;
            if(stories==0){ //0 just means undefined
                stories=1;
            }
            height = (stories+0.5) * 3.0; //not sure if we should do this to account for roof height?
        }

        if (f.geometry.type == "Polygon") {
            const ps: polygonSet = f.geometry.coordinates as polygonSet;
            finalMesh = this.processSinglePolygon(ps, projection, buildingMaterial, exaggeration, height, flipWinding);
        }
        else if(f.geometry.type=="Point") {
            const cp: coordinatePair = f.geometry.coordinates as coordinatePair;
            const v = new Vector2(cp[0], cp[1]);
            const pos = this.tileSet.ourTileMath.GetWorldPosition(v, projection);

            const sphere = MeshBuilder.CreateSphere("sphere", { diameter: pointDiameter }, this.scene);
            
            sphere.position = pos;
            finalMesh=sphere;
        }
        else if (f.geometry.type == "MultiPolygon" || f.geometry.type=="MultiLineString") {

            const allMeshes: Mesh[] = [];

            if (f.geometry.type == "MultiPolygon") {
                const mp: multiPolygonSet = f.geometry.coordinates as multiPolygonSet;

                for (let i = 0; i < mp.length; i++) {
                    const singleMesh = this.processSinglePolygon(mp[i], projection, buildingMaterial, exaggeration, height, flipWinding);
                    allMeshes.push(singleMesh);
                }
            } 
            if(f.geometry.type=="MultiLineString"){
                //console.log("NEW GEOMETRY TYPE: MultiLineString");

                const ps: polygonSet = f.geometry.coordinates as polygonSet;
                //console.log("lineset set of length: " + ps.length);              

                for (let i = 0; i < ps.length; i++) {
                    //console.log("  we are looking at lineset: " + i);
                    const cs:coordinateSet=ps[i];

                    const newPS: polygonSet=this.convertLineToPolygonSet(cs, lineWidth);     
                    const lineArray: coordinateArray = this.convertLinetoArray(cs,projection);
                    arrayOfLines.push(lineArray);

                    const singleMesh = this.processSinglePolygon(newPS, projection, buildingMaterial, exaggeration, height, flipWinding);
                    allMeshes.push(singleMesh);
                }
            }

            if (allMeshes.length == 0) {
                console.error("found 0 meshes for MultiPolygon, something went wrong in JSON parsing!");
            }
            else if (allMeshes.length == 1) {
                finalMesh = allMeshes[0];
            } else {
                const merged = Mesh.MergeMeshes(allMeshes);
                if (merged) {
                    finalMesh = merged;
                } else {
                    console.error("unable to merge meshes!");
                }
            }
        } else {
            //TODO: support other geometry types? 
            console.error("unknown building geometry type: " + f.geometry.type);
        }

        if(finalMesh==null){
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

        if (f.properties.Name !== undefined) { //NOTE: this is not a mistake, look closely and you can see .name vs .Name
            finalMesh.name = f.properties.Name;
        }


        const building=new TileBuilding(finalMesh,tile);

     
        building.ShapeType=shapeType;

        if(building.isBBoxContainedOnTile==false){
            //TODO: check if building is a duplicate
            if(this.tileSet.isBuildingDuplicate(building)){
                console.log("building already exists on another tile! deleting!");
                building.dispose();
                return;
            }
        }

        console.log("building is an original, adding to tile!");

        if(arrayOfLines.length>0){
            building.LineArray=arrayOfLines;
            building.computeLineSegments();
        }

        tile.buildings.push(building);


        console.log("created " + finalMesh.name);
    }

    private convertLinetoArray (cs: coordinateSet, projection: ProjectionType): coordinateArray {
        const vArray: coordinateArray=[];


        for (let p=0;p<cs.length;p++){ //go forward down the line
            
            const x=cs[p][0];
            const y=cs[p][1];

            const v2=new Vector2(x,y);

            const coord = this.tileSet.ourTileMath.GetWorldPosition(v2, projection);

            vArray.push(coord);
        }
        return vArray;
    }

    private processSinglePolygon(ps: polygonSet, projection: ProjectionType, buildingMaterial: StandardMaterial, exaggeration: number, height: number, flipWinding: boolean): Mesh {
        const holeArray: Vector3[][] = [];
        const positions3D: Vector3[] = [];

        for (let i = 0; i < ps.length; i++) {
            const hole: Vector3[] = [];

            //skip final coord (as it seems to duplicate the first)
            //also need to do this backwards to get normals / winding correct

            if (flipWinding == false) {
                for (let e = ps[i].length - 2; e >= 0; e--) {

                    const v2 = new Vector2(ps[i][e][0], ps[i][e][1]);
                    const coord = this.tileSet.ourTileMath.GetWorldPosition(v2, projection);

                    if (i == 0) {
                        positions3D.push(coord);
                    } else {
                        hole.push(coord);
                    }
                }
            } else {
                for (let e = 0; e < ps[i].length-1; e++) {

                    const v2 = new Vector2(ps[i][e][0], ps[i][e][1]);
                    const coord = this.tileSet.ourTileMath.GetWorldPosition(v2, projection);

                    if (i == 0) {
                        positions3D.push(coord);
                    } else {
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
            this.scene);

        ourMesh.position.y = height * heightScaleFixer;
        ourMesh.material = buildingMaterial; //all buildings will use same material
        ourMesh.isPickable = false;

        return ourMesh;
    }    
}

