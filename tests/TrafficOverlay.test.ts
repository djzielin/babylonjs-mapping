import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FreeCamera, MeshBuilder, NullEngine, RenderingManager, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import GlobeSet from "../src/GlobeSet";
import MapLayerRenderer from "../src/core/MapLayerRenderer";
import { TrafficOverlay } from "../examples-npm/globe-mode/src/TrafficOverlay";

vi.mock("../src/core/Attribution", () => ({ default: class {
    advancedTexture = { layer: { isEnabled: true } };
    addAttribution = vi.fn();
} }));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const snapshot = (callsign: string) => ({ roads: [], aircraft: [
    { callsign, latitude: 0, longitude: 0, altitudeMeters: 500, heading: null },
], ships: [{ name: callsign, latitude: 0, longitude: 180, heading: null }] });
const response = (callsign: string) => ({ ok: true, json: async () => snapshot(callsign) } as Response);
const mapMaxLevel = 8;

let engine: NullEngine;
let scene: Scene;
let camera: FreeCamera;
let layers: MapLayerRenderer;
let overlay: TrafficOverlay;
let status: HTMLElement;
let endpoint: string;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    // Local demo installs can give TrafficOverlay a second Babylon module copy.
    // Enable its final overlay group in the root copy used by this test's Scene too.
    RenderingManager.MAX_RENDERINGGROUPS = Math.max(RenderingManager.MAX_RENDERINGGROUPS, mapMaxLevel + 2);
    engine = new NullEngine(); scene = new Scene(engine);
    camera = new FreeCamera("viewer", new Vector3(0, 0, 20), scene);
    const globe = new GlobeSet(scene, engine, { radius: 10 });
    layers = new MapLayerRenderer(scene, mapMaxLevel);
    status = { textContent: "" } as HTMLElement;
    endpoint = "/first";
    overlay = new TrafficOverlay(scene, globe, layers, status, () => endpoint, mapMaxLevel + 1);
    fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { overlay.dispose(); scene.dispose(); engine.dispose(); vi.unstubAllGlobals(); });

function updateCamera(position: Vector3) {
    camera.position.copyFrom(position);
    camera.getViewMatrix(true);
    scene.onBeforeRenderObservable.notifyObservers(scene);
}

describe("traffic overlay visibility", () => {
    it("renders badges after the merged globe's coarse fallback terrain", async () => {
        camera.setTarget(Vector3.Zero());
        const fallback = MeshBuilder.CreateSphere("Coarse fallback", { diameter: 20 }, scene);
        fallback.material = new StandardMaterial("Fallback", scene);
        layers.add(fallback, 0);
        fetchMock.mockResolvedValue(response("visible"));
        overlay.setEnabled(true); await overlay.refresh();
        await scene.whenReadyAsync();
        const order: number[] = [];
        scene.onBeforeRenderingGroupObservable.add(info => order.push(info.renderingGroupId));
        scene.render();
        const badge = scene.getMeshByName("Aircraft: visible")!;
        expect(order).toContain(fallback.renderingGroupId);
        expect(order).toContain(badge.renderingGroupId);
        expect(order.indexOf(badge.renderingGroupId)).toBeGreaterThan(order.indexOf(fallback.renderingGroupId));
        expect(scene.getAutoClearDepthStencilSetup(badge.renderingGroupId).autoClear).toBe(false);
    });
    it("hides far-side symbols and updates their horizon visibility when the camera moves", async () => {
        fetchMock.mockResolvedValue(response("visible"));
        overlay.setEnabled(true); await overlay.refresh();
        updateCamera(new Vector3(0, 0, 20));
        expect(scene.getMeshByName("Aircraft: visible")!.isEnabled()).toBe(true);
        expect(scene.getMeshByName("Ship: visible")!.isEnabled()).toBe(false);
        updateCamera(new Vector3(0, 0, -20));
        expect(scene.getMeshByName("Aircraft: visible")!.isEnabled()).toBe(false);
        expect(scene.getMeshByName("Ship: visible")!.isEnabled()).toBe(true);
    });
    it("keeps an elevated aircraft visible above the limb while hiding surface vessels", async () => {
        const angle = Math.acos(0.4) * 180 / Math.PI;
        const data = { roads: [], aircraft: [{ callsign: "high", latitude: 0, longitude: angle, altitudeMeters: 637813.7, heading: null }],
            ships: [{ name: "low", latitude: 0, longitude: angle, heading: null }] };
        fetchMock.mockResolvedValue({ ok: true, json: async () => data });
        overlay.setEnabled(true); await overlay.refresh();
        updateCamera(new Vector3(0, 0, 20));
        expect(scene.getMeshByName("Aircraft: high")!.isEnabled()).toBe(true);
        expect(scene.getMeshByName("Ship: low")!.isEnabled()).toBe(false);
    });
});

describe("traffic overlay requests", () => {
    it("ignores old endpoint responses even when the old request cannot be aborted", async () => {
        const old = deferred<Response>();
        fetchMock.mockReturnValueOnce(old.promise).mockResolvedValue(response("new"));
        overlay.setEnabled(true);
        endpoint = "/second"; await overlay.refresh();
        old.resolve(response("old")); await old.promise; await Promise.resolve();
        expect(scene.getMeshByName("Aircraft: new")).not.toBeNull();
        expect(scene.getMeshByName("Aircraft: old")).toBeNull();
    });
    it("ignores an old failure after an off/on cycle", async () => {
        const old = deferred<Response>();
        fetchMock.mockReturnValueOnce(old.promise).mockResolvedValue(response("new"));
        overlay.setEnabled(true); overlay.setEnabled(false); overlay.setEnabled(true);
        await overlay.refresh();
        const currentStatus = status.textContent;
        old.reject(new Error("old endpoint failed")); await old.promise.catch(() => {});
        expect(status.textContent).toBe(currentStatus);
        expect(scene.getMeshByName("Aircraft: new")).not.toBeNull();
    });
    it("ignores a slow JSON body superseded by a later refresh", async () => {
        const body = deferred<ReturnType<typeof snapshot>>();
        fetchMock.mockResolvedValueOnce({ ok: true, json: () => body.promise }).mockResolvedValue(response("new"));
        overlay.setEnabled(true); await Promise.resolve();
        await overlay.refresh();
        body.resolve(snapshot("old")); await body.promise;
        expect(scene.getMeshByName("Aircraft: old")).toBeNull();
        expect(scene.getMeshByName("Aircraft: new")).not.toBeNull();
    });
    it("does not fetch or update status when disabled or disposed", async () => {
        overlay.setEnabled(false); await overlay.refresh();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(status.textContent).toBe("Traffic feeds off");
        overlay.dispose(); overlay.setEnabled(true); await overlay.refresh();
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it("cancels pending requests and ignores late completion after disposal", async () => {
        const old = deferred<Response>(); fetchMock.mockReturnValue(old.promise);
        overlay.setEnabled(true);
        const signal = fetchMock.mock.calls[0][1]?.signal;
        overlay.dispose(); old.resolve(response("old")); await old.promise; await Promise.resolve();
        expect(signal?.aborted).toBe(true);
        expect(scene.getMeshByName("Aircraft: old")).toBeNull();
        expect(status.textContent).toBe("Traffic feeds off");
    });
});
