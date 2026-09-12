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

class TileTextureArray extends MaterialPluginBase {
    constructor(material: StandardMaterial, private texture: RawTexture2DArray) {
        super(material, "TileTextureArray", 200, {}, true, true);
    }
    getAttributes(attributes: string[]): void { attributes.push("tileLayer"); }
    getSamplers(samplers: string[]): void { samplers.push("tileTextures"); }
    bindForSubMesh(buffer: UniformBuffer): void { buffer.setTexture("tileTextures", this.texture); }
    getCustomCode(type: string): { [key: string]: string } {
        return type === "vertex" ? {
            CUSTOM_VERTEX_DEFINITIONS: "attribute float tileLayer; varying float vTileLayer;",
            CUSTOM_VERTEX_MAIN_END: "vTileLayer = tileLayer;",
        } : {
            CUSTOM_FRAGMENT_DEFINITIONS: "uniform highp sampler2DArray tileTextures; varying float vTileLayer;",
            "!texture2D\\(diffuseSampler,vDiffuseUV\\+uvOffset\\)": "texture(tileTextures, vec3(vDiffuseUV + uvOffset, vTileLayer));",
        };
    }
}

export function terrainBatchGeometry(meshes: Mesh[]): { vertices: VertexData; layers: number[]; origin: Vector3 } {
    const origin = meshes[0].getAbsolutePosition().clone();
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [], layers: number[] = [];
    for (let layer = 0; layer < meshes.length; layer++) {
        const source = meshes[layer];
        const vertices = VertexData.ExtractFromMesh(source, true, true);
        const matrix = source.getWorldMatrix().multiply(Matrix.Translation(-origin.x, -origin.y, -origin.z));
        vertices.transform(matrix);
        const offset = positions.length / 3;
        for (const value of Array.from(vertices.positions!)) positions.push(value);
        for (const value of Array.from(vertices.normals!)) normals.push(value);
        for (const value of Array.from(vertices.uvs!)) uvs.push(value);
        for (const value of Array.from(vertices.indices!)) indices.push(value + offset);
        for (let i = 0; i < vertices.positions!.length / 3; i++) {
            layers.push(layer);
            colors.push(...(vertices.colors ? [vertices.colors[i * 4], vertices.colors[i * 4 + 1], vertices.colors[i * 4 + 2], vertices.colors[i * 4 + 3]] : [1, 1, 1, 1]));
        }
    }
    const vertices = new VertexData();
    vertices.positions = new Float32Array(positions); vertices.normals = new Float32Array(normals); vertices.uvs = new Float32Array(uvs); vertices.colors = new Float32Array(colors); vertices.indices = new Uint32Array(indices);
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
        if ((scene.getEngine() as Engine).webGLVersion < 2) return;
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
        this.batches = this.batches.filter(batch => {
            if (this.enabled && batch.sources.every(source => this.valid(source))) return true;
            this.release(batch); return false;
        });
        if (!this.enabled || this.busy || performance.now() < this.nextBuild) return;
        this.nextBuild = performance.now() + 500;
        // Small spatial groups retain useful frustum culling and bound each upload.
        const patches: Mesh[][] = [];
        for (const group of this.groups()) for (let i = 0; i < group.length; i += 16) patches.push(group.slice(i, i + 16));
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
        const { vertices, layers, origin } = terrainBatchGeometry(sources.map(source => source.mesh));
        const texture = RawTexture2DArray.CreateRGBATexture(data, size.width, size.height, sources.length, this.scene, true, false, sources[0].texture.samplingMode);
        // Derived pixels can be regenerated from the original raster textures.
        // Avoid retaining a second city-sized CPU copy for context restoration;
        // context loss releases these batches and the originals rebuild normally.
        texture.getInternalTexture()!._bufferView = null;
        texture.anisotropicFilteringLevel = sources[0].texture.anisotropicFilteringLevel;
        texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
        const material = (sources[0].mesh.material as StandardMaterial).clone("batched terrain");
        material.unfreeze();
        if (material.diffuseTexture !== sources[0].texture) material.diffuseTexture?.dispose();
        material.diffuseTexture = sources[0].texture;
        new TileTextureArray(material, texture);
        const mesh = new Mesh("batched terrain", this.scene);
        vertices.applyToMesh(mesh);
        mesh.setVerticesData("tileLayer", new Float32Array(layers), false, 1);
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
        material.freeze();
        mesh.setEnabled(true);
        for (const source of sources) { source.mesh.visibility = 0; this.owned.add(source.mesh); }
        this.batches.push({ mesh, material, texture, sources });
        this.lastError = "";
    }
}
