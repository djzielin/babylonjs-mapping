import { copyTextureArrayLayers } from "./GPUTextureCopies";
import { TextureUsage } from "@babylonjs/core/Engines/WebGPU/webgpuConstants";
import type { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture2DArray } from "@babylonjs/core/Materials/Textures/rawTexture2DArray";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core/Engines/engine";

/** Match Babylon's current StandardMaterial diffuse lookup before GLSL preprocessing. */
export const WEBGL_TILE_DIFFUSE_SAMPLE = "!TEXRD\\(diffuseSampler,vDiffuseUV\\+uvOffset\\)";

class TileTextureArray extends MaterialPluginBase {
    constructor(material: StandardMaterial, private texture: RawTexture2DArray) {
        super(material, "TileTextureArray", 200, {}, true, true);
    }
    getAttributes(attributes: string[]): void { attributes.push("tileLayer"); }
    getSamplers(samplers: string[]): void { samplers.push("tileTextures"); }
    bindForSubMesh(buffer: UniformBuffer): void { buffer.setTexture("tileTextures", this.texture); }
    isCompatible(): boolean { return true; }
    getCustomCode(type: string, shaderLanguage = 0): { [key: string]: string } {
        if (shaderLanguage === 1) return type === "vertex" ? {
            CUSTOM_VERTEX_DEFINITIONS: "attribute tileLayer: f32; varying vTileLayer: f32;",
            CUSTOM_VERTEX_MAIN_END: "vertexOutputs.vTileLayer = vertexInputs.tileLayer;",
        } : {
            CUSTOM_FRAGMENT_DEFINITIONS: "var tileTextures: texture_2d_array<f32>; var tileTexturesSampler: sampler; varying vTileLayer: f32;",
            "!TEXRD\\(diffuseSampler,diffuseSamplerSampler,fragmentInputs\\.vDiffuseUV\\+uvOffset\\)": "textureSample(tileTextures, tileTexturesSampler, fragmentInputs.vDiffuseUV + uvOffset, i32(fragmentInputs.vTileLayer));",
        };
        return type === "vertex" ? {
            CUSTOM_VERTEX_DEFINITIONS: "attribute float tileLayer; varying float vTileLayer;",
            CUSTOM_VERTEX_MAIN_END: "vTileLayer = tileLayer;",
        } : {
            CUSTOM_FRAGMENT_DEFINITIONS: "uniform highp sampler2DArray tileTextures; varying float vTileLayer;",
            [WEBGL_TILE_DIFFUSE_SAMPLE]: "texture(tileTextures, vec3(vDiffuseUV + uvOffset, vTileLayer));",
        };
    }
}

export function terrainBatchGeometry(meshes: Mesh[]): { vertices: VertexData; layers: Float32Array; origin: Vector3 } {
    const origin = meshes[0].getAbsolutePosition().clone();
    const vertexCount = meshes.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0);
    const indexCount = meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices(), 0);
    const positions = new Float32Array(vertexCount * 3), normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2), colors = new Float32Array(vertexCount * 4);
    const indices = new Uint32Array(indexCount), layers = new Float32Array(vertexCount);
    colors.fill(1);
    const translation = Matrix.Translation(-origin.x, -origin.y, -origin.z);
    let offset = 0, indexOffset = 0;
    for (let layer = 0; layer < meshes.length; layer++) {
        const source = meshes[layer];
        const vertices = VertexData.ExtractFromMesh(source, true, true);
        vertices.transform(source.getWorldMatrix().multiply(translation));
        positions.set(vertices.positions!, offset * 3);
        normals.set(vertices.normals!, offset * 3);
        uvs.set(vertices.uvs!, offset * 2);
        if (vertices.colors) colors.set(vertices.colors, offset * 4);
        for (let i = 0; i < vertices.indices!.length; i++) indices[indexOffset++] = vertices.indices![i] + offset;
        const end = offset + vertices.positions!.length / 3;
        layers.fill(layer, offset, end);
        offset = end;
    }
    const vertices = new VertexData();
    Object.assign(vertices, { positions, normals, uvs, colors, indices });
    return { vertices, layers, origin };
}

type Source = { mesh: Mesh; texture: Texture; buffers: unknown[]; matrix: number; world: Matrix; visibility: number };
type Batch = { mesh: Mesh; material: StandardMaterial; texture: RawTexture2DArray; sources: Source[] };

