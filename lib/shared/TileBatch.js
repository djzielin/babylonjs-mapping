import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Frustum } from "@babylonjs/core/Maths/math.frustum.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
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
/** True where tiles can be drawn by `TileBatch` (WebGL engines). */
export function supportsTileBatch(scene) {
    const engine = scene.getEngine();
    return !engine.isWebGPU && !!engine._gl;
}
export class TileBatch extends Mesh {
    /** Tiles to draw, nearest first, which lets early depth testing reject hidden ones. */
    items = [];
    relativeWorld = new Float32Array(16);
    viewProjection = new Matrix();
    viewRotation = new Matrix();
    viewProjection32 = new Float32Array(16);
    bindShader;
    /** The shader with FADE defined, compiled on first use: discarding costs early depth testing, so only fading tiles pay for it. */
    fadeEffect;
    createFadeEffect;
    /** A clipping batch's shader without the clip, for tiles wholly inside it: they keep early depth testing. */
    insideEffect;
    createInsideEffect;
    /**
     * Skip tiles outside the rendering camera's own frustum. Layers select
     * tiles for the view as a whole, a little widened; each eye of a headset
     * sees only part of that.
     */
    cullByCamera = true;
    /** Tiles drawn by the last render, for diagnostics. */
    drawnCount = 0;
    planes = Frustum.GetPlanes(Matrix.Identity());
    /** The planes as (normal, d) quadruples, for the per-tile test. */
    planeValues = new Float64Array(24);
    /** Milliseconds over which tiles that change level cross-fade; 0 swaps them at once. */
    fadeDuration = 0;
    /**
     * With `clip`, fragments farther than `clipRadius` (world units) from
     * `clipCenter` are not drawn: a layer can end on a circle, whatever the
     * shape of its coarsest tiles, and leave the rest to layers beneath.
     */
    clipCenter = new Vector3();
    clipRadius = Infinity;
    constructor(name, scene, shader, { clip = false } = {}) {
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
        if (!shader || shader.fades)
            this.createFadeEffect = () => scene.getEngine().createEffect(shaderName, {
                attributes, uniformsNames: [...uniforms, "fade"], samplers: ["albedo"],
                defines: [...defines, "#define FADE"].join("\n"), fallbacks: null, onCompiled: null, onError: null, indexParameters: null,
            }, scene.getEngine());
        if (clip)
            this.createInsideEffect = () => scene.getEngine().createEffect(shaderName, {
                attributes, uniformsNames: uniforms, samplers: ["albedo"],
                defines: "", fallbacks: null, onCompiled: null, onError: null, indexParameters: null,
            }, scene.getEngine());
        this.bindShader = shader?.bind;
        // Tile transforms mirror geometry (ECEF is right-handed, Babylon's world
        // left-handed), which reverses the winding, and the proxy's default
        // clockwise orientation reverses it back: ordinary back-face culling.
        material.checkReadyOnlyOnce = true;
        this.material = material;
    }
    render(subMesh, _enableAlphaMode) {
        const scene = this.getScene();
        const camera = scene.activeCamera;
        const material = this.material;
        if (!camera || !this.items.length)
            return this;
        // ShaderMaterial compiles its effect per submesh; Mesh.render would
        // normally trigger that.
        if (!material.isReadyForSubMesh(this, subMesh))
            return this;
        const effect = subMesh.effect;
        const engine = scene.getEngine();
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
        const fading = [], inside = [];
        if (this.cullByCamera) {
            Frustum.GetPlanesToRef(camera.getTransformationMatrix(), this.planes);
            this.planes.forEach(({ normal, d }, i) => this.planeValues.set([normal.x, normal.y, normal.z, d], i * 4));
        }
        // Only tiles the clip's edge crosses need it.
        const plain = this.createInsideEffect && Number.isFinite(this.clipRadius) ? this.insideEffect ??= this.createInsideEffect() : undefined;
        const unclipped = plain?.isReady() ? plain : undefined;
        this.drawnCount = 0;
        for (const item of this.items) {
            if (this.cullByCamera && !this.inView(item))
                continue;
            if (item.fadeStart !== undefined && now - item.fadeStart < this.fadeDuration) {
                fading.push(item);
                continue;
            }
            if (item.fadeOut)
                continue;
            if (unclipped && item.bounds && Vector3.Distance(item.bounds.center, this.clipCenter) + item.bounds.radius < this.clipRadius) {
                inside.push(item);
                continue;
            }
            this.draw(engine, effect, item, false);
        }
        if (inside.length) {
            engine.enableEffect(unclipped);
            gl.uniformMatrix4fv(unclipped.getUniform("tileViewProjection"), false, this.viewProjection32);
            unclipped.setColor3("fogColor", scene.fogColor);
            unclipped.setFloat("fogDensity", scene.fogEnabled && scene.fogMode === Scene.FOGMODE_EXP2 ? scene.fogDensity : 0);
            this.bindShader?.(unclipped);
            for (const item of inside)
                this.draw(engine, unclipped, item, false, true);
        }
        if (!fading.length)
            return this;
        // Fading tiles last, with the discarding variant of the shader.
        const fade = this.fadeEffect ??= this.createFadeEffect?.();
        if (!fade?.isReady()) {
            // Not compiled yet: swap at once.
            for (const item of fading)
                if (!item.fadeOut)
                    this.draw(engine, effect, item, false);
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
            const progress = Math.max(1e-3, (now - item.fadeStart) / this.fadeDuration);
            fade.setFloat("fade", item.fadeOut ? -progress : progress);
            this.draw(engine, fade, item, true);
        }
        return this;
    }
    /** True while any tile is cross-fading, so the layer keeps redrawing. */
    get isFading() {
        const now = performance.now();
        return this.items.some(item => item.fadeStart !== undefined && now - item.fadeStart < this.fadeDuration);
    }
    inView(item) {
        const positions = item.localPositions;
        if (!positions)
            return true;
        let bounds = item.bounds;
        if (!bounds) {
            let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
            for (let i = 0; i < positions.length; i += 3) {
                const x = positions[i], y = positions[i + 1], z = positions[i + 2];
                if (x < x0)
                    x0 = x;
                if (x > x1)
                    x1 = x;
                if (y < y0)
                    y0 = y;
                if (y > y1)
                    y1 = y;
                if (z < z0)
                    z0 = z;
                if (z > z1)
                    z1 = z;
            }
            const local = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
            bounds = item.bounds = { local, localRadius: Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2, center: new Vector3(), radius: 0, flag: -1 };
        }
        const world = item.world;
        if (bounds.world !== world || bounds.flag !== world.updateFlag) {
            const m = world.m;
            Vector3.TransformCoordinatesToRef(bounds.local, world, bounds.center);
            const scale = Math.sqrt(Math.max(m[0] * m[0] + m[1] * m[1] + m[2] * m[2], m[4] * m[4] + m[5] * m[5] + m[6] * m[6], m[8] * m[8] + m[9] * m[9] + m[10] * m[10]));
            bounds.radius = bounds.localRadius * scale;
            bounds.world = world;
            bounds.flag = world.updateFlag;
        }
        const { x, y, z } = bounds.center, radius = bounds.radius, p = this.planeValues;
        for (let i = 0; i < 24; i += 4)
            if (p[i] * x + p[i + 1] * y + p[i + 2] * z + p[i + 3] < -radius)
                return false;
        return true;
    }
    draw(engine, effect, item, fading, unclipped = false) {
        this.drawnCount++;
        const gl = engine._gl;
        const m = item.world.m, relative = this.relativeWorld, eye = this.getScene().activeCamera.globalPosition;
        for (let i = 0; i < 12; i++)
            relative[i] = m[i];
        relative[12] = m[12] - eye.x;
        relative[13] = m[13] - eye.y;
        relative[14] = m[14] - eye.z;
        relative[15] = m[15];
        gl.uniformMatrix4fv(effect.getUniform("tileWorld"), false, relative);
        let vao = fading ? item.fadeVao : unclipped ? item.insideVao : item.vao;
        if (!vao) {
            const buffers = { position: item.positions, ...item.attributes };
            if (item.uvs)
                buffers.uv = item.uvs;
            vao = engine.recordVertexArrayObject(buffers, item.indexBuffer, effect);
            if (fading)
                item.fadeVao = vao;
            else if (unclipped)
                item.insideVao = vao;
            else
                item.vao = vao;
        }
        engine.bindVertexArrayObject(vao, item.indexBuffer);
        effect.setTexture("albedo", item.texture ?? null);
        engine.drawElementsType(Constants.MATERIAL_TriangleFillMode, 0, item.indexCount);
    }
    /** Release a drawable's GPU resources (its texture is owned by the tile). */
    static release(engine, item, shared = false) {
        if (item.vao)
            engine.releaseVertexArrayObject(item.vao);
        if (item.fadeVao)
            engine.releaseVertexArrayObject(item.fadeVao);
        if (item.insideVao)
            engine.releaseVertexArrayObject(item.insideVao);
        item.positions.dispose();
        if (item.attributes)
            for (const buffer of Object.values(item.attributes))
                buffer.dispose();
        // Shared uv and index buffers belong to the layer that made them.
        if (shared)
            return;
        item.uvs?.dispose();
        engine._releaseBuffer(item.indexBuffer);
    }
}
//# sourceMappingURL=TileBatch.js.map