import { Vector3 } from "@babylonjs/core/Maths/math.js";
import { Scene } from "@babylonjs/core/scene.js";
import type Buildings from "./Buildings.js";
import type Tile from '../core/Tile.js';
import type TileSet from "../core/TileSet.js";
import { EPSG_Type } from "../core/TileMath.js";
export interface topLevel {
    "type": string;
    "features": feature[];
    "crs"?: coordinateReferenceSystem | string | null;
}
export interface coordinateReferenceSystem {
    "type"?: string;
    "properties"?: {
        "name"?: string;
        "href"?: string;
        "code"?: string | number;
    };
}
export interface feature {
    "id": string;
    "type": string;
    "properties": Record<string, unknown> | null;
    "geometry": geometry | null;
}
export interface propertiesOSM {
    "name": string;
    "type": string;
    "height": number;
    "levels": number;
    "roofShape"?: string;
    "roofHeight"?: number;
    "roofLevels"?: number;
    "roofDirection"?: number;
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
/**
 * Detects the supported coordinate system declared by a GeoJSON CRS entry.
 * Returns undefined for missing or unsupported CRS declarations so callers can
 * preserve their existing explicit-projection fallback.
 */
export declare function detectProjection(document: Pick<topLevel, "crs">): EPSG_Type | undefined;
export declare class GeoJSON {
    private tileSet;
    private scene;
    constructor(tileSet: TileSet, scene: Scene);
    /** Build bounded road quads so a winding road cannot triangulate across a block. */
    private createLineSegmentsMesh;
    generateSingleBuilding(shapeType: string, f: feature, epsg: EPSG_Type, tile: Tile, flipWinding: boolean, buildings: Buildings): void;
    private addBuildingLOD;
    private validateBuildingLODOptions;
    private convertLinetoArray;
    private processSinglePolygon;
    private processSinglePolygonInGameCoordinates;
}
