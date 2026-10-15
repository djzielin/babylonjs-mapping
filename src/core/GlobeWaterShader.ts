import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import type GlobeSet from "./GlobeSet.js";
import type { TileBatchShader } from "../shared/TileBatch.js";

const NAME = "globeWaterTile";

// TileBatch's default shader, plus each point's height above sea level on the
// globe. The height comes from camera-relative positions and a precomputed
// |eye|^2 - R^2, so it stays exact to millimetres in float32.
Effect.ShadersStore[`${NAME}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 tileWorld;
uniform mat4 tileViewProjection;
uniform vec3 eyeCenter;
uniform float eyeK;
uniform float globeRadius;
uniform float unitMetres;
varying vec2 vUV;
varying float vFogDistance;
varying vec3 vRelative;
varying float vHeight;
#ifdef CLIP
uniform vec3 clipCenter;
varying vec3 vClip;
#endif
void main(void) {
    vec4 relative = tileWorld * vec4(position, 1.0);
    gl_Position = tileViewProjection * relative;
    vUV = uv;
    vFogDistance = length(relative.xyz);
    vRelative = relative.xyz;
    vec3 r = relative.xyz;
    vHeight = (eyeK + 2.0 * dot(eyeCenter, r) + dot(r, r)) / (length(eyeCenter + r) + globeRadius) * unitMetres;
#ifdef CLIP
    vClip = relative.xyz - clipCenter;
#endif
}`;

// Satellite imagery of the sea differs between levels of detail and between
// sources (Google's is dark at its finest, pale or violet coarser), so
// neighbouring tiles make a patchwork. Water-coloured pixels at sea level
// are pulled toward one colour, which keeps the photographs but softens the
// patchwork, and reflect the sky toward the horizon. Boats, foam and anything
// above sea level keep their imagery untouched.
Effect.ShadersStore[`${NAME}FragmentShader`] = `
precision highp float;
uniform sampler2D albedo;
uniform vec3 fogColor;
uniform float fogDensity;
uniform vec3 eyeCenter;
uniform vec3 waterColor;
uniform float unitMetres;
varying vec2 vUV;
varying float vFogDistance;
varying vec3 vRelative;
varying float vHeight;
#ifdef CLIP
uniform float clipRadius;
varying vec3 vClip;
#endif
void main(void) {
#ifdef CLIP
    if (dot(vClip, vClip) > clipRadius * clipRadius) discard;
#endif
    vec3 color = texture2D(albedo, vUV).rgb;
    // Water lies within a metre or two of sea level up close. Distant tiles
    // are coarser and approximate the sea surface less closely, which only
    // unmistakably blue water may make up for.
    float distance = vFogDistance * unitMetres;
    float near = 1.5 + 0.0004 * distance, far = 4.0 + 0.002 * distance;
    float level = 1.0 - smoothstep(near, 1.5 * near, abs(vHeight));
    float roughLevel = 1.0 - smoothstep(far, 2.5 * far, abs(vHeight));
    // Blue or teal, or dark and grey like a river's silt; sand, vegetation,
    // foam and boats keep their imagery.
    float luma = dot(color, vec3(0.3, 0.55, 0.15));
    // Light water must be clearly blue: blue-grey roofs of low-lying cities are not water.
    float blueness = 0.03 + 0.25 * max(luma - 0.3, 0.0);
    float blue = smoothstep(blueness, blueness + 0.07, color.b - color.r) * smoothstep(-0.08, -0.02, color.g - color.r);
    float murky = (1.0 - smoothstep(0.3, 0.4, luma)) * (1.0 - smoothstep(0.04, 0.08, color.r - color.b))
        * (1.0 - smoothstep(0.03, 0.06, color.g - max(color.r, color.b)));
    float water = max(blue * roughLevel, murky * level);
    if (water > 0.0) {
        // The photographed water, pulled most of the way toward one colour: swell,
        // wakes and shallows stay, while the patchwork of captures and
        // levels of detail it is assembled from fades to a whisper.
        vec3 matched = mix(color, waterColor, 0.7);
        // Toward the horizon water mirrors the sky.
        vec3 up = normalize(eyeCenter + vRelative);
        float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(up, normalize(-vRelative)), 0.0), 5.0);
        color = mix(color, mix(matched, fogColor, fresnel), water);
    }
    float fog = clamp(exp(-pow(fogDensity * vFogDistance, 2.0)), 0.0, 1.0);
    gl_FragColor = vec4(mix(fogColor, color, fog), 1.0);
}`;

/**
 * TileBatch's shader for imagery on a globe, drawing the sea, whose imagery
 * changes colour between levels of detail and sources, as one water.
 */
export function globeWaterShader(globe: GlobeSet, camera: () => Camera | null | undefined, waterColor: Color3): TileBatchShader {
    return {
        name: NAME,
        uniforms: ["eyeCenter", "eyeK", "globeRadius", "unitMetres", "waterColor"],
        bind: effect => {
            const eye = camera()?.globalPosition;
            if (!eye) return;
            const radius = globe.radius, distance = eye.length();
            effect.setFloat3("eyeCenter", eye.x, eye.y, eye.z);
            effect.setFloat("eyeK", (distance - radius) * (distance + radius));
            effect.setFloat("globeRadius", radius);
            effect.setFloat("unitMetres", 1 / globe.metresToWorld);
            effect.setColor3("waterColor", waterColor);
        },
    };
}

/** Deep coastal water, close to Google's imagery of it at the finest level. */
export const WATER_COLOR = new Color3(0.075, 0.2, 0.23);
