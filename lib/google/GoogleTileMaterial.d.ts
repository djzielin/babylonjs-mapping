import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { Scene } from "@babylonjs/core/scene.js";
/** Per-mesh albedo for the shared material. */
export interface GoogleTileTextureOwner {
    googleTexture?: BaseTexture;
}
/**
 * One unlit material shared by every photorealistic tile. Babylon binds the
 * effect once per frame and each tile only changes its world matrix and
 * albedo, which keeps the per-draw CPU cost to a minimum. Scene fog (EXP2)
 * is honoured so tiles blend with the rest of the map at long range.
 */
export declare function createGoogleTileMaterial(scene: Scene): ShaderMaterial;
