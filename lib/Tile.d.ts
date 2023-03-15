import { Vector2 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
export default class Tile {
    mesh: Mesh;
    material: StandardMaterial;
    tileCoords: Vector3;
    buildings: Mesh[];
    dem: number[];
    demDimensions: Vector2;
    minHeight: number;
    maxHeight: number;
    terrainLoaded: boolean;
    eastSeamFixed: boolean;
    northSeamFixed: boolean;
    northEastSeamFixed: boolean;
    deleteBuildings(): void;
}
