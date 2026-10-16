import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { RenderingManager } from "@babylonjs/core/Rendering/renderingManager";
import { Scene } from "@babylonjs/core/scene";
import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import { WebXRState } from "@babylonjs/core/XR/webXRTypes";
import "@babylonjs/core/XR/motionController/webXROculusTouchMotionController";
// The generic controller mesh, used when a headset's glTF profile cannot load, is a .babylon file.
import "@babylonjs/core/Loading/Plugins/babylonFileLoader";
// The Touch Plus controllers' own models are glTF.
import "@babylonjs/loaders/glTF/2.0";
import {
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
    type VehicleReport,
} from "babylonjs-mapping";
import { aircraftModelUrl, MODEL_AUTHORS, modelKey, shipModelUrl } from "../../globe-mode/src/Models";
import { TOUR, type TourStop } from "../../globe-mode/src/Tour";
import { EYE_HEIGHT, GlobeXRControls } from "./XRControls";
import { createCaption, createCreditLine, createWristPanel, type TextPanel } from "./XRPanels";
import { XRMenu } from "./XRMenu";
import { type AddressResult } from "../../globe-mode/src/AddressSearch";
import { Diagnostics } from "./XRDiagnostics";
import { INITIAL_LEVEL, QualityGovernor, QUALITY_LEVELS } from "./XRQuality";
import type { RigPose } from "./XRRig";

declare const DEMO_GOOGLE_KEY: string;
declare const DEMO_MAPBOX_TOKEN: string;
declare const DEMO_AIRCRAFT_URL: string;
declare const DEMO_MODELS_URL: string;

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const GOOGLE_LEVEL = 2;
const SURFACE_LEVEL = 1;
/** Google's 3D tiles show below this eye height; satellite imagery looks better above. */
const GOOGLE_CEILING = 60_000;
/** The headset's refresh rate to hold: Quest 3 runs 72, 90 or 120 Hz. */
const TARGET_HZ = Number(params.get("hz")) || 90;
/** Above this scale, rooftops are too small to stand on: the floor follows the terrain alone. */
const ROOFTOP_SCALE = 40;
/** The controls, as the menu explains them. */
const HELP = [
    "Trigger: point at the ground, click to fly there, staying high.",
    "    The ring is where you will be, the arrow the way you will face",
    "Grip: hold and pull to drag the world · both grips: zoom, turn",
    "Left stick: glide · right stick: forward to rise, back to sink,",
    "    left and right to turn",
    "A / B: next / previous place · X: life size and back",
    "Y: this menu · left stick click: the whole globe",
    "Right stick click: live traffic on or off",
];
/** Seconds the tour stays at each place. */
const TOUR_LINGER_MS = 14_000;

class GlobeXRDemo {
    private readonly canvas = $<HTMLCanvasElement>("renderCanvas");
    private readonly engine = new Engine(this.canvas, true, {
        useLargeWorldRendering: true, useHighPrecisionMatrix: true, stencil: true,
        adaptToDeviceRatio: true, powerPreference: "high-performance", xrCompatible: true,
    });
    private readonly scene = new Scene(this.engine);
    private readonly diagnostics = new Diagnostics(this.engine, this.scene);
    private readonly globe = new GlobeSet(this.scene, this.engine, { radius: 60, backingSurface: false, attribution: false });
    private readonly layers = new MapLayerRenderer(this.scene, GOOGLE_LEVEL);
    private readonly camera = new TargetCamera("desktop", this.globe.getSurfacePosition(0, 0, 1), this.scene);
    private readonly controls: GlobeControls;
    private readonly atmosphere = new GlobeAtmosphere(this.globe);
    private surface!: GlobeSurface;
    private google?: Google3DTiles;
    private aircraft?: GlobeVehicles;
    private ships?: GlobeVehicles;
    private traffic?: GlobeTraffic;
    private xr?: WebXRDefaultExperience;
    private xrControls?: GlobeXRControls;
    private governor?: QualityGovernor;
    private wrist?: TextPanel;
    private credits?: TextPanel;
    private caption?: TextPanel;
    private captionText = { title: "", text: "" };
    private captionShownAt = -Infinity;
    private place = TOUR[0].title;
    /** The tour stop the user is at or last flew to; the desktop view starts at the first. */
    private stop = 0;
    private menu?: XRMenu;
    /** Counts tours begun; a tour runs while its number is the latest and `touring` holds. */
    private tourRun = 0;
    private touring = false;
    /** The first time in the headset, the menu opens on the controls. */
    private introduced = false;
    private lifeSizeFrom?: number;
    private roof = { at: -Infinity, latitude: NaN, longitude: NaN, height: -Infinity };

