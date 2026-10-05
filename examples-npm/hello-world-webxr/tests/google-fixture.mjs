// Authored, credential-free GLB for functional tests only. Performance acceptance
// uses actual Duke Google tiles and never uses this fixture.
export function googleFixture() {
    const lat = 36.00145 * Math.PI / 180;
    const lon = -78.94032 * Math.PI / 180;
    const n = 6378137 / Math.sqrt(1 - 0.00669437999014 * Math.sin(lat) ** 2);
    const center = [n * Math.cos(lat) * Math.cos(lon), n * Math.cos(lat) * Math.sin(lon), n * (1 - 0.00669437999014) * Math.sin(lat)];
    const binary = Buffer.alloc(44);
    [0, 0, 0, 20, 0, 0, 0, 20, 0].forEach((value, i) => binary.writeFloatLE(value, i * 4));
    [0, 1, 2].forEach((value, i) => binary.writeUInt16LE(value, 36 + i * 2));
    let json = JSON.stringify({
        asset: { version: '2.0', copyright: 'Mock fixture; Copyright test contributors' },
        extensions: { CESIUM_RTC: { center } },
        scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
        materials: [{ doubleSided: true, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 } }],
        buffers: [{ byteLength: binary.length }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }, { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [20, 20, 0] }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }],
    });
    json += ' '.repeat((4 - Buffer.byteLength(json) % 4) % 4);
    const bytes = Buffer.from(json);
    const glb = Buffer.alloc(12 + 8 + bytes.length + 8 + binary.length);
    glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(bytes.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); bytes.copy(glb, 20);
    glb.writeUInt32LE(binary.length, 20 + bytes.length); glb.writeUInt32LE(0x004e4942, 24 + bytes.length); binary.copy(glb, 28 + bytes.length);
    return { glb, tileset: { asset: { version: '1.1' }, geometricError: 0, root: {
        boundingVolume: { region: [lon - 0.0001, lat - 0.0001, lon + 0.0001, lat + 0.0001, -10, 50] },
        geometricError: 0, content: { uri: 'fixture.glb' },
    } } };
}
