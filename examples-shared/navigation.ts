import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import type { FreeCameraMouseInput } from "@babylonjs/core/Cameras/Inputs/freeCameraMouseInput";
import type { FreeCameraKeyboardMoveInput } from "@babylonjs/core/Cameras/Inputs/freeCameraKeyboardMoveInput";
import type { ArcRotateCameraKeyboardMoveInput } from "@babylonjs/core/Cameras/Inputs/arcRotateCameraKeyboardMoveInput";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

// Examples install Babylon independently. Do not expose its nominal class types
// across package boundaries; webpack aliases each demo to one Babylon runtime.
type CameraHandle = Pick<Camera, "detachControl" | "getClassName">;

/** Keep Babylon's pointer, touch and keyboard inputs, but scope them to the canvas.
 * Detaching resets Babylon's held keys/pointers; this also handles XR camera changes.
 */
export function canvasControls(source: CameraHandle, canvas: HTMLCanvasElement, attach: () => void, help: string): () => void {
    const camera = source as Camera;
    const scene = camera.getScene();
    const abort = new AbortController();
    const options = { signal: abort.signal };
    const active = () => scene.activeCamera === camera && document.activeElement === canvas;
    canvas.tabIndex = 0;
    canvas.style.touchAction = "none";
    canvas.setAttribute("aria-label", "3D viewport. " + help);
    const description = document.createElement("details");
    description.className = "navigation-help";
    description.style.cssText = "position:fixed;bottom:38px;left:12px;z-index:10;max-width:min(430px,75vw);padding:6px 10px;background:#15232be8;color:white;font:13px/1.5 system-ui;border-radius:6px";
    const summary = document.createElement("summary");
    summary.textContent = "Navigation controls";
    const text = document.createElement("p");
    text.textContent = help + " Click or Tab to the viewport first. Esc stops movement. Touch: drag to look/orbit; pinch zooms in orbit views.";
    description.append(summary, text);
    document.body.append(description);
    const reset = () => {
        camera.detachControl();
        if ("cameraDirection" in camera) {
            (camera as UniversalCamera).cameraDirection.setAll(0);
            (camera as UniversalCamera).cameraRotation.setAll(0);
        }
        if ("inertialAlphaOffset" in camera) {
            const orbit = camera as ArcRotateCamera;
            orbit.inertialAlphaOffset = orbit.inertialBetaOffset = orbit.inertialRadiusOffset = 0;
            orbit.inertialPanningX = orbit.inertialPanningY = 0;
            orbit.movement.resetPanVelocity();
        }
    };
    const resume = () => { reset(); if (active()) attach(); };
    canvas.addEventListener("focus", resume, options);
    canvas.addEventListener("pointerdown", () => { canvas.focus(); if (active()) attach(); }, { ...options, capture: true });
    canvas.addEventListener("blur", reset, options);
    window.addEventListener("blur", reset, options);
    window.addEventListener("focus", resume, options);
    document.addEventListener("visibilitychange", () => { if (document.hidden) reset(); else resume(); }, options);
    canvas.addEventListener("pointercancel", resume, options);
    canvas.addEventListener("lostpointercapture", resume, options);
    canvas.addEventListener("contextmenu", event => event.preventDefault(), options);
    canvas.addEventListener("keydown", event => {
        if (event.key === "Escape") { reset(); canvas.blur(); }
        else if (event.metaKey || event.altKey || event.ctrlKey && !event.key.startsWith("Arrow") && event.key !== "Control") {
            // Browser shortcuts must not leave a movement key held.
            reset();
            event.stopPropagation();
        }
    }, { ...options, capture: true });
    canvas.addEventListener("keyup", event => {
        if (active() && !event.ctrlKey && !event.metaKey && !event.altKey) attach();
    }, options);
    document.addEventListener("pointerlockchange", resume, options);
    const changed = scene.onActiveCameraChanged.add(() => {
        description.hidden = scene.activeCamera !== camera;
        resume();
    });
    reset();
    const dispose = () => {
        reset(); abort.abort(); description.remove(); scene.onActiveCameraChanged.remove(changed);
    };
    camera.onDisposeObservable.addOnce(dispose);
    return dispose;
}

