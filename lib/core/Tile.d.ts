import { Vector2 } from "@babylonjs/core/Maths/math.js";
import { Vector3 } from "@babylonjs/core/Maths/math.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type TileBuilding from "./TileBuilding.js";
import { BoundingBox } from "@babylonjs/core/Culling/boundingBox.js";
import type TileSet from "./TileSet.js";
export default class Tile {
    mesh: Mesh;
    tileSet: TileSet;
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
    /** Sampled radial elevation in world units, north-to-south row order. */
    elevationHeights?: number[];
    eastSeamFixed: boolean;
    northSeamFixed: boolean;
    northEastSeamFixed: boolean;
    terrainLODMeshes: Array<Mesh | null>;
    constructor(mesh: Mesh, tileSet: TileSet);
    /** Refresh world-space bounds after moving a tile, including frozen meshes. */
    refreshBoundingBox(): void;
    deleteBuildings(): void;
    clearTerrainLOD(): void;
    hideIndividualBuildings(): void;
    getAllBuildingMeshes(): Mesh[];
    isBuildingInsideTileBoundingBox(m: Mesh): boolean;
}
