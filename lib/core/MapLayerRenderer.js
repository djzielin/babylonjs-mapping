import { Constants } from "@babylonjs/core/Engines/constants.js";
import { RenderingManager } from "@babylonjs/core/Rendering/renderingManager.js";
/** Finer map coverage replaces coarse coverage, with one shared depth buffer. */
export default class MapLayerRenderer {
    constructor(scene, maximumLevel = 7, options = {}) {
        this.scene = scene;
        this.maximumLevel = maximumLevel;
        this.options = options;
        this.meshes = new Map();
        this.dirty = new Set();
        this.detach = new Map();
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
            this.configureMaterial(mesh.material, level);
    }
    configureMaterial(material, level) {
        // glTF assets can use MultiMaterial: configure the actual submaterials
        // as well, otherwise they write a different depth encoding.
        const children = material.subMaterials;
        if (children)
            for (const child of children)
                if (child)
                    this.configureMaterial(child, level);
        if (this.options.logarithmicDepth && this.scene.getEngine().getCaps().fragmentDepthSupported && !material.useLogarithmicDepth) {
            material.useLogarithmicDepth = true;
            if (material.isFrozen)
                material.markDirty(true);
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