export function orbitControls(source: CameraHandle, canvas: HTMLCanvasElement, spherical = false): () => void {
    const camera = source as ArcRotateCamera;
    camera.inertia = 0;
    camera.panningInertia = 0;
    if (spherical) camera.movement.input.addEntry({ source: "pointer", button: 1, interaction: "rotate" });
    if (!spherical) {
        camera.panningSensibility = 150;
        camera.wheelDeltaPercentage = 0.03;
    }
    const keyboard = camera.inputs.attached.keyboard as ArcRotateCameraKeyboardMoveInput;
    keyboard.keysZoomIn = [187, 107];
    keyboard.keysZoomOut = [189, 109];
    return canvasControls(camera, canvas, () => camera.attachControl(false, !spherical, spherical ? -1 : 1), spherical
        ? "Left or middle drag rotates the globe. Arrows rotate; wheel zooms. The globe stays centered."
        : "Left drag orbits. Middle drag or Ctrl+left drag pans. Wheel or +/- zooms. Arrows orbit; Ctrl+arrows pan.");
}

export function flyControls(source: CameraHandle, canvas: HTMLCanvasElement): () => void {
    const camera = source as UniversalCamera;
    camera.keysUp = [87, 38]; camera.keysDown = [83, 40];
    camera.keysLeft = [65, 37]; camera.keysRight = [68, 39];
    camera.keysUpward = [69, 33]; camera.keysDownward = [81, 34];
    const keyboard = camera.inputs.attached.keyboard as FreeCameraKeyboardMoveInput;
    keyboard.keysRotateLeft = [74]; keyboard.keysRotateRight = [76];
    keyboard.keysRotateUp = [73]; keyboard.keysRotateDown = [75];
    const mouse = camera.inputs.attached.mouse as FreeCameraMouseInput;
    mouse.buttons = [0, 2];
    camera.inertia = 0;
    const disposeStandard = canvasControls(camera, canvas, () => camera.attachControl(canvas, false),
        "Right or left drag looks. WASD or arrows move/strafe. Q/E or PageDown/PageUp move down/up. IJKL look with the keyboard. Middle drag pans; wheel moves along the sight line.");
    const abort = new AbortController();
    const options = { signal: abort.signal };
    let pointer: number | undefined, x = 0, y = 0;
    const active = () => camera.getScene().activeCamera === camera && document.activeElement === canvas;
    const stop = () => {
        if (pointer !== undefined && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
        pointer = undefined;
    };
    canvas.addEventListener("pointerdown", event => {
        if (!active() || event.button !== 1 || event.pointerType === "touch") return;
        event.preventDefault(); pointer = event.pointerId; x = event.clientX; y = event.clientY;
        canvas.setPointerCapture(pointer);
    }, options);
    canvas.addEventListener("pointermove", event => {
        if (!active() || pointer !== event.pointerId) return;
        const scale = Math.max(camera.minZ, camera.speed) * 0.12;
        camera.position.addInPlace(camera.getDirection(Vector3.Right()).scale(-(event.clientX - x) * scale))
            .addInPlace(camera.getDirection(Vector3.Up()).scale((event.clientY - y) * scale));
        x = event.clientX; y = event.clientY;
    }, options);
    for (const name of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) canvas.addEventListener(name, stop, options);
    window.addEventListener("blur", stop, options);
    canvas.addEventListener("wheel", event => {
        if (!active()) return;
        event.preventDefault();
        camera.position.addInPlace(camera.getDirection(Vector3.Forward()).scale(-Math.max(-300, Math.min(300, event.deltaY)) / 100 * camera.speed));
    }, { ...options, passive: false });
    const changed = camera.getScene().onActiveCameraChanged.add(stop);
    const dispose = () => { stop(); abort.abort(); disposeStandard(); camera.getScene().onActiveCameraChanged.remove(changed); };
    camera.onDisposeObservable.addOnce(dispose);
    return dispose;
}
