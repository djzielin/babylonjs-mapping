import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Scene } from "@babylonjs/core/scene";
import {
    GLOBE_CONTROLS_HELP,
    GlobeAtmosphere,
    GlobeControls,
    GlobeSet,
    GlobeSurface,
    GlobeTraffic,
    GlobeVehicles,
    adsbAircraftFeed,
    digitrafficShipFeed,
    Google3DTiles,
    MapLayerRenderer,
    RasterGoogleSatellite,
    esriImagery,
    esriTopoBathyElevation,
    googleImagery,
    mapboxImagery,
    type GlobeImagery,
} from "babylonjs-mapping";
import { setupAddressSearch } from "./AddressSearch";
import { aircraftModelUrl, MODEL_AUTHORS, modelKey, shipModelUrl } from "./Models";
import { TOUR, type TourStop } from "./Tour";

declare const DEMO_GOOGLE_KEY: string;
declare const DEMO_MAPBOX_TOKEN: string;
/** Where an ADS-B v2 API is proxied (the dev server proxies adsb.lol at /adsb); empty for none. */
declare const DEMO_AIRCRAFT_URL: string;

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Map layers, finest first: Google's 3D tiles cover the surface, which covers the sky. */
const GOOGLE_LEVEL = 2;
const SURFACE_LEVEL = 1;
/** Google's 3D tiles load within this many metres of the point beneath the camera (20 miles). */
const GOOGLE_RADIUS = 32_187;
/** Above this, satellite imagery looks better than Google's coarsest 3D tiles. */
const GOOGLE_CEILING = 60_000;
const SPACE_VIEW = { latitude: 28, longitude: -50, height: 14_000_000, heading: 0, pitch: -90 };

class GlobeDemo {
    private readonly canvas = $<HTMLCanvasElement>("renderCanvas");
    private readonly engine = new Engine(this.canvas, true, {
        useLargeWorldRendering: true, useHighPrecisionMatrix: true, stencil: true,
        adaptToDeviceRatio: true, powerPreference: "high-performance",
    });
    private readonly scene = new Scene(this.engine);
    private readonly globe = new GlobeSet(this.scene, this.engine, { radius: 60, backingSurface: false, attribution: false });
    private readonly layers = new MapLayerRenderer(this.scene, GOOGLE_LEVEL);
    private readonly camera = new TargetCamera("camera", this.globe.getSurfacePosition(0, 0, 1), this.scene);
    private readonly controls: GlobeControls;
    private readonly atmosphere = new GlobeAtmosphere(this.globe);
    private surface!: GlobeSurface;
    private google?: Google3DTiles;
    private traffic?: GlobeTraffic;
    private aircraft?: GlobeVehicles;
    private ships?: GlobeVehicles;
    private imagery!: GlobeImagery[];
    private show3D = true;
    private tourRun = 0;

    public constructor() {
        this.scene.clearColor = new Color4(0, 0, 0, 1);
        this.scene.skipPointerMovePicking = true;
        this.camera.fov = 0.8;
        this.controls = new GlobeControls(this.globe, this.camera, this.canvas, { heightAt: (lat, lon) => this.groundHeight(lat, lon) });
        this.controls.setView(SPACE_VIEW);
        this.controls.onUserInputObservable.add(() => this.stopTour());
        this.engine.runRenderLoop(() => this.scene.render());
        addEventListener("resize", () => this.engine.resize());
    }

