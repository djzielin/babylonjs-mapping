import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { GlobeSet } from "babylonjs-mapping";

const DEGREES = Math.PI / 180;

/** A horizontal point in the rig's own frame, in physical metres: x right, z forward. */
export interface RigPoint { x: number; z: number }

/** Where the rig stands, how it faces, and how large its user is. */
export interface RigPose {
    latitude: number;
    longitude: number;
    /** Degrees clockwise from north that the rig's forward faces. */
    heading: number;
    /** World metres per physical metre: 1 is life size; 1000 makes a city a tabletop. */
    scale: number;
}

/**
 * The XR camera's parent: places the tracked floor on the globe, upright to
 * the local vertical, facing `heading`, and scaled so each physical metre
 * spans `scale` metres of the world. Headset and controllers move within it
 * in physical metres, so the XR reference space never leaves the origin and
 * keeps full precision however far from the globe's centre the user stands.
 */
export class GlobeXRRig implements RigPose {
    public readonly node: TransformNode;
    public latitude = 0;
    public longitude = 0;
    public heading = 0;
    public scale = 1;
    /** Altitude in metres of the physical floor: the ground beneath, smoothed. */
    public floor = 0;
    public static readonly MIN_SCALE = 1;
    public static readonly MAX_SCALE = 4e6;

    private readonly earthRadius: number;

    public constructor(private readonly globe: GlobeSet, scene: Scene) {
        this.node = new TransformNode("xr rig", scene);
        this.node.rotationQuaternion = new Quaternion();
        this.earthRadius = globe.radius / globe.metresToWorld;
    }

    public set(pose: Partial<RigPose>): void {
        Object.assign(this, pose);
        this.normalise();
    }

    /** Updates the node from the pose. */
    public apply(): void {
        const m = this.globe.metresToWorld;
        const position = this.globe.getSurfacePosition(this.latitude, this.longitude, this.floor * m);
        const { right, up, forward } = this.axes();
        const rotation = Matrix.FromValues(
            right.x, right.y, right.z, 0,
            up.x, up.y, up.z, 0,
            forward.x, forward.y, forward.z, 0,
            0, 0, 0, 1);
        Quaternion.FromRotationMatrixToRef(rotation, this.node.rotationQuaternion!);
        this.node.position.copyFrom(position);
        this.node.scaling.setAll(this.scale * m);
        this.node.computeWorldMatrix(true);
    }

    /**
     * Places the node directly, for flights: `rotation` from the rig's frame
     * to the world, the head (rig-local `head`, physical metres) at `eye`
     * in world units. The pose fields are left for the caller to keep.
     */
    public applyFrame(rotation: Quaternion, eye: Vector3, head: Vector3, scale: number): void {
        const m = this.globe.metresToWorld;
        this.node.rotationQuaternion!.copyFrom(rotation);
        this.node.scaling.setAll(scale * m);
        const offset = head.scale(scale * m).applyRotationQuaternionInPlace(rotation);
        this.node.position.copyFrom(eye).subtractInPlace(offset);
        this.node.computeWorldMatrix(true);
    }

    /** World axes of the rig: right, the local vertical, and forward along `heading`. */
    public axes(): { right: Vector3; up: Vector3; forward: Vector3 } {
        const lat = this.latitude * DEGREES, lon = this.longitude * DEGREES, h = this.heading * DEGREES;
        const up = this.globe.getSurfacePosition(this.latitude, this.longitude, 0).normalize();
        const east = new Vector3(-Math.cos(lon), 0, -Math.sin(lon));
        const north = new Vector3(Math.sin(lat) * Math.sin(lon), Math.cos(lat), -Math.sin(lat) * Math.cos(lon));
        const forward = north.scale(Math.cos(h)).addInPlace(east.scale(Math.sin(h)));
        return { right: Vector3.Cross(up, forward), up, forward };
    }

    /**
     * Turns and scales the world about the user's hands or head: what was
     * under `before` (rig-local, at the current heading and scale) ends up
     * under `after` once the rig has the new heading and scale. Dragging,
     * pinching, snap turns and zooming are all this one move.
     */
    public transform(before: RigPoint, after: RigPoint, heading = this.heading, scale = this.scale): void {
        scale = Math.min(GlobeXRRig.MAX_SCALE, Math.max(GlobeXRRig.MIN_SCALE, scale));
        const [e0, n0] = this.toEastNorth(before, this.heading, this.scale);
        const [e1, n1] = this.toEastNorth(after, heading, scale);
        this.heading = heading;
        this.scale = scale;
        this.move(e0 - e1, n0 - n1);
    }

    /** Moves the rig over the ground by metres east and north. */
    public move(east: number, north: number): void {
        const lat = this.latitude * DEGREES;
        this.latitude += north / this.earthRadius / DEGREES;
        this.longitude += east / (this.earthRadius * Math.max(0.01, Math.cos(lat))) / DEGREES;
        this.normalise();
    }

    /** Metres east and north of the rig origin of a rig-local point. */
    public toEastNorth(point: RigPoint, heading = this.heading, scale = this.scale): [number, number] {
        const h = heading * DEGREES, s = Math.sin(h), c = Math.cos(h);
        // forward = (sin h, cos h) and right = (cos h, -sin h) in (east, north).
        return [(point.x * c + point.z * s) * scale, (-point.x * s + point.z * c) * scale];
    }

    private normalise(): void {
        this.latitude = Math.max(-89.5, Math.min(89.5, this.latitude));
        this.longitude = ((this.longitude + 540) % 360) - 180;
        this.heading = ((this.heading % 360) + 360) % 360;
        this.scale = Math.min(GlobeXRRig.MAX_SCALE, Math.max(GlobeXRRig.MIN_SCALE, this.scale));
    }
}
