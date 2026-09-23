import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Reuse recorded draws only while their resources and visible coverage remain valid. */
type DrawState = {
    selected: Mesh | null; material: Mesh["material"]; geometry: Mesh["geometry"];
    worldVersion: number; visibility: number; group: number; mask: number;
    index: unknown; buffers: Record<string, unknown>; effects: readonly unknown[]; textures: readonly unknown[];
};
export class DrawSnapshotCache {
    private recorded = new Map<Mesh, DrawState>();
    private immutableMaterials = new WeakSet<NonNullable<Mesh["material"]>>();
    private expanded: Mesh[] = [];
    private states: DrawState[] = [];
    /** Fully loaded tile materials remain immutable until their asset is replaced. */
    public retainStaticMaterial(material: NonNullable<Mesh["material"]>): void { this.immutableMaterials.add(material); }
    private restoreSelection?: () => void;
    private captures = 0;
    private replays = 0;
    private blocked = "";
    private eye = new Vector3(Infinity, Infinity, Infinity);
    private cpuMs = 0;
    private enabledMeshes = new Set<AbstractMesh>();
    private detach = new Map<AbstractMesh, () => void>();
    private watchMesh!: (mesh: AbstractMesh) => void;
    private syncMeshes = false;
    private view = new Float64Array(16);
    private viewRevision = 0;
    private camera?: Scene["activeCamera"];
    private culling = new WeakMap<Mesh, { view: number; world: number; position: unknown; expanded: boolean; visible: boolean }>();
    public get stats(): string { return `${this.recorded.size} cached / ${this.enabledMeshes.size} enabled / ${this.scene.meshes.length} resident meshes · ${this.captures} captures / ${this.replays} replays${this.blocked ? ` / ${this.blocked}` : ""} · cache ${this.cpuMs.toFixed(2)} ms`; }
    constructor(private scene: Scene, private engine: WebGPUEngine) {
        engine.snapshotRenderingMode = 1;
        const watch = this.watchMesh = (mesh: AbstractMesh) => {
            if (mesh.isDisposed() || this.detach.has(mesh)) return;
            if (mesh.isEnabled()) this.enabledMeshes.add(mesh);
            const enabled = mesh.onEffectiveEnabledStateChangedObservable.add(value => {
                if (value) this.enabledMeshes.add(mesh); else this.enabledMeshes.delete(mesh);
                if (this.recorded.has(mesh as Mesh)) this.invalidate();
            });
            this.detach.set(mesh, () => mesh.onEffectiveEnabledStateChangedObservable.remove(enabled));
        };
        scene.meshes.forEach(watch);
        const added = scene.onNewMeshAddedObservable.add(watch);
        const before = scene.onBeforeCameraRenderObservable.add(() => {
            const start = performance.now(); this.prepare();
            this.cpuMs = this.cpuMs * 0.9 + (performance.now() - start) * 0.1;
        });
        const after = scene.onAfterRenderObservable.add(() => { this.restoreSelection?.(); this.restoreSelection = undefined; });
        const resize = engine.onResizeObservable.add(() => this.invalidate());
        const lost = engine.onContextLostObservable.add(() => this.invalidate());
        const removed = scene.onMeshRemovedObservable.add(mesh => {
            this.syncMeshes = true;
            this.enabledMeshes.delete(mesh); this.detach.get(mesh)?.(); this.detach.delete(mesh);
            if (this.recorded.has(mesh as Mesh)) this.invalidate();
        });
        scene.onDisposeObservable.addOnce(() => {
            this.restoreSelection?.(); this.invalidate();
            scene.onBeforeCameraRenderObservable.remove(before);
            scene.onAfterRenderObservable.remove(after);
            engine.onResizeObservable.remove(resize);
            engine.onContextLostObservable.remove(lost);
            scene.onMeshRemovedObservable.remove(removed);
            scene.onNewMeshAddedObservable.remove(added);
            for (const detach of this.detach.values()) detach();
            this.detach.clear(); this.enabledMeshes.clear();
        });
    }
    public invalidate(): void {
        this.engine.snapshotRendering = false;
        this.recorded.clear();
    }
    private state(mesh: Mesh, previous?: DrawState): DrawState | undefined {
        // Babylon renders meshes without an explicit material with the scene
        // default. Treat that actual draw material as a stable cache resource.
        const material = mesh.material ?? this.scene.defaultMaterial;
        if (!mesh.material && !material.isFrozen) material.freeze();
        if (!mesh.isWorldMatrixFrozen || !material?.isFrozen || mesh.skeleton || mesh.morphTargetManager
            || mesh.hasInstances || mesh.hasThinInstances || mesh.isAnInstance || mesh.billboardMode) {
            const reason = !mesh.isWorldMatrixFrozen ? "world matrix" : !material?.isFrozen ? `material ${material?.getClassName() ?? "none"}`
                : mesh.skeleton ? "skeleton" : mesh.morphTargetManager ? "morph target"
                    : mesh.hasInstances || mesh.hasThinInstances || mesh.isAnInstance ? "instances" : "billboard";
            this.blocked = `${mesh.name}: ${reason}`;
            return undefined;
        }
        const selected = mesh.getLOD(this.scene.activeCamera!) as Mesh | null;
        const geometry = selected?.geometry ?? mesh.geometry;
        const buffers = geometry?.getVertexBuffers() ?? {};
        const index = geometry?.getIndexBuffer();
        const worldVersion = mesh.getWorldMatrix().updateFlag;
        const immutable = this.immutableMaterials.has(material);
        const textures = immutable && previous ? undefined : material.getActiveTextures();
        if (previous && previous.selected === selected && previous.material === material && previous.geometry === geometry
            && previous.worldVersion === worldVersion && previous.visibility === mesh.visibility
            && previous.group === mesh.renderingGroupId && previous.mask === mesh.layerMask && previous.index === index) {
            let same = true;
            for (const kind in buffers) if (previous.buffers[kind] !== buffers[kind]) { same = false; break; }
            // Frozen materials can retain dirty defines after their fast ready
            // path. Compare bound resources, rather than rebuilding forever.
            const subMeshes = (selected ?? mesh).subMeshes;
            if (subMeshes.length !== previous.effects.length || textures && textures.length !== previous.textures.length) same = false;
            if (same) for (let i = 0; i < subMeshes.length; i++) if (subMeshes[i].effect !== previous.effects[i]) { same = false; break; }
            if (same && textures) for (let i = 0; i < textures.length; i++) if (textures[i].getInternalTexture() !== previous.textures[i]) { same = false; break; }
            if (same) return previous;
        }
        if (!mesh.isReady(true) || (selected && !selected.isReady(true))) {
            this.blocked = `${mesh.name}: preparing shaders`;
            return undefined;
        }
        const activeTextures = textures ?? material.getActiveTextures();
        if (activeTextures.some(texture => !texture.isReady())) {
            this.blocked = `${mesh.name}: loading textures`;
            return undefined;
        }
        return { selected, material, geometry, worldVersion, visibility: mesh.visibility,
            group: mesh.renderingGroupId, mask: mesh.layerMask, index, buffers: { ...buffers }, effects: (selected ?? mesh).subMeshes.map(sub => sub.effect), textures: activeTextures.map(texture => texture.getInternalTexture()) };
    }
    private enabled(mesh: AbstractMesh): boolean {
        // enabledMeshes follows effective state, including parent changes.
        return mesh.isVisible && mesh.visibility > 0
            && !!(mesh.layerMask & this.scene.activeCamera!.layerMask);
    }
    private prepare(): void {
        this.blocked = "";
        const scene = this.scene;
        const camera = scene.activeCamera!;
        if (camera !== this.camera) { this.invalidate(); this.camera = camera; }
        this.engine.currentRenderPassId = camera.outputRenderTarget?.renderPassId ?? camera.renderPassId ?? 0;
        if (scene.activeCameras?.length || camera.outputRenderTarget || scene.particleSystems.length) {
            this.invalidate(); return;
        }
        // Babylon defers onNewMeshAdded until the next task. Include meshes
        // created immediately before render in this frame as well.
        if (this.syncMeshes || this.detach.size !== scene.meshes.length) {
            scene.meshes.forEach(this.watchMesh); this.syncMeshes = false;
        }
        const transform = scene.getTransformMatrix().m;
        for (let i = 0; i < 16; i++) if (this.view[i] !== transform[i]) {
            this.view.set(transform); this.viewRevision++; break;
        }
        let reuse = this.recorded.size > 0;
        const expanded = this.expanded, states = this.states;
        expanded.length = states.length = 0;
        for (const abstractMesh of this.enabledMeshes) {
            const mesh = abstractMesh as Mesh;
            if (mesh.isBlocked || !mesh.subMeshes?.length || !this.enabled(mesh)) {
                if (this.recorded.has(mesh)) reuse = false;
                continue;
            }
            const world = mesh.getWorldMatrix().updateFlag;
            const position = mesh.getVertexBuffer("position");
            let cull = this.culling.get(mesh);
            if (!cull || cull.view !== this.viewRevision || cull.world !== world || cull.position !== position || !mesh.isWorldMatrixFrozen) {
                const bounds = mesh.getBoundingInfo().boundingSphere;
                const margin = Math.max(bounds.radiusWorld * 0.02, Vector3.Distance(camera.globalPosition, bounds.centerWorld) * 0.02);
                let expanded = true;
                for (const plane of scene.frustumPlanes) if (plane.dotCoordinate(bounds.centerWorld) < -bounds.radiusWorld - margin) { expanded = false; break; }
                if (!cull) {
                    cull = { view: this.viewRevision, world, position, expanded, visible: false };
                    this.culling.set(mesh, cull);
                }
                cull.view = this.viewRevision; cull.world = world; cull.position = position;
                cull.expanded = expanded; cull.visible = expanded && mesh.isInFrustum(scene.frustumPlanes);
            }
            const recorded = this.recorded.get(mesh);
            if (!cull.expanded && !recorded) continue;
            const state = this.state(mesh, recorded);
            if (state === undefined) { this.blocked ||= mesh.name; this.invalidate(); return; }
            if (recorded !== undefined && recorded !== state) reuse = false;
            if (recorded === undefined && cull.visible) reuse = false;
            if (cull.expanded) { expanded.push(mesh); states.push(state); }
        }
        for (const mesh of this.recorded.keys()) if (mesh.isDisposed()) reuse = false;
        if (!expanded.length) { this.invalidate(); return; }
        if (reuse) {
            // Floating-origin rendering changes GPU world translations as the
            // eye moves, even though source world matrices remain frozen.
            if (!this.eye.equals(scene.floatingOriginOffset)) for (const [source, state] of this.recorded) {
                const mesh = state.selected ?? source;
                if (mesh.getMeshUniformBuffer().useUbo) {
                    mesh.getMeshUniformBuffer().unbindEffect();
                    mesh.transferToEffect(mesh.getWorldMatrix());
                }
            }
            this.eye.copyFrom(scene.floatingOriginOffset);
            this.replays++;
            return;
        }
        this.invalidate();
        this.recorded = new Map(expanded.map((mesh, index) => [mesh, states[index]]));
        const previous = scene.getActiveMeshCandidates;
        const forced = expanded.map(mesh => mesh.alwaysSelectAsActiveMesh);
        expanded.forEach(mesh => { mesh.alwaysSelectAsActiveMesh = true; });
        scene.getActiveMeshCandidates = () => ({ data: expanded, length: expanded.length });
        this.restoreSelection = () => {
            scene.getActiveMeshCandidates = previous;
            expanded.forEach((mesh, index) => { mesh.alwaysSelectAsActiveMesh = forced[index]; });
        };
        this.engine.snapshotRenderingMode = 1;
        this.engine.snapshotRendering = true;
        this.eye.copyFrom(scene.floatingOriginOffset);
        this.captures++;
    }
}
