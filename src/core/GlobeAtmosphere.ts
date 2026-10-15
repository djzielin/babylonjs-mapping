import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type { Observer } from "@babylonjs/core/Misc/observable.js";
import { RenderingManager } from "@babylonjs/core/Rendering/renderingManager.js";
import { Scene } from "@babylonjs/core/scene.js";
import type GlobeSet from "./GlobeSet.js";

const NAME = "globeAtmosphere";
const EARTH_RADIUS = 6378137;

// A full-screen triangle pair at the far plane. Each pixel's view ray is
// traced through an exponential atmosphere in units of the planet's radius.
Effect.ShadersStore[`${NAME}VertexShader`] = `
precision highp float;
attribute vec3 position;
uniform mat4 inverseViewProjection;
varying vec3 vDirection;
void main(void) {
    gl_Position = vec4(position.xy, 0.999999, 1.0);
    vec4 far = inverseViewProjection * vec4(position.xy, 1.0, 1.0);
    vDirection = far.xyz / far.w;
}`;

Effect.ShadersStore[`${NAME}FragmentShader`] = `
precision highp float;
uniform vec3 eye;
uniform float scaleHeight;
uniform vec3 beta;
uniform vec3 tint;
uniform vec3 groundColor;
uniform vec3 fogColor;
// Scene fog density per planet radius, so ground the surface does not reach matches ground it does.
uniform float fogDensity;
uniform float underwater;
uniform vec3 surfaceLight;
uniform float time;
varying vec3 vDirection;
// Mirrored by GlobeAtmosphere.colorAt.
vec3 sky(vec3 d) {
    float r = length(eye);
    float b = dot(eye, d);
    float t = max(0.0, -b);
    float p = length(eye + d * t);
    // Air along the ray, in vertical air masses: density at the lowest point
    // times the length of the path through the layer near that point.
    float path = sqrt(6.2831853 * p * scaleHeight);
    if (b >= 0.0) path = min(path, scaleHeight / max(dot(d, eye / r), 1e-4));
    float depth = exp(-max(p - 1.0, 0.0) / scaleHeight) * path / scaleHeight;
    vec3 air = (1.0 - exp(-depth * beta)) * tint;
    // Rays into the ground show the sea until the surface draws over them,
    // fogged as the surface would be at that distance.
    if (b < 0.0 && p < 1.0) {
        vec3 ground = mix(groundColor, air, clamp(1.0 - exp(-depth * 0.02), 0.0, 1.0));
        float hit = t - sqrt(1.0 - p * p);
        float fog = 1.0 - exp(-pow(hit * fogDensity, 2.0));
        return mix(ground, fogColor, fog);
    }
    return air;
}
// Beneath the sea: water in every direction, lighter upward, and the bright
// disc of Snell's window where rays reach the surface within ~49 degrees of
// vertical (beyond it the surface mirrors the dark water below).
vec3 water(vec3 d) {
    float r = length(eye);
    vec3 up = eye / r;
    float mu = dot(d, up);
    vec3 color = fogColor * (1.0 + 0.45 * mu);
    if (mu <= 0.0) return color;
    float distance = (1.0 - r) / mu;
    // Ripples, in the tangent plane around the camera.
    vec3 east = normalize(cross(up, vec3(0.0, 1.0, 0.0)) + vec3(1e-6));
    vec2 hit = vec2(dot(d, east), dot(d, cross(east, up))) * distance * 6378137.0;
    float shimmer = 0.82 + 0.18 * sin(hit.x * 0.9 + time * 1.3) * sin(hit.y * 1.1 - time * 1.1);
    float window = smoothstep(0.61, 0.69, mu);
    vec3 surface = mix(color * 1.5, surfaceLight * shimmer, window);
    float fog = 1.0 - exp(-pow(distance * fogDensity, 2.0));
    return mix(surface, color, fog);
}

void main(void) {
    vec3 d = normalize(vDirection);
    gl_FragColor = vec4(underwater > 0.5 ? water(d) : sky(d), 1.0);
}`;

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
export const DEEPEST_DARKENING = 110;

export default class GlobeAtmosphere {
    public readonly mesh: Mesh;
    /** Horizon visibility at sea level, in metres. */
    public visibility = 60_000;
    /** Visibility beneath the sea, in metres. */
    public underwaterVisibility = 12_000;
    /** Colour of the water just below the surface; it darkens with depth. */
    public readonly waterColor = new Color3(0.04, 0.25, 0.34);
    /** Metres below sea level of the camera; 0 above it. */
    private depth = 0;
    private readonly surfaceLight = new Color3();
    private readonly material: ShaderMaterial;
    private readonly scaleHeight: number;
    private readonly observer: Observer<Scene>;
    private readonly inverse = new Matrix();
    private readonly rotation = new Matrix();
    private readonly beta = new Vector3(0.3, 0.56, 1.0);
    private readonly tint = new Vector3(0.74, 0.86, 1.0);
    private readonly ground = new Vector3(0.03, 0.08, 0.14);

