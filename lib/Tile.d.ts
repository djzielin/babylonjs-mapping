import { Vector2 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Material } from "@babylonjs/core";
export default class Tile {
    mesh: Mesh;
    material: Material;
    tileCoords: Vector3;
    colRow: Vector2;
    dem: number[];
    demDimensions: Vector2;
    minHeight: number;
    maxHeight: number;
    eastSeamFixed: boolean;
    northSeamFixed: boolean;
    northEastSeamFixed: boolean;
}