    public async start(): Promise<void> {
        this.imagery = await this.chooseImagery();
        this.setSurface();
        if (DEMO_GOOGLE_KEY) await this.startGoogle();
        else $("photoButton").hidden = true;
        // Live congestion on the roads near the camera, over the ground and buildings.
        if (DEMO_MAPBOX_TOKEN) this.traffic = new GlobeTraffic(this.globe, {
            accessToken: DEMO_MAPBOX_TOKEN,
            heightAt: (latitude, longitude) => this.surface.getHeight(latitude, longitude),
            deckHeightAt: (latitude, longitude) => this.deckHeight(latitude, longitude),
            earthFrame: this.google,
        });
        // Aircraft on the ground stand on the 3D tiles: airport aprons, not the terrain beneath.
        const heightAt = (latitude: number, longitude: number) => this.deckHeight(latitude, longitude) ?? this.surface.getHeight(latitude, longitude);
        const { meanSeaLevel } = await import("egm96-universal");
        if (DEMO_AIRCRAFT_URL) this.aircraft = new GlobeVehicles(this.globe, { kind: "aircraft", feed: adsbAircraftFeed(DEMO_AIRCRAFT_URL, { geoid: meanSeaLevel }), heightAt, earthFrame: this.google, modelFor: aircraftModelUrl });
        this.ships = new GlobeVehicles(this.globe, { kind: "ship", feed: digitrafficShipFeed("babylonjs-mapping globe demo"), earthFrame: this.google, modelFor: shipModelUrl });
        this.setupUI();
        this.scene.onBeforeRenderObservable.add(() => this.frame());
        await this.surface.whenIdle();
        $("loading").style.opacity = "0";
        // ?view=latitude,longitude,height,heading,pitch opens a view; ?stop=N
        // starts the tour at its Nth stop; ?tour=0 skips the tour.
        const view = params.get("view")?.split(",").map(Number);
        if (view?.length === 5 && view.every(Number.isFinite)) {
            const [latitude, longitude, height, heading, pitch] = view;
            this.controls.setView({ latitude, longitude, height, heading, pitch });
        } else if (params.get("tour") !== "0") setTimeout(() => void this.tour(Math.max(0, Number(params.get("stop") ?? 1) - 1)), 1200);
    }

    /**
     * Google's satellite imagery matches its 3D tiles. Mapbox, then Esri
     * (no key), take over if a source is missing or out of quota.
     */
    private async chooseImagery(): Promise<GlobeImagery[]> {
        const sources: GlobeImagery[] = [];
        if (DEMO_GOOGLE_KEY) {
            try {
                const session = await RasterGoogleSatellite.openSession(DEMO_GOOGLE_KEY);
                sources.push(googleImagery(DEMO_GOOGLE_KEY, session.session));
            } catch { /* fall through to the other sources */ }
        }
        if (DEMO_MAPBOX_TOKEN) sources.push(mapboxImagery(DEMO_MAPBOX_TOKEN));
        sources.push(esriImagery());
        return sources;
    }

    private setSurface(): void {
        // Survey bathymetry and lidar where they exist, GEBCO elsewhere.
        this.surface = new GlobeSurface(this.globe, { imagery: this.imagery, elevation: esriTopoBathyElevation() });
        this.surface.addToLayers(this.layers, SURFACE_LEVEL);
        this.surface.onImageryChangedObservable.add(() => this.updateAttribution());
    }

    private async startGoogle(): Promise<void> {
        // Google heights are above the WGS84 ellipsoid; the globe's are above sea level.
        const { meanSeaLevel } = await import("egm96-universal");
        this.google = new Google3DTiles(this.globe, {
            apiKey: DEMO_GOOGLE_KEY,
            maximumRadius: GOOGLE_RADIUS,
            // Full detail around the view, easing off into the haze: a stop
            // loads in a few seconds instead of sharpening throughout.
            detailRadius: 4000,
            distantErrorScale: 2,
            geoid: meanSeaLevel,
        });
        this.google.addToLayers(this.layers, GOOGLE_LEVEL);
        this.google.onAttributionsChangedObservable.add(() => this.updateAttribution());
    }

    /** Height of the first 3D-tile surface from above, for laying roads on bridges. */
    private deckHeight(latitude: number, longitude: number): number | undefined {
        if (!this.google?.enabled) return undefined;
        return this.google.surfaceHeight(latitude, longitude, (this.surface.getHeight(latitude, longitude) ?? 0) + 300);
    }

