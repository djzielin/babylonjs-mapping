import { Vector3 } from "@babylonjs/core/Maths/math.js";
import { Scene } from "@babylonjs/core";
import type Buildings from "./Buildings.js";
import type Tile from '../core/Tile.js';
import type TileSet from "../core/TileSet.js";
import { EPSG_Type } from "../core/TileMath.js";
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
export interface multiPolygonSet extends Array<polygonSet> {
}
export interface polygonSet extends Array<coordinateSet> {
}
export interface coordinateSet extends Array<coordinatePair> {
}
export interface coordinatePair extends Array<number> {
}
export interface coordinateArray extends Array<Vector3> {
}
export interface coordinateArrayOfArrays extends Array<coordinateArray> {
}
export declare class GeoJSON {
    private tileSet;
    private scene;
    constructor(tileSet: TileSet, scene: Scene);
    private computeOffset;
    /**
     * Converts a source-coordinate line into a polygon in game coordinates.
     * Doing the offset after projection makes lineWidth mean the same thing for
     * EPSG:4326 and EPSG:3857 inputs.
     */
    private convertLineToGamePolygon;
    generateSingleBuilding(shapeType: string, f: feature, epsg: EPSG_Type, tile: Tile, flipWinding: boolean, buildings: Buildings): void;
    private addBuildingLOD;
    private validateBuildingLODOptions;
    private convertLinetoArray;
    private processSinglePolygon;
    private processSinglePolygonInGameCoordinates;
}
