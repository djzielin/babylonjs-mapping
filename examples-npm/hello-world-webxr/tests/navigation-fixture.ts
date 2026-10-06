import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { flyControls } from "../../../examples-shared/navigation";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
const marker = MeshBuilder.CreateBox("marker", { size: 2 }, scene);
new HemisphericLight("light", Vector3.Up(), scene);
let camera: UniversalCamera;
function reset(): void {
    camera?.dispose();
    camera = new UniversalCamera("fly", new Vector3(0, 4, -10), scene);
    scene.activeCamera = camera;
    camera.setTarget(Vector3.Zero()); camera.speed = 0.1; flyControls(camera, canvas);
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
    document.getElementById("state")!.textContent = JSON.stringify({
        eye: camera.position.asArray(), rotation: camera.rotation.asArray(), speed: camera.speed,
        active: scene.activeCamera === camera,
    });
});
window.addEventListener("pagehide", () => { scene.dispose(); engine.dispose(); });
void marker;
