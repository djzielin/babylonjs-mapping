import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { flyControls, orbitControls } from "../../../examples-shared/navigation";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
const marker = MeshBuilder.CreateBox("marker", { size: 2 }, scene);
new HemisphericLight("light", Vector3.Up(), scene);
let camera: UniversalCamera | ArcRotateCamera;
function reset(): void {
    camera?.dispose();
    const mode = (document.getElementById("mode") as HTMLSelectElement).value;
    camera = mode === "fly" ? new UniversalCamera("fly", new Vector3(0, 4, -10), scene)
        : new ArcRotateCamera("orbit", -Math.PI / 2, 1, 10, Vector3.Zero(), scene);
    scene.activeCamera = camera;
    if (camera instanceof UniversalCamera) { camera.setTarget(Vector3.Zero()); camera.speed = 0.1; flyControls(camera, canvas); }
    else { orbitControls(camera, canvas, mode === "globe"); if (mode === "globe") camera.panningSensibility = 0; }
}
document.getElementById("mode")!.addEventListener("change", reset);
document.getElementById("reset")!.addEventListener("click", reset);
const alternate = new UniversalCamera("alternate", new Vector3(0, 4, -10), scene);
document.getElementById("alternate")!.addEventListener("click", () => {
    scene.activeCamera = scene.activeCamera === camera ? alternate : camera;
});
reset();
engine.runRenderLoop(() => {
    scene.render();
    const orbit = camera instanceof ArcRotateCamera ? camera : undefined;
    document.getElementById("state")!.textContent = JSON.stringify({
        eye: camera.position.asArray(), target: orbit?.getTarget().asArray(),
        alpha: orbit?.alpha, beta: orbit?.beta, radius: orbit?.radius,
        rotation: camera instanceof UniversalCamera ? camera.rotation.asArray() : undefined,
        active: scene.activeCamera === camera,
    });
});
window.addEventListener("pagehide", () => { scene.dispose(); engine.dispose(); });
void marker;
