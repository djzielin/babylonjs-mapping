import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { DestinationMarker } from "./XRDestination";
import type { Scene } from "@babylonjs/core/scene";
import type { WebXRCamera } from "@babylonjs/core/XR/webXRCamera";
import type { WebXRInputSource } from "@babylonjs/core/XR/webXRInputSource";
import type { WebXRAbstractMotionController } from "@babylonjs/core/XR/motionController/webXRAbstractMotionController";
import type { GlobeSet } from "babylonjs-mapping";
import { GlobeXRRig, type RigPoint, type RigPose } from "./XRRig";

const DEGREES = Math.PI / 180;
/** Physical metres per second at full thumbstick. */
const WALK_SPEED = 2.2;
/** e-folds of scale per second at full thumbstick. */
const ZOOM_RATE = 1.5;
const SNAP_TURN = 30;
/** Each click toward the ground brings the user this much closer to it. */
/**
 * A click keeps the user's height up to this scale, where the world looks
 * its best; from higher, each click comes down toward it by `CLICK_DESCENT`.
 */
const VIEW_SCALE = 300;
const CLICK_DESCENT = 0.15;
/** Farthest a flight pulls back from what it looks at, in metres: the whole globe in view. */
const MAX_CRUISE_RANGE = 1.2e7;
/** Degrees below the level the eyes rest at: where a flight keeps what it looks at. */
const GAZE = 30;
/** Degrees below the level a globe seen from space sits at, tilted up into view. */
const GLOBE_GAZE = 15;
/**
 * Metres of altitude over which the world may tilt to bring the globe into
 * view: below, the horizon stays level, as it must where it is seen.
 */
const TILT_FROM = 60_000, TILT_TO = 900_000;
/**
 * Parts of a flight over which the world tilts up to the globe and back. By
 * time, not altitude: altitude grows exponentially, so a tilt following it
 * would swing the world through its whole turn in a fraction of a second.
 */
const TILT_IN = [0.1, 0.47], TILT_OUT = [0.53, 0.9];
/** Longest a descent waits, slowed, for the destination to load. */
const MAX_WAIT_MS = 3000;
/** Duration of settling from a tilted view back onto the ground's level. */
const SETTLE_MS = 450;
/** Physical eye height assumed when matching a view's altitude. */
export const EYE_HEIGHT = 1.6;

export interface XRControlsOptions {
    /** Ground height in metres above sea level, for following terrain and buildings. */
    groundAt: (latitude: number, longitude: number) => number;
    /** Distance in world units to the first surface along a ray: cheap, called while pointing. */
    hover: (ray: Ray) => number | undefined;
    /** As `hover`, but exact, for the click itself. */
    pick: (ray: Ray) => number | undefined;
    /** Called for the controller buttons not used for moving. */
    onButton?: (button: "a" | "b" | "x" | "y" | "stick-left" | "stick-right") => void;
    /** Called whenever the user moves themselves, such as to end a tour. */
    onUserMove?: () => void;
    /** True once the flight's destination (see `destination`) has loaded; descents slow until it has. */
    destinationReady?: () => boolean;
    /** A panel the laser works, such as a menu: while it is open, the trigger is its. */
    ui?: XRPointerUI;
}

/** Something drawn in front of the world that the laser points at and clicks. */
export interface XRPointerUI {
    readonly isOpen: boolean;
    /** Distance in world units along `ray` to the panel, or undefined if it misses; also shows what is pointed at. */
    hover(ray: Ray): number | undefined;
    /** A trigger click along `ray`, which may miss the panel. */
    click(ray: Ray): void;
}

interface Hand {
    source: WebXRInputSource;
    controller?: WebXRAbstractMotionController;
    handedness: "left" | "right" | "none";
    /** Rig-local grip position last frame, while squeezing. */
    held?: Vector3;
    pressed: Set<string>;
    laser: Mesh;
}

/** What a flight looks at, as the flat globe's camera orbits it. */
interface Orbit {
    /** Unit direction from the globe's centre to the target, and its distance (world units). */
    direction: Vector3;
    radius: number;
    /** From the eye to the target, world units. */
    range: number;
    /** Degrees, at the target: heading clockwise from north, pitch of the look (negative is down). */
    heading: number;
    pitch: number;
}

/** Where the rig's frame is: its rotation, the eye's world position, and the user's scale. */
interface Frame {
    rotation: Quaternion;
    eye: Vector3;
    scale: number;
}

interface Flight {
    from: Orbit;
    to: Orbit;
    /** Range at the top of the flight, and the pitch there. */
    cruise: number;
    cruisePitch: number;
    /** Scale per world unit of range at each end: the user's size follows the range between. */
    sizeFrom: number;
    sizeTo: number;
    /** How far the world tilts at the start, the top and the end of the flight, 0 to 1. */
    tiltFrom: number;
    tiltCruise: number;
    tiltTo: number;
    /** Differences between the orbit's frames and the exact frames at each end, faded out. */
    startFix: { rotation: Quaternion; eye: Vector3 };
    endFix: { rotation: Quaternion; eye: Vector3 };
    /** The rig pose to land in; none to stay in the last frame, looking at the globe. */
    land?: RigPose & { floor: number };
    /** Progress from 0 to 1, advancing at `rate` (slowed while the destination loads). */
    t: number;
    rate: number;
    waited: number;
    duration: number;
    resolve: (done: boolean) => void;
}

interface Settle {
    from: Frame;
    to: Frame;
    pose: RigPose & { floor: number };
    start: number;
}

