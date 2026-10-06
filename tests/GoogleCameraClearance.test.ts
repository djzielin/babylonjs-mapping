import { afterEach, expect, it } from "vitest";
import { Mesh, MeshBuilder, NullEngine, Quaternion, Scene, TransformNode, Vector3, VertexData } from "@babylonjs/core";
import { sampleGoogleSurfaceElevation } from "../examples-npm/globe-mode/src/GoogleCameraClearance";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).reverse().forEach(dispose => dispose()));
function setup() {
    const engine = new NullEngine({ renderWidth: 512, renderHeight: 512, textureSize: 512,
        deterministicLockstep: false, lockstepMaxSteps: 4, useHighPrecisionMatrix: true });
    const scene = new Scene(engine), radius = 60, metresToWorld = radius / 6378137;
    cleanup.push(() => { scene.dispose(); engine.dispose(); });
    const globe = {
        metresToWorld,
        getSurfacePosition(latitude: number, longitude: number, elevation = 0) {
            const lat = latitude * Math.PI / 180, lon = longitude * Math.PI / 180, r = radius + elevation;
            return new Vector3(-r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.cos(lon));
        },
    };
    const roof = (height: number, longitude = 0) => {
        const root = new TransformNode("Google tile", scene);
        root.position.copyFrom(globe.getSurfacePosition(0, longitude, height * metresToWorld));
        root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), -longitude * Math.PI / 180);
        const mesh = MeshBuilder.CreatePlane("roof", { size: 80 * metresToWorld }, scene);
        mesh.parent = root;
        return { root, asset: { meshes: [mesh] } };
    };
    return { scene, globe, roof };
}

it("samples the highest roof triangle at the coordinate, excluding a taller neighboring roof", () => {
    const { globe, roof } = setup();
    const ground = roof(10), tower = roof(420), neighbor = roof(700, 0.001);
    const actualRoof = (Vector3.TransformCoordinates(Vector3.Zero(), tower.asset.meshes[0].computeWorldMatrix()).length() - 60)
        / globe.metresToWorld;
    expect(sampleGoogleSurfaceElevation(globe, [ground, neighbor, tower], 0, 0)).toBeCloseTo(actualRoof, 4);
    expect(actualRoof).toBeCloseTo(420, 0);
    expect(sampleGoogleSurfaceElevation(globe, [ground, tower], 0, 0.01)).toBeUndefined();
});

it("respects rotated, translated, and nonuniformly scaled model parents", () => {
    const { globe, roof } = setup();
    const model = roof(400, 60);
    model.root.scaling.set(2, 0.75, 1.5);
    model.asset.meshes[0].position.z = 100 * globe.metresToWorld;
    const actualRoof = (Vector3.TransformCoordinates(Vector3.Zero(), model.asset.meshes[0].computeWorldMatrix()).length() - 60)
        / globe.metresToWorld;
    expect(sampleGoogleSurfaceElevation(globe, [model], 0, 60)).toBeCloseTo(actualRoof, 3);
    expect(actualRoof).toBeCloseTo(550, 0);
});

it("ignores disabled models and meshes and leaves Babylon's vertex pick cache untouched", () => {
    const { globe, roof } = setup();
    const visible = roof(100), retained = roof(500), hidden = roof(300);
    retained.root.setEnabled(false); hidden.asset.meshes[0].setEnabled(false);
    const mesh = visible.asset.meshes[0] as typeof visible.asset.meshes[0] & { _positions?: unknown };
    const previous = mesh._positions;
    const actualRoof = (Vector3.TransformCoordinates(Vector3.Zero(), mesh.computeWorldMatrix()).length() - 60)
        / globe.metresToWorld;
    expect(sampleGoogleSurfaceElevation(globe, [retained, visible, hidden], 0, 0)).toBeCloseTo(actualRoof, 4);
    expect(mesh._positions).toBe(previous);
});

