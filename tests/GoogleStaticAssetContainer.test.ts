import { afterEach, expect, it, vi } from "vitest";
import { AssetContainer, FreeCamera, MeshBuilder, NullEngine, PBRMaterial, Scene, Texture, TransformNode, Vector3 } from "@babylonjs/core";
import { attachGoogleStaticAssetContainer } from "../src/google/GoogleStaticAssetContainer";

const cleanup: (() => void)[] = [];
afterEach(() => {
    cleanup.splice(0).reverse().forEach(dispose => dispose());
    vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function setup() {
    const engine = new NullEngine(), scene = new Scene(engine), asset = new AssetContainer(scene);
    const root = new TransformNode("glTF root", scene);
    const mesh = MeshBuilder.CreateBox("Google static mesh", {}, scene); mesh.parent = root;
    const material = new PBRMaterial("Google atlas", scene), texture = new Texture(null, scene);
    material.albedoTexture = texture; mesh.material = material;
    asset.rootNodes.push(root); asset.meshes.push(mesh); asset.transformNodes.push(root);
    asset.materials.push(material); asset.textures.push(texture); asset.geometries.push(mesh.geometry!);
    asset.removeAllFromScene();
    cleanup.push(() => { scene.dispose(); engine.dispose(); });
    return { asset, scene, engine, root, mesh, material, texture, geometry: mesh.geometry! };
}

it("adds static resources in native order without copying the full scene node collections", () => {
    const { asset, scene, mesh, root, material, texture, geometry } = setup();
    for (let index = 0; index < 100; index++) MeshBuilder.CreateBox(`existing city ${index}`, {}, scene);
    const calls: string[] = [];
    for (const name of ["addMesh", "addMaterial", "addGeometry", "addTransformNode", "addTexture"] as const) {
        const original = scene[name].bind(scene) as (value: any) => unknown;
        vi.spyOn(scene, name).mockImplementation(((value: any) => { calls.push(name); return original(value); }) as any);
    }
    const NativeSet = Set;
    let fullSceneSnapshots = 0;
    vi.stubGlobal("Set", class extends NativeSet {
        constructor(values?: any) {
            if (values === scene.meshes || values === scene.transformNodes) fullSceneSnapshots++;
            super(values);
        }
    });
    expect(attachGoogleStaticAssetContainer(asset)).toBe(true);
    asset.addAllToScene();
    expect(calls).toEqual(["addMesh", "addMaterial", "addGeometry", "addTransformNode", "addTexture"]);
    expect(fullSceneSnapshots).toBe(0);
    expect(mesh.parent).toBe(root);
    expect(scene.meshes).toContain(mesh); expect(scene.transformNodes).toContain(root);
    expect(scene.materials).toContain(material); expect(scene.textures).toContain(texture); expect(scene.geometries).toContain(geometry);
    asset.addAllToScene();
    expect(calls).toHaveLength(5);
});

it("keeps native component hooks, context lifecycle, remove, re-add, and disposal behavior", () => {
    const { asset, scene, engine, mesh, root, material, texture, geometry } = setup();
    const component = { name: "test component", scene, addFromContainer: vi.fn(), removeFromContainer: vi.fn(), dispose() {} };
    scene._serializableComponents.push(component as any);
    const removeObserver = vi.spyOn(engine.onContextRestoredObservable, "remove");
    expect(attachGoogleStaticAssetContainer(asset)).toBe(true);
    asset.addAllToScene();
    expect(component.addFromContainer).toHaveBeenCalledExactlyOnceWith(asset);
    expect(removeObserver).toHaveBeenCalledOnce();
    asset.removeAllFromScene();
    expect(component.removeFromContainer).toHaveBeenCalledExactlyOnceWith(asset);
    expect(scene.meshes).not.toContain(mesh); expect(scene.transformNodes).not.toContain(root);
    expect(scene.materials).not.toContain(material); expect(scene.textures).not.toContain(texture); expect(scene.geometries).not.toContain(geometry);
    asset.addAllToScene();
    expect(scene.meshes.filter(value => value === mesh)).toHaveLength(1);
    expect(component.addFromContainer).toHaveBeenCalledTimes(2);
    const disposeTexture = vi.spyOn(texture, "dispose");
    asset.dispose();
    expect(mesh.isDisposed()).toBe(true); expect(root.isDisposed()).toBe(true);
    expect(scene.meshes).not.toContain(mesh); expect(scene.transformNodes).not.toContain(root);
    expect(scene.materials).not.toContain(material); expect(scene.textures).not.toContain(texture); expect(scene.geometries).not.toContain(geometry);
    expect(disposeTexture).toHaveBeenCalled();
});

it("falls back to native predicate handling and parent detachment", () => {
    const { asset, scene, mesh, root } = setup();
    expect(attachGoogleStaticAssetContainer(asset)).toBe(true);
    const predicate = vi.fn((value: unknown) => value === mesh);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    asset.addToScene(predicate);
    expect(predicate).toHaveBeenCalled();
    expect(scene.meshes).toContain(mesh);
    // The selected mesh's parent was not selected or inserted. Native behavior
    // detaches it; a local-only shortcut must never retain that absent parent.
    expect(mesh.parent).toBeNull();
    expect(scene.transformNodes).not.toContain(root);
    warn.mockRestore();
});

it("rechecks external parents at insertion and preserves native missing-parent semantics", () => {
    const { asset, scene, root } = setup();
    expect(attachGoogleStaticAssetContainer(asset)).toBe(true);
    const external = new TransformNode("missing external parent", scene); external.position.set(2, 3, 4);
    root.setParent(external); root.position.set(5, 6, 7); root.computeWorldMatrix(true);
    const previous = root.getAbsolutePosition().clone();
    scene.removeTransformNode(external);
    asset.addToScene();
    expect(root.parent).toBeNull();
    expect(Vector3.Distance(root.getAbsolutePosition(), previous)).toBeLessThan(1e-6);
});

it("rejects unsupported assets and rechecks resources added after attachment", () => {
    const { asset, scene } = setup();
    const camera = new FreeCamera("asset camera", Vector3.Zero(), scene);
    asset.cameras.push(camera); scene.removeCamera(camera);
    expect(attachGoogleStaticAssetContainer(asset)).toBe(false);
    asset.cameras.length = 0;
    expect(attachGoogleStaticAssetContainer(asset)).toBe(true);
    asset.cameras.push(camera);
    asset.addAllToScene();
    expect(scene.cameras).toContain(camera);
});
