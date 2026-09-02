import "@babylonjs/core/Culling/ray.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
const DEGREES_TO_RADIANS = Math.PI / 180;
const MAX_MERCATOR_LATITUDE = 85.05112878;
/**
 * Connects an ArcRotateCamera to a GlobeSet.
 *
 * The camera continues to use Babylon's native mouse, touch, and wheel input.
 * GlobeNavigator adds coordinate-aware fly-to navigation and keeps a raster
 * tile window centered on the visible part of the globe at an appropriate
 * slippy-map zoom level.
 */
export default class GlobeNavigator {
    constructor(globe, camera, options = {}) {
        this.globe = globe;
        this.camera = camera;
        this.onViewChangedObservable = new Observable();
        this.lastRasterUpdate = Number.NEGATIVE_INFINITY;
        this.minZoom = options.minZoom ?? 3;
        this.maxZoom = options.maxZoom ?? 18;
        this.tilesAcrossViewport = options.tilesAcrossViewport ?? 4;
        this.tileUpdateDelayMs = options.tileUpdateDelayMs ?? 150;
        this.autoUpdateRaster = options.autoUpdateRaster ?? true;
        if (!Number.isInteger(this.minZoom) || this.minZoom < 0) {
            throw new RangeError("minZoom must be a non-negative integer.");
        }
        if (!Number.isInteger(this.maxZoom) || this.maxZoom < this.minZoom) {
            throw new RangeError("maxZoom must be an integer greater than or equal to minZoom.");
        }
        if (!Number.isFinite(this.tilesAcrossViewport) || this.tilesAcrossViewport <= 0) {
            throw new RangeError("tilesAcrossViewport must be greater than zero.");
        }
        if (!Number.isFinite(this.tileUpdateDelayMs) || this.tileUpdateDelayMs < 0) {
            throw new RangeError("tileUpdateDelayMs must be zero or greater.");
        }
        const minimumAltitude = this.getAltitudeForZoom(this.maxZoom);
        const maximumAltitude = this.getAltitudeForZoom(this.minZoom);
        this.camera.lowerRadiusLimit = this.globe.radius + minimumAltitude;
        this.camera.upperRadiusLimit = this.globe.radius + maximumAltitude;
        this.camera.minZ = Math.min(this.camera.minZ, Math.max(minimumAltitude * 0.25, 0.0001));
        this.renderObserver = this.globe.scene.onBeforeRenderObservable.add(() => {
            this.updateFlight();
            this.refresh();
        });
    }
    /** Return the geographic point at the center of the camera view. */
    getView() {
        const latitude = 90 - this.camera.beta / DEGREES_TO_RADIANS;
        const longitude = this.wrapLongitude(90 - this.camera.alpha / DEGREES_TO_RADIANS);
        const altitude = Math.max(0, this.camera.radius - this.globe.radius);
        return {
            latitude,
            longitude,
            altitude,
            zoom: this.getZoomForAltitude(altitude),
        };
    }
    /**
     * Intersect a screen coordinate with the globe independently of tile
     * loading state. This is suitable for click-to-fly interactions.
     */
    getCoordinatesAtScreenPoint(x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new RangeError("screen coordinates must be finite numbers.");
        }
        const ray = this.globe.scene.createPickingRay(x, y, Matrix.Identity(), this.camera, false);
        const direction = ray.direction.normalizeToNew();
        const originProjection = Vector3.Dot(ray.origin, direction);
        const distanceFromSurface = ray.origin.lengthSquared() - this.globe.radius ** 2;
        const discriminant = originProjection ** 2 - distanceFromSurface;
        if (discriminant < 0) {
            return undefined;
        }
        const root = Math.sqrt(discriminant);
        let distance = -originProjection - root;
        if (distance < 0) {
            distance = -originProjection + root;
        }
        if (distance < 0) {
            return undefined;
        }
        return this.globe.getSurfaceCoordinates(ray.origin.add(direction.scale(distance)));
    }
    /** Move immediately to a geographic view. */
    setView(latitude, longitude, options = {}) {
        const target = this.resolveTarget(latitude, longitude, options);
        this.flight = undefined;
        this.clearCameraInertia();
        this.camera.alpha = target.alpha;
        this.camera.beta = target.beta;
        this.camera.radius = target.radius;
        this.refresh(true);
    }
    /** Animate to a geographic location using the shortest longitudinal path. */
    flyTo(latitude, longitude, options = {}) {
        const durationMs = options.durationMs ?? 1200;
        if (!Number.isFinite(durationMs) || durationMs < 0) {
            throw new RangeError("durationMs must be zero or greater.");
        }
        if (durationMs === 0) {
            this.setView(latitude, longitude, options);
            return;
        }
        const target = this.resolveTarget(latitude, longitude, options);
        const targetAlpha = this.camera.alpha + this.shortestAngle(target.alpha - this.camera.alpha);
        this.clearCameraInertia();
        this.flight = {
            startAlpha: this.camera.alpha,
            startBeta: this.camera.beta,
            startRadius: this.camera.radius,
            targetAlpha,
            targetBeta: target.beta,
            targetRadius: target.radius,
            startedAt: Date.now(),
            durationMs,
        };
    }
    /** Force the view readout and raster window to synchronize immediately. */
    refresh(forceRasterUpdate = false) {
        const view = this.getView();
        const viewSignature = [
            view.latitude.toFixed(5),
            view.longitude.toFixed(5),
            view.altitude.toFixed(5),
            view.zoom,
        ].join("/");
        if (viewSignature !== this.lastViewSignature) {
            this.lastViewSignature = viewSignature;
            this.onViewChangedObservable.notifyObservers(view);
        }
        if (!this.autoUpdateRaster || !this.globe.isGeometryCreated) {
            return view;
        }
        const rasterLatitude = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, view.latitude));
        const tileX = this.globe.ourTileMath.lon_to_tile(view.longitude, view.zoom);
        const tileY = this.globe.ourTileMath.lat_to_tile(rasterLatitude, view.zoom);
        const rasterKey = `${view.zoom}/${tileX}/${tileY}`;
        const now = Date.now();
        if ((forceRasterUpdate || rasterKey !== this.lastRasterKey)
            && (forceRasterUpdate || now - this.lastRasterUpdate >= this.tileUpdateDelayMs)) {
            this.globe.updateRaster(rasterLatitude, view.longitude, view.zoom);
            this.lastRasterKey = rasterKey;
            this.lastRasterUpdate = now;
        }
        return view;
    }
    /** Convert a requested raster zoom into a camera altitude. */
    getAltitudeForZoom(zoom) {
        const clampedZoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
        const aspect = this.getAspectRatio();
        const angularWidth = this.tilesAcrossViewport * 2 * Math.PI / (2 ** clampedZoom);
        const viewportScale = 2 * Math.tan(this.camera.fov * 0.5) * aspect;
        return this.globe.radius * angularWidth / viewportScale;
    }
    /** Convert camera altitude into the nearest raster zoom. */
    getZoomForAltitude(altitude) {
        if (!Number.isFinite(altitude) || altitude < 0) {
            throw new RangeError("altitude must be a finite value zero or greater.");
        }
        const aspect = this.getAspectRatio();
        const viewportScale = 2 * Math.tan(this.camera.fov * 0.5) * aspect;
        const safeAltitude = Math.max(altitude, Number.EPSILON);
        const zoom = Math.round(Math.log2(this.globe.radius * this.tilesAcrossViewport * 2 * Math.PI
            / (viewportScale * safeAltitude)));
        return Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    }
    dispose() {
        this.globe.scene.onBeforeRenderObservable.remove(this.renderObserver);
        this.onViewChangedObservable.clear();
        this.flight = undefined;
    }
    resolveTarget(latitude, longitude, options) {
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
            throw new RangeError("latitude must be between -90 and 90 degrees.");
        }
        if (!Number.isFinite(longitude)) {
            throw new RangeError("longitude must be a finite number.");
        }
        if (options.zoom !== undefined && (!Number.isFinite(options.zoom) || options.zoom < 0)) {
            throw new RangeError("zoom must be a finite value zero or greater.");
        }
        if (options.altitude !== undefined && (!Number.isFinite(options.altitude) || options.altitude < 0)) {
            throw new RangeError("altitude must be a finite value zero or greater.");
        }
        const clampedLatitude = Math.max(-89.9, Math.min(89.9, latitude));
        const altitude = options.altitude
            ?? (options.zoom === undefined
                ? Math.max(0, this.camera.radius - this.globe.radius)
                : this.getAltitudeForZoom(options.zoom));
        const minimumRadius = this.camera.lowerRadiusLimit ?? this.globe.radius;
        const maximumRadius = this.camera.upperRadiusLimit ?? Number.POSITIVE_INFINITY;
        return {
            alpha: Math.PI / 2 - this.wrapLongitude(longitude) * DEGREES_TO_RADIANS,
            beta: Math.PI / 2 - clampedLatitude * DEGREES_TO_RADIANS,
            radius: Math.max(minimumRadius, Math.min(maximumRadius, this.globe.radius + altitude)),
        };
    }
    updateFlight() {
        if (this.flight === undefined) {
            return;
        }
        const elapsed = Date.now() - this.flight.startedAt;
        const progress = Math.min(1, elapsed / this.flight.durationMs);
        const eased = progress * progress * (3 - 2 * progress);
        this.camera.alpha = this.lerp(this.flight.startAlpha, this.flight.targetAlpha, eased);
        this.camera.beta = this.lerp(this.flight.startBeta, this.flight.targetBeta, eased);
        this.camera.radius = this.lerp(this.flight.startRadius, this.flight.targetRadius, eased);
        if (progress === 1) {
            this.flight = undefined;
        }
    }
    clearCameraInertia() {
        this.camera.inertialAlphaOffset = 0;
        this.camera.inertialBetaOffset = 0;
        this.camera.inertialRadiusOffset = 0;
        this.camera.inertialPanningX = 0;
        this.camera.inertialPanningY = 0;
    }
    getAspectRatio() {
        const engine = this.camera.getEngine();
        return Math.max(engine.getRenderWidth(), 1) / Math.max(engine.getRenderHeight(), 1);
    }
    wrapLongitude(longitude) {
        return ((longitude + 180) % 360 + 360) % 360 - 180;
    }
    shortestAngle(angle) {
        return ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    }
    lerp(start, end, amount) {
        return start + (end - start) * amount;
    }
}
//# sourceMappingURL=GlobeNavigator.js.map