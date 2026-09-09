import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
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
import { BuildingsOverture, resolveLatestOvertureBuildingsURL, RasterOSM, TileSet } from "babylonjs-mapping";

const canvas = document.getElementById("renderCanvas") as unknown as HTMLCanvasElement;
const help = document.getElementById("help")!;
const status = document.getElementById("xr-status")!;
const buildingStatus = document.getElementById("building-status")!;
const enterButton = document.getElementById("enter-vr") as HTMLButtonElement;
const engine = new Engine(canvas, true);
export const scene = new Scene(engine);
scene.clearColor = new Color4(0.13, 0.22, 0.28, 1);
const camera = new UniversalCamera("desktop", new Vector3(0, 1.6, -3), scene);
camera.setTarget(Vector3.Zero());
camera.minZ = 0.02;
camera.speed = 0.03;
camera.attachControl(canvas, true);
new HemisphericLight("sky", new Vector3(0, 1, 0), scene);

// One scene unit remains one physical metre in XR; the map is a 4 m miniature.
export const map = new TileSet(scene, engine);
export let xrExperience: WebXRDefaultExperience | undefined;
map.setRasterProvider(new RasterOSM(map));
map.createGeometry(new Vector2(4, 4), 1, 1);
map.updateRaster(36.0014, -78.9382, 16);
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
const signText = new TextBlock("instructions", "DUKE CAMPUS · HELLO WORLD\nThumbstick: teleport / snap turn · Headset menu: exit\nMap © OpenStreetMap contributors · Buildings © Overture Maps");
signText.color = "white";
signText.fontSize = 40;
signTexture.addControl(signText);

engine.runRenderLoop(() => scene.render());
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
        floorMeshes: [floor, ...map.ourTiles.map(tile => tile.mesh)],
        disableHandTracking: true,
        disableNearInteraction: true,
        // Bundled Touch input mapping supports Quest thumbsticks without remote profile requests.
        inputOptions: { forceInputProfile: "oculus-touch", disableOnlineControllerRepository: true, doNotLoadControllerMeshes: true },
    });
    xrExperience = xr;
    xr.baseExperience.camera.minZ = 0.02;
    xr.baseExperience.onStateChangedObservable.add(state => {
        help.hidden = state === WebXRState.IN_XR;
        enterButton.disabled = state !== WebXRState.NOT_IN_XR;
        if (state === WebXRState.NOT_IN_XR) status.textContent = "VR ready. Select Enter VR to return.";
    });
    enterButton.disabled = false;
    status.textContent = "VR ready. Select Enter VR to explore the campus.";
    enterButton.addEventListener("click", async () => {
        enterButton.disabled = true;
        try {
            await xr.baseExperience.enterXRAsync("immersive-vr", "local-floor", xr.renderTarget);
        } catch (error) {
            help.hidden = false;
            enterButton.disabled = false;
            status.textContent = "Could not enter VR. Check headset permissions and try again.";
            console.error("Unable to enter VR", error);
        }
    });
}

void loadBuildings();
void setupXR().catch(error => {
    status.textContent = "VR setup failed. Reload to retry, or explore on desktop.";
    console.error("Unable to initialize WebXR", error);
});
