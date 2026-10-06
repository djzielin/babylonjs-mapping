import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Constants } from "@babylonjs/core/Engines/constants";
import MapLayerRenderer from "../../../src/core/MapLayerRenderer";
import { MAP_MAX_LEVEL, buildingLayerLevel } from "../../globe-mode/src/BuildingLayerPriority";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const engine = new Engine(canvas, false, { stencil: true, preserveDrawingBuffer: true });
const scene = new Scene(engine);
const camera = new UniversalCamera("camera", new Vector3(0, 0, -10), scene);
camera.setTarget(Vector3.Zero());
const layers = new MapLayerRenderer(scene, MAP_MAX_LEVEL, { logarithmicDepth: true });
const baseline = new URLSearchParams(location.search).has("baseline");
function surface(name: string, width: number, x: number, z: number, color: Color3, level: number) {
    const mesh = MeshBuilder.CreatePlane(name, { width, height: 4 }, scene);
    mesh.position.set(x, 0, z);
    const material = new StandardMaterial(name, scene);
    material.disableLighting = true; material.emissiveColor = color;
    mesh.material = material;
    layers.add(mesh, baseline && level !== MAP_MAX_LEVEL ? 7 : level);
    return mesh;
}
// The inaccurate coarse wall protrudes toward the eye. Ordinary depth testing
// would show it over both the finer wall and the replacement Google surface.
const coarse = surface("coarse", 4, 0, -0.3, Color3.Red(), buildingLayerLevel(10));
const fine = surface("fine", 2, -1, 0, Color3.Green(), buildingLayerLevel(14));
const retained = fine.clone("retained", null, true)!;
retained.material = fine.material!.clone("retained")!;
retained.material.stencil.func = Constants.GREATER;
retained.renderingGroupId++;
const google = surface("Google", 2, -1, 0.1, Color3.Blue(), MAP_MAX_LEVEL);
let sampled = "";
function update(): void {
    const state = (document.getElementById("phase") as HTMLSelectElement).value;
    fine.setEnabled(state === "partial" || state === "complete");
    fine.scaling.x = state === "complete" ? 2 : 1;
    fine.position.x = state === "complete" ? 0 : -1;
    retained.setEnabled(state === "retained");
    google.setEnabled(state === "google");
    coarse.setEnabled(true);
    scene.render();
    if (sampled === state || !scene.isReady()) return;
    sampled = state;
    void Promise.all([engine.readPixels(160, 200, 1, 1), engine.readPixels(240, 200, 1, 1)]).then(buffers => {
        const colors = buffers.map(buffer => Array.from(new Uint8Array(buffer.buffer, buffer.byteOffset, 3)));
        document.getElementById("pixels")!.textContent = JSON.stringify({ phase: state, left: colors[0], right: colors[1] });
    });
}
document.getElementById("phase")!.addEventListener("change", update);
engine.runRenderLoop(update);
window.addEventListener("pagehide", () => { scene.dispose(); engine.dispose(); });