/**
 * Immersive controls for a globe, after Google Earth VR:
 *
 * - Grip and pull: drag the world. Both grips: pull apart or together to
 *   shrink or grow, twist to turn, about the point between the hands.
 * - Left thumbstick: move where you look. Right thumbstick: up to grow
 *   (rise), down to shrink (descend); left or right to snap turn.
 * - Trigger: point, then click to zoom toward the ground under the laser.
 *
 * Motion is eased and framed by a comfort vignette; the floor follows the
 * terrain and rooftops beneath the head.
 */
export class GlobeXRControls {
    public readonly rig: GlobeXRRig;
    /** Allow the floor below sea level, for dives such as to the Mariana Trench. */
    public diving = false;
    public enabled = true;
    /** Placed at the end of a flight, for loading ahead. */
    public readonly destination: TargetCamera;
    private readonly hands = new Map<WebXRInputSource, Hand>();
    private readonly vignette: Mesh;
    private readonly marker: DestinationMarker;
    private flight?: Flight;
    /** A frame held after a flight that ends looking at the globe, until the user moves. */
    private held?: Frame & { tilt: number };
    private settle?: Settle;
    /** The head, rig-local, and its yaw (radians), as when the flight began: the world moves past them, not with them. */
    private readonly flightHead = new Vector3();
    private flightYaw = 0;
    /** The view's current tilt, degrees: how far the world is turned to bring the globe into view. */
    private tilt = 0;
    private comfort = 0;
    private last = performance.now();
    private hoverAt = 0;
    private hoverHit?: Vector3;
    private turned = false;
    private groundAge = 0;
    private ground = 0;
    private readonly scene: Scene;

    public constructor(private readonly globe: GlobeSet, private readonly camera: WebXRCamera, private readonly options: XRControlsOptions, private readonly overlayGroup: number) {
        this.scene = globe.scene;
        this.rig = new GlobeXRRig(globe, this.scene);
        camera.parent = this.rig.node;
        this.destination = new TargetCamera("xr flight destination", Vector3.Zero(), this.scene, false);
        this.destination.rotationQuaternion = new Quaternion();
        this.destination.fov = 1.6;
        this.vignette = this.createVignette();
        this.marker = new DestinationMarker(this.scene, this.overlayGroup, (name, color, alpha) => this.overlayMaterial(name, color, alpha));
    }

    /** Where the user's head is, as a rig pose with the head at its origin. */
    public get headPose(): RigPose & { height: number } {
        if (this.flight || this.held || this.settle) {
            // The rig is turned: read the head from where it is.
            const eye = this.camera.globalPosition, m = this.globe.metresToWorld;
            const { latitude, longitude, elevation } = this.globe.getSurfaceCoordinates(eye);
            const look = angles(eye, this.levelForward());
            return { latitude, longitude, heading: look.heading, scale: this.rig.scale, height: elevation / m };
        }
        const head = this.head();
        const [east, north] = this.rig.toEastNorth(head);
        const lat = this.rig.latitude * DEGREES, R = this.globe.radius / this.globe.metresToWorld;
        return {
            latitude: this.rig.latitude + north / R / DEGREES,
            longitude: this.rig.longitude + east / (R * Math.cos(lat)) / DEGREES,
            heading: this.rig.heading + Math.atan2(this.headForward().x, this.headForward().z) / DEGREES,
            scale: this.rig.scale,
            height: this.rig.floor + this.camera.position.y * this.rig.scale,
        };
    }

    /** Places the user's head at `pose`, standing on the ground beneath it. */
    public place(pose: RigPose): void {
        this.stopFlight();
        this.held = this.settle = undefined;
        this.tilt = 0;
        this.rig.set(pose);
        this.ground = this.floorAt(pose.latitude, pose.longitude);
        this.rig.floor = this.ground;
        this.centreHead(pose.heading);
        this.rig.apply();
    }

    /**
     * Flies the head to `pose` as the flat globe's camera does: pulling back
     * from what the eyes rest on to a height that holds both ends, gliding
     * across, and dropping in, in overlapping phases, looking straight down
     * at the top of long flights. Short hops just ease between the two.
     *
     * The world moves past the head as it was when the flight began, so the
     * user can look around on the way. High up, where the ground has become
     * a globe, the world tilts to keep that globe in front of the eyes rather
     * than beneath the feet; near the ground its horizon stays level.
     */
    public flyTo(pose: RigPose, durationMs?: number): Promise<boolean> {
        return this.startFlight(pose, durationMs);
    }

    /** Out to the whole globe, held in front of the eyes until the user moves. */
    public overview(durationMs = 3500): Promise<boolean> {
        return this.startFlight(undefined, durationMs);
    }

    public get isFlying(): boolean {
        return !!this.flight;
    }

    /** True while a flight, a held globe view, or the settling after one turns the world. */
    public get isTilted(): boolean {
        return !!(this.flight || this.held || this.settle);
    }

    public cancelFlight(): void {
        if (this.flight) this.settleDown();
    }

