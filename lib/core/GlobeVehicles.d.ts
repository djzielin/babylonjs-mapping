import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { GlobeEarthFrame } from "./GlobeEarthFrame.js";
import type GlobeSet from "./GlobeSet.js";
/** One position report of a moving vehicle. */
export interface VehicleReport {
    id: string;
    latitude: number;
    longitude: number;
    /** Metres above sea level; undefined for vehicles on the surface (ships, taxiing aircraft). */
    altitude?: number;
    /** Degrees clockwise from north, of the direction of travel or of the bow. */
    heading?: number;
    /** Metres per second over the ground. */
    speed?: number;
    /** Metres per second, climbing positive. */
    verticalSpeed?: number;
    /** ICAO aircraft type designator, such as "B738", for the aircraft's model. */
    type?: string;
    /** ADS-B emitter category, such as "A3", for a model when the type is unknown; for ships, the AIS ship type, such as "70". */
    category?: string;
    /** Overall length in metres, for ships. */
    length?: number;
    /** When the position was measured (`Date.now()` milliseconds). */
    time: number;
}
/** The area to report vehicles in: a circle around the view. */
export interface VehicleArea {
    latitude: number;
    longitude: number;
    /** Metres. */
    radius: number;
}
/** A source of live vehicle positions. Called again for each refresh. */
export type VehicleFeed = (area: VehicleArea, signal: AbortSignal) => Promise<VehicleReport[]>;
export type VehicleKind = "aircraft" | "ship";
export interface GlobeVehiclesOptions {
    feed: VehicleFeed;
    kind: VehicleKind;
    /** Seconds between refreshes. Default 5 for aircraft, 15 for ships. */
    refreshSeconds?: number;
    /**
     * Ships: smallest on-screen length in CSS pixels, so ships stay visible
     * from afar (default 18). Aircraft are drawn at true scale, and as a
     * marker this many pixels across only once their model is smaller (default 5).
     */
    sizePixels?: number;
    /** Seconds of track drawn behind each vehicle. Default 90 for aircraft, 300 for ships. */
    trailSeconds?: number;
    /** Camera height in metres above which the layer is hidden. Default 400 km for aircraft, 150 km for ships. */
    maximumHeight?: number;
    /** Surface height in metres above sea level, for aircraft reported on the ground. */
    heightAt?: (latitude: number, longitude: number) => number | undefined;
    /**
     * Place vehicles in this frame, such as photorealistic 3D tiles', to line
     * up with its content exactly; otherwise on the globe's sphere.
     */
    earthFrame?: GlobeEarthFrame;
    /**
     * The URL of a glTF model of the vehicle, drawn in place of the built-in
     * shape once it is `detailPixels` long on screen, for the nearest
     * `detailedModels` vehicles. Models face +Z with +Y up, as glTF does, and
     * are scaled to the vehicle's length (aircraft by type, ships as reported)
     * and set on their lowest point. Each URL is loaded once, when first needed.
     */
    modelFor?: (report: VehicleReport) => string | undefined;
    /** Most vehicles drawn with their glTF model at once. Default 24. */
    detailedModels?: number;
    /** On-screen length in CSS pixels from which a vehicle is drawn with its glTF model. Default 24. */
    detailPixels?: number;
}
/**
 * Live aircraft or ships on a globe. Positions from a `VehicleFeed` are dead
 * reckoned between reports, so vehicles move smoothly at their reported
 * speed, heading and climb, and glide rather than jump to each correction.
 *
 * Aircraft are low-poly models of their type at true scale, pitched to their
 * climb, with a faint line to the ground; each shrinks to a small marker
 * coloured by altitude when too distant to see. Ships are hulls kept at
 * least `sizePixels` long. Both trail their recent track.
 */
export default class GlobeVehicles {
    readonly globe: GlobeSet;
    enabled: boolean;
    readonly mesh: Mesh;
    private trails?;
    private readonly material;
    private readonly scene;
    private readonly feed;
    private readonly kind;
    private readonly refreshMs;
    private readonly sizePixels;
    private readonly trailMs;
    private readonly maximumHeight;
    private readonly heightAt?;
    private readonly earthFrame?;
    private readonly modelFor?;
    private readonly detailedModels;
    private readonly detailPixels;
    private readonly models;
    private light?;
    private disposed;
    private readonly group;
    private readonly vehicles;
    private readonly observer;
    private positions;
    private normals;
    private colors;
    private loading?;
    private requestedAt;
    private requestedArea?;
    private trailsAt;
    private lastFrame;
    constructor(globe: GlobeSet, options: GlobeVehiclesOptions);
    /** Vehicles currently known. */
    get count(): number;
    /** URLs of the glTF models drawn this frame, such as to credit their authors. */
    get drawnModels(): string[];
    dispose(): void;
    private update;
    /**
     * Models are laid out around the eye each frame: a few hundred vertices
     * per visible vehicle, precise however far from the globe's centre.
     */
    private build;
    /** Overall length in metres: aircraft by type, ships as reported. */
    private lengthOf;
    /**
     * The nearest vehicles long enough on screen to draw with their glTF
     * models, and those models, loading any not yet requested.
     */
    private pickDetailed;
    /** Adds `vehicle` to its model's instances, `ox, oy, oz` from the eye. */
    private instance;
    /**
     * Loads a glTF model: its meshes baked into one per texture, with
     * material colours in vertex colours, centred, one unit long and standing
     * on their lowest point, lit simply.
     */
    private load;
    /**
     * A glTF material's textures as a lit StandardMaterial, as the scene has
     * no environment for PBR; its colours are in the mesh's vertex colours.
     */
    private simpleMaterial;
    /** Request vehicles around the view when it is time, or the view moved away. */
    private refresh;
    private receive;
    /** The dead-reckoned position of `vehicle` at `date`, without its correction. */
    private place;
    /** Aircraft from warm low to cool high; ships a single bright tone. */
    private color;
    /** Metres per CSS pixel at a distance of one metre. */
    private metresPerPixel;
    /** Tracks fading behind each vehicle, and aircraft's lines to the ground. */
    private drawTrails;
}
/**
 * Aircraft from an ADS-B Exchange v2 style API (adsb.lol, airplanes.live and
 * others serve `/v2/point/{lat}/{lon}/{radius nm}`). These APIs do not allow
 * browser requests from other origins, so `baseUrl` is usually a proxy of yours.
 * Geometric altitudes are above the WGS84 ellipsoid: pass `geoid` (the geoid's
 * height above it, such as EGM96) for heights above sea level.
 */
export declare function adsbAircraftFeed(baseUrl: string, { geoid }?: {
    geoid?: (latitude: number, longitude: number) => number;
}): VehicleFeed;
/**
 * Ships from Fintraffic's Digitraffic marine AIS API: open, keyless and
 * browser-friendly, covering the Baltic Sea around Finland. Reports carry
 * each ship's length and AIS ship type (as `category`) when known.
 */
export declare function digitrafficShipFeed(user?: string): VehicleFeed;
