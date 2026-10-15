import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";

const WGS84_A = 6378137;
const WGS84_E2 = 6.6943799901413165e-3;
const DEGREES = Math.PI / 180;

/** WGS84 geodetic position. Heights are metres above the ellipsoid. */
export interface GeodeticPosition {
    latitude: number;
    longitude: number;
    height?: number;
}

/** WGS84 geodetic coordinates to Earth-centred, Earth-fixed metres. */
export function geodeticToECEF(latitude: number, longitude: number, height = 0, result = new Vector3()): Vector3 {
    const phi = latitude * DEGREES, lambda = longitude * DEGREES;
    const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
    return result.copyFromFloats(
        (n + height) * cosPhi * Math.cos(lambda),
        (n + height) * cosPhi * Math.sin(lambda),
        (n * (1 - WGS84_E2) + height) * sinPhi,
    );
}

/** Earth-centred, Earth-fixed metres to WGS84 geodetic coordinates (Bowring, sub-millimetre near the surface). */
export function ecefToGeodetic(x: number, y: number, z: number): Required<GeodeticPosition> {
    const b = WGS84_A * Math.sqrt(1 - WGS84_E2);
    const ep2 = (WGS84_A * WGS84_A - b * b) / (b * b);
    const p = Math.hypot(x, y);
    const theta = Math.atan2(z * WGS84_A, p * b);
    const phi = Math.atan2(z + ep2 * b * Math.sin(theta) ** 3, p - WGS84_E2 * WGS84_A * Math.cos(theta) ** 3);
    const sinPhi = Math.sin(phi);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
    const height = Math.abs(Math.cos(phi)) > 1e-9 ? p / Math.cos(phi) - n : Math.abs(z) - b;
    return { latitude: phi / DEGREES, longitude: Math.atan2(y, x) / DEGREES, height };
}

/** East, north and up unit vectors of the WGS84 tangent plane, in ECEF. */
export function ellipsoidFrame(latitude: number, longitude: number) {
    const phi = latitude * DEGREES, lambda = longitude * DEGREES;
    const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi), sinLambda = Math.sin(lambda), cosLambda = Math.cos(lambda);
    return {
        east: new Vector3(-sinLambda, cosLambda, 0),
        north: new Vector3(-sinPhi * cosLambda, -sinPhi * sinLambda, cosPhi),
        up: new Vector3(cosPhi * cosLambda, cosPhi * sinLambda, sinPhi),
    };
}

/** Where, and in which orientation, the ECEF anchor appears in the Babylon scene. */
export interface WorldAnchor {
    position: Vector3;
    east: Vector3;
    north: Vector3;
    up: Vector3;
    /** World units per metre. */
    scale: number;
}

/**
 * A similarity transform from ECEF metres to Babylon world space: the WGS84
 * tangent frame at `anchor` is placed on the supplied world frame. Distances
 * and angles near the anchor are exact, which keeps photogrammetry seamless
 * however the host scene models the Earth.
 */
export class GoogleTileFrame {
    /** ECEF to world, row-vector convention (Babylon). */
    public readonly matrix = new Matrix();
    /** World to ECEF. */
    public readonly inverse = new Matrix();
    public readonly anchorECEF = new Vector3();
    public anchor: Required<GeodeticPosition> = { latitude: 0, longitude: 0, height: 0 };
    public world!: WorldAnchor;
    /** Increments whenever the transform changes. */
    public revision = 0;

    public set(anchor: GeodeticPosition, world: WorldAnchor): void {
        this.anchor = { latitude: anchor.latitude, longitude: anchor.longitude, height: anchor.height ?? 0 };
        this.world = world;
        geodeticToECEF(this.anchor.latitude, this.anchor.longitude, this.anchor.height, this.anchorECEF);
        const { east, north, up } = ellipsoidFrame(this.anchor.latitude, this.anchor.longitude);
        // Row i is the world-space image of ECEF axis i.
        const rows = [0, 1, 2].map(axis => {
            const component = (v: Vector3) => axis === 0 ? v.x : axis === 1 ? v.y : v.z;
            return world.east.scale(component(east))
                .addInPlace(world.north.scale(component(north)))
                .addInPlace(world.up.scale(component(up)))
                .scaleInPlace(world.scale);
        });
        const p = this.anchorECEF;
        const t = world.position.subtract(rows[0].scale(p.x)).subtractInPlace(rows[1].scale(p.y)).subtractInPlace(rows[2].scale(p.z));
        Matrix.FromValuesToRef(
            rows[0].x, rows[0].y, rows[0].z, 0,
            rows[1].x, rows[1].y, rows[1].z, 0,
            rows[2].x, rows[2].y, rows[2].z, 0,
            t.x, t.y, t.z, 1,
            this.matrix,
        );
        this.matrix.invertToRef(this.inverse);
        this.revision++;
    }

    public toWorld(ecef: Vector3, result = new Vector3()): Vector3 {
        return Vector3.TransformCoordinatesToRef(ecef, this.matrix, result);
    }

    public toECEF(world: Vector3, result = new Vector3()): Vector3 {
        return Vector3.TransformCoordinatesToRef(world, this.inverse, result);
    }
}

/** glTF Y-up to 3D Tiles Z-up, row-vector convention: (x, y, z) -> (x, -z, y). */
export const Y_UP_TO_Z_UP = Matrix.FromValues(
    1, 0, 0, 0,
    0, 0, 1, 0,
    0, -1, 0, 0,
    0, 0, 0, 1,
);
