import "@babylonjs/core/Culling/ray.js";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import type GlobeSet from "./GlobeSet.js";
/** Where the camera is and where it looks. Angles in degrees, heights in metres above sea level. */
export interface GlobeCameraView {
    latitude: number;
    longitude: number;
    height: number;
    /** Clockwise from north. */
    heading: number;
    /** Above the horizon is positive; -90 looks straight down. */
    pitch: number;
}
export interface GlobeLookAt {
    latitude: number;
    longitude: number;
    /** Height of the target point above sea level. */
    height?: number;
    heading: number;
    pitch: number;
    /** Metres from the target to the camera. */
    range: number;
}
export interface GlobeControlsOptions {
    /** Ground height in metres above sea level beneath a location, if known. */
    heightAt?: (latitude: number, longitude: number) => number | undefined;
    /** Closest the camera may come to the ground, in metres. Defaults to 2. */
    minimumClearance?: number;
    /** Highest altitude, in metres. Defaults to 4 Earth radii. */
    maximumHeight?: number;
    /** Fit near and far clipping planes to the altitude every frame. Defaults to true. */
    adaptiveClipping?: boolean;
}
export declare const GLOBE_CONTROLS_HELP = "Drag to look around (from space, to spin the globe) \u00B7 middle drag or Ctrl drag to pan \u00B7 wheel to fly toward the cursor \u00B7 WASD or arrows move \u00B7 Q/E down and up \u00B7 I/K/J/L look \u00B7 Shift moves faster";
/** A camera position (world units) with its heading and pitch in degrees. */
interface Pose {
    position: Vector3;
    heading: number;
    pitch: number;
}
/**
 * Globe navigation for a free camera: the horizon stays level, movement
 * follows the surface and its speed scales with altitude, so the same
 * controls work from orbit down to street level.
 *
 * - Drag (left or right button, or one finger) looks around; from globe
 *   height a left drag spins the globe instead, and so does moving.
 * - Middle drag, Ctrl drag or two fingers grab and pan the ground.
 * - The wheel or a pinch flies toward the point under the cursor.
 * - WASD/arrows move, Q/E or PageDown/PageUp descend and climb, I/K/J/L
 *   look, and Shift moves four times faster.
 */
export default class GlobeControls {
    readonly globe: GlobeSet;
    readonly camera: TargetCamera;
    readonly canvas: HTMLCanvasElement;
    /** Fires on any user input, e.g. to stop an automatic tour. */
    readonly onUserInputObservable: Observable<void>;
    /** Accept user input. Flights and `setView` work either way. */
    enabled: boolean;
    minimumClearance: number;
    maximumHeight: number;
    adaptiveClipping: boolean;
    private readonly position;
    private heading;
    private pitch;
    private readonly keys;
    private readonly pointers;
    private drag?;
    private pinch?;
    private flight?;
    private destination?;
    private groundHeight;
    private groundAge;
    private readonly abort;
    private readonly observer;
    private readonly heightAt?;
    constructor(globe: GlobeSet, camera: TargetCamera, canvas: HTMLCanvasElement, options?: GlobeControlsOptions);
    /** The camera's current location and orientation. */
    getView(): GlobeCameraView;
    /** Metres between the camera and the ground beneath it. */
    get heightAboveGround(): number;
    /** Move the camera at once, cancelling any flight. */
    setView(view: GlobeCameraView | GlobeLookAt): void;
    /**
     * Fly to a view along a rising arc. Resolves true on arrival, or false
     * when user input or another flight interrupts it.
     */
    flyTo(view: GlobeCameraView | GlobeLookAt, durationMs?: number): Promise<boolean>;
    /** The orbit equivalent to a pose: what it looks at on the ground at `groundHeight` metres, or ahead of it. */
    private orbitOf;
    get isFlying(): boolean;
    /**
     * A camera at the end of the current flight, or undefined when not
     * flying: give it to a layer's `prefetchCamera` to load the destination
     * on the way there.
     */
    get flightDestination(): TargetCamera | undefined;
    /**
     * Point any camera at a view with this camera's field of view and the
     * clipping it would have there, e.g. for prefetching the next place.
     */
    placeCamera(view: GlobeCameraView | GlobeLookAt | Pose, camera: TargetCamera): void;
    /** The camera view that looks at a target from `range` metres away. */
    lookAt(target: GlobeLookAt): GlobeCameraView;
    dispose(): void;
    private pose;
    private refreshGround;
    private cancelFlight;
    private userInput;
    private tick;
    /** Keep the camera above the ground and below the ceiling, then place it. */
    private apply;
    /**
     * Near and far planes (world units) that follow the altitude: the depth
     * buffer's precision is spent on what can actually be seen.
     */
    private clipping;
    private fly;
    private move;
    /** Move the camera, keeping its view direction fixed in space. */
    private translate;
    /** Rotate the camera about the globe's centre, carrying its orientation with it. */
    private rotateAboutCentre;
    /** Where the ray through a canvas point meets the sphere of radius `radius`, if it does. */
    private pick;
    private groundRadius;
    private attach;
    /** Fly a fraction of the way to the ground point under the cursor (negative backs away). */
    private flyToward;
}
export {};
