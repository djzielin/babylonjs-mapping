import { AssetContainer } from "@babylonjs/core/assetContainer.js";
const wrapped = new WeakSet();
const unsupportedCollections = ["cameras", "lights", "skeletons", "particleSystems", "animations", "animationGroups",
    "multiMaterials", "morphTargetManagers", "actionManagers", "reflectionProbes", "spriteManagers", "postProcesses",
    "sounds", "effectLayers", "layers", "lensFlareSystems", "proceduralTextures"];
/** Avoid a city-wide parent snapshot when adding a self-contained static Google asset.
 * The native outer lifecycle, components, removals and disposal stay intact.
 */
export function attachGoogleStaticAssetContainer(asset) {
    if (wrapped.has(asset))
        return true;
    if (asset.addToScene !== AssetContainer.prototype.addToScene || !canAddLocally(asset))
        return false;
    const nativeAdd = asset.addToScene;
    asset.addToScene = function (predicate = null) {
        // Recheck mutable resources and parents on every insertion. The provider
        // attaches its external tile root after the initial asset insertion.
        if (predicate || !canAddLocally(this)) {
            nativeAdd.call(this, predicate);
            return;
        }
        // Exact native ordering for the supported resource types. Every parent
        // is in this asset and will be present after these calls, so none needs
        // the native scene-wide Set or transform-preserving parent detachment.
        for (const mesh of this.meshes)
            this.scene.addMesh(mesh);
        for (const material of this.materials)
            this.scene.addMaterial(material);
        for (const geometry of this.geometries)
            this.scene.addGeometry(geometry);
        for (const node of this.transformNodes)
            this.scene.addTransformNode(node);
        for (const texture of this.textures)
            this.scene.addTexture(texture);
    };
    wrapped.add(asset);
    return true;
}
function canAddLocally(asset) {
    if (asset.scene._blockEntityCollection || asset.environmentTexture || unsupportedCollections.some(key => !!asset[key]?.length))
        return false;
    const nodes = new Set([...asset.meshes, ...asset.transformNodes]);
    if (asset.rootNodes.some(node => !nodes.has(node)))
        return false;
    for (const node of nodes) {
        if (node.getScene() !== asset.scene || node.animations.length || (node.parent && !nodes.has(node.parent)))
            return false;
    }
    for (const mesh of asset.meshes) {
        if (mesh.getClassName() !== "Mesh" || mesh.skeleton || mesh.morphTargetManager)
            return false;
    }
    return true;
}
//# sourceMappingURL=GoogleStaticAssetContainer.js.map