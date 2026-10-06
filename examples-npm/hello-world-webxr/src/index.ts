import { flyControls } from "../../../examples-shared/navigation";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Engines/Extensions/engine.query";
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery";
import { EngineInstrumentation } from "@babylonjs/core/Instrumentation/engineInstrumentation";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import { WebXRState } from "@babylonjs/core/XR/webXRTypes";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import "@babylonjs/core/Helpers/sceneHelpers";
import "@babylonjs/core/XR/motionController/webXROculusTouchMotionController";
import { BuildingsOverture, resolveLatestOvertureBuildingsURL, Google3DTiles, RasterOSM, TileSet } from "babylonjs-mapping";

import { optimizeStaticGoogleModels } from "../../../examples-shared/static-google-models";
import { googleTilesOptions } from "../../../examples-shared/google-tiles-options";

const canvas = document.getElementById("renderCanvas") as unknown as HTMLCanvasElement;
const help = document.getElementById("help")!;
const status = document.getElementById("xr-status")!;
const buildingStatus = document.getElementById("building-status")!;
const enterButton = document.getElementById("enter-vr") as HTMLButtonElement;
export const engine = new Engine(canvas, true, { powerPreference: "high-performance" });
const profiling = new URLSearchParams(location.search).get("profile") === "1";
const googleCandidate = new URLSearchParams(location.search).get("legacy") !== "1";
export let googleTiles: Google3DTiles | undefined;
export const scene = new Scene(engine);
export const engineProfile = new EngineInstrumentation(engine);
engineProfile.captureGPUFrameTime = profiling;
export const sceneProfile = new SceneInstrumentation(scene);
sceneProfile.captureRenderTime = profiling;
scene.clearColor = new Color4(0.13, 0.22, 0.28, 1);
export const camera = new UniversalCamera("desktop", new Vector3(0, 1.6, -3), scene);
camera.setTarget(Vector3.Zero());
camera.minZ = 0.02;
camera.speed = 0.03;
flyControls(camera, canvas);
new HemisphericLight("sky", new Vector3(0, 1, 0), scene);

// One scene unit remains one physical metre in XR; the map is a 4 m miniature.
export const map = new TileSet(scene, engine);
export let xrExperience: WebXRDefaultExperience | undefined;
map.setRasterProvider(new RasterOSM(map));
map.createGeometry(new Vector2(4, 4), 1, googleCandidate ? 2 : 1);
map.updateRaster(googleCandidate ? 36.00145 : 36.0014, googleCandidate ? -78.94032 : -78.9382, googleCandidate ? 17 : 16);
const floor = MeshBuilder.CreateGround("teleport-floor", { width: 10, height: 10 }, scene);
floor.position.y = -0.01;
const floorMaterial = new StandardMaterial("floor-material", scene);
floorMaterial.diffuseColor = new Color3(0.24, 0.32, 0.35);
floor.material = floorMaterial;

// Screen overlays do not appear in immersive VR, so keep instructions and credits in the scene.
const sign = MeshBuilder.CreatePlane("campus-sign", { width: 3, height: 0.9 }, scene);
sign.position.set(0, 1.5, 2.8);
sign.isPickable = false;
const signTexture = AdvancedDynamicTexture.CreateForMesh(sign, 1536, 460);
signTexture.background = "#15232b";
const signText = new TextBlock("instructions", googleCandidate
    ? "DUKE CHAPEL · GOOGLE 3D TILES\nThumbstick: teleport / snap turn · Headset menu: exit\nMap © OpenStreetMap contributors · Google tiles loading"
    : "DUKE CAMPUS · HELLO WORLD\nThumbstick: teleport / snap turn · Headset menu: exit\nMap © OpenStreetMap contributors · Buildings © Overture Maps");
if (!googleCandidate) document.getElementById("map-credits")!.textContent = "Map © OpenStreetMap contributors · Buildings © Overture Maps";
signText.color = "white";
signText.fontSize = 40;
signTexture.addControl(signText);

// A compact camera-relative panel keeps full Google credits visible after
// head turns and teleportation; the fullscreen provider credits remain visible too.
export const googleCreditPanel = googleCandidate
    ? MeshBuilder.CreatePlane("google-credits", { width: 1.2, height: 0.14 }, scene)
    : undefined;
let googleCreditText: TextBlock | undefined;
if (googleCreditPanel) {
    googleCreditPanel.parent = camera;
    googleCreditPanel.position.set(0, -0.39, 0.8);
    googleCreditPanel.isVisible = false;
    googleCreditPanel.isPickable = false;
    googleCreditPanel.alwaysSelectAsActiveMesh = true;
    googleCreditPanel.renderingGroupId = 3;
    const texture = AdvancedDynamicTexture.CreateForMesh(googleCreditPanel, 2048, 240);
    texture.background = "#15232b";
    googleCreditText = new TextBlock("google immersive credits");
    googleCreditText.color = "white";
    googleCreditText.fontSize = 32;
    googleCreditText.textWrapping = true;
    texture.addControl(googleCreditText);
    const material = googleCreditPanel.material as StandardMaterial;
    material.disableDepthWrite = true;
    material.depthFunction = Constants.ALWAYS;
    scene.onActiveCameraChanged.add(() => { googleCreditPanel.parent = scene.activeCamera; });
}

function showGoogleCredits(): void {
    const credits = "Google Maps · " + googleTiles!.getAttributions().join("; ");
    signText.text = "DUKE CHAPEL · GOOGLE 3D TILES\nThumbstick: teleport / snap turn · Headset menu: exit\n" + credits;
    document.getElementById("map-credits")!.textContent = credits;
    googleCreditText!.text = credits;
    googleCreditPanel!.isVisible = true;
}

