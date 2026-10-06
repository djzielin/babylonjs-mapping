import { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Material } from "@babylonjs/core/Materials/material.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { DracoDecoder } from "@babylonjs/core/Meshes/Compression/dracoDecoder.js";
import { Geometry } from "@babylonjs/core/Meshes/geometry.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { attachGoogleStaticAssetContainer } from "./GoogleStaticAssetContainer.js";
import { tryCreateGoogleUnlitMaterial } from "./GoogleUnlitMaterial.js";
const kinds = {
    POSITION: { kind: VertexBuffer.PositionKind, size: 3 }, NORMAL: { kind: VertexBuffer.NormalKind, size: 3 },
    TEXCOORD_0: { kind: VertexBuffer.UVKind, size: 2 },
};
let nextAssetId = 0;
/** Dimensions only; unknown or incomplete JPEG/PNG headers retain full-source decoding. */
export function googleAtlasDimensions(bytes, mimeType) {
    const dimensions = (width, height) => width > 0 && height > 0 ? { width, height } : undefined;
    if (mimeType === "image/png") {
        if (bytes.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value))
            return undefined;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452 ? dimensions(view.getUint32(16), view.getUint32(20)) : undefined;
    }
    if (mimeType !== "image/jpeg" || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216)
        return undefined;
    let offset = 2;
    while (offset < bytes.length) {
        if (bytes[offset++] !== 255)
            return undefined;
        while (bytes[offset] === 255)
            offset++;
        const marker = bytes[offset++];
        if (marker === undefined || marker === 217 || marker === 218)
            return undefined;
        if (marker === 1 || marker >= 208 && marker <= 216)
            continue;
        if (offset + 2 > bytes.length)
            return undefined;
        const length = bytes[offset] * 256 + bytes[offset + 1];
        if (length < 2 || offset + length > bytes.length)
            return undefined;
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker))
            return length >= 8 ? dimensions(bytes[offset + 5] * 256 + bytes[offset + 6], bytes[offset + 3] * 256 + bytes[offset + 4]) : undefined;
        offset += length;
    }
    return undefined;
}
function extensionsAre(value, allowed) {
    return Object.keys(value.extensions ?? {}).every(name => allowed.includes(name));
}
function parse(buffer) {
    try {
        if (buffer.byteLength < 28)
            return undefined;
        const header = new DataView(buffer);
        if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2
            || header.getUint32(8, true) !== buffer.byteLength || header.getUint32(16, true) !== 0x4e4f534a)
            return undefined;
        const jsonLength = header.getUint32(12, true), binHeader = 20 + jsonLength;
        if (jsonLength % 4 || binHeader + 8 > buffer.byteLength || header.getUint32(binHeader + 4, true) !== 0x004e4942)
            return undefined;
        const binLength = header.getUint32(binHeader, true);
        if (binHeader + 8 + binLength !== buffer.byteLength)
            return undefined;
        const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)).replace(/\0+$/, ""));
        const glb = { json, binary: new Uint8Array(buffer, binHeader + 8, binLength) };
        return supported(glb) ? glb : undefined;
    }
    catch {
        return undefined;
    }
}
function supported(glb) {
    const { json, binary } = glb;
    if (json.asset?.version !== "2.0" || json.animations?.length || json.skins?.length || !json.nodes?.length
        || !json.meshes?.length || !json.scenes?.length || json.buffers?.length !== 1 || json.buffers[0].uri
        || json.buffers[0].byteLength > binary.byteLength || !extensionsAre(json, ["CESIUM_RTC"]))
        return false;
    const allowed = ["KHR_materials_unlit", "KHR_draco_mesh_compression", "KHR_mesh_quantization", "CESIUM_RTC"];
    if ([...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])].some(name => !allowed.includes(name)))
        return false;
    if (!json.bufferViews?.every(view => view.buffer === 0 && Number.isInteger(view.byteLength) && view.byteLength >= 0
        && (view.byteOffset ?? 0) >= 0 && (view.byteOffset ?? 0) + view.byteLength <= binary.byteLength && extensionsAre(view, [])))
        return false;
    const index = (value, length) => value !== undefined && Number.isInteger(value) && value >= 0 && value < length;
    const array = (value, length) => value === undefined || value.length === length && value.every(Number.isFinite);
    if (!json.nodes.every(node => node.skin === undefined && node.camera === undefined && !node.weights?.length && extensionsAre(node, [])
        && (node.mesh === undefined || index(node.mesh, json.meshes.length)) && (node.children ?? []).every(child => index(child, json.nodes.length))
        && array(node.matrix, 16) && array(node.translation, 3) && array(node.rotation, 4) && array(node.scale, 3)))
        return false;
    const meshes = json.nodes.flatMap(node => node.mesh === undefined ? [] : [node.mesh]);
    if (new Set(meshes).size !== meshes.length)
        return false; // Instances remain on the native path.
    const scene = json.scenes[json.scene ?? 0];
    if (!scene || !extensionsAre(scene, []) || !scene.nodes?.length)
        return false;
    const visited = new Set();
    const tree = (node) => index(node, json.nodes.length) && !visited.has(node)
        && (visited.add(node), (json.nodes[node].children ?? []).every(tree));
    if (!scene.nodes.every(tree))
        return false;
    if (!json.meshes.every(mesh => !mesh.weights?.length && extensionsAre(mesh, []) && !!mesh.primitives.length
        && mesh.primitives.every(primitive => supportedPrimitive(glb, primitive))))
        return false;
    if (!json.materials?.every(material => extensionsAre(material, ["KHR_materials_unlit"])
        && (material.alphaMode === undefined || material.alphaMode === "OPAQUE") && !material.normalTexture && !material.occlusionTexture
        && !material.emissiveTexture && !material.pbrMetallicRoughness?.metallicRoughnessTexture
        && (!material.pbrMetallicRoughness?.baseColorTexture || (material.pbrMetallicRoughness.baseColorTexture.texCoord ?? 0) === 0
            && extensionsAre(material.pbrMetallicRoughness.baseColorTexture, [])
            && index(material.pbrMetallicRoughness.baseColorTexture.index, json.textures?.length ?? 0))
        && array(material.pbrMetallicRoughness?.baseColorFactor, 4) && array(material.emissiveFactor, 3)))
        return false;
    if (!json.textures?.every(texture => extensionsAre(texture, []) && index(texture.source, json.images?.length ?? 0)
        && (texture.sampler === undefined || index(texture.sampler, json.samplers?.length ?? 0))))
        return false;
    if (!json.images?.every(image => !image.uri && extensionsAre(image, []) && (image.mimeType === "image/jpeg" || image.mimeType === "image/png")
        && index(image.bufferView, json.bufferViews.length)))
        return false;
    if (json.samplers?.some(sampler => !extensionsAre(sampler, []) || ![undefined, 9728, 9729].includes(sampler.magFilter)
        || ![undefined, 9728, 9729, 9984, 9985, 9986, 9987].includes(sampler.minFilter)
        || ![undefined, 33071, 33648, 10497].includes(sampler.wrapS) || ![undefined, 33071, 33648, 10497].includes(sampler.wrapT)))
        return false;
    return true;
}
function supportedPrimitive(glb, primitive) {
    const { json } = glb;
    if (primitive.mode !== undefined && primitive.mode !== 4 || primitive.targets?.length || !extensionsAre(primitive, ["KHR_draco_mesh_compression"]))
        return false;
    if (primitive.attributes.POSITION === undefined)
        return false;
    const position = json.accessors?.[primitive.attributes.POSITION];
    if (!position || !Number.isInteger(position.count) || position.count <= 0 || primitive.material !== undefined && !json.materials?.[primitive.material])
        return false;
    if (primitive.attributes.NORMAL === undefined && !json.materials?.[primitive.material ?? -1]?.extensions?.KHR_materials_unlit)
        return false;
    if (json.materials?.[primitive.material ?? -1]?.pbrMetallicRoughness?.baseColorTexture && primitive.attributes.TEXCOORD_0 === undefined)
        return false;
    const draco = primitive.extensions?.KHR_draco_mesh_compression;
    if (draco && !json.bufferViews?.[draco.bufferView])
        return false;
    if (draco && Object.keys(draco.attributes).some(semantic => !kinds[semantic] || primitive.attributes[semantic] === undefined))
        return false;
    for (const [semantic, accessorIndex] of Object.entries(primitive.attributes)) {
        const kind = kinds[semantic], accessor = json.accessors?.[accessorIndex];
        if (!kind || !accessor || accessor.componentType !== 5126 || accessor.normalized || accessor.sparse || !extensionsAre(accessor, [])
            || accessor.type !== `VEC${kind.size}` || accessor.count !== position.count)
            return false;
        if (draco) {
            if (!Number.isInteger(draco.attributes[semantic]) || draco.attributes[semantic] < 0)
                return false;
        }
        else if (!accessorBytes(glb, accessor, kind.size, 4))
            return false;
    }
    const indices = primitive.indices === undefined ? undefined : json.accessors?.[primitive.indices];
    if (!indices || indices.type !== "SCALAR" || indices.normalized || indices.sparse || !extensionsAre(indices, [])
        || ![5121, 5123, 5125].includes(indices.componentType) || !Number.isInteger(indices.count) || indices.count <= 0 || indices.count % 3)
        return false;
    return !!draco || !!accessorBytes(glb, indices, 1, indices.componentType === 5121 ? 1 : indices.componentType === 5123 ? 2 : 4);
}
function accessorBytes({ json, binary }, accessor, size, bytes) {
    const view = accessor.bufferView === undefined ? undefined : json.bufferViews?.[accessor.bufferView];
    const offset = accessor.byteOffset ?? 0, length = accessor.count * size * bytes;
    if (!view || !Number.isInteger(offset) || offset < 0 || offset + length > view.byteLength
        || view.byteStride !== undefined && view.byteStride !== size * bytes)
        return undefined;
    const start = binary.byteOffset + (view.byteOffset ?? 0) + offset;
    if (start % bytes)
        return undefined;
    return new Uint8Array(binary.buffer, start, length);
}
/** Static Google format only. Unsupported content and allocation/decode errors return to the native loader. */
export async function tryLoadGoogle3DFastModel(buffer, scene, signal, timing, atlasOptions, lightweightUnlitMaterials = false) {
    signal?.throwIfAborted();
    const record = (phase, started) => {
        if (timing) {
            try {
                timing(phase, performance.now() - started);
            }
            catch { /* Diagnostics cannot change loading. */ }
        }
    };
    const timed = (phase, work) => {
        const started = performance.now();
        try {
            return work();
        }
        finally {
            record(phase, started);
        }
    };
    const glb = timed("parse", () => parse(buffer));
    if (!glb)
        return undefined;
    const { json, binary } = glb, asset = new AssetContainer(scene), id = nextAssetId++;
    const jobs = [];
    const preparation = new AbortController();
    const forwardAbort = () => preparation.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    const cancelled = new Promise((_resolve, reject) => preparation.signal.addEventListener("abort", () => reject(new DOMException("Static model preparation cancelled.", "AbortError")), { once: true }));
    void cancelled.catch(() => undefined);
    let stopped = false;
    const check = () => { preparation.signal.throwIfAborted(); if (stopped)
        throw new DOMException("Static model preparation stopped.", "AbortError"); };
    const blocked = (work) => {
        const oldEntities = scene._blockEntityCollection, oldDirty = scene.blockMaterialDirtyMechanism;
        scene._blockEntityCollection = true;
        scene._forceBlockMaterialDirtyMechanism(true);
        try {
            return work();
        }
        finally {
            scene._blockEntityCollection = oldEntities;
            scene._forceBlockMaterialDirtyMechanism(oldDirty);
        }
    };
    const owned = (value) => { value._parentContainer = asset; return value; };
    const viewBytes = (index) => {
        const view = json.bufferViews[index];
        return new Uint8Array(binary.buffer, binary.byteOffset + (view.byteOffset ?? 0), view.byteLength);
    };
    const texture = (index) => {
        const atlasStarted = performance.now();
        const source = json.textures[index], image = json.images[source.source], sampler = source.sampler === undefined ? {} : json.samplers[source.sampler];
        let complete, fail, reported = false;
        const ready = new Promise((resolve, reject) => {
            complete = () => {
                if (!reported) {
                    reported = true;
                    record("atlasReady", atlasStarted);
                }
                resolve();
            };
            fail = reject;
        });
        const abort = () => fail(new DOMException("Static texture preparation cancelled.", "AbortError"));
        preparation.signal.addEventListener("abort", abort, { once: true });
        jobs.push(ready.finally(() => preparation.signal.removeEventListener("abort", abort)));
        const min = sampler.minFilter ?? 9987, mag = sampler.magFilter ?? 9729;
        const modes = mag === 9729
            ? [Texture.LINEAR_NEAREST, Texture.LINEAR_LINEAR, Texture.LINEAR_NEAREST_MIPNEAREST, Texture.LINEAR_LINEAR_MIPNEAREST, Texture.LINEAR_NEAREST_MIPLINEAR, Texture.LINEAR_LINEAR_MIPLINEAR]
            : [Texture.NEAREST_NEAREST, Texture.NEAREST_LINEAR, Texture.NEAREST_NEAREST_MIPNEAREST, Texture.NEAREST_LINEAR_MIPNEAREST, Texture.NEAREST_NEAREST_MIPLINEAR, Texture.NEAREST_LINEAR_MIPLINEAR];
        const result = owned(new Texture(null, scene, { noMipmap: min === 9728 || min === 9729, invertY: false,
            samplingMode: modes[[9728, 9729, 9984, 9985, 9986, 9987].indexOf(min)], mimeType: image.mimeType,
            useSRGBBuffer: true, onLoad: complete, onError: () => fail(new Error("Static Google atlas failed to load.")) }));
        asset.textures.push(result);
        const wrap = (value) => value === 33071 ? Texture.CLAMP_ADDRESSMODE : value === 33648 ? Texture.MIRROR_ADDRESSMODE : Texture.WRAP_ADDRESSMODE;
        result.wrapU = wrap(sampler.wrapS);
        result.wrapV = wrap(sampler.wrapT);
        const url = `data:google-static-${id}#image${source.source}`;
        const bytes = viewBytes(image.bufferView);
        const maximum = atlasOptions?.maxSize && Number.isInteger(atlasOptions.maxSize) && atlasOptions.maxSize > 0 ? atlasOptions.maxSize : undefined;
        const sourceSize = maximum ? googleAtlasDimensions(bytes, image.mimeType) : undefined;
        const ratio = maximum && sourceSize && Math.max(sourceSize.width, sourceSize.height) > maximum
            ? maximum / Math.max(sourceSize.width, sourceSize.height) : undefined;
        const resize = ratio && sourceSize ? { resizeWidth: Math.max(1, Math.round(sourceSize.width * ratio)),
            resizeHeight: Math.max(1, Math.round(sourceSize.height * ratio)), resizeQuality: "high" } : undefined;
        const report = (width, height, resized) => {
            if (atlasOptions?.decoded) {
                try {
                    atlasOptions.decoded({ sourceWidth: sourceSize?.width,
                        sourceHeight: sourceSize?.height, width, height, resized });
                }
                catch { /* Diagnostic only. */ }
            }
        };
        // The engine may perform its image upload later; this measures only the
        // synchronous updateURL call, rather than claiming total GPU upload time.
        const upload = (data) => timed("atlasUpdate", () => result.updateURL(url, data));
        if (typeof createImageBitmap === "function") {
            // Decode the embedded atlas directly. The engine's generic bitmap
            // path first creates a Blob URL and reads it back through XHR.
            // Keep the bitmap until disposal so context restoration can reuse it.
            const bitmapStarted = performance.now();
            const decoding = createImageBitmap(new Blob([bytes], { type: image.mimeType }), { premultiplyAlpha: "none", colorSpaceConversion: "none", imageOrientation: "none", ...resize });
            void decoding.then(bitmap => {
                record("atlasBitmap", bitmapStarted);
                if (preparation.signal.aborted || stopped) {
                    bitmap.close();
                    return;
                }
                if (resize && (bitmap.width !== resize.resizeWidth || bitmap.height !== resize.resizeHeight)) {
                    bitmap.close();
                    try {
                        upload(bytes);
                        if (sourceSize)
                            report(sourceSize.width, sourceSize.height, false);
                    }
                    catch {
                        fail(new Error("Static Google atlas failed to upload."));
                    }
                    return;
                }
                let closed = false;
                const close = () => { if (!closed) {
                    closed = true;
                    bitmap.close();
                } };
                result.onDisposeObservable.addOnce(close);
                try {
                    check();
                    upload(bitmap);
                    report(bitmap.width, bitmap.height, !!resize);
                }
                catch {
                    close();
                    fail(new Error("Static Google atlas failed to upload."));
                }
            }, () => {
                record("atlasBitmap", bitmapStarted);
                // Browser bitmap support may exclude a valid JPEG/PNG format.
                if (!preparation.signal.aborted && !stopped) {
                    try {
                        upload(bytes);
                        if (sourceSize)
                            report(sourceSize.width, sourceSize.height, false);
                    }
                    catch {
                        fail(new Error("Static Google atlas failed to upload."));
                    }
                }
            });
        }
        else {
            upload(bytes);
            if (sourceSize)
                report(sourceSize.width, sourceSize.height, false);
        }
        return result;
    };
    const materials = new Map();
    const material = (index) => {
        const key = index ?? -1;
        if (materials.has(key))
            return materials.get(key);
        return timed("material", () => {
            const source = index === undefined ? {} : json.materials[index], pbr = source.pbrMetallicRoughness;
            const name = source.name ?? `material${key}`;
            const useLightweight = lightweightUnlitMaterials && !scene.getEngine().isWebGPU;
            const baseTexture = useLightweight && pbr?.baseColorTexture ? texture(pbr.baseColorTexture.index) : undefined;
            const lightweight = useLightweight ? tryCreateGoogleUnlitMaterial(name, scene, source, baseTexture) : undefined;
            if (lightweight) {
                owned(lightweight);
                asset.materials.push(lightweight);
                materials.set(key, lightweight);
                if (baseTexture)
                    baseTexture.name = `${name} (Base Color)`;
                return lightweight;
            }
            const result = owned(new PBRMaterial(name, scene));
            asset.materials.push(result);
            materials.set(key, result);
            result.enableSpecularAntiAliasing = true;
            result.useRadianceOverAlpha = true;
            result.useSpecularOverAlpha = true;
            result.unlit = !!source.extensions?.KHR_materials_unlit;
            result.metallic = result.unlit ? 1 : pbr?.metallicFactor ?? 1;
            result.roughness = result.unlit ? 1 : pbr?.roughnessFactor ?? 1;
            result.albedoColor = pbr?.baseColorFactor ? Color3.FromArray(pbr.baseColorFactor) : Color3.White();
            result.alpha = 1;
            result.transparencyMode = Material.MATERIAL_OPAQUE;
            result.emissiveColor = !result.unlit && source.emissiveFactor ? Color3.FromArray(source.emissiveFactor) : Color3.Black();
            if (source.doubleSided) {
                result.backFaceCulling = false;
                result.twoSidedLighting = true;
            }
            if (pbr?.baseColorTexture) {
                result.albedoTexture = baseTexture ?? texture(pbr.baseColorTexture.index);
                result.albedoTexture.name = `${result.name} (Base Color)`;
            }
            result.maxSimultaneousLights = Math.max(result.maxSimultaneousLights, scene.lights.length);
            return result;
        });
    };
    const loadGeometry = async (primitive, mesh) => {
        const draco = primitive.extensions?.KHR_draco_mesh_compression;
        const data = draco ? await Promise.race([DracoDecoder.Default.decodeMeshToMeshDataAsync(viewBytes(draco.bufferView), Object.fromEntries(Object.keys(primitive.attributes).map(semantic => [kinds[semantic].kind, draco.attributes[semantic]])), Object.fromEntries(Object.keys(primitive.attributes).map(semantic => [kinds[semantic].kind, false]))), cancelled]) : undefined;
        check();
        timed("geometry", () => blocked(() => {
            const geometry = owned(new Geometry(mesh.name, scene));
            asset.geometries.push(geometry);
            const position = json.accessors[primitive.attributes.POSITION];
            if (position.min?.length === 3 && position.max?.length === 3) {
                geometry._boundingInfo = new BoundingInfo(Vector3.FromArray(position.min), Vector3.FromArray(position.max));
                geometry.useBoundingInfoFromGeometry = true;
            }
            if (data) {
                if (!data.indices || data.totalVertices !== position.count)
                    throw new Error("Unsupported decoded static mesh.");
                geometry.setIndices(data.indices);
                for (const attribute of data.attributes)
                    geometry.setVerticesBuffer(new VertexBuffer(scene.getEngine(), attribute.data, attribute.kind, false, undefined, attribute.byteStride, undefined, attribute.byteOffset, attribute.size, undefined, attribute.normalized, true), data.totalVertices);
            }
            else {
                const indices = json.accessors[primitive.indices], bytes = accessorBytes(glb, indices, 1, indices.componentType === 5121 ? 1 : indices.componentType === 5123 ? 2 : 4);
                geometry.setIndices(indices.componentType === 5121 ? Uint16Array.from(bytes) : indices.componentType === 5123
                    ? new Uint16Array(bytes.buffer, bytes.byteOffset, indices.count) : new Uint32Array(bytes.buffer, bytes.byteOffset, indices.count));
                for (const [semantic, index] of Object.entries(primitive.attributes)) {
                    const accessor = json.accessors[index], kind = kinds[semantic], bytes = accessorBytes(glb, accessor, kind.size, 4);
                    geometry.setVerticesBuffer(new VertexBuffer(scene.getEngine(), new Float32Array(bytes.buffer, bytes.byteOffset, accessor.count * kind.size), kind.kind, false, undefined, kind.size), accessor.count);
                }
            }
            geometry.applyToMesh(mesh);
        }));
    };
    const primitiveMesh = (primitive, name) => {
        const mesh = owned(new Mesh(name, scene));
        asset.meshes.push(mesh);
        mesh.sideOrientation = scene.useRightHandedSystem ? Material.CounterClockWiseSideOrientation : Material.ClockWiseSideOrientation;
        mesh.material = material(primitive.material);
        jobs.push(loadGeometry(primitive, mesh));
        return mesh;
    };
    const transform = (node, target) => {
        if (node.matrix)
            Matrix.FromArray(node.matrix).decompose(target.scaling, target.rotationQuaternion = Quaternion.Identity(), target.position);
        else {
            if (node.translation)
                target.position.copyFromFloats(...node.translation);
            target.rotationQuaternion = node.rotation ? Quaternion.FromArray(node.rotation) : Quaternion.Identity();
            if (node.scale)
                target.scaling.copyFromFloats(...node.scale);
        }
    };
    try {
        const root = timed("creation", () => blocked(() => {
            const root = owned(new Mesh("__root__", scene));
            asset.meshes.push(root);
            asset.rootNodes.push(root);
            root.setEnabled(false);
            if (!scene.useRightHandedSystem) {
                root.rotationQuaternion = new Quaternion(0, 1, 0, 0);
                root.scaling.set(1, 1, -1);
            }
            const build = (index, parent) => {
                const node = json.nodes[index], primitives = node.mesh === undefined ? [] : json.meshes[node.mesh].primitives;
                const name = node.name ?? `node${index}`;
                const target = primitives.length === 1 ? primitiveMesh(primitives[0], name) : owned(new TransformNode(name, scene));
                if (!(target instanceof Mesh))
                    asset.transformNodes.push(target);
                target.parent = parent;
                transform(node, target);
                if (primitives.length > 1)
                    primitives.forEach((primitive, i) => { primitiveMesh(primitive, `${name}_primitive${i}`).parent = target; });
                (node.children ?? []).forEach(child => build(child, target));
            };
            json.scenes[json.scene ?? 0].nodes.forEach(index => build(index, root));
            return root;
        }));
        await Promise.all(jobs);
        check();
        root.setEnabled(true);
        attachGoogleStaticAssetContainer(asset);
        const copyright = json.asset.copyright;
        const center = json.extensions?.CESIUM_RTC?.center;
        return { asset, attributions: typeof copyright === "string" ? copyright.split(";").map(value => value.trim()).filter(Boolean) : [],
            rtcCenter: Array.isArray(center) && center.length === 3 && center.every(Number.isFinite) ? Vector3.FromArray(center) : undefined,
            renderable: asset.meshes.some(mesh => mesh.getTotalVertices() > 0) };
    }
    catch {
        stopped = true;
        preparation.abort();
        asset.dispose();
        await Promise.allSettled(jobs);
        signal?.throwIfAborted();
        return undefined;
    }
    finally {
        signal?.removeEventListener("abort", forwardAbort);
    }
}
//# sourceMappingURL=Google3DFastModel.js.map