    /** Ground height for the camera's clearance: rooftops where 3D tiles are drawn. */
    private groundHeight(latitude: number, longitude: number): number | undefined {
        const terrain = this.surface?.getHeight(latitude, longitude) ?? 0;
        if (!this.google?.enabled || this.controls.heightAboveGround > 3000) return terrain;
        // Google's water lies at sea level; the camera may dive through it.
        const roof = this.google.surfaceHeight(latitude, longitude) ?? -Infinity;
        // No building stands 900 m above its terrain: a higher hit is a coarse
        // tile still loading, and lifting the camera over it would be permanent.
        return roof > 1 && roof < terrain + 900 ? Math.max(terrain, roof) : terrain;
    }

    private frame(): void {
        const view = this.controls.getView();
        // Load the end of a flight on the way there.
        const ahead = this.controls.flightDestination;
        this.surface.prefetchCamera = ahead;
        if (this.google) {
            this.google.enabled = this.show3D && this.wants3D(view.height);
            const end = ahead ? this.globe.getSurfaceCoordinates(ahead!.position).elevation / this.globe.metresToWorld : NaN;
            this.google.prefetchCamera = this.show3D && this.wants3D(end) ? ahead : undefined;
            // Beneath Google's tiles the surface only needs to be a fallback.
            this.surface.coverage = this.show3D ? { radius: GOOGLE_RADIUS * 0.9, maxZoom: 15 } : undefined;
        }
        this.updateStats();
        if (this.frameCount++ % 30 === 0) {
            if (this.modelAuthors().join() !== this.modelCredit) this.updateAttribution();
        }
    }

    /** Google's 3D tiles show at heights between sea level and their ceiling. */
    private wants3D(height: number): boolean {
        return height > 0 && height < GOOGLE_CEILING;
    }

    // ------------------------------------------------------------------ tour

    private async tour(first = 0): Promise<void> {
        const run = ++this.tourRun;
        this.setPressed("tourButton", true);
        const alive = () => run === this.tourRun;
        for (let i = first % TOUR.length; alive(); i = (i + 1) % TOUR.length) {
            const stop = TOUR[i];
            this.caption();
            if (!await this.controls.flyTo(stop) || !alive()) break;
            this.caption(stop.title, stop.text);
            if (!await this.linger(stop, 14_000, alive)) break;
            if (i === TOUR.length - 1 && alive()) {
                this.caption();
                if (!await this.controls.flyTo(SPACE_VIEW, 7000) || !await this.linger(undefined, 3000, alive)) break;
            }
        }
        if (alive()) this.stopTour();
    }

    /** Orbit slowly around a stop. Resolves false if interrupted. */
    private linger(stop: TourStop | undefined, ms: number, alive: () => boolean): Promise<boolean> {
        return new Promise(resolve => {
            const start = performance.now();
            const observer = this.scene.onBeforeRenderObservable.add(() => {
                if (!alive()) { this.scene.onBeforeRenderObservable.remove(observer); resolve(false); return; }
                const t = performance.now() - start;
                if (stop) this.controls.setView({ ...stop, heading: stop.heading + (stop.orbit ?? 2) * t / 1000 });
                if (t >= ms) { this.scene.onBeforeRenderObservable.remove(observer); resolve(true); }
            });
        });
    }

    private stopTour(): void {
        if (!this.tourRun) return;
        this.tourRun++;
        this.setPressed("tourButton", false);
        this.caption();
    }

    private caption(title = "", text = ""): void {
        const caption = $("caption");
        if (!title) { caption.classList.remove("shown"); return; }
        $("captionTitle").textContent = title;
        $("captionText").textContent = text;
        caption.classList.add("shown");
    }

    // -------------------------------------------------------------------- UI

