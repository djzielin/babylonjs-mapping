import { Effect } from "@babylonjs/core/Materials/effect.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { Scene } from "@babylonjs/core/scene.js";

const NAME = "googlePhotorealisticTile";

Effect.ShadersStore[`${NAME}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 view;
uniform mat4 viewProjection;
varying vec2 vUV;
varying float vFogDistance;
void main(void) {
    vec4 worldPosition = world * vec4(position, 1.0);
    gl_Position = viewProjection * worldPosition;
    vUV = uv;
    vFogDistance = length((view * worldPosition).xyz);
}`;

Effect.ShadersStore[`${NAME}FragmentShader`] = `
precision highp float;
uniform sampler2D albedo;
uniform vec3 fogColor;
uniform float fogDensity;
varying vec2 vUV;
varying float vFogDistance;
void main(void) {
    vec3 color = texture2D(albedo, vUV).rgb;
    float fog = clamp(exp(-pow(fogDensity * vFogDistance, 2.0)), 0.0, 1.0);
    gl_FragColor = vec4(mix(fogColor, color, fog), 1.0);
}`;

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
export function createGoogleTileMaterial(scene: Scene): ShaderMaterial {
    const material = new ShaderMaterial(NAME, scene, NAME, {
        attributes: ["position", "uv"],
        uniforms: ["world", "view", "viewProjection", "fogColor", "fogDensity"],
        samplers: ["albedo"],
        needAlphaBlending: false,
    });
    material.checkReadyOnlyOnce = true;
    // ECEF is right-handed and Babylon's world is left-handed, so every tile
    // transform mirrors its geometry and reverses the winding. ShaderMaterial
    // does not compensate for mirrored world matrices, so cull the opposite side.
    material.cullBackFaces = false;
    material.onBindObservable.add((mesh: AbstractMesh) => {
        const effect = material.getEffect();
        if (!effect) return;
        // Effects cache uniform values, so these are no-ops after the first tile.
        effect.setColor3("fogColor", scene.fogColor);
        effect.setFloat("fogDensity", scene.fogEnabled && scene.fogMode === Scene.FOGMODE_EXP2 ? scene.fogDensity : 0);
        effect.setTexture("albedo", (mesh as AbstractMesh & GoogleTileTextureOwner).googleTexture ?? null);
    });
    return material;
}
