import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import "@babylonjs/core/Culling/ray.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import GlobeSet, { type GlobeCoordinates } from "./GlobeSet.js";
export interface GlobeNavigatorOptions {
    /** Lowest raster zoom requested while the camera is far from the globe. */
    minZoom?: number;
    /** Highest raster zoom requested near the surface. */
    maxZoom?: number;
    /** Approximate number of 256px raster tiles kept across the viewport. */
    tilesAcrossViewport?: number;
    /** Minimum time between raster-grid changes while the camera is moving. */
    tileUpdateDelayMs?: number;
    /** Set false to use navigation without automatic raster updates. */
    autoUpdateRaster?: boolean;
}
export interface GlobeView {
    latitude: number;
    longitude: number;
    altitude: number;
    zoom: number;
}
export interface GlobeFlyToOptions {
    /** Target raster zoom. Ignored when altitude is supplied. */
    zoom?: number;
    /** Camera height above the globe in Babylon world units. */
    altitude?: number;
    /** Flight duration. A value of zero moves immediately. */
    durationMs?: number;
}
/**
 * Connects an ArcRotateCamera to a GlobeSet.
 *
 * The camera continues to use Babylon's native mouse, touch, and wheel input.
 * GlobeNavigator adds coordinate-aware fly-to navigation and keeps a raster
 * tile window centered on the visible part of the globe at an appropriate
 * slippy-map zoom level.
 */
export default class GlobeNavigator {
    readonly globe: GlobeSet;
    readonly camera: ArcRotateCamera;
    readonly onViewChangedObservable: Observable<GlobeView>;
    private readonly minZoom;
    private readonly maxZoom;
    private readonly tilesAcrossViewport;
    private readonly tileUpdateDelayMs;
    private readonly autoUpdateRaster;
    private readonly renderObserver;
    private flight?;
    private lastRasterKey?;
    private lastRasterUpdate;
    private lastViewSignature?;
    constructor(globe: GlobeSet, camera: ArcRotateCamera, options?: GlobeNavigatorOptions);
    /** Return the geographic point at the center of the camera view. */
    getView(): GlobeView;
    /**
     * Intersect a screen coordinate with the globe independently of tile
     * loading state. This is suitable for click-to-fly interactions.
     */
    getCoordinatesAtScreenPoint(x: number, y: number): GlobeCoordinates | undefined;
    /** Move immediately to a geographic view. */
    setView(latitude: number, longitude: number, options?: Omit<GlobeFlyToOptions, "durationMs">): void;
    /** Animate to a geographic location using the shortest longitudinal path. */
    flyTo(latitude: number, longitude: number, options?: GlobeFlyToOptions): void;
    /** Force the view readout and raster window to synchronize immediately. */
    refresh(forceRasterUpdate?: boolean): GlobeView;
    /** Convert a requested raster zoom into a camera altitude. */
    getAltitudeForZoom(zoom: number): number;
    /** Convert camera altitude into the nearest raster zoom. */
    getZoomForAltitude(altitude: number): number;
    dispose(): void;
    private resolveTarget;
    private updateFlight;
    private clearCameraInertia;
    private getAspectRatio;
    private wrapLongitude;
    private shortestAngle;
    private lerp;
}
