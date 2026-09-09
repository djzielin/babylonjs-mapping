import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
/** Prefer detailed models only where their actual geometry covers a footprint. */
export default class BuildingReplacementIndex {
    private meshes;
    setModels(meshes: Mesh[]): void;
    keepFootprint(mesh: Mesh, up?: Vector3, rayLength?: number): boolean;
}
