import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type GlobeSet from "../core/GlobeSet.js";
import type { feature } from "./GeoJSON.js";
/** Direct flat-roof extrusion; no intermediate Babylon meshes or world matrices. */
export declare class GlobeBuildingBatch {
    private globe;
    readonly origin: Vector3;
    readonly positions: number[];
    readonly normals: number[];
    readonly indices: number[];
    featureCount: number;
    readonly ranges: {
        latitude: number;
        longitude: number;
        start: number;
        end: number;
    }[];
    constructor(globe: GlobeSet, origin: Vector3);
    private vertex;
    private triangle;
    append(feature: feature, defaultHeight: number, exaggeration: number): void;
    vertexData(): VertexData;
}