it("returns a signed elevation for actual Google triangles below globe zero", () => {
    const { globe, roof } = setup();
    const model = roof(-30);
    const actualRoof = (Vector3.TransformCoordinates(Vector3.Zero(), model.asset.meshes[0].computeWorldMatrix()).length() - 60)
        / globe.metresToWorld;
    expect(sampleGoogleSurfaceElevation(globe, [model], 0, 0)).toBeCloseTo(actualRoof, 4);
    expect(actualRoof).toBeCloseTo(-30, 0);
});

it("does not mistake a model on the opposite side of the globe for local surface coverage", () => {
    const { globe, roof } = setup();
    expect(sampleGoogleSurfaceElevation(globe, [roof(100, 180)], 0, 0)).toBeUndefined();
});

it("includes a narrow nearby spire within the safety column while retaining the exact center roof", () => {
    const { scene, globe, roof } = setup();
    const center = roof(347), spire = roof(443);
    spire.asset.meshes[0].dispose();
    const tip = MeshBuilder.CreatePlane("narrow spire tip", { size: 2 * globe.metresToWorld }, scene);
    tip.parent = spire.root; tip.position.x = 10 * globe.metresToWorld;
    spire.asset.meshes = [tip];
    expect(sampleGoogleSurfaceElevation(globe, [center, spire], 0, 0)).toBeCloseTo(347, 3);
    expect(sampleGoogleSurfaceElevation(globe, [center, spire], 0, 0, 15)).toBeCloseTo(443, 3);
});

it("excludes a narrow spire outside the sample radius and avoids loose bounding-box false positives", () => {
    const { scene, globe, roof } = setup();
    const center = roof(347), distantSpire = roof(800), corners = roof(900);
    distantSpire.asset.meshes[0].dispose();
    const tip = MeshBuilder.CreatePlane("distant spire", { size: 2 * globe.metresToWorld }, scene);
    tip.parent = distantSpire.root; tip.position.x = 25 * globe.metresToWorld;
    distantSpire.asset.meshes = [tip];
    corners.asset.meshes[0].dispose();
    const mesh = new Mesh("disconnected tall corners", scene), data = new VertexData();
    data.positions = [-26, -26, 0, -24, -26, 0, -26, -24, 0,
        26, 26, 0, 24, 26, 0, 26, 24, 0].map(value => value * globe.metresToWorld);
    data.indices = [0, 1, 2, 3, 4, 5];
    data.applyToMesh(mesh); mesh.parent = corners.root; corners.asset.meshes = [mesh];
    expect(sampleGoogleSurfaceElevation(globe, [center, distantSpire, corners], 0, 0, 20)).toBeCloseTo(347, 3);
});

it("ignores unreferenced high vertices when sampling the clearance column", () => {
    const { scene, globe, roof } = setup();
    const model = roof(100); model.asset.meshes[0].dispose();
    const mesh = new Mesh("roof with unused high vertex", scene), data = new VertexData();
    data.positions = [-1, -1, 0, 1, -1, 0, 0, 1, 0, 0, 0, 900].map(value => value * globe.metresToWorld);
    data.indices = [0, 1, 2]; data.applyToMesh(mesh); mesh.parent = model.root; model.asset.meshes = [mesh];
    expect(sampleGoogleSurfaceElevation(globe, [model], 0, 0, 15)).toBeCloseTo(100, 3);
});

it("measures column radius in world metres under transformed model parents", () => {
    const { scene, globe, roof } = setup();
    const spire = roof(400, 60); spire.asset.meshes[0].dispose();
    spire.root.scaling.set(2, 0.75, 1.5);
    const tip = MeshBuilder.CreatePlane("transformed nearby tip", { size: 2 * globe.metresToWorld }, scene);
    tip.parent = spire.root; tip.position.set(5 * globe.metresToWorld, 0, 100 * globe.metresToWorld);
    spire.asset.meshes = [tip];
    expect(sampleGoogleSurfaceElevation(globe, [spire], 0, 60)).toBeUndefined();
    expect(sampleGoogleSurfaceElevation(globe, [spire], 0, 60, 15)).toBeCloseTo(550, 3);
    expect(sampleGoogleSurfaceElevation(globe, [spire], 0, 60, 5)).toBeUndefined();
});
