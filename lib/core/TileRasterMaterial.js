import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
/** A raster tile owns its material, so dirty only the meshes bound to it. */
export class TileRasterMaterial extends StandardMaterial {
    _markAllSubMeshesAsDirty(update) {
        if (!this.meshMap) {
            super._markAllSubMeshesAsDirty(update);
            return;
        }
        const scene = this.getScene();
        if (scene.blockMaterialDirtyMechanism || this.blockDirtyMechanism)
            return;
        for (const mesh of this.getBindedMeshes())
            for (const subMesh of mesh.subMeshes) {
                if (subMesh.getMaterial() !== this)
                    continue;
                for (const wrapper of subMesh._drawWrappers) {
                    if (wrapper?.defines && typeof wrapper.defines !== "string"
                        && wrapper.materialContext === this._materialContext)
                        update(wrapper.defines);
                }
            }
    }
    markDirty(forceMaterialDirty = false) {
        if (!this.meshMap || forceMaterialDirty) {
            super.markDirty(forceMaterialDirty);
            return;
        }
        for (const mesh of this.getBindedMeshes())
            for (const subMesh of mesh.subMeshes) {
                if (subMesh.getMaterial() !== this)
                    continue;
                for (const wrapper of subMesh._drawWrappers) {
                    if (wrapper && wrapper.materialContext === this._materialContext) {
                        wrapper._wasPreviouslyReady = false;
                        wrapper._wasPreviouslyUsingInstances = null;
                        wrapper._forceRebindOnNextCall = false;
                    }
                }
            }
    }
}
//# sourceMappingURL=TileRasterMaterial.js.map