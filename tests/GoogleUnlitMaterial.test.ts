import { afterEach, expect, it, vi } from "vitest";
import { Color3, Material, NullEngine, Scene, Texture } from "@babylonjs/core";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage.js";
import { defaultPixelShader } from "@babylonjs/core/Shaders/default.fragment.js";
import { defaultPixelShaderWGSL } from "@babylonjs/core/ShadersWGSL/default.fragment.js";
import { pbrBlockImageProcessing } from "@babylonjs/core/Shaders/ShadersInclude/pbrBlockImageProcessing.js";
import { GoogleUnlitLinearPlugin, tryCreateGoogleUnlitMaterial } from "../src/google/GoogleUnlitMaterial";

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(dispose => dispose()); vi.restoreAllMocks(); });
function setup() {
    const engine = new NullEngine(), scene = new Scene(engine);
    cleanup.push(() => { scene.dispose(); engine.dispose(); });
    return scene;
}
const source = (factor = [0.2, 0.7, 1, 0.3]) => ({ extensions: { KHR_materials_unlit: {} },
    alphaMode: "OPAQUE" as const, pbrMetallicRoughness: { baseColorFactor: factor } });

it("keeps linear source factors, opaque alpha, disabled lighting and double-sided semantics", () => {
    const scene = setup(), material = tryCreateGoogleUnlitMaterial("Google unlit", scene, { ...source(), doubleSided: true })!;
    expect(material).toBeDefined();
    expect(material.diffuseColor.asArray()).toEqual([0.2, 0.7, 1]);
    expect(material.emissiveColor.equals(Color3.White())).toBe(true);
    expect(material.ambientColor.equals(Color3.Black())).toBe(true); expect(material.specularColor.equals(Color3.Black())).toBe(true);
    expect(material.disableLighting).toBe(true); expect(material.linkEmissiveWithDiffuse).toBe(true);
    expect(material.useEmissiveAsIllumination).toBe(false); expect(material.useAlphaFromDiffuseTexture).toBe(false);
    expect(material.alpha).toBe(1); expect(material.transparencyMode).toBe(Material.MATERIAL_OPAQUE);
    expect(material.backFaceCulling).toBe(false); expect(material.twoSidedLighting).toBe(true);
});

it("borrows the native atlas without mutating sampling, gamma, bytes or ownership", () => {
    const scene = setup(), texture = new Texture(null, scene);
    texture.wrapU = Texture.CLAMP_ADDRESSMODE; texture.wrapV = Texture.MIRROR_ADDRESSMODE;
    const before = { gamma: texture.gammaSpace, wrapU: texture.wrapU, wrapV: texture.wrapV, level: texture.level };
    const dispose = vi.spyOn(texture, "dispose");
    const material = tryCreateGoogleUnlitMaterial("Google atlas", scene,
        { ...source(), pbrMetallicRoughness: { ...source().pbrMetallicRoughness, baseColorTexture: { index: 0 } } }, texture)!;
    expect(material.diffuseTexture).toBe(texture);
    expect({ gamma: texture.gammaSpace, wrapU: texture.wrapU, wrapV: texture.wrapV, level: texture.level }).toEqual(before);
    material.dispose();
    expect(dispose).not.toHaveBeenCalled();
    expect(scene.materials.includes(material)).toBe(false); expect(material.pluginManager).toBeUndefined();
});

it.each([
    ["missing unlit", (scene: Scene, input: any) => { input.extensions = {}; }],
    ["fog", (scene: Scene) => { scene.fogMode = Scene.FOGMODE_LINEAR; }],
    ["blend", (_scene: Scene, input: any) => { input.alphaMode = "BLEND"; }],
    ["out-of-range factor", (_scene: Scene, input: any) => { input.pbrMetallicRoughness.baseColorFactor[0] = 1.1; }],
    ["normal map", (_scene: Scene, input: any) => { input.normalTexture = { index: 0 }; }],
    ["unresolved atlas", (_scene: Scene, input: any) => { input.pbrMetallicRoughness.baseColorTexture = { index: 0 }; }],
    ["extra prepass outputs", (scene: Scene) => { Object.defineProperty(scene, "prePassRenderer", { configurable: true, value: { enabled: true } }); }],
])("leaves %s on PBR without allocating a substitute", (_name, change) => {
    const scene = setup(), input: any = source(); (change as (scene: Scene, input: any) => void)(scene, input);
    const count = scene.materials.length;
    expect(tryCreateGoogleUnlitMaterial("unsupported", scene, input)).toBeUndefined();
    expect(scene.materials.length).toBe(count);
});