    public constructor(public readonly globe: GlobeSet, options: GlobeAtmosphereOptions = {}) {
        const scene = globe.scene;
        this.scaleHeight = (options.scaleHeight ?? 20_000) / EARTH_RADIUS;
        const group = RenderingManager.MAX_RENDERINGGROUPS;
        RenderingManager.MAX_RENDERINGGROUPS = group + 1;
        scene.setRenderingAutoClearDepthStencil(group, false);

        this.mesh = new Mesh("globe atmosphere", scene);
        const quad = new VertexData();
        quad.positions = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
        quad.indices = [0, 1, 2, 0, 2, 3];
        quad.applyToMesh(this.mesh);
        this.mesh.alwaysSelectAsActiveMesh = true;
        this.mesh.doNotSyncBoundingInfo = true;
        this.mesh.isPickable = false;
        // Last: the sky fills only pixels nothing else has covered.
        this.mesh.renderingGroupId = group;
        this.material = new ShaderMaterial(NAME, scene, NAME, {
            attributes: ["position"],
            uniforms: ["inverseViewProjection", "eye", "scaleHeight", "beta", "tint", "groundColor", "fogColor", "fogDensity", "underwater", "surfaceLight", "time"],
        });
        this.material.backFaceCulling = false;
        this.material.disableDepthWrite = true;
        this.material.depthFunction = Constants.LEQUAL;
        this.mesh.material = this.material;
        this.material.onBindObservable.add(() => this.bind(scene.activeCamera));

        if (options.fog !== false) {
            scene.fogMode = Scene.FOGMODE_EXP2;
            this.observer = scene.onBeforeRenderObservable.add(() => this.updateFog());
        } else this.observer = scene.onBeforeRenderObservable.add(() => undefined);
    }

    /** Colour of the sky seen from `position` (world) along `direction`. */
    public colorAt(position: Vector3, direction: Vector3, result = new Color3()): Color3 {
        const eye = position.scale(1 / this.globe.radius);
        const d = direction.normalizeToNew();
        const r = eye.length(), b = Vector3.Dot(eye, d), t = Math.max(0, -b);
        const p = eye.add(d.scale(t)).length();
        let path = Math.sqrt(2 * Math.PI * p * this.scaleHeight);
        if (b >= 0) path = Math.min(path, this.scaleHeight / Math.max(Vector3.Dot(d, eye) / r, 1e-4));
        const depth = Math.exp(-Math.max(p - 1, 0) / this.scaleHeight) * path / this.scaleHeight;
        return result.set((1 - Math.exp(-depth * this.beta.x)) * this.tint.x,
            (1 - Math.exp(-depth * this.beta.y)) * this.tint.y, (1 - Math.exp(-depth * this.beta.z)) * this.tint.z);
    }

    public dispose(): void {
        this.globe.scene.onBeforeRenderObservable.remove(this.observer);
        this.material.dispose();
        this.mesh.dispose();
    }

    private bind(camera: Camera | null): void {
        if (!camera) return;
        const effect = this.material.getEffect();
        if (!effect) return;
        // Rotation only: rays are directions from the eye.
        this.rotation.copyFrom(camera.getViewMatrix());
        this.rotation.setTranslationFromFloats(0, 0, 0);
        this.rotation.multiplyToRef(camera.getProjectionMatrix(), this.inverse);
        this.inverse.invert();
        effect.setMatrix("inverseViewProjection", this.inverse);
        const eye = camera.globalPosition.scale(1 / this.globe.radius);
        effect.setFloat3("eye", eye.x, eye.y, eye.z);
        effect.setFloat("scaleHeight", this.scaleHeight);
        effect.setVector3("beta", this.beta);
        effect.setVector3("tint", this.tint);
        effect.setVector3("groundColor", this.ground);
        const scene = this.globe.scene;
        effect.setColor3("fogColor", scene.fogColor);
        effect.setFloat("fogDensity", scene.fogEnabled ? scene.fogDensity * this.globe.radius : 0);
        effect.setFloat("underwater", this.depth > 0 ? 1 : 0);
        effect.setColor3("surfaceLight", this.surfaceLight);
        effect.setFloat("time", performance.now() / 1000 % 3600);
    }

    /**
     * Fog matching the horizon haze, thinning with altitude: dense enough
     * near the ground to soften the distance, gone from orbit.
     */
    private updateFog(): void {
        const scene = this.globe.scene;
        const camera = scene.activeCamera;
        if (!camera) return;
        const position = camera.globalPosition;
        const height = (position.length() - this.globe.radius) / this.globe.metresToWorld;
        // Beneath the sea: water that darkens with depth as the light fades.
        this.depth = Math.max(0, -height);
        if (this.depth > 0) {
            // Darkening stops at a deep twilight blue, so the abyss stays visible.
            const compressed = Math.min(DEEPEST_DARKENING, 40 * Math.log(1 + this.depth / 40));
            const fade = (k: number) => Math.exp(-k * compressed);
            scene.fogColor.set(this.waterColor.r * fade(0.012), this.waterColor.g * fade(0.0065), this.waterColor.b * fade(0.0045));
            this.surfaceLight.set(0.62 * fade(0.034), 0.86 * fade(0.011), 0.94 * fade(0.0062));
            scene.clearColor.set(scene.fogColor.r, scene.fogColor.g, scene.fogColor.b, 1);
            scene.fogDensity = 1 / (this.underwaterVisibility * this.globe.metresToWorld);
            scene.fogEnabled = true;
            return;
        }
        scene.clearColor.set(0, 0, 0, 1);
        const up = position.normalizeToNew();
        // Any horizontal direction.
        const side = Math.abs(up.y) < 0.9 ? Vector3.Up() : Vector3.Right();
        const level = Vector3.Cross(up, side).normalize();
        this.colorAt(position, level, scene.fogColor);
        const fade = 1 - smoothstep(60_000, 400_000, height);
        // Visibility grows with altitude, but the sea horizon always fades
        // into the sky (95% fog there) rather than ending as a hard edge.
        const horizon = Math.sqrt(2 * EARTH_RADIUS * height + height * height);
        const visibility = Math.min(this.visibility + height * 3, Math.max(horizon, 30_000) / Math.sqrt(3));
        scene.fogDensity = fade / (visibility * this.globe.metresToWorld);
        scene.fogEnabled = fade > 0;
    }
}

function smoothstep(a: number, b: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}