    private startFlight(pose: RigPose | undefined, durationMs?: number): Promise<boolean> {
        const current = this.currentFrame();
        const tilted = this.tilt > 0;
        // A new flight takes over from wherever the last one, or its settling, had got to.
        this.stopFlight();
        this.settle = this.held = undefined;
        this.flightHead.copyFrom(this.camera.position);
        const forward = this.headForward();
        this.flightYaw = Math.atan2(forward.x, forward.z);
        const m = this.globe.metresToWorld;
        const groundHere = this.ground;
        // From a view tilted to the globe, the flight starts looking straight down at it.
        const from = tilted ? this.overhead(current, groundHere) : this.orbitFrom(current, GAZE, groundHere);

        let to: Orbit, landing: Frame, land: Flight["land"];
        if (pose) {
            const floor = this.floorAt(pose.latitude, pose.longitude);
            const standard = this.standardFrame(pose, floor);
            landing = standard.frame;
            land = { ...standard.pose, floor };
            to = this.orbitFrom(landing, GAZE, floor);
        } else {
            // Straight down at the place beneath the eyes, from as far as the
            // rig allows: settling then keeps the eyes where they are.
            to = { ...this.overhead(current, 0), heading: from.heading, range: GlobeXRRig.MAX_SCALE * Math.max(0.5, this.flightHead.y) * m };
            landing = this.orbitFrame(to, this.tiltFor(to, this.highUp(to)), GlobeXRRig.MAX_SCALE);
        }

        const distance = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(from.direction, to.direction)))) * EARTH_RADIUS;
        // As the flat camera: high enough to hold both ends, looking down once the hop is long.
        const near = Math.max(from.range, to.range) / m;
        const cruise = Math.min(MAX_CRUISE_RANGE, Math.max(near, distance * 1.1)) * m;
        const overhead = smoothstep(1.5, 5, distance / near);
        const cruisePitch = pose ? (from.pitch + to.pitch) / 2 * (1 - overhead) - 89.5 * overhead : -89.5;
        const duration = durationMs ?? Math.min(6500, 2400 + Math.log10(1 + distance / 1000) * 800);
        const sizeFrom = current.scale / from.range, sizeTo = landing.scale / to.range;
        const tiltFrom = this.highUp(from), tiltTo = this.highUp(to);
        // Looking down on the whole hop from high enough to tilt the world.
        const tiltCruise = Math.max(tiltFrom, tiltTo, smoothstep(Math.log(TILT_FROM), Math.log(TILT_TO), Math.log(cruise / m)));
        const fix = (exact: Frame, orbit: Orbit, size: number, high: number) => {
            const frame = this.orbitFrame(orbit, this.tiltFor(orbit, high), orbit.range * size);
            return { rotation: Quaternion.Inverse(frame.rotation).multiplyInPlace(exact.rotation), eye: exact.eye.subtract(frame.eye) };
        };
        this.placeDestination(pose ?? { latitude: 0, longitude: 0, heading: 0, scale: GlobeXRRig.MAX_SCALE }, pose ? undefined : landing);
        return new Promise(resolve => {
            this.flight = {
                from, to, cruise, cruisePitch, sizeFrom, sizeTo, tiltFrom, tiltCruise, tiltTo,
                startFix: fix(current, from, sizeFrom, tiltFrom), endFix: fix(landing, to, sizeTo, tiltTo),
                land, t: 0, rate: 1, waited: 0, duration, resolve,
            };
        });
    }

    /** Ends a flight where it is, without settling: for placing or starting another. */
    private stopFlight(): void {
        const flight = this.flight;
        this.flight = undefined;
        flight?.resolve(false);
    }

    public addController(source: WebXRInputSource): void {
        const laser = CreateBox("xr laser", { width: 0.0014, height: 0.0014, depth: 1 }, this.scene);
        // From the controller forward.
        laser.bakeTransformIntoVertices(Matrix.Translation(0, 0, 0.5));
        laser.material = this.overlayMaterial("xr laser", new Color3(0.8, 0.9, 1), 0.45);
        laser.renderingGroupId = this.overlayGroup;
        laser.isPickable = false;
        laser.setEnabled(false);
        const hand: Hand = { source, handedness: source.inputSource.handedness, pressed: new Set(), laser };
        this.hands.set(source, hand);
        laser.parent = source.pointer;
        source.onMotionControllerInitObservable.addOnce(controller => {
            hand.controller = controller;
        });
    }

    public removeController(source: WebXRInputSource): void {
        this.hands.get(source)?.laser.dispose();
        this.hands.delete(source);
    }

    /** Once a frame, before rendering. */
    public update(): void {
        const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000);
        this.last = now;
        const before = { latitude: this.rig.latitude, longitude: this.rig.longitude, heading: this.rig.heading, scale: this.rig.scale };
        if (this.enabled) this.input(dt, now);
        if (this.flight) this.fly(now, dt);
        else if (this.settle) this.settling(now);
        else if (this.held) this.applyFrame(this.held, this.held.tilt);
        else {
            this.followGround(dt);
            this.rig.apply();
        }
        this.updateComfort(before, dt);
    }

    // ------------------------------------------------------------------ input

    private input(dt: number, now: number): void {
        const hands = [...this.hands.values()].filter(hand => hand.controller);
        const squeezing = hands.filter(hand => value(hand, "xr-standard-squeeze") > 0.45);
        if (this.isTilted) {
            // Gripping or a stick first brings the world back level; buttons
            // and pointing still work, and may start another flight.
            const sticks = hands.some(hand => {
                const stick = hand.controller!.getComponent("xr-standard-thumbstick");
                return deadzone(stick?.axes.x ?? 0) !== 0 || deadzone(stick?.axes.y ?? 0) !== 0;
            });
            if ((squeezing.length || sticks) && !this.settle) this.userMoved();
            for (const hand of hands) hand.held = undefined;
            for (const hand of hands) this.buttons(hand);
            this.pointing(hands, now);
            return;
        }
        for (const hand of hands) if (!squeezing.includes(hand)) hand.held = undefined;

        if (squeezing.length) {
            this.userMoved();
            const grips = squeezing.map(hand => (hand.source.grip ?? hand.source.pointer).position.clone());
            if (squeezing.length >= 2) {
                const [a, b] = squeezing;
                if (a.held && b.held) this.pinch(a.held, b.held, grips[0], grips[1]);
            } else if (squeezing[0].held) {
                const p0 = squeezing[0].held, p1 = grips[0];
                this.rig.transform({ x: p0.x, z: p0.z }, { x: p1.x, z: p1.z });
            }
            squeezing.forEach((hand, i) => hand.held = grips[i]);
        }

        for (const hand of hands) {
            const stick = hand.controller!.getComponent("xr-standard-thumbstick");
            const x = deadzone(stick?.axes.x ?? 0), y = deadzone(stick?.axes.y ?? 0);
            if (hand.handedness === "left" && (x || y)) {
                // Where the head looks, level.
                const yaw = Math.atan2(this.headForward().x, this.headForward().z);
                const speed = WALK_SPEED * (1 + 2 * value(hand, "xr-standard-trigger")) * dt;
                const right = x * speed, forward = -y * speed;
                const step = { x: right * Math.cos(yaw) + forward * Math.sin(yaw), z: -right * Math.sin(yaw) + forward * Math.cos(yaw) };
                this.rig.transform(step, { x: 0, z: 0 });
                this.userMoved();
            }
            if (hand.handedness === "right") {
                if (y) {
                    const head = this.head();
                    this.rig.transform(head, head, this.rig.heading, this.rig.scale * Math.exp(-y * ZOOM_RATE * dt));
                    this.userMoved();
                }
                // Snap turn on each push past the threshold.
                if (Math.abs(x) > 0.7 && !this.turned) {
                    const head = this.head();
                    this.rig.transform(head, head, this.rig.heading + Math.sign(x) * SNAP_TURN);
                    this.turned = true;
                    this.userMoved();
                } else if (Math.abs(x) < 0.3) this.turned = false;
            }
            this.buttons(hand);
        }
        this.pointing(hands, now);
    }

    /** Two hands: the world turns and scales with them, about their midpoint. */
    private pinch(a0: Vector3, b0: Vector3, a1: Vector3, b1: Vector3): void {
        const v0x = b0.x - a0.x, v0z = b0.z - a0.z, v1x = b1.x - a1.x, v1z = b1.z - a1.z;
        const d0 = Math.hypot(v0x, v0z), d1 = Math.hypot(v1x, v1z);
        if (d0 < 0.05 || d1 < 0.05) return;
        // Hands apart: the world grows, so the user shrinks.
        const ratio = Math.min(1.5, Math.max(1 / 1.5, d0 / d1));
        const turn = Math.atan2(v1x, v1z) - Math.atan2(v0x, v0z);
        const wrapped = Math.atan2(Math.sin(turn), Math.cos(turn));
        const mid0: RigPoint = { x: (a0.x + b0.x) / 2, z: (a0.z + b0.z) / 2 };
        const mid1: RigPoint = { x: (a1.x + b1.x) / 2, z: (a1.z + b1.z) / 2 };
        this.rig.transform(mid0, mid1, this.rig.heading - wrapped / DEGREES, this.rig.scale * ratio);
    }

    private buttons(hand: Hand): void {
        const names: [string, "a" | "b" | "x" | "y" | "stick-left" | "stick-right"][] = hand.handedness === "right"
            ? [["a-button", "a"], ["b-button", "b"], ["xr-standard-thumbstick", "stick-right"]]
            : [["x-button", "x"], ["y-button", "y"], ["xr-standard-thumbstick", "stick-left"]];
        for (const [id, button] of names) {
            const pressed = !!hand.controller!.getComponent(id)?.pressed;
            if (pressed && !hand.pressed.has(id)) this.options.onButton?.(button);
            if (pressed) hand.pressed.add(id); else hand.pressed.delete(id);
        }
    }

    /** The laser of the hand whose trigger is touched, and a click to zoom along it. */
    private pointing(hands: Hand[], now: number): void {
        let active: Hand | undefined;
        for (const hand of hands) {
            const trigger = hand.controller!.getComponent("xr-standard-trigger");
            // An open panel keeps the right hand's laser up, to show what it points at.
            const aiming = !!trigger && (trigger.touched || trigger.value > 0.02 || (!!this.options.ui?.isOpen && hand.handedness === "right")) && !hand.held;
            if (aiming && (!active || hand.handedness === "right")) active = hand;
        }
        for (const hand of hands) hand.laser.setEnabled(hand === active);
        if (!active) { this.marker.hide(); this.hoverHit = undefined; return; }

        const ray = new Ray(Vector3.Zero(), Vector3.Forward(), 1e9);
        active.source.getWorldPointerRayToRef(ray);
        ray.length = 1e9;
        const ui = this.options.ui;
        if (ui?.isOpen) {
            const distance = ui.hover(ray);
            const physical = this.rig.scale * this.globe.metresToWorld;
            active.laser.scaling.z = distance === undefined ? 2 : Math.min(30, distance / physical);
            this.marker.hide();
            this.hoverHit = undefined;
            const trigger = active.controller!.getComponent("xr-standard-trigger")!;
            const clicked = trigger.pressed && !active.pressed.has("trigger");
            if (trigger.pressed) active.pressed.add("trigger"); else active.pressed.delete("trigger");
            if (clicked) ui.click(ray);
            return;
        }
        if (now - this.hoverAt > 66) {
            this.hoverAt = now;
            const distance = this.options.hover(ray);
            this.hoverHit = distance === undefined ? undefined : ray.origin.add(ray.direction.scale(distance));
        }
        // Pointing at the ground: an arc to where a click lands, and how you will
        // stand there. At the sky: a short laser, going nowhere.
        active.laser.setEnabled(!this.hoverHit);
        active.laser.scaling.z = 2;
        if (this.hoverHit) {
            const arrival = clickScale(this.headPose.scale);
            this.marker.show(ray.origin, this.hoverHit, this.levelForward(), arrival * this.globe.metresToWorld, EYE_HEIGHT, this.camera.globalPosition);
        } else this.marker.hide();

        const trigger = active.controller!.getComponent("xr-standard-trigger")!;
        const clicked = trigger.pressed && !active.pressed.has("trigger");
        if (trigger.pressed) active.pressed.add("trigger"); else active.pressed.delete("trigger");
        if (!clicked) return;
        const distance = this.options.pick(ray) ?? (this.hoverHit ? Vector3.Distance(ray.origin, this.hoverHit) : undefined);
        if (distance === undefined) return;
        const target = this.globe.getSurfaceCoordinates(ray.origin.add(ray.direction.scale(distance)));
        this.userMoved();
        const head = this.headPose;
        // To the point, keeping a good viewing height: the right stick goes lower on purpose.
        void this.flyTo({ latitude: target.latitude, longitude: target.longitude, heading: head.heading, scale: clickScale(head.scale) }, 1100);
    }

    private userMoved(): void {
        if (this.flight || this.held) this.settleDown();
        this.options.onUserMove?.();
    }

    // ----------------------------------------------------------------- motion

    private fly(now: number, dt: number): void {
        const flight = this.flight!;
        // Slow the descent, within limits, until the destination has loaded.
        const waiting = flight.land && flight.t > 0.5 && flight.t < 0.95 && flight.waited < MAX_WAIT_MS
            && !(this.options.destinationReady?.() ?? true);
        flight.rate += ((waiting ? 0.3 : 1) - flight.rate) * (1 - Math.exp(-dt / 0.25));
        flight.waited += (1 - flight.rate) * dt * 1000;
        flight.t = Math.min(1, flight.t + dt * 1000 / flight.duration * flight.rate);
        const t = flight.t, { from, to } = flight;
        // As the flat camera: rise and look down, glide, drop and look up, overlapping; turn mid-way.
        const phase = (a: number, b: number) => smootherstep(Math.max(0, Math.min(1, (t - a) / (b - a))));
        // An overview only rises, and takes all its time to.
        const over = !flight.land;
        const rise = over ? phase(0, 1) : phase(0, 0.45), glide = over ? phase(0, 1) : phase(0.2, 0.8), drop = over ? 0 : phase(0.55, 1);
        const turn = phase(0.25, 0.75), tiltDown = over ? phase(0, 0.85) : phase(0, 0.4), tiltUp = over ? 0 : phase(0.6, 1);
        const lerp = (a: number, b: number, e: number) => a + (b - a) * e;
        // Range in log space, so the climb and the fall feel even at every height.
        const range = Math.exp(lerp(lerp(Math.log(from.range), Math.log(flight.cruise), rise), Math.log(to.range), drop));
        const orbit: Orbit = {
            direction: slerpDirection(from.direction, to.direction, glide),
            radius: lerp(from.radius, to.radius, glide),
            range,
            heading: from.heading + shortest(to.heading - from.heading) * turn,
            pitch: lerp(lerp(from.pitch, flight.cruisePitch, tiltDown), to.pitch, tiltUp),
        };
        // The user's size follows the range, so what the eyes rest on stays as far away.
        const scale = Math.min(GlobeXRRig.MAX_SCALE, Math.max(GlobeXRRig.MIN_SCALE, range * Math.exp(lerp(Math.log(flight.sizeFrom), Math.log(flight.sizeTo), glide))));
        const up = over ? phase(0.1, 0.9) : phase(TILT_IN[0], TILT_IN[1]), down = over ? 0 : phase(TILT_OUT[0], TILT_OUT[1]);
        const high = lerp(lerp(flight.tiltFrom, flight.tiltCruise, up), flight.tiltTo, down);
        const tilt = this.tiltFor(orbit, high);
        const frame = this.orbitFrame(orbit, tilt, scale);
        // Each end's exact frame, in place of the orbit's, faded in and out.
        const atStart = 1 - tiltDown, atEnd = tiltUp;
        const fix = Quaternion.Slerp(Quaternion.Identity(), flight.startFix.rotation, atStart)
            .multiplyInPlace(Quaternion.Slerp(Quaternion.Identity(), flight.endFix.rotation, atEnd));
        frame.rotation.multiplyInPlace(fix);
        frame.eye.addInPlace(flight.startFix.eye.scale(atStart)).addInPlace(flight.endFix.eye.scale(atEnd));
        if (t < 1) {
            this.applyFrame(frame, tilt);
            return;
        }
        this.flight = undefined;
        if (flight.land) {
            // On the ground's level again: the rig's own pose takes over.
            const { floor, ...pose } = flight.land;
            this.rig.set(pose);
            this.rig.floor = this.ground = floor;
            this.rig.apply();
            this.tilt = 0;
        } else {
            this.held = { ...frame, tilt };
            this.applyFrame(frame, tilt);
        }
        flight.resolve(true);
    }

    /** From a turned world back onto the ground's level, about the eyes. */
    private settleDown(): void {
        const current = this.currentFrame();
        this.stopFlight();
        this.held = undefined;
        const m = this.globe.metresToWorld;
        const { latitude, longitude, elevation } = this.globe.getSurfaceCoordinates(current.eye);
        const floor = this.floorAt(latitude, longitude);
        const eyeHeight = Math.max(0.5, this.flightHead.y);
        const scale = Math.min(GlobeXRRig.MAX_SCALE, Math.max(GlobeXRRig.MIN_SCALE, (elevation / m - floor) / eyeHeight));
        const heading = angles(current.eye, this.levelForward()).heading;
        const standard = this.standardFrame({ latitude, longitude, heading, scale }, floor);
        this.settle = { from: current, to: standard.frame, pose: { ...standard.pose, floor }, start: performance.now() };
    }

    private settling(now: number): void {
        const settle = this.settle!;
        const e = smootherstep(Math.min(1, (now - settle.start) / SETTLE_MS));
        if (e >= 1) {
            this.settle = undefined;
            const { floor, ...pose } = settle.pose;
            this.rig.set(pose);
            this.rig.floor = this.ground = floor;
            this.rig.apply();
            this.tilt = 0;
            return;
        }
        const { from, to } = settle;
        this.applyFrame({
            rotation: Quaternion.Slerp(from.rotation, to.rotation, e),
            eye: Vector3.Lerp(from.eye, to.eye, e),
            scale: Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * e),
        }, this.tilt * (1 - e));
    }

    /** Places the rig at `frame`, keeping its pose fields roughly in step for anything that reads them. */
    private applyFrame(frame: Frame, tilt: number): void {
        this.rig.applyFrame(frame.rotation, frame.eye, this.flightHead, frame.scale);
        const { latitude, longitude } = this.globe.getSurfaceCoordinates(frame.eye);
        this.rig.latitude = latitude;
        this.rig.longitude = longitude;
        this.rig.scale = frame.scale;
        this.tilt = tilt;
    }

    /** The rig's frame as it is now. */
    private currentFrame(): Frame {
        const rotation = this.rig.node.rotationQuaternion!.clone();
        const eye = Vector3.TransformCoordinates(this.camera.position, this.rig.node.getWorldMatrix());
        return { rotation, eye, scale: this.rig.scale };
    }

    /** The world direction, level in the rig, the head faced as the flight began (or faces now, on the ground). */
    private levelForward(): Vector3 {
        const yaw = this.isTilted ? this.flightYaw : Math.atan2(this.headForward().x, this.headForward().z);
        return new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).applyRotationQuaternionInPlace(this.rig.node.rotationQuaternion!);
    }

    /**
     * The orbit seen from `frame`: what the eyes, resting `gaze` degrees
     * below the head's level, look at on the ground `ground` metres up, or
     * a point ahead where that look misses the globe.
     */
    private orbitFrom(frame: Frame, gaze: number, ground: number): Orbit {
        const m = this.globe.metresToWorld;
        const forward = new Vector3(Math.sin(this.flightYaw), 0, Math.cos(this.flightYaw)).applyRotationQuaternionInPlace(frame.rotation);
        const up = Vector3.Up().applyRotationQuaternionInPlace(frame.rotation);
        const look = forward.scale(Math.cos(gaze * DEGREES)).subtractInPlace(up.scale(Math.sin(gaze * DEGREES))).normalize();
        const eye = frame.eye, sphere = this.globe.radius + ground * m;
        const b = Vector3.Dot(eye, look), c = eye.lengthSquared() - sphere * sphere, disc = b * b - c;
        let range = disc > 0 && -b - Math.sqrt(disc) > 0 ? -b - Math.sqrt(disc) : 0;
        if (!range) range = Math.max(1000 * m, (eye.length() - sphere) * 3);
        const target = eye.add(look.scale(range));
        const { heading, pitch } = angles(target, look);
        return { direction: target.normalizeToNew(), radius: Math.max(sphere, target.length()), range, heading, pitch };
    }

    /** How high `orbit`'s eye is, 0 to 1: from where the world may start tilting to where it tilts fully. */
    private highUp(orbit: Orbit): number {
        const target = orbit.direction.scale(orbit.radius);
        const { forward } = localFrame(target, orbit.heading, orbit.pitch);
        const altitude = (target.subtract(forward.scale(orbit.range)).length() - this.globe.radius) / this.globe.metresToWorld;
        return smoothstep(Math.log(TILT_FROM), Math.log(TILT_TO), Math.log(Math.max(1, altitude)));
    }

    /** The orbit looking straight down from `frame`'s eye onto ground `ground` metres up, headed as the head faces. */
    private overhead(frame: Frame, ground: number): Orbit {
        const m = this.globe.metresToWorld, sphere = this.globe.radius + ground * m;
        const forward = new Vector3(Math.sin(this.flightYaw), 0, Math.cos(this.flightYaw)).applyRotationQuaternionInPlace(frame.rotation);
        const direction = frame.eye.normalizeToNew();
        return { direction, radius: sphere, range: Math.max(1000 * m, frame.eye.length() - sphere),
            heading: angles(direction.scale(sphere), forward).heading, pitch: -89.5 };
    }

    /**
     * Degrees to tilt the world while looking along `orbit`, `high` of the way
     * (0 near the ground, where the horizon must stay level) to bringing what
     * the flight looks at to `GLOBE_GAZE` below the eyes' level.
     */
    private tiltFor(orbit: Orbit, high: number): number {
        return Math.max(0, -orbit.pitch - GLOBE_GAZE) * high;
    }

    /**
     * The rig's frame looking along `orbit`: the eye where the orbit puts it,
     * and the head as the flight began facing along it, the world tilted by
     * `tilt` degrees so the look lies that much nearer the eyes' level.
     */
    private orbitFrame(orbit: Orbit, tilt: number, scale: number): Frame {
        const target = orbit.direction.scale(orbit.radius);
        const { forward: look, level, up } = localFrame(target, orbit.heading, orbit.pitch);
        const eye = target.subtract(look.scale(orbit.range));
        const tau = tilt * DEGREES;
        // The rig's level, `tilt` below the target's, and its up likewise turned.
        const ahead = level.scale(Math.cos(tau)).subtractInPlace(up.scale(Math.sin(tau)));
        const vertical = up.scale(Math.cos(tau)).addInPlace(level.scale(Math.sin(tau)));
        const side = Vector3.Cross(vertical, ahead);
        // Turned so the head, as it was, faces `ahead`.
        const yaw = this.flightYaw, c = Math.cos(yaw), s = Math.sin(yaw);
        const right = side.scale(c).addInPlace(ahead.scale(s));
        const forward = ahead.scale(c).subtractInPlace(side.scale(s));
        const rotation = Quaternion.FromRotationMatrix(Matrix.FromValues(
            right.x, right.y, right.z, 0,
            vertical.x, vertical.y, vertical.z, 0,
            forward.x, forward.y, forward.z, 0,
            0, 0, 0, 1));
        return { rotation, eye, scale };
    }

    /** The rig's own frame for `pose`, with the head as the flight began standing over the pose's place, facing its heading. */
    private standardFrame(pose: RigPose, floor: number): { frame: Frame; pose: RigPose } {
        const probe = new GlobeXRRig(this.globe, this.scene);
        probe.set(pose);
        probe.floor = floor;
        const head = { x: this.flightHead.x, z: this.flightHead.z };
        probe.transform({ x: 0, z: 0 }, head);
        probe.transform(head, head, pose.heading - this.flightYaw / DEGREES);
        probe.apply();
        const frame = { rotation: probe.node.rotationQuaternion!.clone(), eye: Vector3.TransformCoordinates(this.flightHead, probe.node.getWorldMatrix()), scale: probe.scale };
        const placed = { latitude: probe.latitude, longitude: probe.longitude, heading: probe.heading, scale: probe.scale };
        probe.node.dispose();
        return { frame, pose: placed };
    }

    private followGround(dt: number): void {
        if (++this.groundAge > 5) {
            this.groundAge = 0;
            const head = this.headPose;
            this.ground = this.floorAt(head.latitude, head.longitude);
        }
        // Quick when close to the ground, so nothing is walked through.
        const rate = this.rig.scale < 20 ? 6 : 2;
        this.rig.floor += (this.ground - this.rig.floor) * (1 - Math.exp(-dt * rate));
    }

    private floorAt(latitude: number, longitude: number): number {
        const ground = this.options.groundAt(latitude, longitude);
        return this.diving ? ground : Math.max(0, ground);
    }

    /** The prefetch camera: at the destination, looking where the eyes will rest; or at `frame`, toward the globe. */
    private placeDestination(pose: RigPose, frame?: Frame): void {
        const m = this.globe.metresToWorld;
        if (frame) {
            this.destination.position.copyFrom(frame.eye);
            const look = frame.eye.negate().normalize();
            const side = Math.abs(look.y) > 0.9 ? Vector3.Right() : Vector3.Up();
            Quaternion.FromLookDirectionLHToRef(look, Vector3.Cross(look, Vector3.Cross(side, look)).normalize(), this.destination.rotationQuaternion!);
        } else {
            const ground = this.floorAt(pose.latitude, pose.longitude);
            const position = this.globe.getSurfacePosition(pose.latitude, pose.longitude, (ground + EYE_HEIGHT * pose.scale) * m);
            const probe = new GlobeXRRig(this.globe, this.scene);
            probe.set(pose);
            const { up, forward } = probe.axes();
            probe.node.dispose();
            const look = forward.scale(Math.cos(GAZE * DEGREES)).subtract(up.scale(Math.sin(GAZE * DEGREES)));
            this.destination.position.copyFrom(position);
            Quaternion.FromLookDirectionLHToRef(look, up, this.destination.rotationQuaternion!);
        }
        this.destination.minZ = this.camera.minZ;
        this.destination.maxZ = this.camera.maxZ;
    }

    /**
     * With the rig origin where the head should be: moves the rig so the head
     * is there instead, and turns it about the head to face `heading`.
     */
    private centreHead(heading: number): void {
        const head = this.head();
        this.rig.transform({ x: 0, z: 0 }, head);
        this.rig.transform(head, head, heading - Math.atan2(this.headForward().x, this.headForward().z) / DEGREES);
    }

    /** Head position in the rig, physical metres. */
    private head(): RigPoint {
        return { x: this.camera.position.x, z: this.camera.position.z };
    }

    /** Level direction the head faces, in the rig. */
    private headForward(): { x: number; z: number } {
        const q = this.camera.rotationQuaternion;
        const f = q ? Vector3.Forward().rotateByQuaternionToRef(q, new Vector3()) : Vector3.Forward();
        const length = Math.hypot(f.x, f.z) || 1;
        return { x: f.x / length, z: f.z / length };
    }

    // ---------------------------------------------------------------- comfort

    /** Narrows the view while the world moves, in proportion to how fast it moves. */
    private updateComfort(before: RigPose, dt: number): void {
        if (dt <= 0) return;
        const [east, north] = [(this.rig.longitude - before.longitude) * Math.cos(this.rig.latitude * DEGREES), this.rig.latitude - before.latitude];
        const metres = Math.hypot(east, north) * DEGREES * this.globe.radius / this.globe.metresToWorld;
        const linear = metres / this.rig.scale / dt;
        const zoom = Math.abs(Math.log(this.rig.scale / before.scale)) / dt;
        const turn = Math.abs(((this.rig.heading - before.heading + 540) % 360) - 180);
        // Snap turns are instant: no vignette needed.
        // A scripted flight is expected and steady: a light frame, so the way stays in view.
        const target = Math.min(this.flight ? 0.3 : 1, linear / 6 + zoom / 2.5 + (turn > 5 ? 0 : turn / dt / 120));
        this.comfort += (target - this.comfort) * (1 - Math.exp(-dt * (target > this.comfort ? 10 : 3)));
        const visible = this.comfort > 0.04;
        this.vignette.setEnabled(visible);
        if (!visible) return;
        // Clear aperture from 55 degrees wide at rest to 25 degrees at full.
        const aperture = Math.tan((55 - 30 * this.comfort) * DEGREES) * 0.3;
        this.vignette.scaling.set(aperture, aperture, 1);
        (this.vignette.material as StandardMaterial).alpha = Math.min(1, this.comfort * 1.6);
    }

    /** A ring in front of the eyes, clear inside and black toward the edges. */
    private createVignette(): Mesh {
        const segments = 48, positions: number[] = [], colors: number[] = [], indices: number[] = [];
        const radii = [1, 1.5, 6], alphas = [0, 1, 1];
        for (let i = 0; i <= segments; i++) {
            const a = i / segments * Math.PI * 2;
            radii.forEach((r, k) => {
                positions.push(Math.cos(a) * r, Math.sin(a) * r, 0);
                colors.push(0, 0, 0, alphas[k]);
            });
            if (i < segments) for (let k = 0; k < radii.length - 1; k++) {
                const p = i * radii.length + k, q = p + radii.length;
                indices.push(p, q, p + 1, p + 1, q, q + 1);
            }
        }
        const mesh = new Mesh("xr comfort vignette", this.scene);
        Object.assign(new VertexData(), { positions, colors, indices }).applyToMesh(mesh);
        mesh.hasVertexAlpha = true;
        mesh.material = this.overlayMaterial("xr comfort vignette", Color3.Black(), 1);
        mesh.parent = this.camera;
        mesh.position.z = 0.3;
        mesh.renderingGroupId = this.overlayGroup;
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.setEnabled(false);
        return mesh;
    }

    private overlayMaterial(name: string, color: Color3, alpha: number): StandardMaterial {
        const material = new StandardMaterial(name, this.scene);
        material.disableLighting = true;
        material.emissiveColor = color;
        material.alpha = alpha;
        material.backFaceCulling = false;
        // Over everything: these are guides, not part of the world.
        material.depthFunction = Constants.ALWAYS;
        material.disableDepthWrite = true;
        material.fogEnabled = false;
        return material;
    }
}

