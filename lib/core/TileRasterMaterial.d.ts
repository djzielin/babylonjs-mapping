import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
/** A raster tile owns its material, so dirty only the meshes bound to it. */
export declare class TileRasterMaterial extends StandardMaterial {
    protected _markAllSubMeshesAsDirty(update: (defines: MaterialDefines) => void): void;
    markDirty(forceMaterialDirty?: boolean): void;
}
