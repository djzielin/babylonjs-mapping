import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import Tile from "./Tile.js";
import { coordinateArrayOfArrays } from "../buildings/GeoJSON.js";
export interface LineSegment {
    p1: Vector2;
    p2: Vector2;
}
export interface LineTestReturnPacket {
    p: Vector3;
    dir1: Vector3;
    dir2: Vector3;
}
export interface LineSegmentArray extends Array<LineSegment> {
}
export default class TileBuilding {
    mesh: Mesh;
    tile: Tile;
    isBBoxContainedOnTile: boolean;
    ShapeType: String;
    LineArray: coordinateArrayOfArrays;
    LineSegments: LineSegmentArray;
    vertices: Vector3[];
    /** @deprecated Use vertices. */
    verticies: Vector3[];
    private tm;
    constructor(mesh: Mesh, tile: Tile);
    computeLineSegments(): void;
    private computeDir;
    findLineIntersectionPoint(otherStreet: TileBuilding): LineTestReturnPacket | false;
    dispose(): void;
    getVertices(): void;
    /** @deprecated Use getVertices. */
    getVerticies(): void;
    computeBuildingBoxInsideTile(): void;
    doVerticesMatch(otherBuilding: TileBuilding): boolean;
}