    public constructor() {
        this.scene.clearColor = new Color4(0, 0, 0, 1);
        this.scene.skipPointerMovePicking = true;
        this.scene.constantlyUpdateMeshUnderPointer = false;
        this.camera.fov = 0.8;
        this.controls = new GlobeControls(this.globe, this.camera, this.canvas, {
            // In the headset the desktop camera idles: it needs no rooftops, and asking would evict the head's.
            heightAt: (lat, lon) => this.inXR ? this.surface?.getHeight(lat, lon) ?? 0 : this.groundHeight(lat, lon),
        });
        this.controls.setView(TOUR[0]);
        this.engine.runRenderLoop(() => this.scene.render());
        addEventListener("resize", () => this.engine.resize());
    }

    public async start(): Promise<void> {
        const imagery = await this.chooseImagery();
        // Tighter caches than the desktop demo: Quest 3 shares 8 GB with the browser.
        this.surface = new GlobeSurface(this.globe, { imagery, elevation: esriTopoBathyElevation(), memoryBudgetMB: 192, maxConcurrentRequests: 8, uploadBudgetMs: 2 });
        this.surface.addToLayers(this.layers, SURFACE_LEVEL);
        this.surface.onImageryChangedObservable.add(() => this.updateAttribution());
        const { meanSeaLevel } = await import("egm96-universal");
        if (DEMO_GOOGLE_KEY) {
            this.google = new Google3DTiles(this.globe, {
                apiKey: DEMO_GOOGLE_KEY,
                ...googleQuality(INITIAL_LEVEL),
                // Everything around the head at full detail; more than this risks
                // the Quest closing the tab.
                memoryBudgetMB: 500,
                maxConcurrentRequests: 12,
                // Uploads share an 11 ms frame with two eyes' rendering.
                uploadBudgetMs: 2,
                geoid: meanSeaLevel,
            });
            this.google.addToLayers(this.layers, GOOGLE_LEVEL);
            this.google.onAttributionsChangedObservable.add(() => this.updateAttribution());
        }
        const heightAt = (latitude: number, longitude: number) => this.surface.getHeight(latitude, longitude);
        if (DEMO_AIRCRAFT_URL) this.aircraft = new GlobeVehicles(this.globe, {
            kind: "aircraft", feed: adsbAircraftFeed(DEMO_AIRCRAFT_URL, { geoid: meanSeaLevel }), heightAt, earthFrame: this.google,
            modelFor: (report: VehicleReport) => aircraftModelUrl(report)?.replace(/^models\//, DEMO_MODELS_URL),
            // Fewer, larger models: each is drawn twice, once per eye.
            detailedModels: 12, detailPixels: 40,
        });
        this.ships = new GlobeVehicles(this.globe, {
            kind: "ship", feed: digitrafficShipFeed("babylonjs-mapping globe xr demo"), earthFrame: this.google,
            modelFor: (report: VehicleReport) => shipModelUrl(report)?.replace(/^models\//, DEMO_MODELS_URL),
            detailedModels: 12, detailPixels: 40,
        });
        // Live congestion on the roads near the head, over the ground and bridges.
        if (DEMO_MAPBOX_TOKEN) this.traffic = new GlobeTraffic(this.globe, {
            accessToken: DEMO_MAPBOX_TOKEN,
            // As wide as the lanes: in the headset, roads are seen at their true size.
            worldWidths: true,
            heightAt,
            deckHeightAt: (latitude, longitude) => this.google?.enabled
                ? this.google.surfaceHeight(latitude, longitude, (this.surface.getHeight(latitude, longitude) ?? 0) + 300) : undefined,
            earthFrame: this.google,
        });
        this.scene.onBeforeRenderObservable.add(() => this.frame());
        this.updateAttribution();
        await this.setupXR();
        await this.surface.whenIdle();
        $("loading").hidden = true;
    }

    private async chooseImagery(): Promise<GlobeImagery[]> {
        const sources: GlobeImagery[] = [];
        if (DEMO_GOOGLE_KEY) {
            try {
                const session = await RasterGoogleSatellite.openSession(DEMO_GOOGLE_KEY);
                sources.push(googleImagery(DEMO_GOOGLE_KEY, session.session));
            } catch { /* fall through */ }
        }
        if (DEMO_MAPBOX_TOKEN) sources.push(mapboxImagery(DEMO_MAPBOX_TOKEN));
        sources.push(esriImagery());
        return sources;
    }

    /**
     * Ground height for the floor: rooftops where 3D tiles are drawn and the
     * user is near life size, the terrain otherwise. Rooftops are found by
     * casting into the tiles, so at most a few times a second.
     */
    private groundHeight(latitude: number, longitude: number): number {
        const terrain = this.surface?.getHeight(latitude, longitude) ?? 0;
        const scale = this.xrControls && this.inXR ? this.xrControls.rig.scale : Infinity;
        if (!this.google?.enabled || scale > ROOFTOP_SCALE && this.inXR) return terrain;
        const now = performance.now(), roof = this.roof;
        if (now - roof.at > 300 || Math.abs(roof.latitude - latitude) + Math.abs(roof.longitude - longitude) > 2e-4) {
            this.roof = { at: now, latitude, longitude, height: this.google.surfaceHeight(latitude, longitude) ?? -Infinity };
        }
        const height = this.roof.height;
        // A hit far above the terrain is a coarse tile still loading.
        return height > 1 && height < terrain + 900 ? Math.max(terrain, height) : terrain;
    }

    private get inXR(): boolean {
        return this.xr?.baseExperience.state === WebXRState.IN_XR;
    }

    // ---------------------------------------------------------------------- XR

    private async setupXR(): Promise<void> {
        const button = $<HTMLButtonElement>("enterVR"), status = $("xrStatus");
        if (!navigator.xr || !await navigator.xr.isSessionSupported("immersive-vr").catch(() => false)) {
            status.textContent = window.isSecureContext
                ? "Open this page in Meta Quest Browser to enter VR. Here, drag to explore."
                : "VR needs HTTPS. Open the HTTPS address in Meta Quest Browser.";
            return;
        }
        const xr = this.xr = await WebXRDefaultExperience.CreateAsync(this.scene, {
            disableDefaultUI: true,
            // Our own pointing and movement: Babylon's would pick against every tile each frame.
            disableTeleportation: true,
            disablePointerSelection: true,
            disableNearInteraction: true,
            disableHandTracking: true,
            optionalFeatures: false,
            // Babylon's own layer options (alpha included): on Quest 3, an
            // opaque layer leaves the eyes' framebuffer without attachments,
            // so nothing draws. ?alpha=0 and ?resolution=<scale> to test.
            outputCanvasOptions: {
                canvasOptions: {
                    antialias: params.get("aa") !== "0", depth: true, stencil: true,
                    alpha: params.get("alpha") !== "0",
                    framebufferScaleFactor: Number(params.get("resolution")) || 1,
                },
            },
        });
        const camera = xr.baseExperience.camera;
        // Level of detail from the eyes' field of view (Quest 3: about 96 degrees vertically).
        camera.fov = 1.68;
        camera.minZ = 0.05;

        // Overlays and hands: after every globe layer, over a cleared depth buffer.
        const overlay = RenderingManager.MAX_RENDERINGGROUPS;
        RenderingManager.MAX_RENDERINGGROUPS = overlay + 1;
        this.scene.setRenderingAutoClearDepthStencil(overlay, true, true, false);

        const menu = this.menu = new XRMenu(this.scene, overlay, {
            get tourOn() { return demo.touring; },
            get trafficOn() { return demo.liveLayers.some(layer => layer.enabled); },
            get hasTraffic() { return demo.liveLayers.length > 0; },
            toggleTour: () => { if (this.touring) this.stopTour(); else void this.tour(); },
            toggleTraffic: () => this.toggleTraffic(),
            overview: () => { this.stopTour(); this.xrControls!.diving = false; void this.xrControls!.overview(); },
            goTo: result => { this.stopTour(); void this.goToPlace(result); },
            searchToken: DEMO_MAPBOX_TOKEN,
            help: HELP,
        });
        const demo = this;
        const controls = this.xrControls = new GlobeXRControls(this.globe, camera, {
            groundAt: (lat, lon) => this.groundHeight(lat, lon),
            hover: ray => this.surface.intersectRay(ray) ?? sphereHit(ray, this.globe.radius),
            pick: ray => {
                const surface = this.surface.intersectRay(ray);
                const tiles = this.google?.enabled ? this.google.intersectRay(ray, 60) : undefined;
                return tiles !== undefined && (surface === undefined || tiles < surface) ? tiles : surface ?? sphereHit(ray, this.globe.radius);
            },
            onButton: button => this.button(button),
            onUserMove: () => this.stopTour(),
            ui: menu,
            // Descents wait a little for the place to load, rather than arriving at a blur.
            destinationReady: () => this.surface.prefetchPending === 0 && (!this.google || this.google.prefetchPending === 0),
        }, overlay);

        const handsLight = new HemisphericLight("xr hands light", new Vector3(0, 1, 0), this.scene);
        handsLight.groundColor = new Color3(0.35, 0.36, 0.4);
        handsLight.includedOnlyMeshes = [];
        xr.input.onControllerAddedObservable.add(source => {
            controls.addController(source);
            source.onMotionControllerInitObservable.addOnce(controller => {
                controller.onModelLoadedObservable.addOnce(() => {
                    const meshes: AbstractMesh[] = controller.rootMesh?.getChildMeshes() ?? [];
                    for (const mesh of meshes) { mesh.renderingGroupId = overlay; mesh.isPickable = false; }
                    handsLight.includedOnlyMeshes.push(...meshes);
                });
                if (source.inputSource.handedness === "left") {
                    this.wrist?.dispose();
                    this.wrist = createWristPanel(this.scene, overlay, () => this.wristState());
                    this.wrist.mesh.parent = source.grip ?? source.pointer;
                }
            });
        });
        xr.input.onControllerRemovedObservable.add(source => controls.removeController(source));

        this.credits = createCreditLine(this.scene, overlay, camera, () => this.creditText());
        this.credits.alpha = 0;
        this.caption = createCaption(this.scene, overlay, () => this.captionText);
        this.caption.alpha = 0;

        // ?level=<n> holds a quality level, for measuring one.
        const held = params.get("level");
        this.governor = new QualityGovernor(() => TARGET_HZ, held === null ? INITIAL_LEVEL : Number(held), (_, index) => {
            if (this.google) Object.assign(this.google, googleQuality(index));
        });
        // A flight loads as it goes: its frames say nothing of the detail the
        // place can hold, so the level is judged afresh after landing.
        let flew = false;
        xr.baseExperience.sessionManager.onXRFrameObservable.add(() => {
            const now = performance.now(), flying = !!this.xrControls?.isTilted;
            if (flew && !flying) this.governor!.reset();
            flew = flying;
            if (held === null && !flying) this.governor!.frame(now);
            else this.governor!.measure(now);
        });

        // Babylon starts the headset at the desktop camera; here the rig places
        // it, so the head starts at the rig's origin instead.
        const origin = new TargetCamera("xr origin", Vector3.Zero(), this.scene, false);
        xr.baseExperience.onInitialXRPoseSetObservable.add(() => camera.setTransformationFromNonVRCamera(origin, true));
        xr.baseExperience.onStateChangedObservable.add(state => {
            button.disabled = state !== WebXRState.NOT_IN_XR;
            if (state === WebXRState.IN_XR) void this.entered();
            if (state === WebXRState.NOT_IN_XR) this.exited();
        });
        button.disabled = false;
        status.textContent = "Ready for VR.";
        button.addEventListener("click", async () => {
            button.disabled = true;
            try {
                await xr.baseExperience.enterXRAsync("immersive-vr", "local-floor", xr.renderTarget);
            } catch (error) {
                status.textContent = "VR could not start. Check the browser's permission and try again.";
                console.error(error);
                button.disabled = false;
            }
        });
    }

    /** In the headset: at the desktop's view, at the refresh rate, foveated. */
    private async entered(): Promise<void> {
        const session = this.xr!.baseExperience.sessionManager;
        // A framebuffer without attachments draws nothing, silently: say so.
        session.onXRFrameObservable.addOnce(() => {
            const gl = (this.engine as unknown as { _gl: WebGL2RenderingContext })._gl;
            const layer = session.session.renderState.baseLayer;
            if (!layer) return;
            const bound = gl.getParameter(gl.FRAMEBUFFER_BINDING);
            gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            gl.bindFramebuffer(gl.FRAMEBUFFER, bound);
            if (status !== gl.FRAMEBUFFER_COMPLETE) this.diagnostics.add(`Headset framebuffer incomplete (0x${status.toString(16)}): nothing will draw.`);
        });
        // Fewer pixels at the edges of the lenses, where they are not seen sharply.
        if (session.fixedFoveation !== null) session.fixedFoveation = Number(params.get("foveation") ?? 1);
        const rates = session.supportedFrameRates;
        if (rates && Array.from(rates).includes(TARGET_HZ)) await session.updateTargetFrameRate(TARGET_HZ).catch(() => undefined);
        this.controls.enabled = false;
        this.governor!.reset();
        // The head turns anywhere at once: everything around it, at the view's detail.
        if (this.google) { this.google.surroundErrorScale = 1; this.google.alwaysLoadSurroundings = true; }
        // The head's pose changes every frame: reselect tiles only once it has
        // turned or moved appreciably, drawing a little wider meanwhile.
        const tolerance = { degrees: 4, distance: 0.02 };
        this.surface.viewTolerance = tolerance;
        if (this.google) this.google.viewTolerance = tolerance;
        const view = this.controls.getView();
        const ground = this.groundHeight(view.latitude, view.longitude);
        this.xrControls!.diving = view.height < 0;
        this.xrControls!.place({ latitude: view.latitude, longitude: view.longitude, heading: view.heading, scale: Math.max(1, (view.height - ground) / EYE_HEIGHT) });
        this.credits!.alpha = 1;
        // The first time, the controls, once the head's pose has settled.
        if (!this.introduced) {
            this.introduced = true;
            setTimeout(() => {
                if (!this.inXR) return;
                const camera = this.xr!.baseExperience.camera;
                const forward = new Vector3(0, 0, 1).rotateByQuaternionToRef(camera.rotationQuaternion, new Vector3());
                this.menu!.show(this.xrControls!.rig.node, camera.position, forward, "help");
            }, 1500);
        }
    }

    /** Back on the desktop, where the head was. */
    private exited(): void {
        this.controls.enabled = true;
        if (this.google) { this.google.surroundErrorScale = 2; this.google.alwaysLoadSurroundings = false; }
        this.surface.viewTolerance = { degrees: 0, distance: 0 };
        if (this.google) this.google.viewTolerance = { degrees: 0, distance: 0 };
        const controls = this.xrControls;
        if (controls) {
            const head = controls.headPose;
            this.controls.setView({ latitude: head.latitude, longitude: head.longitude, height: head.height, heading: head.heading, pitch: -25 });
        }
        if (this.credits) this.credits.alpha = 0;
        if (this.caption) this.caption.alpha = 0;
    }

    private button(button: "a" | "b" | "x" | "y" | "stick-left" | "stick-right"): void {
        const controls = this.xrControls!;
        switch (button) {
            case "a": this.stopTour(); void this.goToStop(this.stop + 1); break;
            case "b": this.stopTour(); void this.goToStop(this.stop - 1); break;
            case "x": {
                // Life size and back.
                const head = controls.headPose;
                if (head.scale > 1.5) { this.lifeSizeFrom = head.scale; void controls.flyTo({ ...head, scale: 1 }, 1400); }
                else void controls.flyTo({ ...head, scale: this.lifeSizeFrom ?? 300 }, 1400);
                break;
            }
            case "y": {
                const camera = this.xr!.baseExperience.camera;
                const forward = new Vector3(0, 0, 1).rotateByQuaternionToRef(camera.rotationQuaternion, new Vector3());
                this.menu!.toggle(controls.rig.node, camera.position, forward);
                break;
            }
            case "stick-left": {
                // Out to see the whole globe.
                this.stopTour();
                controls.diving = false;
                void controls.overview();
                break;
            }
            case "stick-right": this.toggleTraffic(); break;
        }
    }

    /** Aircraft, ships and road congestion: whichever this build has. */
    private get liveLayers(): { enabled: boolean }[] {
        return [this.aircraft, this.ships, this.traffic].filter(layer => layer !== undefined);
    }

    private toggleTraffic(): void {
        const layers = this.liveLayers, enabled = !layers.some(layer => layer.enabled);
        for (const layer of layers) layer.enabled = enabled;
        this.menu?.refresh();
    }

    // ------------------------------------------------------------------ tour

    /** From the next place on, each in turn, lingering at each, until the user moves. */
    private async tour(): Promise<void> {
        const run = ++this.tourRun;
        this.touring = true;
        this.menu?.refresh();
        const alive = () => run === this.tourRun && this.touring;
        for (let i = this.stop + 1; alive(); i++) {
            if (!await this.goToStop(i) || !alive()) break;
            const start = performance.now();
            while (alive() && performance.now() - start < TOUR_LINGER_MS) await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (run === this.tourRun) this.stopTour();
    }

    private stopTour(): void {
        if (!this.touring) return;
        this.touring = false;
        this.tourRun++;
        this.menu?.refresh();
    }

    /** To a place found by search: standing over it, as high as the flat demo would look from. */
    private async goToPlace(result: AddressResult): Promise<void> {
        const [title, ...rest] = result.label.split(", ");
        const stop: TourStop = {
            title, text: rest.join(", "),
            latitude: result.latitude, longitude: result.longitude,
            height: this.surface.getHeight(result.latitude, result.longitude) ?? 0,
            heading: this.xrControls!.headPose.heading, pitch: result.zoom <= 7 ? -80 : -35,
            range: Math.max(800, 40_000_000 / 2 ** result.zoom),
        };
        this.stop = -1;
        this.hideCaption();
        this.xrControls!.diving = false;
        if (await this.xrControls!.flyTo(this.stopPose(stop))) this.showCaption(stop);
    }

    private async goToStop(index: number): Promise<boolean> {
        const controls = this.xrControls!;
        const count = TOUR.length;
        this.stop = ((index % count) + count) % count;
        const stop = TOUR[this.stop];
        this.hideCaption();
        const pose = this.stopPose(stop);
        controls.diving = stop.height !== undefined && stop.height < 0;
        if (!await controls.flyTo(pose)) return false;
        this.showCaption(stop);
        return true;
    }

    /**
     * A tour stop as the user's place: standing where the desktop camera would
     * be, as tall as it is high above the place it looks at.
     */
    private stopPose(stop: TourStop): RigPose {
        const view = this.controls.lookAt(stop);
        const above = view.height - (stop.height ?? 0);
        return { latitude: view.latitude, longitude: view.longitude, heading: stop.heading, scale: Math.max(1, above / EYE_HEIGHT) };
    }

    private showCaption(stop: TourStop): void {
        const caption = this.caption!, camera = this.xr!.baseExperience.camera;
        this.captionText = { title: stop.title, text: stop.text };
        caption.refresh(`${stop.title}|${stop.text}`);
        // Two metres ahead of the eyes, a little low, facing them; it stays put in the world.
        const forward = new Vector3(0, 0, 1).rotateByQuaternionToRef(camera.rotationQuaternion, new Vector3());
        forward.y = 0;
        forward.normalize();
        caption.mesh.parent = this.xrControls!.rig.node;
        caption.mesh.position.copyFrom(camera.position).addInPlace(forward.scale(2));
        caption.mesh.position.y = camera.position.y - 0.15;
        caption.mesh.rotation.set(0, Math.atan2(forward.x, forward.z), 0);
        this.captionShownAt = performance.now();
        this.place = stop.title;
    }

    private hideCaption(): void {
        this.captionShownAt = -Infinity;
        if (this.caption) this.caption.alpha = 0;
    }

    private wristState(): { title: string; detail: string; lines: string[] } {
        const head = this.xrControls!.headPose;
        const height = head.height - this.xrControls!.rig.floor;
        const eye = height < 1000 ? `${Math.round(height)} m` : `${(height / 1000).toFixed(height < 10_000 ? 1 : 0)} km`;
        const governor = this.governor!;
        const errors = this.diagnostics.errors;
        // Errors first: in the headset there is nowhere else to read them.
        const lines = errors.length ? [`${errors.length} error${errors.length > 1 ? "s" : ""}:`, ...errors.slice(0, 3)] : ["Y  menu"];
        // Only where you are, unless ?stats asks for how it is running.
        const stats = params.has("stats") ? ` · ${Math.round(governor.fps)} fps · ${this.diagnostics.summary} · detail ${QUALITY_LEVELS.length - governor.level}/${QUALITY_LEVELS.length}` : "";
        return {
            title: this.place || `${head.latitude.toFixed(3)}°, ${head.longitude.toFixed(3)}°`,
            detail: `${this.touring ? "Tour · " : ""}Eye ${eye}${stats}`,
            lines,
        };
    }

    // ------------------------------------------------------------------ frame

    private frame(): void {
        const xr = this.inXR;
        let height: number, ahead: TargetCamera | undefined;
        if (xr) {
            const controls = this.xrControls!;
            controls.update();
            const head = controls.headPose;
            height = head.height;
            ahead = controls.isFlying ? controls.destination : undefined;
            if (!controls.isFlying && this.place && this.stop >= 0) {
                const stop = TOUR[this.stop];
                if (Math.abs(head.latitude - stop.latitude) + Math.abs(head.longitude - stop.longitude) > 0.5) this.place = "";
            }
            this.updateClipping(height - controls.rig.floor);
            this.updatePanels();
        } else {
            height = this.controls.getView().height;
            ahead = this.controls.flightDestination;
        }
        this.surface.prefetchCamera = ahead;
        if (this.google) {
            this.google.enabled = height > 0 && height < GOOGLE_CEILING;
            this.google.prefetchCamera = ahead;
            this.surface.coverage = { radius: QUALITY_LEVELS[this.governor?.level ?? INITIAL_LEVEL].radius * 0.9, maxZoom: 16 };
        }
    }

    /** Far enough for the horizon, in the eyes' physical metres. */
    private updateClipping(eyeHeight: number): void {
        const camera = this.xr!.baseExperience.camera, scale = this.xrControls!.rig.scale;
        const r = this.globe.radius / this.globe.metresToWorld, h = Math.max(1, eyeHeight);
        const horizon = Math.sqrt(2 * r * h + h * h) + Math.sqrt(2 * r * 9000);
        const far = Math.max(horizon, 50_000) * 1.05 / scale;
        // Changing the planes updates the session's render state: only when it matters.
        if (Math.abs(far / camera.maxZ - 1) > 0.1) camera.maxZ = far;
    }

    private updatePanels(): void {
        const now = performance.now();
        if (this.wrist && Math.floor(now / 500) !== Math.floor((now - this.engine.getDeltaTime()) / 500)) {
            const s = this.wristState();
            this.wrist.refresh(`${s.title}|${s.detail}|${s.lines.length}`);
            this.credits?.refresh(this.creditText());
        }
        if (this.caption) {
            const age = (now - this.captionShownAt) / 1000;
            this.caption.alpha = age < 0.6 ? age / 0.6 : age < 7 ? 1 : Math.max(0, 1 - (age - 7) / 1.5);
        }
    }

    // ------------------------------------------------------------ attribution

    /** One short line: who made what is in view. */
    private creditText(): string {
        const sources: string[] = [];
        if (this.google?.enabled) sources.push(...this.google.getAttributions());
        if (this.surface?.attribution) sources.push(this.surface.attribution);
        const authors = [...new Set([...this.aircraft?.drawnModels ?? [], ...this.ships?.drawnModels ?? []].map(url => MODEL_AUTHORS[modelKey(url)]).filter(Boolean))];
        if (authors.length) sources.push(`Models: ${authors.join(", ")} (CC BY)`);
        return [...new Set(sources)].join(" · ");
    }

    private updateAttribution(): void {
        const bar = $("attribution");
        const text = this.creditText();
        bar.textContent = text;
        bar.title = text;
    }
}

/** Distance along `ray` to a sphere of `radius` about the origin. */
function sphereHit(ray: { origin: Vector3; direction: Vector3 }, radius: number): number | undefined {
    const b = Vector3.Dot(ray.origin, ray.direction), c = ray.origin.lengthSquared() - radius * radius;
    const discriminant = b * b - c;
    if (discriminant < 0) return undefined;
    const t = -b - Math.sqrt(discriminant);
    return t > 0 ? t : undefined;
}

function googleQuality(level: number) {
    const { error, detailRadius, distantErrorScale, radius } = QUALITY_LEVELS[level];
    return { maximumScreenSpaceError: error, detailRadius, distantErrorScale, maximumRadius: radius };
}

const demo = new GlobeXRDemo();
Object.assign(window, { demo });
void demo.start();
