import { Vector3 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import Tile from "./Tile";
export default class TileBuilding {
    mesh: Mesh;
    tile: Tile;
    isBBoxContainedOnTile: boolean;
    verticies: Vector3[];
    constructor(mesh: Mesh, tile: Tile);
    dispose(): void;
    getVerticies(): void;
    computeBuildingBoxInsideTile(): void;
    doVerticesMatch(otherBuilding: TileBuilding): boolean;
}
