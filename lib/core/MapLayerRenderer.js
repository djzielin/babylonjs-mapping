import { Constants } from "@babylonjs/core/Engines/constants.js";
import { RenderingManager } from "@babylonjs/core/Rendering/renderingManager.js";
/** Finer map coverage replaces coarse coverage, with one shared depth buffer. */
export default class MapLayerRenderer {
    constructor(scene, maximumLevel = 7) {
        this.scene = scene;
        this.maximumLevel = maximumLevel;
        this.meshes = new Map();
        RenderingManager.MAX_RENDERINGGROUPS = Math.max(RenderingManager.MAX_RENDERINGGROUPS, maximumLevel + 1);
        for (let group = 0; group <= maximumLevel; group++)
            scene.setRenderingAutoClearDepthStencil(group, false);
        this.observer = scene.onBeforeRenderObservable.add(() => {
            for (const [mesh, level] of this.meshes) {
                if (mesh.isDisposed()) {
                    this.meshes.delete(mesh);
                    continue;
                }
                this.configure(mesh, level);
            }
        });
    }
    add(mesh, level) {
        if (!Number.isInteger(level) || level < 0 || level > this.maximumLevel)
            throw new RangeError("Invalid map layer level");
        this.meshes.set(mesh, level);
        this.configure(mesh, level);
    }
    configure(mesh, level) {
        mesh.renderingGroupId = this.maximumLevel - level;
        const material = mesh.material;
        if (!material)
            return;
        material.stencil.enabled = true;
        material.stencil.func = Constants.GEQUAL;
        material.stencil.funcRef = level + 1;
        material.stencil.opStencilDepthPass = Constants.REPLACE;
        // Same-level surfaces still use ordinary depth testing. A later,
        // coarser level cannot overwrite a pixel already owned by finer data.
    }
    dispose() {
        this.scene.onBeforeRenderObservable.remove(this.observer);
        this.meshes.clear();
    }
}
//# sourceMappingURL=MapLayerRenderer.js.map