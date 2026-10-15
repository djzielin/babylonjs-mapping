import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
/** WGS84 geodetic position. Heights are metres above the ellipsoid. */
export interface GeodeticPosition {
    latitude: number;
    longitude: number;
    height?: number;
}
/** WGS84 geodetic coordinates to Earth-centred, Earth-fixed metres. */
export declare function geodeticToECEF(latitude: number, longitude: number, height?: number, result?: Vector3): Vector3;
/** Earth-centred, Earth-fixed metres to WGS84 geodetic coordinates (Bowring, sub-millimetre near the surface). */
export declare function ecefToGeodetic(x: number, y: number, z: number): Required<GeodeticPosition>;
/** East, north and up unit vectors of the WGS84 tangent plane, in ECEF. */
export declare function ellipsoidFrame(latitude: number, longitude: number): {
    east: Vector3;
    north: Vector3;
    up: Vector3;
};
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
export declare class GoogleTileFrame {
    /** ECEF to world, row-vector convention (Babylon). */
    readonly matrix: Matrix;
    /** World to ECEF. */
    readonly inverse: Matrix;
    readonly anchorECEF: Vector3;
    anchor: Required<GeodeticPosition>;
    world: WorldAnchor;
    /** Increments whenever the transform changes. */
    revision: number;
    set(anchor: GeodeticPosition, world: WorldAnchor): void;
    toWorld(ecef: Vector3, result?: Vector3): Vector3;
    toECEF(world: Vector3, result?: Vector3): Vector3;
}
/** glTF Y-up to 3D Tiles Z-up, row-vector convention: (x, y, z) -> (x, -z, y). */
export declare const Y_UP_TO_Z_UP: Matrix;
