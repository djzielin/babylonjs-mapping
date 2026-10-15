import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import type GlobeSet from "./GlobeSet.js";
import type { TileBatchShader } from "../shared/TileBatch.js";
/**
 * TileBatch's shader for imagery on a globe, drawing the sea, whose imagery
 * changes colour between levels of detail and sources, as one water.
 */
export declare function globeWaterShader(globe: GlobeSet, camera: () => Camera | null | undefined, waterColor: Color3): TileBatchShader;
/** Deep coastal water, close to Google's imagery of it at the finest level. */
export declare const WATER_COLOR: Color3;
