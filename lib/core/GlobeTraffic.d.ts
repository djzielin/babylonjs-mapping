import { TileBatch } from "../shared/TileBatch.js";
import { type GlobeEarthFrame } from "./GlobeEarthFrame.js";
import type GlobeSet from "./GlobeSet.js";
export interface GlobeTrafficOptions {
    /** Mapbox access token for the mapbox-traffic-v1 tileset. */
    accessToken: string;
    /** Ground height in metres above sea level, for laying roads on terrain. */
    heightAt?: (latitude: number, longitude: number) => number | undefined;
    /**
     * Height in metres of the first surface from above, such as a bridge's
     * deck in 3D tiles, for laying bridges; without it they lie on the ground.
     */
    deckHeightAt?: (latitude: number, longitude: number) => number | undefined;
    /**
     * Place roads in this frame, such as photorealistic 3D tiles', to line up
     * with its content exactly; otherwise on the globe's sphere.
     */
    earthFrame?: GlobeEarthFrame;
    /** Tile zoom level. Default 14 (about 2.4 km tiles at the equator). */
    zoom?: number;
    /** Ground distance in metres around the camera that shows traffic. Default 7 km. */
    radius?: number;
    /** Camera height in metres above which traffic is hidden. Default 30 km. */
    maximumHeight?: number;
    /** Seconds between refreshes of each tile; Mapbox updates congestion every few minutes. Default 120. */
    refreshSeconds?: number;
    /**
     * Draw each road as wide as its lanes in metres rather than at a constant
     * width on screen: for headsets, where roads are seen at their true size. Default false.
     */
    worldWidths?: boolean;
    /** Milliseconds per frame spent turning loaded tiles into roads. Default 3; less for headsets, whose frames are short. */
    buildBudgetMs?: number;
}
export interface GlobeTrafficStats {
    /** Tiles around the camera. */
    tiles: number;
    /** Tiles with roads drawn. */
    drawn: number;
    /** Requests in flight. */
    loading: number;
}
/**
 * Live road traffic on a globe from Mapbox Traffic v1: each road drawn as a
 * line of constant on-screen width, coloured by congestion, with pulses
 * flowing along it in the direction and at roughly the speed of travel.
 * Tiles near the camera load and refresh in the background.
 */
export default class GlobeTraffic {
    readonly globe: GlobeSet;
    readonly batch: TileBatch;
    enabled: boolean;
    private readonly scene;
    private readonly accessToken;
    private readonly heightAt?;
    private readonly zoom;
    private readonly radius;
    private readonly maximumHeight;
    private readonly refreshMs;
    private readonly worldWidths;
    private readonly buildBudgetMs;
    private readonly tiles;
    private readonly observer;
    private wanted;
    private plannedAt;
    private inFlight;
    private building?;
    private readonly deckHeightAt?;
    private readonly earthFrame?;
    constructor(globe: GlobeSet, options: GlobeTrafficOptions);
    dispose(): void;
    private update;
    /** Build road geometry until `deadline`, one tile at a time, so frames stay even. */
    private buildFor;
    /** Choose the tiles around the camera, nearest first, and start loads. */
    private plan;
    private load;
    private groundReady;
    /**
     * Turn a loaded tile into road ribbons, a slice at a time: the generator
     * yields between roads and update() stops it when the frame's budget is spent.
     */
    private build;
    get stats(): GlobeTrafficStats;
    private release;
    private clear;
}
