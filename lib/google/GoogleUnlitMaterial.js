import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage.js";
import { Material } from "@babylonjs/core/Materials/material.js";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Scene } from "@babylonjs/core/scene.js";
/** Experimental opt-in shader correction for the opaque glTF unlit subset. */
export class GoogleUnlitLinearPlugin extends MaterialPluginBase {
    standard;
    constructor(standard) {
        super(standard, "GoogleUnlitLinear", 200, { GOOGLE_UNLIT_GAMMA_TEXTURE: false }, true, true);
        this.standard = standard;
        this.doNotSerialize = true;
    }
    isCompatible(language) {
        return language === ShaderLanguage.GLSL || language === ShaderLanguage.WGSL;
    }
    prepareDefines(defines) {
        defines.GOOGLE_UNLIT_GAMMA_TEXTURE
            = this.standard.diffuseTexture?.gammaSpace ?? false;
    }
    getCustomCode(shaderType, language = ShaderLanguage.GLSL) {
        if (shaderType !== "fragment" || !this.isCompatible(language))
            return null;
        if (language === ShaderLanguage.WGSL)
            return {
                CUSTOM_FRAGMENT_UPDATE_ALPHA: `
#if defined(DIFFUSE) && defined(GOOGLE_UNLIT_GAMMA_TEXTURE)
baseColor = vec4f(toLinearSpaceVec3(baseColor.rgb), baseColor.a);
#endif`,
                CUSTOM_FRAGMENT_BEFORE_FOG: "color = vec4f(toGammaSpaceVec3(color.rgb), color.a);",
            };
        return {
            CUSTOM_FRAGMENT_UPDATE_ALPHA: `
#if defined(DIFFUSE) && defined(GOOGLE_UNLIT_GAMMA_TEXTURE)
baseColor.rgb = toLinearSpace(baseColor.rgb);
#endif`,
            CUSTOM_FRAGMENT_BEFORE_FOG: "color.rgb = toGammaSpace(color.rgb);",
        };
    }
}
/** Separate opt-in experiment; undefined leaves the caller on native PBR.
 * Inputs are the original glTF material and untouched native atlas. Fog and
 * unsupported material states remain on PBR. Do not enable fog on this subset.
 */
export function tryCreateGoogleUnlitMaterial(name, scene, source, baseColorTexture) {
    const pbr = source.pbrMetallicRoughness, factor = pbr?.baseColorFactor ?? [1, 1, 1, 1];
    const extraOutputs = scene;
    if (!source.extensions?.KHR_materials_unlit || Object.keys(source.extensions).some(key => key !== "KHR_materials_unlit")
        || source.alphaMode !== undefined && source.alphaMode !== "OPAQUE" || scene.fogMode !== Scene.FOGMODE_NONE
        || extraOutputs.prePassRenderer?.enabled || extraOutputs.geometryBufferRenderer
        || factor.length !== 4 || factor.some(value => !Number.isFinite(value) || value < 0 || value > 1)
        || source.normalTexture || source.occlusionTexture || source.emissiveTexture || pbr?.metallicRoughnessTexture
        || pbr?.baseColorTexture && ((pbr.baseColorTexture.texCoord ?? 0) !== 0
            || Object.keys(pbr.baseColorTexture.extensions ?? {}).length || !baseColorTexture)
        || !pbr?.baseColorTexture && baseColorTexture
        || baseColorTexture && (baseColorTexture.getScene() !== scene || baseColorTexture.level !== 1))
        return undefined;
    const material = new StandardMaterial(name, scene);
    material.disableLighting = true;
    material.diffuseColor = Color3.FromArray(factor);
    material.diffuseTexture = baseColorTexture ?? null;
    material.emissiveColor = Color3.White();
    material.linkEmissiveWithDiffuse = true;
    material.useEmissiveAsIllumination = false;
    material.ambientColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.alpha = 1;
    material.transparencyMode = Material.MATERIAL_OPAQUE;
    material.useAlphaFromDiffuseTexture = false;
    material.backFaceCulling = !source.doubleSided;
    material.twoSidedLighting = !!source.doubleSided;
    new GoogleUnlitLinearPlugin(material);
    return material;
}
//# sourceMappingURL=GoogleUnlitMaterial.js.map