/** Batch settled raster tiles without resampling their pixels or simplifying their geometry. */
export class TerrainBatcher {
    private batches: Batch[] = [];
    public lastError = "";
    public enabled = true;
    public get stats(): string { return `${this.batches.length} batches / ${this.owned.size} tiles${this.lastError ? ` / ${this.lastError}` : ""}`; }
    private owned = new Set<Mesh>();
    private busy = false;
    private nextBuild = 0;
    private pixels = new WeakMap<Texture, Promise<ArrayBufferView | null>>();
    constructor(private scene: Scene, private groups: () => Mesh[][], private register: (mesh: Mesh, source: Mesh) => void) {
        if (!scene.getEngine().isWebGPU && (scene.getEngine() as Engine).webGLVersion < 2) return;
        scene.onBeforeRenderObservable.add(() => this.update());
        const engine = scene.getEngine();
        const lost = engine.onContextLostObservable.add(() => {
            this.batches.forEach(batch => this.release(batch));
            this.batches = [];
        });
        scene.onDisposeObservable.add(() => {
            engine.onContextLostObservable.remove(lost);
            this.batches.forEach(batch => this.release(batch));
        });
    }
    private snapshot(mesh: Mesh): Source {
        return { mesh, texture: (mesh.material as StandardMaterial).diffuseTexture as Texture,
            buffers: [VertexBuffer.PositionKind, VertexBuffer.NormalKind, VertexBuffer.UVKind, VertexBuffer.ColorKind].map(kind => mesh.getVertexBuffer(kind)),
            matrix: mesh.computeWorldMatrix().updateFlag, world: mesh.getWorldMatrix().clone(), visibility: mesh.visibility };
    }
    private valid(source: Source): boolean {
        const mesh = source.mesh;
        if (mesh.isDisposed()) return false;
        const world = mesh.computeWorldMatrix();
        if (world.updateFlag !== source.matrix) {
            if (!world.equals(source.world)) return false;
            // Parenting new buildings can recompute an unchanged terrain matrix.
            source.matrix = world.updateFlag;
        }
        return mesh.isEnabled() && mesh.isVisible
            && (mesh.material as StandardMaterial)?.diffuseTexture === source.texture
            && mesh.getVertexBuffer(VertexBuffer.PositionKind) === source.buffers[0]
            && mesh.getVertexBuffer(VertexBuffer.NormalKind) === source.buffers[1]
            && mesh.getVertexBuffer(VertexBuffer.UVKind) === source.buffers[2]
            && mesh.getVertexBuffer(VertexBuffer.ColorKind) === source.buffers[3];
    }
    private release(batch: Batch): void {
        for (const source of batch.sources) {
            if (!source.mesh.isDisposed()) source.mesh.visibility = source.visibility;
            this.owned.delete(source.mesh);
        }
        batch.mesh.dispose(); batch.material.dispose(); batch.texture.dispose();
    }
    private update(): void {
        if (!this.scene.frustumPlanes) return;
        this.batches = this.batches.filter(batch => {
            if (this.enabled && batch.mesh.isInFrustum(this.scene.frustumPlanes)
                && batch.sources.every(source => this.valid(source))) return true;
            this.release(batch); return false;
        });
        if (!this.enabled || this.busy || performance.now() < this.nextBuild) return;
        this.nextBuild = performance.now() + 500;
        // Small spatial groups retain useful frustum culling and bound each upload.
        const patches: Mesh[][] = [];
        for (const group of this.groups()) {
            // Original tiles remain resident. Only duplicate textures for draws
            // that can currently benefit from batching.
            const visible = group.filter(mesh => mesh.isInFrustum(this.scene.frustumPlanes));
            for (let i = 0; i < visible.length; i += 16) patches.push(visible.slice(i, i + 16));
        }
        for (const group of patches) {
            const candidates = group.filter(mesh => !this.owned.has(mesh) && mesh.isEnabled() && mesh.isVisible && mesh.visibility === 1
                && (mesh.material as StandardMaterial)?.diffuseTexture?.isReady());
            if (candidates.length < 4 || candidates.length !== group.length) continue;
            const first = (candidates[0].material as StandardMaterial).diffuseTexture!;
            const size = first.getSize();
            const sources = candidates.filter(mesh => {
                const texture = (mesh.material as StandardMaterial).diffuseTexture!;
                return texture.getSize().width === size.width && texture.getSize().height === size.height && texture.hasAlpha === first.hasAlpha;
            }).slice(0, 16).map(mesh => this.snapshot(mesh));
            if (sources.length < 4) continue;
            this.busy = true;
            void this.build(sources).catch(error => { this.lastError = String(error); })
                .finally(() => { this.busy = false; this.nextBuild = performance.now() + 100; });
            break;
        }
    }
    private async build(sources: Source[]): Promise<void> {
        const size = sources[0].texture.getSize();
        let texture: RawTexture2DArray;
        const engine = this.scene.getEngine();
        if (engine.isWebGPU) {
            const gpu = engine as WebGPUEngine;
            const originals = sources.map(source => source.texture.getInternalTexture()?._hardwareTexture?.underlyingResource as GPUTexture | undefined);
            if (originals.some(original => !original || original.format !== "rgba8unorm"
                || !(original.usage & TextureUsage.CopySrc))) return;
            const mipLevels = originals[0]!.mipLevelCount;
            if (originals.some(original => original!.mipLevelCount !== mipLevels)) return;
            texture = new RawTexture2DArray(null, size.width, size.height, sources.length,
                5, this.scene, true, false, sources[0].texture.samplingMode, 0, 0, mipLevels);
            const target = texture.getInternalTexture()!._hardwareTexture!.underlyingResource as GPUTexture;
            // Keep Babylon's pending source uploads ahead of our copies. Copy the
            // existing mip chain: the raw-array generator only fills layer zero.
            gpu.flushFramebuffer();
            try {
                copyTextureArrayLayers(gpu._device, originals as GPUTexture[], target);
            } catch (error) {
                texture.dispose();
                throw error;
            }
        } else {
            const data = new Uint8Array(size.width * size.height * 4 * sources.length);
            for (let i = 0; i < sources.length; i++) {
                const texture = sources[i].texture;
                let read = this.pixels.get(texture);
                if (!read) { read = Promise.resolve(texture.readPixels()); this.pixels.set(texture, read); }
                const pixels = await read;
                this.pixels.delete(texture);
                if (!pixels || pixels.byteLength !== size.width * size.height * 4) { this.lastError = "Unsupported texture readback"; return; }
                if (!this.enabled || !sources.every(source => this.valid(source))) { this.lastError = "Tiles changed during readback"; return; }
                data.set(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), i * size.width * size.height * 4);
            }
            texture = RawTexture2DArray.CreateRGBATexture(data, size.width, size.height, sources.length, this.scene, true, false, sources[0].texture.samplingMode);
        }
        const { vertices, layers, origin } = terrainBatchGeometry(sources.map(source => source.mesh));
        // Derived pixels can be regenerated from the original raster textures.
        // Avoid retaining a second city-sized CPU copy for context restoration;
        // context loss releases these batches and the originals rebuild normally.
        texture.getInternalTexture()!._bufferView = null;
        texture.anisotropicFilteringLevel = sources[0].texture.anisotropicFilteringLevel;
        texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
        // The cloned batch material has no cached draw wrappers yet. Babylon's
        // clone setters and unfreeze() otherwise scan every city mesh for each
        // property while camera movement creates new batches.
        const scene = this.scene as Scene & { _forceBlockMaterialDirtyMechanism(value: boolean): void };
        const wasBlocked = scene.blockMaterialDirtyMechanism;
        let material: StandardMaterial;
        scene._forceBlockMaterialDirtyMechanism(true);
        try {
            material = (sources[0].mesh.material as StandardMaterial).clone("batched terrain");
            material.checkReadyOnlyOnce = false;
            if (material.diffuseTexture !== sources[0].texture) material.diffuseTexture?.dispose();
            material.diffuseTexture = sources[0].texture;
            new TileTextureArray(material, texture);
        } finally { scene._forceBlockMaterialDirtyMechanism(wasBlocked); }
        const mesh = new Mesh("batched terrain", this.scene);
        vertices.applyToMesh(mesh);
        mesh.setVerticesData("tileLayer", layers, false, 1);
        mesh.setEnabled(false);
        mesh.position.copyFrom(origin);
        mesh.material = material;
        mesh.isPickable = false;
        mesh.hasVertexAlpha = sources[0].mesh.hasVertexAlpha;
        mesh.useVertexColors = sources[0].mesh.useVertexColors;
        mesh.freezeWorldMatrix();
        this.register(mesh, sources[0].mesh);
        try {
            await material.forceCompilationAsync(mesh);
        } catch (error) {
            mesh.dispose(); material.dispose(); texture.dispose();
            throw error;
        }
        if (!this.enabled || !sources.every(source => this.valid(source))) {
            mesh.dispose(); material.dispose(); texture.dispose();
            return;
        }
        material.checkReadyOnlyOnce = true;
        mesh.setEnabled(true);
        for (const source of sources) { source.mesh.visibility = 0; this.owned.add(source.mesh); }
        this.batches.push({ mesh, material, texture, sources });
        this.lastError = "";
    }
}
