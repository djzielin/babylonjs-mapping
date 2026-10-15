import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type GlobeSet from "./GlobeSet.js";
export interface GlobeAtmosphereOptions {
    /** Scale height of the haze in metres; larger is a thicker, softer glow. Defaults to 20 km. */
    scaleHeight?: number;
    /** Drive scene fog to match the horizon. Defaults to true. */
    fog?: boolean;
}
/**
 * Sky, horizon haze and the glow around the planet seen from orbit, from a
 * single analytic atmosphere. It draws only where nothing else has, after
 * all other rendering groups, and sets the scene's exponential fog to the
 * same haze so distant ground fades into the sky.
 */
/**
 * Cap on how far light fades with depth, in the compressed depth scale the
 * water and the sea floor share: real light vanishes a few hundred metres
 * down, which would leave trenches black.
 */
export declare const DEEPEST_DARKENING = 110;
export default class GlobeAtmosphere {
    readonly globe: GlobeSet;
    readonly mesh: Mesh;
    /** Horizon visibility at sea level, in metres. */
    visibility: number;
    /** Visibility beneath the sea, in metres. */
    underwaterVisibility: number;
    /** Colour of the water just below the surface; it darkens with depth. */
    readonly waterColor: Color3;
    /** Metres below sea level of the camera; 0 above it. */
    private depth;
    private readonly surfaceLight;
    private readonly material;
    private readonly scaleHeight;
    private readonly observer;
    private readonly inverse;
    private readonly rotation;
    private readonly beta;
    private readonly tint;
    private readonly ground;
    constructor(globe: GlobeSet, options?: GlobeAtmosphereOptions);
    /** Colour of the sky seen from `position` (world) along `direction`. */
    colorAt(position: Vector3, direction: Vector3, result?: Color3): Color3;
    dispose(): void;
    private bind;
    /**
     * Fog matching the horizon haze, thinning with altitude: dense enough
     * near the ground to soften the distance, gone from orbit.
     */
    private updateFog;
}