    private setupUI(): void {
        $("tourButton").addEventListener("click", () => {
            if ($("tourButton").getAttribute("aria-pressed") === "true") { this.tourRun++; this.stopTour(); }
            else void this.tour();
        });
        $("photoButton").addEventListener("click", () => {
            this.show3D = !this.show3D;
            // Ships come and go with the 3D view.
            if (this.ships) this.ships.enabled = this.show3D;
            this.setPressed("photoButton", this.show3D);
        });
        const toggles: [string, { enabled: boolean } | undefined][] = [["roadsButton", this.traffic], ["airButton", this.aircraft]];
        for (const [id, layer] of toggles) {
            $(id).hidden = !layer;
            $(id).addEventListener("click", () => {
                if (!layer) return;
                layer.enabled = !layer.enabled;
                this.setPressed(id, layer.enabled);
            });
        }
        const help = $("help");
        help.textContent = GLOBE_CONTROLS_HELP;
        $("helpButton").addEventListener("click", () => {
            help.hidden = !help.hidden;
            this.setPressed("helpButton", !help.hidden);
        });
        setupAddressSearch(result => {
            this.stopTour();
            const range = Math.max(800, 40_000_000 / 2 ** result.zoom);
            void this.controls.flyTo({
                latitude: result.latitude, longitude: result.longitude,
                height: this.surface.getHeight(result.latitude, result.longitude) ?? 0,
                heading: 0, pitch: result.zoom <= 7 ? -80 : -35, range,
            });
            this.canvas.focus();
        }, () => DEMO_MAPBOX_TOKEN);
        addEventListener("keydown", event => {
            if (event.key === "`" && !(event.target instanceof HTMLInputElement)) $("stats").hidden = !$("stats").hidden;
        });
        if (params.has("stats")) $("stats").hidden = false;
        this.updateAttribution();
    }

    private setPressed(id: string, pressed: boolean): void {
        $(id).setAttribute("aria-pressed", String(pressed));
    }

    private updateAttribution(): void {
        const sources = new Set<string>();
        if (this.google?.enabled) for (const source of this.google.getAttributions()) sources.add(source);
        if (this.surface.attribution) sources.add(this.surface.attribution);
        const bar = $("attribution");
        bar.textContent = [...sources].join(" · ");
        // CC BY: the authors of the vehicle models in view.
        const authors = this.modelAuthors();
        if (authors.length) {
            const credit = document.createElement("a");
            credit.href = "models/CREDITS.md";
            credit.target = "_blank";
            credit.textContent = `Models: ${authors.join(", ")} (CC BY 4.0)`;
            bar.append(bar.textContent ? " · " : "", credit);
        }
        bar.title = bar.textContent ?? "";
        this.modelCredit = authors.join();
    }

    private modelCredit = "";

    /** Authors of the vehicle models drawn now. */
    private modelAuthors(): string[] {
        const urls = [...this.aircraft?.drawnModels ?? [], ...this.ships?.drawnModels ?? []];
        return [...new Set(urls.map(url => MODEL_AUTHORS[modelKey(url)]).filter(Boolean))].sort();
    }
    private frameCount = 0;

    // ----------------------------------------------------------------- stats

    private frames: number[] = [];

    private updateStats(): void {
        const now = performance.now();
        this.frames.push(now);
        while (this.frames.length && this.frames[0] < now - 1000) this.frames.shift();
        const surface = this.surface.stats, google = this.google?.stats;
        // For measurement scripts.
        Object.assign(window, { __demoStats: () => ({ surface, google, traffic: this.traffic?.stats, aircraft: this.aircraft?.count, ships: this.ships?.count, fps: this.frames.length }), __demoControls: this.controls, __demoLayers: { aircraft: this.aircraft, ships: this.ships } });
        const stats = $("stats");
        if (stats.hidden || this.frames.length % 10) return;
        const view = this.controls.getView();
        const mb = (bytes: number) => `${Math.round(bytes / 1048576)} MB`;
        stats.textContent = [
            `${this.frames.length} fps  ${this.engine.getRenderWidth()}×${this.engine.getRenderHeight()}`,
            `${view.latitude.toFixed(4)}, ${view.longitude.toFixed(4)}  ${Math.round(view.height)} m`,
            `surface ${surface.rendered} drawn  ${surface.resident} cached  ${mb(surface.residentBytes)}  ${surface.pending} pending`,
            google ? `3D      ${google.rendered} drawn  ${google.resident} cached  ${mb(google.residentBytes)}  ${google.pending} pending` : "",
        ].filter(Boolean).join("\n");
    }
}

const demo = new GlobeDemo();
Object.assign(window, { demo, BABYLON_SCENE: (demo as unknown as { scene: Scene }).scene });
void demo.start();
