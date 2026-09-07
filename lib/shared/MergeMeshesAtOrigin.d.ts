import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
/** Batch meshes without baking planet-sized translations into Float32 vertices. */
export declare function mergeMeshesAtOrigin(meshes: Mesh[], origin: Vector3): Mesh | null;
