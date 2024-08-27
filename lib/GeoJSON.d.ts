import { Vector3 } from "@babylonjs/core/Maths/math";
import { Scene } from "@babylonjs/core";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import Tile from './Tile';
import TileSet from "./TileSet";
import { ProjectionType } from "./TileMath";
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
    private convertCoordinatePairToVector2;
    private convertVector2ToCoordinatePair;
    private computeOffset;
    private convertLineToPolygonSet;
    generateSingleBuilding(shapeType: string, f: feature, projection: ProjectionType, tile: Tile, buildingMaterial: StandardMaterial, exaggeration: number, defaultBuildingHeight: number, flipWinding: boolean, lineWidth: number, pointDiameter: number): void;
    private convertLinetoArray;
    private processSinglePolygon;
}
