import { Vector2, Vector3 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import Tile from "./Tile";
import { coordinateArrayOfArrays } from "./GeoJSON";
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
    verticies: Vector3[];
    private tm;
    constructor(mesh: Mesh, tile: Tile);
    computeLineSegments(): void;
    private computeDir;
    findLineIntersectionPoint(otherStreet: TileBuilding): LineTestReturnPacket | false;
    dispose(): void;
    getVerticies(): void;
    computeBuildingBoxInsideTile(): void;
    doVerticesMatch(otherBuilding: TileBuilding): boolean;
}