const renderScene = () => scene.render();
engine.runRenderLoop(renderScene);
window.addEventListener("resize", () => engine.resize());

async function loadBuildings(): Promise<void> {
    try {
        const buildings = new BuildingsOverture(map, await resolveLatestOvertureBuildingsURL());
        buildings.doMerge = true;
        buildings.exaggeration = 1;
        buildings.onCaughtUpObservable.addOnce(() => {
            const count = map.ourTiles.reduce((total, tile) => total + tile.buildings.length, 0);
            buildingStatus.textContent = count ? "Buildings ready." : "No buildings loaded. Reload to retry.";
        });
        buildings.generateBuildings();
    } catch (error) {
        buildingStatus.textContent = "Buildings unavailable. Reload to retry; the map still works.";
        console.error("Unable to load buildings", error);
    }
}

async function loadGoogleTiles(): Promise<void> {
    buildingStatus.textContent = "Loading Duke Google 3D tiles…";
    try {
        const response = await fetch("../google-3d-tiles/google-key.txt", { cache: "no-store" });
        if (!response.ok) throw new Error("Google tiles configuration is unavailable.");
        const apiKey = (await response.text()).trim();
        if (!apiKey) throw new Error("Google tiles configuration is empty.");
        googleTiles = new Google3DTiles(map, googleTilesOptions(apiKey, 32));
        const overview = await googleTiles.load();
        if (overview.length) {
            for (const tile of map.ourTiles) tile.mesh.isVisible = false;
            showGoogleCredits();
            buildingStatus.textContent = `${overview.length} overview tiles visible; refining detail…`;
        }
        googleTiles.maxDepth = 32;
        const loaded = await googleTiles.load();
        if (!loaded.length) throw new Error("No Google model tiles matched Duke Chapel.");
        optimizeStaticGoogleModels(loaded);
        for (const model of loaded) for (const mesh of model.asset.meshes) mesh.isPickable = false;
        for (const tile of map.ourTiles) tile.mesh.isVisible = false;
        showGoogleCredits();
        canvas.dataset.googleTiles = String(loaded.length);
        buildingStatus.textContent = `${loaded.length} Google model tiles ready.`;
    } catch {
        // Keep credentials and credential-bearing request URLs out of diagnostics.
        buildingStatus.textContent = "Google tiles unavailable. Reload to retry; the map still works.";
        canvas.dataset.googleTiles = "0";
    }
}

async function setupXR(): Promise<void> {
    if (!window.isSecureContext) {
        status.textContent = "VR requires HTTPS. Open the HTTPS demo in Quest Browser.";
        return;
    }
    if (!navigator.xr || !await navigator.xr.isSessionSupported("immersive-vr")) {
        status.textContent = "VR unavailable here. Open in Quest Browser, or explore on desktop.";
        return;
    }
    const xr = await WebXRDefaultExperience.CreateAsync(scene, {
        disableDefaultUI: true,
        floorMeshes: googleCandidate ? [floor] : [floor, ...map.ourTiles.map(tile => tile.mesh)],
        disableHandTracking: true,
        disableNearInteraction: true,
        // Bundled Touch input mapping supports Quest thumbsticks without remote profile requests.
        inputOptions: { forceInputProfile: "oculus-touch", disableOnlineControllerRepository: true, doNotLoadControllerMeshes: true },
    });
    xrExperience = xr;
    if (googleCandidate) {
        xr.pointerSelection.raySelectionPredicate = mesh => mesh === floor;
        scene.pointerMovePredicate = mesh => mesh === floor;
    }
    xr.baseExperience.camera.minZ = 0.02;
    let entering = false;
    xr.baseExperience.onStateChangedObservable.add(state => {
        help.hidden = state === WebXRState.IN_XR;
        enterButton.disabled = entering || state !== WebXRState.NOT_IN_XR;
        if (state === WebXRState.NOT_IN_XR) status.textContent = "VR ready. Select Enter VR to return.";
    });
    enterButton.disabled = false;
    status.textContent = "VR ready. Select Enter VR to explore the campus.";
    enterButton.addEventListener("click", async () => {
        if (entering || xr.baseExperience.state !== WebXRState.NOT_IN_XR) return;
        entering = true;
        enterButton.disabled = true;
        try {
            await xr.baseExperience.enterXRAsync("immersive-vr", "local-floor", xr.renderTarget);
        } catch (error) {
            // Babylon resets its state after an entry failure, but an allocated
            // session can still be active if reference-space or layer setup failed.
            if (xr.baseExperience.sessionManager.inXRSession) {
                // Ending a partially initialized session restarts Babylon's loop.
                // Cancel the desktop frame first so retry cannot create two loops.
                engine.stopRenderLoop(renderScene);
                try {
                    await xr.baseExperience.sessionManager.exitXRAsync();
                } finally {
                    engine.runRenderLoop(renderScene);
                }
            }
            help.hidden = false;
            status.textContent = "Could not enter VR. Check headset permissions and try again.";
            console.error("Unable to enter VR", error);
        } finally {
            entering = false;
            enterButton.disabled = xr.baseExperience.state !== WebXRState.NOT_IN_XR;
        }
    });
}

void (googleCandidate ? loadGoogleTiles() : loadBuildings());
void setupXR().catch(error => {
    status.textContent = "VR setup failed. Reload to retry, or explore on desktop.";
    console.error("Unable to initialize WebXR", error);
});