const EARTH_RADIUS = 6_371_008;

/** The scale a click arrives at from `scale`: the same, unless higher than the view looks best from. */
function clickScale(scale: number): number {
    return scale <= VIEW_SCALE ? scale : Math.max(VIEW_SCALE, scale * CLICK_DESCENT);
}

function smoothstep(a: number, b: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

function shortest(degrees: number): number {
    return ((degrees % 360) + 540) % 360 - 180;
}

/**
 * The local frame at `position` on the globe: up, level along `heading`
 * (degrees clockwise from north), and `forward`, that pitched by `pitch`
 * (degrees, negative down). Matches the rig's own axes.
 */
function localFrame(position: Vector3, heading: number, pitch: number): { forward: Vector3; level: Vector3; up: Vector3 } {
    const up = position.normalizeToNew();
    let east = Vector3.Cross(up, Vector3.Up());
    if (east.lengthSquared() < 1e-12) east = new Vector3(-1, 0, 0);
    east.normalize();
    const north = Vector3.Cross(east, up);
    const h = heading * DEGREES, p = pitch * DEGREES;
    const level = north.scale(Math.cos(h)).addInPlace(east.scale(Math.sin(h)));
    const forward = level.scale(Math.cos(p)).addInPlace(up.scale(Math.sin(p)));
    return { forward, level, up };
}

/** Heading and pitch, in degrees, of a world direction seen from `position`. */
function angles(position: Vector3, direction: Vector3): { heading: number; pitch: number } {
    const up = position.normalizeToNew();
    let east = Vector3.Cross(up, Vector3.Up());
    if (east.lengthSquared() < 1e-12) east = new Vector3(-1, 0, 0);
    east.normalize();
    const north = Vector3.Cross(east, up);
    const d = direction.normalizeToNew();
    return {
        heading: Math.atan2(Vector3.Dot(d, east), Vector3.Dot(d, north)) / DEGREES,
        pitch: Math.asin(Math.max(-1, Math.min(1, Vector3.Dot(d, up)))) / DEGREES,
    };
}

/** Along the great circle between two unit directions. */
function slerpDirection(a: Vector3, b: Vector3, t: number): Vector3 {
    const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(a, b))));
    if (angle < 1e-9) return b.clone();
    const s = Math.sin(angle);
    return a.scale(Math.sin((1 - t) * angle) / s).addInPlace(b.scale(Math.sin(t * angle) / s));
}

function smootherstep(x: number): number {
    return x * x * x * (x * (x * 6 - 15) + 10);
}

function value(hand: Hand, id: string): number {
    return hand.controller?.getComponent(id)?.value ?? 0;
}

function deadzone(v: number): number {
    const d = 0.15;
    return Math.abs(v) < d ? 0 : Math.sign(v) * (Math.abs(v) - d) / (1 - d);
}
