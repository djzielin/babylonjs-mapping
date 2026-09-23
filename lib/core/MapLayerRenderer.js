import { Constants } from "@babylonjs/core/Engines/constants.js";
import { RenderingManager } from "@babylonjs/core/Rendering/renderingManager.js";
/** Finer map coverage replaces coarse coverage, with one shared depth buffer. */
export default class MapLayerRenderer {
    scene;
    maximumLevel;
    options;
    meshes = new Map();
    observer;
    dirty = new Set();
    detach = new Map();
    constructor(scene, maximumLevel = 7, options = {}) {
        this.scene = scene;
        this.maximumLevel = maximumLevel;
        this.options = options;
        RenderingManager.MAX_RENDERINGGROUPS = Math.max(RenderingManager.MAX_RENDERINGGROUPS, maximumLevel + 1);
        for (let group = 0; group <= maximumLevel; group++)
            scene.setRenderingAutoClearDepthStencil(group, false);
        this.observer = scene.onBeforeRenderObservable.add(() => {
            for (const mesh of this.dirty) {
                const level = this.meshes.get(mesh);
                if (level !== undefined && !mesh.isDisposed())
                    this.configure(mesh, level);
            }
            this.dirty.clear();
        });
    }
    add(mesh, level) {
        if (!Number.isInteger(level) || level < 0 || level > this.maximumLevel)
            throw new RangeError("Invalid map layer level");
        if (!this.meshes.has(mesh)) {
            const material = mesh.onMaterialChangedObservable.add(() => this.dirty.add(mesh));
            const dispose = mesh.onDisposeObservable.add(() => {
                this.meshes.delete(mesh);
                this.dirty.delete(mesh);
                this.detach.get(mesh)?.();
                this.detach.delete(mesh);
            });
            this.detach.set(mesh, () => {
                mesh.onMaterialChangedObservable.remove(material);
                mesh.onDisposeObservable.remove(dispose);
            });
        }
        this.meshes.set(mesh, level);
        this.configure(mesh, level);
    }
    configure(mesh, level) {
        mesh.renderingGroupId = this.maximumLevel - level;
        if (mesh.material)
            this.configureMaterial(mesh.material, level, mesh);
    }
    configureMaterial(material, level, owner) {
        // glTF assets can use MultiMaterial: configure the actual submaterials
        // as well, otherwise they write a different depth encoding.
        const children = material.subMaterials;
        if (children)
            for (const child of children)
                if (child)
                    this.configureMaterial(child, level);
        if (this.options.logarithmicDepth && this.scene.getEngine().getCaps().fragmentDepthSupported && !material.useLogarithmicDepth) {
            const bound = owner && material === owner.material && material.meshMap ? material.getBindedMeshes() : [];
            const firstUse = bound.length === 1 && bound[0] === owner
                && owner.subMeshes.every(subMesh => !subMesh.effect);
            if (firstUse) {
                const state = material;
                const blocked = state._blockDirtyMechanism;
                state._blockDirtyMechanism = true;
                try {
                    material.useLogarithmicDepth = true;
                }
                finally {
                    state._blockDirtyMechanism = blocked;
                }
            }
            else {
                material.useLogarithmicDepth = true;
                if (material.isFrozen)
                    material.markDirty(true);
            }
        }
        material.stencil.enabled = true;
        material.stencil.func = Constants.GEQUAL;
        material.stencil.funcRef = level + 1;
        material.stencil.opStencilDepthPass = Constants.REPLACE;
        // Same-level surfaces still use ordinary depth testing. A later,
        // coarser level cannot overwrite a pixel already owned by finer data.
    }
    dispose() {
        this.scene.onBeforeRenderObservable.remove(this.observer);
        for (const detach of this.detach.values())
            detach();
        this.detach.clear();
        this.dirty.clear();
        this.meshes.clear();
    }
}
//# sourceMappingURL=MapLayerRenderer.js.map