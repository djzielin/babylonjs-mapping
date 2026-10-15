/**
 * Low-poly vehicles. Aircraft are at true scale, built procedurally from a type's real
 * length and wingspan and its general arrangement: enough to tell an A380
 * from a regional jet or a Cessna at a glance, at a few hundred triangles each.
 *
 * Models are in metres: x to the right wingtip, y up, z forward, centred on
 * the fuselage.
 */
/** Material slots of a model's triangles, coloured by the renderer. */
export declare enum VehiclePart {
    Body = 0,
    Wing = 1,
    Engine = 2,
    Tail = 3,
    Dark = 4
}
export interface VehicleModel {
    /** Triangle soup: three vertices per triangle. */
    positions: Float32Array;
    /** Flat normals, per vertex. */
    normals: Float32Array;
    /** An `VehiclePart` per vertex. */
    parts: Uint8Array;
    /** Overall length in metres. */
    length: number;
}
/**
 * A model for an ICAO aircraft type designator, or failing that an ADS-B
 * emitter category, or failing both a guess from ground speed.
 */
export declare function aircraftModel(type?: string, category?: string, speed?: number): VehicleModel;
/** A ship one unit long: hull, deck and a superstructure aft. */
export declare function shipModel(): VehicleModel;
