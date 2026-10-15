import type { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import type { DataBuffer } from "@babylonjs/core/Buffers/dataBuffer.js";
import type { ThinEngine } from "@babylonjs/core/Engines/thinEngine.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { Scene } from "@babylonjs/core/scene.js";

const NAME = "mapTileBatch";

// Positions are tile-local. `tileWorld` maps them into camera-relative world
// space, computed in double precision on the CPU, so float32 never sees large
// coordinates however far the camera is from the world origin.
Effect.ShadersStore[`${NAME}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 tileWorld;
uniform mat4 tileViewProjection;
varying vec2 vUV;
varying float vFogDistance;
#ifdef CLIP
uniform vec3 clipCenter;
varying vec3 vClip;
#endif
void main(void) {
    vec4 relative = tileWorld * vec4(position, 1.0);
    gl_Position = tileViewProjection * relative;
    vUV = uv;
    vFogDistance = length(relative.xyz);
#ifdef CLIP
    vClip = relative.xyz - clipCenter;
#endif
}`;

Effect.ShadersStore[`${NAME}FragmentShader`] = `
precision highp float;
uniform sampler2D albedo;
uniform vec3 fogColor;
uniform float fogDensity;
varying vec2 vUV;
varying float vFogDistance;
#ifdef CLIP
uniform float clipRadius;
varying vec3 vClip;
#endif
#ifdef FADE
// Fraction of the cross-fade done; negative for a tile fading out.
uniform float fade;
#endif
void main(void) {
#ifdef CLIP
    if (dot(vClip, vClip) > clipRadius * clipRadius) discard;
#endif
#ifdef FADE
    // Screen-door cross-fade: a tile fading out keeps exactly the pixels its
    // replacement, at the same progress, has not taken yet.
    float threshold = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (fade >= 0.0 ? threshold >= fade : threshold < -fade) discard;
#endif
    vec3 color = texture2D(albedo, vUV).rgb;
    float fog = clamp(exp(-pow(fogDensity * vFogDistance, 2.0)), 0.0, 1.0);
    gl_FragColor = vec4(mix(fogColor, color, fog), 1.0);
}`;

/** GPU resources of one textured tile primitive, drawn by `TileBatch`. */
export interface TileDrawable {
    positions: VertexBuffer;
    uvs?: VertexBuffer;
    indexBuffer: DataBuffer;
    indexCount: number;
    texture?: BaseTexture;
    /** Tile-local to world, double precision. */
    world: Matrix;
    /** Recorded on first draw, once the effect's attribute locations are known. */
    vao?: WebGLVertexArrayObject;
    /** The vertex array for the cross-fading variant of the shader. */
    fadeVao?: WebGLVertexArrayObject;
    /**
     * When the tile started to fade in (`performance.now()`), or out with
     * `fadeOut`. Tiles fade over `TileBatch.fadeDuration`.
     */
    fadeStart?: number;
    fadeOut?: boolean;
    /** Further per-vertex attributes for custom shaders, by attribute name. */
    attributes?: Record<string, VertexBuffer>;
    /** CPU copies for ray queries. */
    localPositions?: Float32Array;
    localIndices?: Uint16Array | Uint32Array;
}

/** True where tiles can be drawn by `TileBatch` (WebGL engines). */
export function supportsTileBatch(scene: Scene): boolean {
    const engine = scene.getEngine() as ThinEngine;
    return !engine.isWebGPU && !!engine._gl;
}

/**
 * Draws every visible tile of a streaming layer in one pass. Babylon sees a single
 * mesh, so the tiles take part in rendering groups, stencil layering
 * (`MapLayerRenderer`) and multiple cameras like any other mesh, while the
 * per-tile cost is only a matrix upload, a vertex array bind, a texture bind
 * and the draw itself.
 */
export interface TileBatchShader {
    /** Name of a shader pair in `Effect.ShadersStore`, with the same core inputs as the default. */
    name: string;
    attributes?: string[];
    uniforms?: string[];
    /** Set custom uniforms before drawing. */
    bind?: (effect: Effect) => void;

    /** The fragment shader implements `#ifdef FADE` like the default; otherwise tiles appear at once. */
    fades?: boolean;
}

export class TileBatch extends Mesh {
    /** Tiles to draw, nearest first, which lets early depth testing reject hidden ones. */
    public items: TileDrawable[] = [];
    private readonly relativeWorld = new Float32Array(16);
    private readonly viewProjection = new Matrix();
    private readonly viewRotation = new Matrix();
    private readonly viewProjection32 = new Float32Array(16);

    private readonly bindShader?: (effect: Effect) => void;
    /** The shader with FADE defined, compiled on first use: discarding costs early depth testing, so only fading tiles pay for it. */
    private fadeEffect?: Effect;
    private readonly createFadeEffect?: () => Effect;

    /** Milliseconds over which tiles that change level cross-fade; 0 swaps them at once. */
    public fadeDuration = 0;

    /**
     * With `clip`, fragments farther than `clipRadius` (world units) from
     * `clipCenter` are not drawn: a layer can end on a circle, whatever the
     * shape of its coarsest tiles, and leave the rest to layers beneath.
     */
    public clipCenter = new Vector3();
    public clipRadius = Infinity;

    public constructor(name: string, scene: Scene, shader?: TileBatchShader, { clip = false }: { clip?: boolean } = {}) {
        super(name, scene);
        // A single placeholder triangle: Babylon needs geometry to schedule
        // the mesh, but `render` draws the tiles instead.
        const placeholder = new VertexData();
        placeholder.positions = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        placeholder.uvs = [0, 0, 0, 0, 0, 0];
        placeholder.indices = [0, 1, 2];
        placeholder.applyToMesh(this);
        this.alwaysSelectAsActiveMesh = true;
        this.isPickable = false;
        this.doNotSyncBoundingInfo = true;
        const shaderName = shader?.name ?? NAME;
        const attributes = ["position", "uv", ...shader?.attributes ?? []];
        const uniforms = ["tileWorld", "tileViewProjection", "fogColor", "fogDensity", "clipCenter", "clipRadius", ...shader?.uniforms ?? []];
        // Discarding costs early depth testing, so only clipped batches pay for it.
        const defines = clip ? ["#define CLIP"] : [];
        const material = new ShaderMaterial(shaderName, scene, shaderName, { attributes, uniforms, samplers: ["albedo"], defines });
        if (!shader || shader.fades) this.createFadeEffect = () => scene.getEngine().createEffect(shaderName, {
            attributes, uniformsNames: [...uniforms, "fade"], samplers: ["albedo"],
            defines: [...defines, "#define FADE"].join("\n"), fallbacks: null, onCompiled: null, onError: null, indexParameters: null,
        }, scene.getEngine());
        this.bindShader = shader?.bind;
        // Tile transforms mirror geometry (ECEF is right-handed, Babylon's world
        // left-handed), which reverses the winding, and the proxy's default
        // clockwise orientation reverses it back: ordinary back-face culling.
        material.checkReadyOnlyOnce = true;
        this.material = material;
    }

    public override render(subMesh: SubMesh, _enableAlphaMode: boolean): Mesh {
        const scene = this.getScene();
        const camera = scene.activeCamera;
        const material = this.material as ShaderMaterial;
        if (!camera || !this.items.length) return this;
        // ShaderMaterial compiles its effect per submesh; Mesh.render would
        // normally trigger that.
        if (!material.isReadyForSubMesh(this, subMesh)) return this;
        const effect = subMesh.effect!;
        const engine = scene.getEngine() as ThinEngine;
        const gl = engine._gl;

        // Depth, culling and the stencil state MapLayerRenderer configured.
        material._preBind(subMesh._drawWrapper);
        // Camera-relative view-projection: the view's rotation only.
        this.viewRotation.copyFrom(camera.getViewMatrix());
        this.viewRotation.setTranslationFromFloats(0, 0, 0);
        this.viewRotation.multiplyToRef(camera.getProjectionMatrix(), this.viewProjection);
        this.viewProjection32.set(this.viewProjection.m);
        gl.uniformMatrix4fv(effect.getUniform("tileViewProjection"), false, this.viewProjection32);
        effect.setColor3("fogColor", scene.fogColor);
        effect.setFloat("fogDensity", scene.fogEnabled && scene.fogMode === Scene.FOGMODE_EXP2 ? scene.fogDensity : 0);
        const eye = camera.globalPosition;
        effect.setFloat3("clipCenter", this.clipCenter.x - eye.x, this.clipCenter.y - eye.y, this.clipCenter.z - eye.z);
        effect.setFloat("clipRadius", Math.min(this.clipRadius, 3.4e38));
        this.bindShader?.(effect);

        const now = performance.now();
        const fading: TileDrawable[] = [];
        for (const item of this.items) {
            if (item.fadeStart !== undefined && now - item.fadeStart < this.fadeDuration) { fading.push(item); continue; }
            if (item.fadeOut) continue;
            this.draw(engine, effect, item, false);
        }
        if (!fading.length) return this;

        // Fading tiles last, with the discarding variant of the shader.
        const fade = this.fadeEffect ??= this.createFadeEffect?.();
        if (!fade?.isReady()) {
            // Not compiled yet: swap at once.
            for (const item of fading) if (!item.fadeOut) this.draw(engine, effect, item, false);
            return this;
        }
        engine.enableEffect(fade);
        gl.uniformMatrix4fv(fade.getUniform("tileViewProjection"), false, this.viewProjection32);
        fade.setColor3("fogColor", scene.fogColor);
        fade.setFloat("fogDensity", scene.fogEnabled && scene.fogMode === Scene.FOGMODE_EXP2 ? scene.fogDensity : 0);
        fade.setFloat3("clipCenter", this.clipCenter.x - eye.x, this.clipCenter.y - eye.y, this.clipCenter.z - eye.z);
        fade.setFloat("clipRadius", Math.min(this.clipRadius, 3.4e38));
        this.bindShader?.(fade);
        for (const item of fading) {
            const progress = Math.max(1e-3, (now - item.fadeStart!) / this.fadeDuration);
            fade.setFloat("fade", item.fadeOut ? -progress : progress);
            this.draw(engine, fade, item, true);
        }
        return this;
    }

    /** True while any tile is cross-fading, so the layer keeps redrawing. */
    public get isFading(): boolean {
        const now = performance.now();
        return this.items.some(item => item.fadeStart !== undefined && now - item.fadeStart < this.fadeDuration);
    }

    private draw(engine: ThinEngine, effect: Effect, item: TileDrawable, fading: boolean): void {
        const gl = engine._gl;
        const m = item.world.m, relative = this.relativeWorld, eye = this.getScene().activeCamera!.globalPosition;
        for (let i = 0; i < 12; i++) relative[i] = m[i];
        relative[12] = m[12] - eye.x;
        relative[13] = m[13] - eye.y;
        relative[14] = m[14] - eye.z;
        relative[15] = m[15];
        gl.uniformMatrix4fv(effect.getUniform("tileWorld"), false, relative);
        let vao = fading ? item.fadeVao : item.vao;
        if (!vao) {
            const buffers: Record<string, VertexBuffer> = { position: item.positions, ...item.attributes };
            if (item.uvs) buffers.uv = item.uvs;
            vao = engine.recordVertexArrayObject(buffers, item.indexBuffer, effect);
            if (fading) item.fadeVao = vao;
            else item.vao = vao;
        }
        engine.bindVertexArrayObject(vao, item.indexBuffer);
        effect.setTexture("albedo", item.texture ?? null);
        engine.drawElementsType(Constants.MATERIAL_TriangleFillMode, 0, item.indexCount);
    }

    /** Release a drawable's GPU resources (its texture is owned by the tile). */
    public static release(engine: ThinEngine, item: TileDrawable, shared = false): void {
        if (item.vao) engine.releaseVertexArrayObject(item.vao);
        if (item.fadeVao) engine.releaseVertexArrayObject(item.fadeVao);
        item.positions.dispose();
        if (item.attributes) for (const buffer of Object.values(item.attributes)) buffer.dispose();
        // Shared uv and index buffers belong to the layer that made them.
        if (shared) return;
        item.uvs?.dispose();
        engine._releaseBuffer(item.indexBuffer);
    }
}