it("tracks hardware versus shader gamma decoding in plugin defines", () => {
    const scene = setup(), texture = new Texture(null, scene);
    const material = tryCreateGoogleUnlitMaterial("Google atlas", scene,
        { ...source(), pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }, texture)!;
    const plugin = material.pluginManager!.getPlugin("GoogleUnlitLinear") as GoogleUnlitLinearPlugin;
    const defines = {} as any;
    texture.gammaSpace = true; plugin.prepareDefines(defines);
    expect(defines.GOOGLE_UNLIT_GAMMA_TEXTURE).toBe(true);
    texture.gammaSpace = false; plugin.prepareDefines(defines);
    expect(defines.GOOGLE_UNLIT_GAMMA_TEXTURE).toBe(false);
});

it("places GLSL and WGSL corrections before texture level and image-processing conversion", () => {
    const scene = setup(), material = tryCreateGoogleUnlitMaterial("Google unlit", scene, source())!;
    const plugin = material.pluginManager!.getPlugin("GoogleUnlitLinear") as GoogleUnlitLinearPlugin;
    const glsl = plugin.getCustomCode("fragment", ShaderLanguage.GLSL)!;
    const wgsl = plugin.getCustomCode("fragment", ShaderLanguage.WGSL)!;
    expect(plugin.isCompatible(ShaderLanguage.GLSL)).toBe(true); expect(plugin.isCompatible(ShaderLanguage.WGSL)).toBe(true);
    expect(plugin.getCustomCode("vertex", ShaderLanguage.GLSL)).toBeNull();
    expect(glsl.CUSTOM_FRAGMENT_UPDATE_ALPHA).toContain("toLinearSpace(baseColor.rgb)");
    expect(wgsl.CUSTOM_FRAGMENT_UPDATE_ALPHA).toContain("toLinearSpaceVec3(baseColor.rgb)");
    expect(glsl.CUSTOM_FRAGMENT_BEFORE_FOG).toBe("color.rgb = toGammaSpace(color.rgb);");
    expect(wgsl.CUSTOM_FRAGMENT_BEFORE_FOG).toBe("color = vec4f(toGammaSpaceVec3(color.rgb), color.a);");
    expect(defaultPixelShader.shader.indexOf("CUSTOM_FRAGMENT_UPDATE_ALPHA"))
        .toBeLessThan(defaultPixelShader.shader.indexOf("baseColor.rgb*=vDiffuseInfos.y"));
    expect(defaultPixelShaderWGSL.shader.indexOf("CUSTOM_FRAGMENT_UPDATE_ALPHA"))
        .toBeLessThan(defaultPixelShaderWGSL.shader.indexOf("baseColor=vec4f(baseColor.rgb*uniforms.vDiffuseInfos.y"));
    expect(defaultPixelShader.shader.indexOf("CUSTOM_FRAGMENT_BEFORE_FOG"))
        .toBeLessThan(defaultPixelShader.shader.indexOf("color.rgb=toLinearSpace(color.rgb)"));
    expect(pbrBlockImageProcessing.shader).toContain("finalColor=applyImageProcessing(finalColor)");
});

it.each([false, true])("matches native unlit color algebra through default, material and post processing (%s)", gammaTexture => {
    const linear = (value: number) => Math.pow(value, 2.2), gamma = (value: number) => Math.pow(value, 1 / 2.2);
    for (const texture of [0, 0.02, 0.2, 0.5, 0.9, 1]) for (const factor of [0, 0.2, 0.7, 1]) {
        const decoded = gammaTexture ? linear(texture) : texture, nativeLinear = decoded * factor;
        const standardLinear = Math.min(1, Math.max(0, factor)) * decoded;
        const correctedBeforeProcessing = gamma(standardLinear);
        expect(correctedBeforeProcessing).toBeCloseTo(gamma(nativeLinear), 12);
        expect(linear(correctedBeforeProcessing)).toBeCloseTo(nativeLinear, 12);
        for (const exposure of [0.5, 1, 2]) {
            const process = (value: number) => Math.min(1, gamma(value * exposure));
            expect(process(linear(correctedBeforeProcessing))).toBeCloseTo(process(nativeLinear), 12);
        }
    }
});
