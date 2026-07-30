import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { coordinateArrayOfArrays } from "./GeoJSON.js";
export type SupportedRoofShape = "gabled" | "hipped" | "pyramidal" | "skillion";
export interface RoofSpec {
    shape: SupportedRoofShape;
    height: number;
    direction?: number;
}
/**
 * Resolve the subset of roof tags that can be generated from a footprint
 * alone. OSM Buildings uses camelCase/raw OSM keys, while Overture uses
 * snake_case schema fields.
 */
export declare function resolveRoofSpec(properties: Record<string, unknown>, totalHeight: number): RoofSpec | undefined;
export declare function createRoofMesh(rings: coordinateArrayOfArrays, spec: RoofSpec, baseHeight: number, heightScale: number, material: StandardMaterial, scene: Scene): Mesh | undefined;
