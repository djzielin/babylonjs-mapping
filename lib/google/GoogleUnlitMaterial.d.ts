import type { IMaterial } from "babylonjs-gltf2interface";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Scene } from "@babylonjs/core/scene.js";
/** Experimental opt-in shader correction for the opaque glTF unlit subset. */
export declare class GoogleUnlitLinearPlugin extends MaterialPluginBase {
    private readonly standard;
    constructor(standard: StandardMaterial);
    isCompatible(language: ShaderLanguage): boolean;
    prepareDefines(defines: MaterialDefines): void;
    getCustomCode(shaderType: string, language?: ShaderLanguage): Record<string, string> | null;
}
/** Separate opt-in experiment; undefined leaves the caller on native PBR.
 * Inputs are the original glTF material and untouched native atlas. Fog and
 * unsupported material states remain on PBR. Do not enable fog on this subset.
 */
export declare function tryCreateGoogleUnlitMaterial(name: string, scene: Scene, source: IMaterial, baseColorTexture?: Texture): StandardMaterial | undefined;
