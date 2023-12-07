import { Vector2 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import TileBuilding from "./TileBuilding";
import { BoundingBox } from "@babylonjs/core/Culling/boundingBox";
export default class Tile {
    mesh: Mesh;
    material: StandardMaterial;
    tileCoords: Vector3;
    box2D: BoundingBox;
    buildings: TileBuilding[];
    mergedBuildingMesh: Mesh | undefined;
    dem: number[];
    demDimensions: Vector2;
    minHeight: number;
    maxHeight: number;
    terrainLoaded: boolean;
    eastSeamFixed: boolean;
    northSeamFixed: boolean;
    northEastSeamFixed: boolean;
    constructor(mesh: Mesh);
    deleteBuildings(): void;
    hideIndividualBuildings(): void;
    getAllBuildingMeshes(): Mesh[];
    isBuildingInsideTileBoundingBox(m: Mesh): Boolean;
}
