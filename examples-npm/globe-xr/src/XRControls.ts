import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
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
const CLICK_ZOOM = 0.35;
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

interface Flight {
    from: RigPose;
    to: RigPose;
    /** Extra log-scale at mid-flight, to rise over long distances. */
    lift: number;
    start: number;
    duration: number;
    resolve: (done: boolean) => void;
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
    private readonly reticle: Mesh;
    private flight?: Flight;
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
        this.reticle = this.createReticle();
    }

    /** Where the user's head is, as a rig pose with the head at its origin. */
    public get headPose(): RigPose & { height: number } {
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
        this.cancelFlight();
        this.rig.set(pose);
        this.ground = this.floorAt(pose.latitude, pose.longitude);
        this.rig.floor = this.ground;
        this.centreHead(pose.heading);
        this.rig.apply();
    }

    /** Glides the head to `pose`: rising over long distances, eased at both ends. */
    public flyTo(pose: RigPose, durationMs?: number): Promise<boolean> {
        this.cancelFlight();
        const from = this.headPose;
        const distance = greatCircle(from.latitude, from.longitude, pose.latitude, pose.longitude);
        // High enough at mid-flight to see the way: a tenth of the distance as eye height.
        const peak = Math.log(Math.max(1, distance / 10 / EYE_HEIGHT));
        const lift = Math.max(0, peak - Math.max(Math.log(from.scale), Math.log(pose.scale)));
        const duration = durationMs ?? Math.min(9000, 1200 + 1400 * Math.log10(1 + distance / 1000));
        this.placeDestination(pose);
        return new Promise(resolve => {
            this.flight = { from, to: pose, lift, start: performance.now(), duration, resolve };
        });
    }

    public get isFlying(): boolean {
        return !!this.flight;
    }

    public cancelFlight(): void {
        const flight = this.flight;
        this.flight = undefined;
        flight?.resolve(false);
    }

    public addController(source: WebXRInputSource): void {
        const laser = CreateBox("xr laser", { width: 0.0025, height: 0.0025, depth: 1 }, this.scene);
        // From the controller forward.
        laser.bakeTransformIntoVertices(Matrix.Translation(0, 0, 0.5));
        laser.material = this.overlayMaterial("xr laser", new Color3(0.55, 0.85, 1), 0.65);
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
        if (this.flight) this.fly(now);
        if (this.enabled) this.input(dt, now);
        this.followGround(dt);
        this.rig.apply();
        this.updateComfort(before, dt);
    }

    // ------------------------------------------------------------------ input

    private input(dt: number, now: number): void {
        const hands = [...this.hands.values()].filter(hand => hand.controller);
        const squeezing = hands.filter(hand => value(hand, "xr-standard-squeeze") > 0.45);
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
            const aiming = !!trigger && (trigger.touched || trigger.value > 0.02) && !hand.held;
            if (aiming && (!active || hand.handedness === "right")) active = hand;
        }
        for (const hand of hands) hand.laser.setEnabled(hand === active);
        if (!active) { this.reticle.setEnabled(false); this.hoverHit = undefined; return; }

        const ray = new Ray(Vector3.Zero(), Vector3.Forward(), 1e9);
        active.source.getWorldPointerRayToRef(ray);
        ray.length = 1e9;
        if (now - this.hoverAt > 66) {
            this.hoverAt = now;
            const distance = this.options.hover(ray);
            this.hoverHit = distance === undefined ? undefined : ray.origin.add(ray.direction.scale(distance));
        }
        const physical = this.rig.scale * this.globe.metresToWorld;
        const length = this.hoverHit ? Vector3.Distance(ray.origin, this.hoverHit) / physical : 30;
        active.laser.scaling.z = Math.min(30, length);
        this.reticle.setEnabled(!!this.hoverHit);
        if (this.hoverHit) {
            this.reticle.position.copyFrom(this.hoverHit);
            const eye = this.camera.globalPosition;
            const toEye = eye.subtract(this.hoverHit);
            // A constant size on screen, facing the eye.
            this.reticle.scaling.setAll(toEye.length() * 0.012);
            Quaternion.FromLookDirectionLHToRef(toEye.normalize().negate(), Vector3.Up(), this.reticle.rotationQuaternion!);
        }

        const trigger = active.controller!.getComponent("xr-standard-trigger")!;
        const clicked = trigger.pressed && !active.pressed.has("trigger");
        if (trigger.pressed) active.pressed.add("trigger"); else active.pressed.delete("trigger");
        if (!clicked) return;
        const distance = this.options.pick(ray) ?? (this.hoverHit ? Vector3.Distance(ray.origin, this.hoverHit) : undefined);
        if (distance === undefined) return;
        const target = this.globe.getSurfaceCoordinates(ray.origin.add(ray.direction.scale(distance)));
        this.userMoved();
        const head = this.headPose;
        // Toward the point, and closer: the eye height shrinks with each click.
        void this.flyTo({ latitude: target.latitude, longitude: target.longitude, heading: head.heading, scale: Math.max(1, head.scale * CLICK_ZOOM) }, 1100);
    }

    private userMoved(): void {
        if (this.flight) this.cancelFlight();
        this.options.onUserMove?.();
    }

    // ----------------------------------------------------------------- motion

    private fly(now: number): void {
        const flight = this.flight!;
        const t = Math.min(1, (now - flight.start) / flight.duration);
        const e = t * t * t * (t * (t * 6 - 15) + 10);
        const { from, to } = flight;
        const [latitude, longitude] = slerp(from.latitude, from.longitude, to.latitude, to.longitude, e);
        const scale = Math.exp(Math.log(from.scale) * (1 - e) + Math.log(to.scale) * e + flight.lift * Math.sin(Math.PI * e));
        const turn = ((to.heading - from.heading + 540) % 360) - 180;
        this.rig.set({ latitude, longitude, heading: from.heading + turn * e, scale });
        this.centreHead(from.heading + turn * e);
        if (t >= 1) {
            this.flight = undefined;
            flight.resolve(true);
        }
    }

    /** The floor eases to the ground under the head: terrain and rooftops at life size, the land when large. */
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

    private placeDestination(pose: RigPose): void {
        const m = this.globe.metresToWorld;
        const ground = this.floorAt(pose.latitude, pose.longitude);
        const position = this.globe.getSurfacePosition(pose.latitude, pose.longitude, (ground + EYE_HEIGHT * pose.scale) * m);
        const probe = new GlobeXRRig(this.globe, this.scene);
        probe.set(pose);
        const { up, forward } = probe.axes();
        probe.node.dispose();
        const look = forward.scale(Math.cos(35 * DEGREES)).subtract(up.scale(Math.sin(35 * DEGREES)));
        this.destination.position.copyFrom(position);
        Quaternion.FromLookDirectionLHToRef(look, up, this.destination.rotationQuaternion!);
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
        const target = Math.min(1, linear / 6 + zoom / 2.5 + (turn > 5 ? 0 : turn / dt / 120));
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

    private createReticle(): Mesh {
        const disc = CreateDisc("xr reticle", { radius: 1, tessellation: 32 }, this.scene);
        disc.material = this.overlayMaterial("xr reticle", new Color3(0.85, 0.95, 1), 0.85);
        disc.rotationQuaternion = new Quaternion();
        disc.renderingGroupId = this.overlayGroup;
        disc.isPickable = false;
        disc.alwaysSelectAsActiveMesh = true;
        disc.setEnabled(false);
        return disc;
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

function value(hand: Hand, id: string): number {
    return hand.controller?.getComponent(id)?.value ?? 0;
}

function deadzone(v: number): number {
    const d = 0.15;
    return Math.abs(v) < d ? 0 : Math.sign(v) * (Math.abs(v) - d) / (1 - d);
}

function greatCircle(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const a = Math.sin((lat2 - lat1) * DEGREES / 2) ** 2 + Math.cos(lat1 * DEGREES) * Math.cos(lat2 * DEGREES) * Math.sin((lon2 - lon1) * DEGREES / 2) ** 2;
    return 2 * 6_371_008 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Along the great circle between two points. */
function slerp(lat1: number, lon1: number, lat2: number, lon2: number, t: number): [number, number] {
    const toVector = (lat: number, lon: number) => new Vector3(Math.cos(lat * DEGREES) * Math.cos(lon * DEGREES), Math.sin(lat * DEGREES), Math.cos(lat * DEGREES) * Math.sin(lon * DEGREES));
    const a = toVector(lat1, lon1), b = toVector(lat2, lon2);
    const angle = Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(a, b))));
    if (angle < 1e-9) return [lat2, lon2];
    const p = a.scale(Math.sin((1 - t) * angle) / Math.sin(angle)).addInPlace(b.scale(Math.sin(t * angle) / Math.sin(angle)));
    return [Math.asin(Math.max(-1, Math.min(1, p.y))) / DEGREES, Math.atan2(p.z, p.x) / DEGREES];
}
