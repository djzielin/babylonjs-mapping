import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { PassPostProcess } from "@babylonjs/core/PostProcesses/passPostProcess";
import type { WebGPURenderTargetWrapper } from "@babylonjs/core/Engines/WebGPU/webgpuRenderTargetWrapper";
import { DracoCompression } from "@babylonjs/core/Meshes/Compression/dracoCompression";
import { lookFromEye, moveEye } from "./FirstPersonNavigation";
import { TerrainTransition } from "./TerrainTransition";
import { BuildingTransition } from "./BuildingTransition";
import { OvertureTierCoverage } from "./OvertureTierCoverage";
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery";
import "@babylonjs/core/Engines/Extensions/engine.query";
import { EngineInstrumentation } from "@babylonjs/core/Instrumentation/engineInstrumentation";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import { RenderingManager } from "@babylonjs/core/Rendering/renderingManager";
import { TerrainBatcher } from "./TerrainBatcher";
import { installResidentMeshCandidates } from "./ResidentMeshCandidates";
import { DrawSnapshotCache } from "./DrawSnapshotCache";
import { MotionFrameProfile } from "./MotionFrameProfile";
import { globeLODPlan, MIN_GLOBE_BUILDING_ZOOM } from "./GlobeLODPlan";
import { setupAddressSearch } from "./AddressSearch";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import type { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
type GlobeEngine = Engine | WebGPUEngine;
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color4 } from "@babylonjs/core/Maths/math";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";

import {
    Google3DTiles,
    GlobeNavigator,
    MapLayerRenderer,
    BuildingReplacementIndex,
    landscapeTerrainLOD,
    GlobeSet,
    RasterOSM,
    RasterGoogleSatellite,
    RasterGEBCO,
    RasterMB,
    GlobeDataController,
    TerrainRGB,
    Buildings,
    BuildingsOverture,
    BuildingsVectorTile,
    BuildingsMB,
    resolveLatestOvertureBuildingsURL,
    GeoJSON,
    EPSG_Type,
    type GlobeView,
    type GoogleSatelliteSession,
    type Tile,
} from "babylonjs-mapping";

declare const DEMO_MAPBOX_TOKEN: string;

interface LocationPreset {
    name: string;
    latitude: number;
    longitude: number;
    zoom: number;
    heading?: number;
    tilt?: number;
    eyeHeight?: number;
    distance?: number;
    google?: boolean;
    basemap?: "osm" | "satellite" | "gebco";
}

const GLOBE_RADIUS = 60;
const DETAIL_RADIUS = 60;
const GOOGLE_DETAIL_SHOW_ZOOM = 15;
const GOOGLE_DETAIL_HIDE_ZOOM = 14;
const HOME_VIEW: LocationPreset = {
    name: "New York · Empire State Building",
    latitude: 40.7484,
    longitude: -73.9857,
    zoom: 17,
    google: true,
    basemap: "satellite",
};
const LOCATIONS: LocationPreset[] = [
    HOME_VIEW,
    { name: "Duke University · Duke Chapel", latitude: 36.00145, longitude: -78.94032, zoom: 18, heading: 256, tilt: 65, eyeHeight: 150, distance: 650, google: true, basemap: "satellite" },
    {
        name: "Manhattan · buildings",
        google: false,
        basemap: "osm",
        latitude: 40.706,
        longitude: -74.009,
        zoom: 16,
    },
    {
        name: "Mariana Trench · seabed",
        basemap: "gebco",
        latitude: 11.35,
        longitude: 142.2,
        zoom: 8,
    },
    {
        name: "Monterey Canyon · coastline",
        basemap: "gebco",
        latitude: 36.73,
        longitude: -122.02,
        zoom: 11,
    },
    { name: "Date line · Fiji", latitude: -17.71, longitude: 179.99, zoom: 9 },
    { name: "Grand Canyon", latitude: 36.1069, longitude: -112.1129, zoom: 13 },
    { name: "Mount Everest", latitude: 27.9881, longitude: 86.925, zoom: 13 },
    { name: "Paris · Eiffel Tower", latitude: 48.8584, longitude: 2.2945, zoom: 18, heading: 310, tilt: 65, eyeHeight: 160, distance: 750, google: true, basemap: "satellite" },
    { name: "Tokyo · Skytree", latitude: 35.7101, longitude: 139.8107, zoom: 17, heading: 235, tilt: 65, eyeHeight: 180, distance: 1000, google: true, basemap: "satellite" },
    { name: "Sydney", latitude: -33.8688, longitude: 151.2093, zoom: 13 },
    { name: "Tokyo · toward Mount Fuji", google: false, basemap: "satellite", latitude: 35.6812, longitude: 139.7671, zoom: 16, heading: 249.5, tilt: 87, eyeHeight: 600 },
];

class GlobeDemo {
    private readonly canvas: HTMLCanvasElement;
    private readonly engine: GlobeEngine;
    private readonly scene: Scene;
    private navigator: GlobeNavigator;
    private detailGlobe: GlobeSet;
    private baseGlobe: GlobeSet;
    private camera: ArcRotateCamera;
    private layers: MapLayerRenderer;
    private replacements = new BuildingReplacementIndex();
    private finerOvertureCoverage = new Map<GlobeSet, OvertureTierCoverage>();
    private overtureCoverageTimer?: ReturnType<typeof setTimeout>;
    private detailBuildingWindowKey = "";
    private lastCoverageRevision = -1;
    private replacementSignatures = new WeakMap<object, string>();
    private replacementLandmarkSignature?: string;
    private data: GlobeDataController;
    private elevation = new TerrainRGB();
    private buildings?: BuildingsOverture;
    private inspecting?: ArcRotateCamera;
    private tourTimer?: ReturnType<typeof setInterval>;
    private lastStats = 0;
    private userSettings?: BuildingsVectorTile;
    private roads?: BuildingsVectorTile;
    private landmarks?: BuildingsMB;
    private landmarkKey = "";
    private landmarkRetryAt = 0;
    private distanceLayers: { globe: GlobeSet; data: GlobeDataController; buildings?: BuildingsOverture; key: string; lodKey?: string; visible?: boolean }[] = [];
    private overtureURL?: string;
    private googleTiles?: Google3DTiles;
    private googleKey = "";
    private satelliteSession?: GoogleSatelliteSession;
    private satelliteSessionPending?: Promise<GoogleSatelliteSession>;
    private satelliteCopyright = "";
    private satelliteAttributionKey = "";
    private satelliteAttributionRetryAt = 0;
    private googleViewKey = "";
    private googlePriorityKey = "";
    private googleSelectionBearing = "";
    private googleTurnPending = false;
    private googleTimer?: ReturnType<typeof setTimeout>;
    private googleGeneration = 0;
    private googleMeshes = new WeakSet<object>();
    private registeredGoogleModels = new WeakSet<object>();
    private registeredGoogleTiles?: Google3DTiles;
    private registeredGoogleRevision = -1;
    private replacementCoverageProvider?: Google3DTiles;
    private replacementCoverageURLs = new Set<string>();
    private replacementCoverageHidden = false;
    private photorealisticActive = false;
    private googleFarHidden = false;
    private googleLoading = false;
    private googlePassStartedAt = 0;
    private lastGoogleCheck = 0;
    private movementKeys = new Set<string>();
    private engineProfile: EngineInstrumentation;
    private sceneProfile: SceneInstrumentation;
    private terrainBatcher: TerrainBatcher;
    private terrainTransition = new TerrainTransition();
    private buildingTransition = new BuildingTransition();
    private renderTimes: number[] = [];
    private gpuTimes: number[] = [];
    private drawSnapshot?: DrawSnapshotCache;
    private depthPass?: PassPostProcess;
    private depthCamera?: Scene["activeCamera"];
    private reversedDepth = false;
    private framePacing = new MotionFrameProfile(600);
    private longFrameObserver?: PerformanceObserver;
    private longestAnimationFrame = 0;
    private longestFrameScript = "unattributed";
    private longestFrameBreakdown = "";
    private benchmarkPhaseMax = new Map<string, number>();
    private benchmark?: { started: number; previous: number; heading: number; tilt: number; shift: Vector3;
        moving: boolean; fullSpeed: boolean; profile: MotionFrameProfile;
        maxSelectionLagMeters: number; knownIncomplete: boolean; qualitySamples: number;
        qualityFailures: number; maxVisibleErrorRatio: number; maxUnderDetailedTiles: number;
        maxMissingVisibleTiles: number;
        lastQualitySampleAt: number };
    private googleSelectionCenter?: { latitude: number; longitude: number };
    private readonly diagnoseGoogle = new URLSearchParams(location.search).has("diagnoseGoogle");
    private nextGoogleDiagnosticsAt = 0;

    public constructor(engine?: GlobeEngine) {
        this.canvas = document.getElementById(
            "renderCanvas",
        ) as unknown as HTMLCanvasElement;
        this.engine = engine ?? new Engine(this.canvas, true, {
            powerPreference: "high-performance",
            useLargeWorldRendering: true,
            useHighPrecisionMatrix: true,
            stencil: true,
            adaptToDeviceRatio: true,
        });
        DracoCompression.DefaultNumWorkers = Math.min(8, Math.max(1, Math.floor(navigator.hardwareConcurrency / 2) || 1));
        RenderingManager.MAX_RENDERINGGROUPS = Math.max(RenderingManager.MAX_RENDERINGGROUPS, 8);
        this.scene = new Scene(this.engine);
        installResidentMeshCandidates(this.scene);
        if (this.engine.isWebGPU && new URLSearchParams(location.search).has("snapshot"))
            this.drawSnapshot = new DrawSnapshotCache(this.scene, this.engine as WebGPUEngine);
        this.scene.skipPointerMovePicking = true;
        Buildings.setSceneCreationTimeBudget(this.scene, 1);
        this.engineProfile = new EngineInstrumentation(this.engine);
        this.engineProfile.captureGPUFrameTime = true;
        this.sceneProfile = new SceneInstrumentation(this.scene);
        this.sceneProfile.captureActiveMeshesEvaluationTime = true;
        this.sceneProfile.captureRenderTargetsRenderTime = true;
        this.sceneProfile.captureRenderTime = true;
        this.reversedDepth = this.engine.isWebGPU && new URLSearchParams(location.search).get("depth") === "reverse"
            && (this.engine as WebGPUEngine)._device.features.has("depth32float-stencil8");
        if (this.reversedDepth) this.engine.useReverseDepthBuffer = true;
        this.layers = new MapLayerRenderer(this.scene, 7, { logarithmicDepth: !this.reversedDepth });
    }

    public start(): void {
        (document.getElementById("mapboxToken") as HTMLInputElement).value = DEMO_MAPBOX_TOKEN;
        if (DEMO_MAPBOX_TOKEN && HOME_VIEW.basemap)
            (document.getElementById("basemap") as HTMLSelectElement).value = HOME_VIEW.basemap;
        this.createScene();
        if (this.reversedDepth) {
            // Float reverse depth preserves near-surface precision without
            // writing fragment depth, so hidden geometry can fail depth early.
            this.depthPass = new PassPostProcess("precise depth", 1, this.scene.activeCamera!, Texture.NEAREST_SAMPLINGMODE, this.engine);
            this.depthCamera = this.scene.activeCamera;
            this.depthPass.samples = 4;
            this.depthPass.onSizeChangedObservable.add(pass => pass.inputTexture.createDepthStencilTexture(0, false, true, 4, 18));
        }
        this.scene.onDisposeObservable.add(() => {
            this.terrainTransition.dispose();
            this.buildingTransition.dispose();
        });
        document.addEventListener("visibilitychange", () => {
            this.framePacing.reset();
            if (document.hidden && this.benchmark) this.finishBenchmark("Interrupted: browser was hidden.");
        });
        document.getElementById("benchmark")!.addEventListener("click", () => {
            if (this.benchmark) { this.finishBenchmark("Stopped before completion."); return; }
            const mode = (document.getElementById("benchmarkMode") as HTMLSelectElement).value;
            const moving = mode !== "still";
            const fullSpeed = mode === "shift";
            if (moving && !this.inspecting) this.orientView(60, 0);
            const now = performance.now();
            this.benchmark = { started: now, previous: 0,
                heading: Number((document.getElementById("heading") as HTMLInputElement).value),
                tilt: Number((document.getElementById("tilt") as HTMLInputElement).value),
                shift: this.inspectionBasis().north.scale(this.inspecting
                    ? fullSpeed ? this.movementSpeed() * 4 : Math.min(200 * this.detailGlobe.metresToWorld, this.movementSpeed()) : 0),
                moving, fullSpeed, profile: new MotionFrameProfile(30000),
                maxSelectionLagMeters: 0, knownIncomplete: false, qualitySamples: 0,
                qualityFailures: 0, maxVisibleErrorRatio: 0, maxUnderDetailedTiles: 0,
                maxMissingVisibleTiles: 0,
                lastQualitySampleAt: -Infinity };
            this.longestAnimationFrame = 0;
            this.longestFrameScript = "unattributed";
            this.longestFrameBreakdown = "";
            this.benchmarkPhaseMax.clear();
            if (typeof PerformanceObserver !== "undefined"
                && PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) {
                this.longFrameObserver = new PerformanceObserver(list => this.recordLongFrames(list.getEntries()));
                this.longFrameObserver.observe({ type: "long-animation-frame" });
            }
            document.getElementById("benchmark")!.textContent = "Stop measurement";
        });
        this.terrainBatcher = new TerrainBatcher(this.scene,
            () => [this.baseGlobe, this.detailGlobe, ...this.distanceLayers.map(layer => layer.globe)].map(globe => globe.ourTiles.map(tile => tile.mesh)),
            (mesh, source) => this.registerTerrain(mesh, 7 - source.renderingGroupId));
        document.getElementById("batchTerrain")!.addEventListener("change", () => {
            this.terrainBatcher.enabled = (document.getElementById("batchTerrain") as HTMLInputElement).checked;
        });
        this.setupLocationControls();
        setupAddressSearch(result => {
            this.exitInspection();
            if (this.tourTimer) {
                clearInterval(this.tourTimer);
                this.tourTimer = undefined;
                document.getElementById("tour")!.textContent = "Guided tour";
            }
            (document.getElementById("latitude") as HTMLInputElement).value = String(result.latitude);
            (document.getElementById("longitude") as HTMLInputElement).value = String(result.longitude);
            (document.getElementById("locationPreset") as HTMLSelectElement).selectedIndex = -1;
            this.navigator.flyTo(result.latitude, result.longitude, { zoom: result.zoom, durationMs: 1400 });
        }, () => (document.getElementById("mapboxToken") as HTMLInputElement).value);
        this.setupPointerNavigation();
        this.setupDataControls();
        if (DEMO_MAPBOX_TOKEN && HOME_VIEW.basemap)
            document.getElementById("basemap")!.dispatchEvent(new Event("change"));
        if (DEMO_MAPBOX_TOKEN) {
            (document.getElementById("roads") as HTMLInputElement).checked = true;
            document.getElementById("roads")!.dispatchEvent(new Event("change"));
        }
        document.getElementById("controlsToggle")!.addEventListener("click", () => {
            const expanded = document.getElementById("controlPanel")!.classList.toggle("expanded");
            document.getElementById("controlsToggle")!.setAttribute("aria-expanded", String(expanded));
            document.getElementById("controlsToggle")!.textContent = expanded ? "Hide controls" : "Layers & controls";
        });
        window.addEventListener("pagehide", event => {
            if (event.persisted) return;
            clearTimeout(this.googleTimer);
            clearTimeout(this.overtureCoverageTimer);
            this.googleTiles?.dispose(); this.scene.dispose(); this.engine.dispose();
        }, { once: true });
        void this.readGoogleKey();
        document.getElementById("googleTiles")!.addEventListener("change", () => {
            this.updateDistanceLayers(this.navigator.getView());
            if (!this.googleKey && (document.getElementById("googleTiles") as HTMLInputElement).checked) void this.readGoogleKey();
            else this.scheduleGoogleTiles(true);
        });
        document.getElementById("googleQuality")!.addEventListener("change", () => this.scheduleGoogleTiles(true));
        this.engine.runRenderLoop(() => {
            const frameStarted = performance.now();
            this.updateBenchmark();
            this.updateMovement();
            if (this.depthPass && this.depthCamera !== this.scene.activeCamera) {
                this.depthCamera?.detachPostProcess(this.depthPass);
                this.scene.activeCamera?.attachPostProcess(this.depthPass);
                this.depthCamera = this.scene.activeCamera;
            }
            this.terrainTransition.update(performance.now());
            this.buildingTransition.update(performance.now(), this.googleTiles && !this.googleFarHidden
                ? (lat, lon, bounds) => this.googleCoversFootprint(lat, lon, bounds) : undefined);
            this.sampleBenchmarkPhase("movement+transitions", frameStarted);
            const registrationStarted = performance.now();
            const googleRevision = this.googleTiles?.coverageRevision ?? -1;
            if (this.registeredGoogleTiles !== this.googleTiles || this.registeredGoogleRevision !== googleRevision) {
                this.registeredGoogleTiles = this.googleTiles;
                this.registeredGoogleRevision = googleRevision;
                for (const tile of this.googleTiles?.loadedModelTiles ?? []) {
                    if (this.registeredGoogleModels.has(tile)) continue;
                    this.registeredGoogleModels.add(tile);
                    for (const mesh of tile.asset.meshes) {
                        if (this.googleMeshes.has(mesh)) continue;
                        this.googleMeshes.add(mesh);
                        this.layers.add(mesh, 7);
                        mesh.freezeWorldMatrix();
                        // Newly loaded static materials have no stale bindings to
                        // invalidate. freeze() otherwise scans the entire city.
                        if (mesh.material) {
                            mesh.material.checkReadyOnlyOnce = true;
                            this.drawSnapshot?.retainStaticMaterial(mesh.material);
                        }
                        mesh.isPickable = false;
                    }
                    this.drawSnapshot?.registerStaticGroup(tile.asset.meshes);
                }
            }
            this.sampleBenchmarkPhase("model registration", registrationStarted);
            const replacementStarted = performance.now();
            // Resolve Google/Overture overlap before drawing the newly enabled model.
            if (googleRevision !== this.lastCoverageRevision) {
                this.lastCoverageRevision = googleRevision;
                this.refreshBuildingReplacements();
                this.buildingTransition.update(performance.now(), (lat, lon, bounds) => this.googleCoversFootprint(lat, lon, bounds), true);
                for (const tile of this.landmarks?.loadedModelTiles ?? []) for (const mesh of tile.asset.meshes) {
                    const point = this.detailGlobe.getSurfaceCoordinates(mesh.getBoundingInfo().boundingBox.centerWorld);
                    mesh.setEnabled(!this.googleCoversLocation(point.latitude, point.longitude));
                }
            }
            this.sampleBenchmarkPhase("coverage replacement", replacementStarted);
            const renderStart = performance.now();
            this.scene.render();
            this.sampleBenchmarkPhase("scene render", renderStart);
            const frameTailStarted = performance.now();
            this.framePacing.sample(performance.now(), this.scene.activeCamera!.getViewMatrix().m, !document.hidden);
            this.benchmark?.profile.sample(performance.now(), this.scene.activeCamera!.getViewMatrix().m, !document.hidden);
            this.renderTimes.push(performance.now() - renderStart);
            if (this.renderTimes.length > 180) this.renderTimes.shift();
            const gpuEngine = this.engine as GlobeEngine & { gpuTimeInFrameForMainPass?: { counter: { current: number } } };
            const depthGpuTime = (this.depthPass?.inputTexture as WebGPURenderTargetWrapper | undefined)?.gpuTimeInFrame?.counter.current ?? 0;
            const gpuTime = ((gpuEngine.gpuTimeInFrameForMainPass?.counter.current ?? this.engineProfile.gpuFrameTimeCounter.current) + depthGpuTime) / 1e6;
            if (gpuTime > 0) this.gpuTimes.push(gpuTime);
            if (this.gpuTimes.length > 180) this.gpuTimes.shift();
            this.updateOrientation();
            this.updateLandmarks();
            this.updateLandscapeLOD();
            if (performance.now() - this.lastGoogleCheck > 50) {
                this.lastGoogleCheck = performance.now();
                this.scheduleGoogleTiles();
            }
            if (performance.now() - this.lastStats > 500) {
                this.lastStats = performance.now();
                const times = [...this.renderTimes].sort((a, b) => a - b);
                const gpuTimes = [...this.gpuTimes].sort((a, b) => a - b);
                const gpuMs = gpuTimes[Math.floor(gpuTimes.length * 0.5)] ?? 0;
                const motion = this.framePacing.summary(true);
                document.getElementById("renderProfile")!.textContent =
                    `CPU render p50 ${times[Math.floor(times.length * 0.5)]?.toFixed(2)} ms · p95 ${times[Math.floor(times.length * 0.95)]?.toFixed(2)} ms · GPU p50 ${gpuMs.toFixed(2)} ms · moving ${motion.fps.toFixed(0)} FPS / 1% ${motion.low1.toFixed(0)} / 0.1% ${motion.low01.toFixed(0)} / p95 ${motion.p95.toFixed(2)} ms (${motion.samples} frames) · mesh evaluation ${this.sceneProfile.activeMeshesEvaluationTimeCounter.average.toFixed(2)} ms · draw ${this.sceneProfile.renderTimeCounter.average.toFixed(2)} ms · render targets ${this.sceneProfile.renderTargetsRenderTimeCounter.average.toFixed(2)} ms · ${this.sceneProfile.drawCallsCounter.current} draws · ${this.terrainBatcher.stats}${this.drawSnapshot ? ` · ${this.drawSnapshot.stats}` : ""}`;
                const gpuInfo = this.engine.getInfo();
                document.getElementById("gpuInfo")!.textContent = `${this.engine.isWebGPU ? "WebGPU" : "WebGL"}${this.reversedDepth ? " · reverse float depth" : ""} · ${gpuInfo.vendor} · ${gpuInfo.renderer} · ${gpuInfo.version}`;
                this.canvas.dataset.maxTerrainCaptureMs = String(Math.round(this.terrainTransition.maxCaptureMs));
                this.updateGoogleCredits();
                if (this.googleTiles) {
                    const stages = this.googleTiles.stats;
                    this.canvas.dataset.googleModelFetchCount = String(stages.modelFetchCount);
                    this.canvas.dataset.googleModelDecodeCount = String(stages.modelDecodeCount);
                    this.canvas.dataset.googleModelFetchMs = String(Math.round(stages.modelFetchMs));
                    this.canvas.dataset.googleModelDecodeMs = String(Math.round(stages.modelDecodeMs));
                    this.canvas.dataset.googleModelDecodeActive = String(stages.modelDecodeActive);
                    this.canvas.dataset.googlePeakModelDecodeActive = String(stages.peakModelDecodeActive);
                    this.canvas.dataset.googleModelDecodeQueued = String(stages.modelDecodeQueued);
                    this.canvas.dataset.googlePeakModelDecodeQueued = String(stages.peakModelDecodeQueued);
                    this.canvas.dataset.googleReusedDownloadedModels = String(stages.reusedDownloadedModels);
                    this.canvas.dataset.googleCoastalSkirtTrianglesRemoved = String(stages.coastalSkirtTrianglesRemoved);
                    this.canvas.dataset.googleModelIntegrationMs = String(Math.round(stages.modelIntegrationMs));
                    this.canvas.dataset.googleModelIntegrationMaxMs = String(Math.round(stages.modelIntegrationMaxMs));
                    // Bounding every Google mesh and sorting the largest ones
                    // costs a full frame during streaming. The benchmark takes
                    // its own quality samples, so keep this panel diagnostic
                    // off the render hot path while measuring frame pacing.
                    if (this.diagnoseGoogle && !this.benchmark
                        && performance.now() >= this.nextGoogleDiagnosticsAt) {
                        this.nextGoogleDiagnosticsAt = performance.now() + 5000;
                        this.canvas.dataset.googleVisibleQuality = JSON.stringify(this.googleTiles.measureVisibleQuality());
                        const scale = this.detailGlobe.metresToWorld;
                        const largest = this.googleTiles.loadedModelTiles.flatMap(tile => tile.asset.meshes
                            .filter(mesh => mesh.getTotalVertices() > 0 && mesh.isEnabled())
                            .map(mesh => {
                                const box = mesh.getBoundingInfo().boundingBox;
                                const size = box.maximumWorld.subtract(box.minimumWorld).length() / scale;
                                const point = this.detailGlobe.getSurfaceCoordinates(box.centerWorld);
                                return { depth: tile.depth, size: Math.round(size), latitude: +point.latitude.toFixed(4),
                                    longitude: +point.longitude.toFixed(4), name: mesh.name.slice(0, 40) };
                            })).sort((a, b) => b.size - a.size).slice(0, 8);
                        this.canvas.dataset.googleLargestMeshes = JSON.stringify(largest);
                    }
                }

                const stat = this.distanceLayers.reduce<{ active: number; completed: number; failed: number }>((total, layer) => ({
                    active: total.active + layer.data.stats.active,
                    completed: total.completed + layer.data.stats.completed,
                    failed: total.failed + layer.data.stats.failed,
                }), this.data.stats);
                const globes = [this.detailGlobe, ...this.distanceLayers.map(layer => layer.globe)];
                const terrainTiles = globes.reduce((sum, globe) => sum + globe.ourTiles.filter(tile => tile.terrainLoaded).length, 0);
                const totalTiles = globes.reduce((sum, globe) => sum + globe.ourTiles.length, 0);
                const buildingTiles = globes.reduce((sum, globe) => sum + globe.ourTiles.filter(tile => tile.buildings.length > 0 || tile.buildingBatches.length > 0).length, 0);
                document.getElementById("loadingStatus")!.textContent = `Terrain ${terrainTiles}/${totalTiles} tiles · Buildings ${buildingTiles} tiles${stat.failed ? ` · ${stat.failed} data errors` : ""}`;
                const roadJobs = this.roads?.pendingRequestCount ?? 0;
                const buildingJobs = [this.buildings, ...this.distanceLayers.map(layer => layer.buildings)]
                    .reduce((count, provider) => count + (provider?.pendingRequestCount ?? 0), 0);
                const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
                const heap = memory ? ` · heap ${Math.round(memory.usedJSHeapSize / 1048576)}/${Math.round(memory.jsHeapSizeLimit / 1048576)} MB` : "";
                document.getElementById("performance")!.textContent =
                    `${this.engine.getFps().toFixed(0)} FPS${heap} · ${this.scene.getActiveMeshes().length} active meshes · ${stat.active} detail jobs · ${buildingJobs} building / ${roadJobs} road jobs · ${stat.completed} completed · ${stat.failed} errors${this.googleTiles ? ` · Google: ${this.googleTiles.stats.hierarchyRequests} hierarchy / ${this.googleTiles.stats.modelRequests} fetched / ${this.googleTiles.stats.reusedModels} reused · last update ${this.canvas.dataset.googleLoadMs ?? "—"} ms` : ""}`;
            }
            this.sampleBenchmarkPhase("post-render+stats", frameTailStarted);
        });
        const requestedPreset = new URLSearchParams(window.location.search).get("preset");
        if (requestedPreset) {
            const index = LOCATIONS.findIndex(location => location.name.toLowerCase().startsWith(requestedPreset.toLowerCase()));
            if (index >= 0) {
                const preset = document.getElementById("locationPreset") as HTMLSelectElement;
                preset.value = String(index);
                // The home view is already active. Replaying its flight while
                // the first terrain frame initializes can produce a bad radius.
                if (index !== 0) preset.dispatchEvent(new Event("change"));
            }
        }
        window.addEventListener("resize", () => {
            this.engine.resize();
            this.navigator.refresh(true);
        });
    }

    private registerTerrain(mesh: import("@babylonjs/core/Meshes/abstractMesh").AbstractMesh, level: number): void {
        this.layers.add(mesh, level);
    }

    private createScene(): void {
        this.scene.clearColor = new Color4(5 / 255, 10 / 255, 22 / 255, 1);

        const baseGlobe = this.baseGlobe = new GlobeSet(this.scene, this.engine, {
            radius: GLOBE_RADIUS,
        });
        // Keep the global fallback in the selected imagery style so newly
        // exposed edges have a recognizable surface while detail streams.
        this.applyMapStyle(baseGlobe);
        baseGlobe.setOptimizationOptions({ freezeTileWorldMatrices: true, disableTilePicking: true, disableTileCollisions: true });
        baseGlobe.createGeometry(new Vector2(4, 4), 20, 16);
        baseGlobe.updateRaster(40.98, 0, 2);
        for (const mesh of this.scene.meshes) {
            this.registerTerrain(mesh, 0);
            mesh.freezeWorldMatrix();
            mesh.material?.freeze();
        }

        // The detail layer follows the camera. Its small radial offset avoids
        // z-fighting while the zoom-2 base remains visible during tile loads.
        this.detailGlobe = new GlobeSet(this.scene, this.engine, {
            radius: DETAIL_RADIUS,
            geometryBudgetMs: 4,
            backingSurface: false,
            attribution: false,
        });
        this.detailGlobe.setRasterProvider(new RasterOSM(this.detailGlobe));
        this.detailGlobe.setOptimizationOptions({ freezeTileWorldMatrices: true, disableTilePicking: true, disableTileCollisions: true });
        this.detailGlobe.createGeometry(new Vector2(5, 5), 20, 16);
        for (const tile of this.detailGlobe.ourTiles)
            this.registerTerrain(tile.mesh, 6);
        this.detailGlobe.ourAttribution.advancedTexture.rootContainer.isVisible = false;
        this.data = new GlobeDataController(this.detailGlobe, {
            elevation: this.elevation.load,
            concurrency: 4,
            prioritizeVisible: true,
            minTerrainZoom: 5,
            minBuildingZoom: MIN_GLOBE_BUILDING_ZOOM, maxBuildingZoom: 14,
            minFeatureZoom: 15, maxFeatureZoom: 18,
            exaggeration: 1,
        });
        this.data.onErrorObservable.add((error) => this.message(error.message));
        void resolveLatestOvertureBuildingsURL()
            .then((url) => {
                this.overtureURL = url;
                this.buildings = new BuildingsOverture(this.detailGlobe, url);
                this.buildings.doMerge = true;
                this.buildings.batchGeometry = true;
                this.buildings.batchVisibilityFilter = (lat, lon, bounds) =>
                    !this.googleCoversFootprint(lat, lon, bounds)
                    && !this.finerOvertureCoverage.get(this.detailGlobe)?.covers(bounds);
                this.buildings.onTileResolved = () => this.onFinerOvertureCoverageChanged(this.detailGlobe);
                this.buildings.tileCoverageFilter = tile => this.googleCoversTile(this.detailGlobe, tile);
                this.buildings.loadConcurrency = 6;
                this.buildings.setOptimizationOptions({ freezeWorldMatrices: true, disablePicking: true, prioritizeRequestsByDistance: true });
                this.buildings.buildingFeatureFilter = feature => this.keepBuildingFeature(feature.geometry?.coordinates, this.detailGlobe, Number(feature.properties?.height) || 4);
                this.buildings.buildingsCreatedPerFrame = 32;
                this.buildings.buildingMeshTransform = (mesh) => {
                    this.layers.add(mesh, 7);
                };
                this.buildings.buildingMaterial.diffuseColor.set(
                    0.86,
                    0.84,
                    0.72,
                );
                if (
                    (document.getElementById("buildings") as HTMLInputElement)
                        .checked
                )
                    this.data.options.buildings = this.buildings;
                this.baseGlobe.ourAttribution.addAttribution("OVERTURE");
                this.data.invalidate(true, true);
                this.configureDistanceLayers();
                this.message(
                    "Terrain and Overture buildings ready.",
                );
            })
            .catch((error) =>
                this.message(`Buildings unavailable: ${error.message}`),
            );

        this.camera = new ArcRotateCamera(
            "globe camera",
            0,
            Math.PI / 2,
            180,
            Vector3.Zero(),
            this.scene,
        );
        this.camera.attachControl(this.canvas, true);
        this.camera.inputs.removeByType("ArcRotateCameraMouseWheelInput");
        this.camera.panningSensibility = 0;
        this.camera.inertia = 0.72;

        this.navigator = new GlobeNavigator(this.detailGlobe, this.camera, {
            minZoom: 3,
            maxZoom: 18,
            tilesAcrossViewport: 4,
            tileUpdateDelayMs: 0,
            tileHysteresis: 1,
        });
        this.navigator.setView(HOME_VIEW.latitude, HOME_VIEW.longitude, {
            zoom: HOME_VIEW.zoom,
        });

        const hemisphere = new HemisphericLight(
            "hemisphere",
            new Vector3(0, 1, 0),
            this.scene,
        );
        hemisphere.intensity = 0.55;

        const sun = new DirectionalLight(
            "sun",
            new Vector3(-1, -0.5, 1),
            this.scene,
        );
        sun.intensity = 0.8;
    }

    private message(message: string): void {
        document.getElementById("dataStatus")!.textContent = message;
    }

    private setupDataControls(): void {
        const terrain = document.getElementById("terrain") as HTMLInputElement;
        const buildings = document.getElementById(
            "buildings",
        ) as HTMLInputElement;
        const exaggeration = document.getElementById(
            "exaggeration",
        ) as HTMLInputElement;
        const reload = () => {
            this.data.options.elevation = terrain.checked
                ? this.elevation.load
                : undefined;
            this.data.options.buildings = buildings.checked
                ? this.buildings
                : undefined;
            this.data.options.exaggeration = Number(exaggeration.value);
            document.getElementById("exaggerationValue")!.textContent =
                exaggeration.value + "×";
            if (!terrain.checked) {
                // Retained previous-view meshes still contain their old DEM.
                // They must not keep drawing relief after the user disables it.
                this.terrainTransition.dispose();
                for (const tile of this.detailGlobe.ourTiles) {
                    const p = this.detailGlobe.meshPrecision;
                    this.detailGlobe.applyElevationGrid(
                        tile,
                        new Array((p + 1) * (p + 1)).fill(0),
                        p,
                    );
                }
            }
            this.data.invalidate(false, buildings.checked);
            this.configureDistanceLayers();
        };
        terrain.addEventListener("change", reload);
        buildings.addEventListener("change", reload);
        exaggeration.addEventListener("change", reload);
        document
            .getElementById("retry")!
            .addEventListener("click", () => this.data.invalidate(false, buildings.checked));
        document.getElementById("roads")!.addEventListener("change", () => {
            const enabled = (
                document.getElementById("roads") as HTMLInputElement
            ).checked;
            const token = (
                document.getElementById("mapboxToken") as HTMLInputElement
            ).value.trim();
            if (enabled && !token) {
                this.message("Enter a Mapbox token for road geometry.");
                return;
            }
            if (enabled) {
                this.roads ??= new BuildingsVectorTile(this.detailGlobe);
                this.roads.accessToken = token;
                // One grouped road mesh per bounded job keeps its own material;
                // the generic tile merge also includes Overture building meshes.
                this.roads.doMerge = false;
                this.roads.maxLinesPerFeature = 128;
                this.roads.setOptimizationOptions({ freezeWorldMatrices: true, disablePicking: true, prioritizeRequestsByDistance: true });
                this.roads.buildingMaterial.diffuseColor.set(0.92, 0.57, 0.18);
                this.roads.buildingMeshTransform = (mesh) => {
                    this.layers.add(mesh, 7);
                };
                this.roads.buildingMeshFilter = mesh => {
                    return !this.roadOverlapsGoogle(mesh);
                };
            }
            this.data.options.features =
                enabled && this.roads ? [this.roads] : [];
            this.data.invalidate(true, enabled);
        });
        document.getElementById("landmarks")!.addEventListener("change", () => {
            if (
                !(document.getElementById("landmarks") as HTMLInputElement)
                    .checked
            ) {
                this.landmarks?.dispose();
                this.landmarkKey = "";
                this.refreshBuildingReplacements();
            }
        });
        const basemap = document.getElementById("basemap") as HTMLSelectElement;
        const tokenInput = document.getElementById("mapboxToken") as HTMLInputElement;
        let activeStyle = "osm";
        let pendingSatellite = false;
        const applyStyle = () => {
            if (basemap.value === "satellite" && !tokenInput.value.trim() && !this.satelliteSession) {
                pendingSatellite = true;
                basemap.value = activeStyle;
                document.getElementById("mapStyleStatus")!.textContent = this.googleKey
                    ? "Loading Google satellite imagery…" : "Add a Mapbox token or Google Maps key to enable satellite.";
                if (this.googleKey) void this.ensureSatelliteSession().then(() => {
                    if (!pendingSatellite) return;
                    basemap.value = "satellite";
                    applyStyle();
                }).catch(() => {
                    document.getElementById("mapStyleStatus")!.textContent = "Google satellite unavailable; add a Mapbox token to use satellite imagery.";
                });
                return;
            }
            pendingSatellite = false;
            activeStyle = basemap.value;
            document.getElementById("mapStyleStatus")!.textContent = "";
            this.terrainTransition.capture(this.detailGlobe, this.detailGlobe.zoom, undefined, undefined, true);
            for (const layer of this.distanceLayers)
                this.terrainTransition.capture(layer.globe, layer.globe.zoom, undefined, undefined, true);
            for (const globe of [this.baseGlobe, this.detailGlobe]) this.applyMapStyle(globe);
            this.baseGlobe.updateRaster(40.98, 0, 2);
            this.syncDistanceStyles();
            this.updateDistanceLayers(this.navigator.getView());
            this.navigator.refresh(true);
            this.updateGoogleCredits();
            document.getElementById("mapView")!.setAttribute("aria-pressed", String(activeStyle === "osm"));
            document.getElementById("satelliteView")!.setAttribute("aria-pressed", String(activeStyle === "satellite"));
        };
        basemap.addEventListener("change", applyStyle);
        for (const [id, style] of [["mapView", "osm"], ["satelliteView", "satellite"]]) {
            document.getElementById(id)!.addEventListener("click", () => {
                if (style === activeStyle) {
                    pendingSatellite = false;
                    document.getElementById("mapStyleStatus")!.textContent = "";
                    return;
                }
                basemap.value = style;
                applyStyle();
            });
        }
        tokenInput.addEventListener("change", () => {
            if ((pendingSatellite || activeStyle === "satellite") && tokenInput.value.trim()) {
                basemap.value = "satellite";
                applyStyle();
            }
        });
        document.getElementById("inspect")!.addEventListener("click", () => {
            if (this.inspecting) this.exitInspection();
            else this.orientView(60, 0);
        });
        for (const id of ["tilt", "heading"]) {
            document.getElementById(id)!.addEventListener("input", () => {
                const tilt = Number((document.getElementById("tilt") as HTMLInputElement).value);
                const heading = Number((document.getElementById("heading") as HTMLInputElement).value);
                this.orientView(tilt, heading);
            });
        }
        document.getElementById("tour")!.addEventListener("click", () => {
            if (this.tourTimer) {
                clearInterval(this.tourTimer);
                this.tourTimer = undefined;
                document.getElementById("tour")!.textContent = "Guided tour";
                return;
            }
            let i = 1;
            const next = () => {
                this.exitInspection();
                const place = LOCATIONS[i++ % LOCATIONS.length];
                this.navigator.flyTo(place.latitude, place.longitude, {
                    zoom: place.zoom,
                    durationMs: 1800,
                });
                this.message(place.name);
            };
            next();
            this.tourTimer = setInterval(next, 12000);
            document.getElementById("tour")!.textContent = "Stop tour";
        });
        document
            .getElementById("geojson")!
            .addEventListener("change", async (event) => {
                const file = (event.target as HTMLInputElement).files?.[0];
                if (!file) return;
                try {
                    const document = JSON.parse(
                        await file.text(),
                    ) as GeoJSON.topLevel;
                    if (
                        document.type !== "FeatureCollection" ||
                        !Array.isArray(document.features)
                    )
                        throw new Error("Expected a GeoJSON FeatureCollection");
                    const settings =
                        this.userSettings ??
                        (this.userSettings = new BuildingsVectorTile(
                            this.detailGlobe,
                        ));
                    settings.buildingMeshTransform = (mesh) => {
                        this.layers.add(mesh, 7);
                    };
                    const generator = new GeoJSON.GeoJSON(
                        this.detailGlobe,
                        this.scene,
                    );
                    for (const feature of document.features)
                        generator.generateSingleBuilding(
                            "User GeoJSON",
                            feature,
                            GeoJSON.detectProjection(document) ??
                                EPSG_Type.EPSG_4326,
                            this.detailGlobe.ourTiles[0],
                            false,
                            settings,
                        );
                    this.message(
                        `Loaded ${document.features.length} user features at their geographic coordinates.`,
                    );
                } catch (error) {
                    this.message(String(error));
                }
            });
    }

    private updateLandmarks(): void {
        const enabled = (document.getElementById("landmarks") as HTMLInputElement).checked;
        const token = (document.getElementById("mapboxToken") as HTMLInputElement).value.trim();
        if (!enabled || !token || this.detailGlobe.zoom < 14) {
            const hadModels = !!this.landmarks;
            this.landmarks?.dispose();
            this.landmarks = undefined;
            this.landmarkKey = "";
            if (hadModels) this.refreshBuildingReplacements();
            return;
        }
        if (this.landmarks && this.landmarks.accessToken !== token) {
            this.landmarks.dispose();
            this.landmarks = undefined;
            this.landmarkKey = "";
        }
        if (this.detailGlobe.pendingGeometryCount > 0 || this.data.stats.active > 0) return;
        // Landmark requests follow geography independently of the slower
        // footprint queue, including custom addresses and drag navigation.
        const landmarkGlobe = this.distanceLayers[3]?.globe.zoom >= 14
            ? this.distanceLayers[3].globe : this.detailGlobe;
        if (this.landmarks && this.landmarks.tileSet !== landmarkGlobe) {
            this.landmarks.dispose(); this.landmarks = undefined; this.landmarkKey = "";
        }
        const key = `${landmarkGlobe.zoom}/${landmarkGlobe.ourTileMath.lon_to_tile(landmarkGlobe.centerCoords.x, landmarkGlobe.zoom)}/${landmarkGlobe.ourTileMath.lat_to_tile(landmarkGlobe.centerCoords.y, landmarkGlobe.zoom)}/${landmarkGlobe.ourTiles.length}`;
        if (key === this.landmarkKey) return;
        if (performance.now() < this.landmarkRetryAt) return;
        this.landmarkKey = key;
        const provider = this.landmarks ??= new BuildingsMB(landmarkGlobe);
        provider.accessToken = token;
        void provider.generateBuildings().then(tiles => {
            if (provider !== this.landmarks || key !== this.landmarkKey) return;
            for (const tile of tiles)
                for (const mesh of tile.asset.meshes) {
                    mesh.computeWorldMatrix(true);
                    const location = landmarkGlobe.getSurfaceCoordinates(mesh.getBoundingInfo().boundingBox.centerWorld);
                    mesh.setEnabled(!this.googleCoversLocation(location.latitude, location.longitude));
                    this.layers.add(mesh, 7);
                    mesh.freezeWorldMatrix();
                    // These newly loaded landmark materials have no stale draw
                    // bindings. freeze() scans every mesh in the city, once per
                    // landmark, and can stall camera movement for hundreds of ms.
                    if (mesh.material) mesh.material.checkReadyOnlyOnce = true;
                    mesh.isPickable = false;
                }
            this.refreshBuildingReplacements();
        }).catch(() => {
            if (provider !== this.landmarks || key !== this.landmarkKey) return;
            this.landmarkKey = "";
            this.landmarkRetryAt = performance.now() + 15000;
            this.message("Landmark request failed; retrying shortly. Check the Mapbox token if this persists.");
        });
    }

    private onFinerOvertureCoverageChanged(globe: GlobeSet): void {
        if ([{ globe: this.detailGlobe, buildings: this.buildings }, ...this.distanceLayers]
            .some(tier => tier.buildings && tier.globe.zoom >= MIN_GLOBE_BUILDING_ZOOM
                && tier.globe.zoom < globe.zoom)) this.scheduleOvertureCoverageRefresh();
    }

    private scheduleOvertureCoverageRefresh(): void {
        if (this.overtureCoverageTimer !== undefined) return;
        // Coalesce batches completed in the same frame without delaying the
        // fallback-to-detail handoff beyond the next frame.
        this.overtureCoverageTimer = setTimeout(() => {
            this.overtureCoverageTimer = undefined;
            const tiers = [{ globe: this.detailGlobe, buildings: this.buildings }, ...this.distanceLayers]
                .filter((tier): tier is { globe: GlobeSet; buildings: BuildingsOverture } =>
                    !!tier.buildings && tier.globe.zoom >= MIN_GLOBE_BUILDING_ZOOM && tier.globe.zoom <= 14);
            const coverage = new Map<GlobeSet, OvertureTierCoverage>();
            for (const owner of tiers) {
                const finerTiers = tiers.filter(tier => tier.globe.zoom > owner.globe.zoom);
                if (!finerTiers.length) continue;
                const available = new OvertureTierCoverage();
                for (const finer of finerTiers) {
                    for (const tile of finer.globe.ourTiles) {
                        if (tile.buildingsResolvedKey !== tile.tileCoords.toString()) continue;
                        for (const mesh of tile.buildingBatches) {
                            if (mesh.isDisposed()) continue;
                            const ranges = (mesh.metadata as { overtureCoverage?: {
                                ranges: { id: string; south: number; west: number; north: number; east: number }[];
                            } } | undefined)?.overtureCoverage?.ranges ?? [];
                            for (const range of ranges) available.add(range);
                        }
                    }
                    for (const range of this.buildingTransition.retainedFootprints(finer.globe))
                        available.add(range);
                }
                coverage.set(owner.globe, available);
            }
            this.finerOvertureCoverage = coverage;
            for (const tier of tiers) if (coverage.has(tier.globe)) tier.buildings.updateBatchVisibility();
        }, 16);
    }

    private keepBuildingFeature(coordinates: unknown, owner: GlobeSet, height = 4): boolean {
        let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
        const stack: unknown[] = [coordinates];
        while (stack.length) {
            const part = stack.pop();
            if (!Array.isArray(part)) continue;
            if (typeof part[0] === "number" && typeof part[1] === "number") {
                west = Math.min(west, part[0]); east = Math.max(east, part[0]);
                south = Math.min(south, part[1]); north = Math.max(north, part[1]);
            } else for (const child of part) stack.push(child);
        }
        if (!Number.isFinite(west) || east - west > 180) return true;
        // Keep the coarse geometry even when a finer tile window overlaps.
        // Visibility changes only after the corresponding finer footprint is
        // built, so a quick move cannot expose an empty building tile.
        const point = owner.getSurfacePosition((south + north) / 2, (west + east) / 2);
        if (owner.zoom < 14 && this.scene.activeCamera) {
            const camera = this.scene.activeCamera;
            const metres = Math.max(height, (north - south) * 111320,
                (east - west) * 111320 * Math.cos((south + north) * Math.PI / 360));
            const distance = Math.max(1, Vector3.Distance(point, camera.globalPosition) / owner.metresToWorld);
            const pixels = metres / distance * this.engine.getRenderHeight() / (2 * Math.tan(camera.fov / 2));
            if (pixels < 1) return false;
        }
        return this.replacements.keepPoint(point, point, 20000 * owner.metresToWorld);
    }

    private updateLandscapeLOD(): void {
        const region = this.distanceLayers[1];
        if (!region || region.lodKey === region.key || region.data.stats.active > 0 || !region.globe.ourTiles.every(tile => tile.terrainLoaded)) return;
        const tile = region.globe.ourTiles[Math.floor(region.globe.ourTiles.length / 2)];
        const width = Vector3.Distance(region.globe.getTileSurfacePosition(tile.tileCoords, 0, 0.5), region.globe.getTileSurfacePosition(tile.tileCoords, 1, 0.5));
        const lod = landscapeTerrainLOD(region.globe.meshPrecision, width * 4);
        region.globe.setupTerrainLOD(lod.precisions, lod.distances, 10 * region.globe.metresToWorld);
        region.lodKey = region.key;
    }

    private roadOverlapsGoogle(mesh: import("@babylonjs/core/Meshes/mesh").Mesh): boolean {
        if (!this.googleTiles || this.googleFarHidden) return false;
        const bounds = mesh.getBoundingInfo().boundingBox;
        // A road tile can cross several Google model bounds. Testing only its
        // center leaves long lines painted over already loaded city imagery.
        for (const vertex of [bounds.centerWorld, ...bounds.vectorsWorld]) {
            const point = this.detailGlobe.getSurfaceCoordinates(vertex);
            if (this.googleTiles.coversLocation(point.latitude, point.longitude)) return true;
        }
        return false;
    }

    private googleCoversLocation(latitude: number, longitude: number): boolean {
        return !this.googleFarHidden && !!this.googleTiles?.coversLocation(latitude, longitude);
    }

    private googleCoversTile(globe: GlobeSet, tile: Tile): boolean {
        if (!this.googleTiles || this.googleFarHidden) return false;
        const { x, y, z } = tile.tileCoords;
        const math = globe.ourTileMath;
        return this.googleTiles.coversAreaCompletely(
            math.tile_to_lat(y + 1, z), math.tile_to_lon(x, z),
            math.tile_to_lat(y, z), math.tile_to_lon(x + 1, z));
    }

    private googleCoversFootprint(latitude: number, longitude: number,
        bounds?: { south: number; west: number; north: number; east: number }): boolean {
        if (this.googleCoversLocation(latitude, longitude)) return true;
        if (!bounds || !this.googleTiles || this.googleFarHidden) return false;
        return this.googleTiles.overlapsFootprint(bounds.south, bounds.west, bounds.north, bounds.east);
    }

    private refreshBuildingReplacements(): void {
        const coverageURLs = new Set(this.googleTiles?.loadedModelTiles.map(tile => tile.url) ?? []);
        const sameActiveGoogle = !!this.googleTiles && this.googleTiles === this.replacementCoverageProvider
            && !this.googleFarHidden && !this.replacementCoverageHidden;
        const coverageOnlyGrows = sameActiveGoogle
            && Array.from(this.replacementCoverageURLs).every(url => coverageURLs.has(url));
        const changedCoverageURLs = sameActiveGoogle ? [
            ...Array.from(coverageURLs).filter(url => !this.replacementCoverageURLs.has(url)),
            ...Array.from(this.replacementCoverageURLs).filter(url => !coverageURLs.has(url)),
        ] : undefined;
        this.replacementCoverageProvider = this.googleTiles;
        this.replacementCoverageURLs = coverageURLs;
        this.replacementCoverageHidden = this.googleFarHidden;
        const models = this.landmarks?.loadedModelTiles.flatMap(tile => tile.asset.meshes) ?? [];
        const landmarkSignature = models.map(mesh => `${mesh.uniqueId}:${mesh.isEnabled()}`).join(",");
        const landmarksChanged = this.replacementLandmarkSignature !== landmarkSignature;
        if (landmarksChanged) {
            this.replacementLandmarkSignature = landmarkSignature;
            this.replacements.setModels(models.filter((mesh): mesh is import("@babylonjs/core/Meshes/mesh").Mesh =>
                mesh.isEnabled() && mesh.getTotalVertices() > 0) as import("@babylonjs/core/Meshes/mesh").Mesh[]);
        }
        // Photorealistic imagery already contains streets. Keep road geometry
        // outside its coverage without repainting red lines over the models.
        if (this.roads) for (const tile of this.detailGlobe.ourTiles)
            for (const mesh of tile.getAllBuildingMeshes()) {
                if (coverageOnlyGrows && !mesh.isEnabled(false)) continue;
                const visible = !this.roadOverlapsGoogle(mesh);
                if (mesh.isEnabled(false) !== visible) mesh.setEnabled(visible);
            }
        // Convert landmark positions once per globe. Comparing every model to
        // every raster tile made a Google coverage update quadratic in practice.
        for (const entry of [{ globe: this.detailGlobe, buildings: this.buildings }, ...this.distanceLayers]) {
            if (!entry.buildings || entry.globe.zoom < MIN_GLOBE_BUILDING_ZOOM || entry.globe.zoom > 14) continue;
            entry.buildings.updateBatchVisibility(coverageOnlyGrows, changedCoverageURLs ? tile => {
                const math = entry.globe.ourTileMath;
                const z = tile.tileCoords.z;
                // Features at a vector tile edge can extend into its neighbors.
                // Include one tile of padding before skipping its visibility pass.
                return this.googleTiles!.coverageChangesIntersect(changedCoverageURLs,
                    math.tile_to_lat(tile.tileCoords.y + 2, z), math.tile_to_lon(tile.tileCoords.x - 1, z),
                    math.tile_to_lat(tile.tileCoords.y - 1, z), math.tile_to_lon(tile.tileCoords.x + 2, z));
            } : undefined);
            // Batched Overture geometry changes its index mask in place when
            // Google coverage changes. Rebuilding landmark signatures and
            // resubmitting every tile is only needed when landmark models change.
            if (entry.buildings.batchGeometry && !landmarksChanged) continue;
            const positions = models.map(mesh => {
                const point = entry.globe.getSurfaceCoordinates(mesh.getBoundingInfo().boundingBox.centerWorld);
                return { mesh, latitude: point.latitude, longitude: point.longitude };
            });
            const math = entry.globe.ourTileMath;
            const modelsByTile = new Map<string, string[]>();
            for (const { mesh, latitude, longitude } of positions) {
                const key = `${math.lon_to_tile(longitude, entry.globe.zoom)}/${math.lat_to_tile(latitude, entry.globe.zoom)}`;
                const signatures = modelsByTile.get(key) ?? [];
                signatures.push(`${mesh.uniqueId}:${mesh.isEnabled()}`);
                modelsByTile.set(key, signatures);
            }
            for (const tile of entry.globe.ourTiles) {
                const coverage = entry.buildings.batchGeometry ? "batched" :
                    [0, 0.5, 1].flatMap(x => [0, 0.5, 1].map(y => this.googleCoversLocation(
                        math.tile_to_lat(tile.tileCoords.y + y, tile.tileCoords.z),
                        math.tile_to_lon(tile.tileCoords.x + x, tile.tileCoords.z)) ? "1" : "0")).join("");
                const localModels = modelsByTile.get(`${tile.tileCoords.x}/${tile.tileCoords.y}`)?.join(",") ?? "";
                const signature = `${tile.tileCoords}/${entry.buildings.batchGeometry ? "batched" : coverage}/${localModels}`;
                const previous = this.replacementSignatures.get(tile);
                if (previous === signature) continue;
                this.replacementSignatures.set(tile, signature);
                // The batched provider applies Google coverage by changing its
                // index mask. Its initial load is already owned by the globe
                // data controller; cancelling and resubmitting every tile here
                // can duplicate hundreds of Overture jobs during startup.
                if (entry.buildings.batchGeometry && previous === undefined
                    && (!models.length || !tile.buildingBatches.length && !tile.buildings.length)) continue;
                entry.buildings.cancelPendingRequests(tile);
                if (!entry.buildings.batchGeometry) tile.deleteBuildings();
                if ((document.getElementById("buildings") as HTMLInputElement).checked) entry.buildings.SubmitLoadTileRequest(tile);
            }
        }
    }

    private setupLocationControls(): void {
        const form = document.getElementById("locationForm") as HTMLFormElement;
        const preset = document.getElementById(
            "locationPreset",
        ) as HTMLSelectElement;
        const latitude = document.getElementById(
            "latitude",
        ) as HTMLInputElement;
        const longitude = document.getElementById(
            "longitude",
        ) as HTMLInputElement;
        const zoomIn = document.getElementById("zoomIn") as HTMLButtonElement;
        const zoomOut = document.getElementById("zoomOut") as HTMLButtonElement;
        const home = document.getElementById("home") as HTMLButtonElement;
        const readout = document.getElementById(
            "viewReadout",
        ) as HTMLDivElement;

        LOCATIONS.forEach((location, index) => {
            const option = document.createElement("option");
            option.value = String(index);
            option.textContent = location.name;
            preset.append(option);
        });

        latitude.value = String(HOME_VIEW.latitude);
        longitude.value = String(HOME_VIEW.longitude);

        preset.addEventListener("change", () => {
            this.framePacing.reset();
            this.exitInspection();
            const location = LOCATIONS[Number(preset.value)];
            if (location.google !== undefined) {
                (document.getElementById("googleTiles") as HTMLInputElement).checked = location.google;
            }
            latitude.value = String(location.latitude);
            longitude.value = String(location.longitude);
            if (location.heading !== undefined) {
                this.navigator.setView(location.latitude, location.longitude, { zoom: location.zoom });
                this.orientView(location.tilt ?? 80, location.heading, location.eyeHeight ?? 0, location.distance);
            } else this.navigator.flyTo(location.latitude, location.longitude, {
                zoom: location.zoom,
                durationMs: 1400,
            });
            const basemap = document.getElementById("basemap") as HTMLSelectElement;
            const style = location.basemap ?? "osm";
            if (basemap.value !== style) {
                basemap.value = style;
                basemap.dispatchEvent(new Event("change"));
            }
            this.scheduleGoogleTiles(true);
        });

        form.addEventListener("submit", (event) => {
            event.preventDefault();
            this.exitInspection();
            this.navigator.flyTo(
                Number(latitude.value),
                Number(longitude.value),
                {
                    zoom: Math.max(8, this.navigator.getView().zoom),
                    durationMs: 1200,
                },
            );
        });

        zoomIn.addEventListener("click", () => this.changeZoom(1));
        zoomOut.addEventListener("click", () => this.changeZoom(-1));
        home.addEventListener("click", () => {
            this.exitInspection();
            preset.value = "0";
            latitude.value = String(HOME_VIEW.latitude);
            longitude.value = String(HOME_VIEW.longitude);
            this.navigator.flyTo(HOME_VIEW.latitude, HOME_VIEW.longitude, {
                zoom: HOME_VIEW.zoom,
                durationMs: 1200,
            });
        });

        this.navigator.onBeforeRasterUpdateObservable.add(view => {
            this.terrainTransition.capture(this.detailGlobe, view.zoom, view.latitude, view.longitude);
            this.buildingTransition.capture(this.detailGlobe, view.zoom, view.latitude, view.longitude);
        });
        this.navigator.onViewChangedObservable.add((view) => {
            const precision = view.zoom < 5 ? 16 : 64;
            if (this.detailGlobe.meshPrecision !== precision) {
                this.terrainTransition.capture(this.detailGlobe, view.zoom, view.latitude, view.longitude);
                this.buildingTransition.capture(this.detailGlobe, view.zoom, view.latitude, view.longitude);
                this.detailGlobe.createGeometry(
                    new Vector2(5, 5),
                    20,
                    precision,
                );
                for (const tile of this.detailGlobe.ourTiles)
                    this.registerTerrain(tile.mesh, 6);
                // createGeometry clears raster setup. Restore coordinates in
                // this callback before Google selection reads the tile window.
                this.detailGlobe.updateRaster(view.latitude, view.longitude, view.zoom);
                this.data.invalidate(false, (document.getElementById("buildings") as HTMLInputElement).checked);
            }
            this.updateDistanceLayers(view);
            const detailWindow = this.detailGlobe.ourTiles[0]?.tileCoords.toString() ?? "";
            if (detailWindow !== this.detailBuildingWindowKey) {
                this.detailBuildingWindowKey = detailWindow;
                this.onFinerOvertureCoverageChanged(this.detailGlobe);
            }
            this.updateReadout(readout, view);
            this.scheduleGoogleTiles();
        });
        const initialView = this.navigator.getView();
        this.updateDistanceLayers(initialView);
        this.updateReadout(readout, initialView);
    }

    private setPhotorealisticActive(active: boolean): void {
        if (this.photorealisticActive === active) return;
        this.photorealisticActive = active;
        const buildings = (document.getElementById("buildings") as HTMLInputElement).checked;
        this.data.options.buildings = buildings ? this.buildings : undefined;
        this.configureDistanceLayers();
        this.landmarkKey = "";
        this.refreshBuildingReplacements();
    }

    private googleStatus(message: string): void {
        document.getElementById("googleStatus")!.textContent = message;
    }

    private async readGoogleKey(): Promise<void> {
        try {
            const response = await fetch("google-key.txt", { cache: "no-store" });
            this.googleKey = response.ok ? (await response.text()).trim() : "";
        } catch { this.googleKey = ""; }
        this.scheduleGoogleTiles(true);
        if (this.googleKey && !(document.getElementById("mapboxToken") as HTMLInputElement).value.trim()) {
            void this.ensureSatelliteSession().then(() => {
                const basemap = document.getElementById("basemap") as HTMLSelectElement;
                if (basemap.value === "osm" && HOME_VIEW.basemap === "satellite") {
                    basemap.value = "satellite";
                    basemap.dispatchEvent(new Event("change"));
                }
            }).catch(() => { /* Google 3D can still load without 2D satellite access. */ });
        }
    }

    private ensureSatelliteSession(): Promise<GoogleSatelliteSession> {
        if (this.satelliteSession && this.satelliteSession.expiry * 1000 > Date.now() + 60000)
            return Promise.resolve(this.satelliteSession);
        if (!this.googleKey) return Promise.reject(new Error("Google Maps key unavailable"));
        return this.satelliteSessionPending ??= RasterGoogleSatellite.openSession(this.googleKey)
            .then(session => this.satelliteSession = session)
            .finally(() => { this.satelliteSessionPending = undefined; });
    }

    private updateGoogleCredits(): void {
        const satellite = (document.getElementById("basemap") as HTMLSelectElement).value === "satellite"
            && !!this.satelliteSession && !(document.getElementById("mapboxToken") as HTMLInputElement).value.trim();
        const photorealistic = !this.googleFarHidden && !!this.googleTiles?.loadedModelTiles.length;
        const sources = [...(photorealistic ? this.googleTiles?.getAttributions() ?? [] : [])];
        if (satellite && this.satelliteCopyright) sources.push(this.satelliteCopyright);
        document.getElementById("googleSources")!.textContent = [...new Set(sources)].join("; ");
        document.getElementById("googleCredits")!.hidden = !satellite && !photorealistic;
    }

    private updateSatelliteAttribution(view: GlobeView): void {
        if (!this.satelliteSession || (document.getElementById("basemap") as HTMLSelectElement).value !== "satellite"
            || (document.getElementById("mapboxToken") as HTMLInputElement).value.trim()) return;
        if (Date.now() < this.satelliteAttributionRetryAt) return;
        const zoom = Math.min(22, Math.max(0, view.zoom));
        const key = `${Math.round(view.latitude * 20)}/${Math.round(view.longitude * 20)}/${zoom}`;
        if (key === this.satelliteAttributionKey) return;
        this.satelliteAttributionKey = key;
        const latitudeRadius = 15 * 1609.344 / 111320;
        const longitudeRadius = latitudeRadius / Math.max(0.05, Math.cos(view.latitude * Math.PI / 180));
        const wrap = (longitude: number) => ((longitude + 180) % 360 + 360) % 360 - 180;
        const bounds = {
            north: Math.min(89.9, view.latitude + latitudeRadius), south: Math.max(-89.9, view.latitude - latitudeRadius),
            east: wrap(view.longitude + longitudeRadius), west: wrap(view.longitude - longitudeRadius),
        };
        void RasterGoogleSatellite.viewportCopyright(this.googleKey, this.satelliteSession, bounds, zoom)
            .then(copyright => {
                if (this.satelliteAttributionKey !== key) return;
                this.satelliteCopyright = copyright;
                this.updateGoogleCredits();
            }).catch(() => {
                if (this.satelliteAttributionKey === key) {
                    this.satelliteAttributionKey = "";
                    this.satelliteAttributionRetryAt = Date.now() + 5000;
                }
            });
    }

    private scheduleGoogleTiles(force = false): void {
        const view = this.navigator.getView();
        const enabled = (document.getElementById("googleTiles") as HTMLInputElement).checked;
        const quality = (document.getElementById("googleQuality") as HTMLSelectElement).value;
        const math = this.detailGlobe.ourTileMath;
        // Small distance changes can reveal new detail before crossing a raster zoom level.
        const direction = this.scene.activeCamera!.getForwardRay().direction;
        const bearing = [direction.x, direction.y, direction.z].map(value => Math.round(value * 50)).join("/");
        const selectionBearing = [direction.x, direction.y, direction.z].map(value => Math.round(value * 12)).join("/");
        const distanceStep = Math.round(Math.log(Math.max(view.altitude, 1e-9)) / Math.log(1.05));
        const positionStep = Math.max(2, Math.min(150, view.altitude / this.detailGlobe.metresToWorld * 0.08));
        const positionKey = `${Math.round(view.latitude * 111320 / positionStep)}/${Math.round(view.longitude * 111320 * Math.cos(view.latitude * Math.PI / 180) / positionStep)}`;
        // One zoom level of hysteresis keeps a far camera turn from repeatedly
        // swapping satellite and photogrammetry at the same LOD boundary.
        const showDetail = view.zoom >= GOOGLE_DETAIL_SHOW_ZOOM
            || (view.zoom >= GOOGLE_DETAIL_HIDE_ZOOM && !!this.googleTiles && !this.googleFarHidden);
        const key = enabled && showDetail
            ? `${math.lon_to_tile(view.longitude, view.zoom)}/${math.lat_to_tile(view.latitude, view.zoom)}/${view.zoom}/${quality}/${distanceStep}/${positionKey}` : "";
        const priorityKey = key ? `${bearing}/${distanceStep}/${positionKey}` : "";
        if (priorityKey !== this.googlePriorityKey) {
            this.googlePriorityKey = priorityKey;
            if (key) this.googleTiles?.reprioritizeRequests();
        }
        if (key && selectionBearing !== this.googleSelectionBearing) {
            this.googleSelectionBearing = selectionBearing;
            this.googleTurnPending = true;
        }
        if (key && this.googleTurnPending && !this.googleLoading && !this.googleTimer && this.googleTiles) {
            this.googleTurnPending = false;
            const quality = this.googleTiles.measureVisibleQuality();
            if (!quality.visibleTiles || quality.underDetailedTiles || quality.missingVisibleTiles) force = true;
        }
        if (key && this.googleTurnPending && this.googleLoading && !this.googleTimer
            && this.googleTiles?.tileset && !this.googleTiles.selectingFrontier
            && performance.now() - this.googlePassStartedAt >= 100) {
            const quality = this.googleTiles.measureVisibleQuality();
            if (!quality.visibleTiles || quality.underDetailedTiles || quality.missingVisibleTiles) {
                this.googleTiles.cancelPendingLoad(true);
                this.googleTurnPending = false;
                this.canvas.dataset.googleTurnPreemptions = String(
                    Number(this.canvas.dataset.googleTurnPreemptions ?? 0) + 1);
                force = true;
            }
        }
        if (!force && key === this.googleViewKey) return;
        this.googleViewKey = key;
        if (!force && key && this.googleTimer) return;
        if (!force && key && this.googleLoading) {
            const center = this.googleTiles?.selectedCoverageCenter;
            if (!center || performance.now() - this.googlePassStartedAt < 500) return;
            // The live frontier reseeds at 250 m and reprioritizes its queue
            // on every turn. Cancelling it at 500 m repeatedly starves Shift
            // traversal of both nearby detail and full-radius completion.
            if (this.googleTiles?.selectingFrontier) return;
            const selected = this.detailGlobe.getSurfacePosition(center.latitude, center.longitude);
            const current = this.detailGlobe.getSurfacePosition(view.latitude, view.longitude);
            // The active frontier follows the camera inside one pass. Restart
            // only if a pass has moved on to waiting for old replacement jobs.
            if (Vector3.Distance(selected, current) / this.detailGlobe.metresToWorld < 500) return;
            // A pass waiting on old replacement groups cannot reseed. Retain
            // its renderable tiles and reuse its in-flight models in a new pass.
            this.googleTiles?.cancelPendingLoad(true);
            this.canvas.dataset.googleMovementPreemptions = String(
                Number(this.canvas.dataset.googleMovementPreemptions ?? 0) + 1);
        }
        clearTimeout(this.googleTimer);
        this.googleTimer = undefined;
        const generation = ++this.googleGeneration;
        if (!key) {
            this.googleSelectionBearing = "";
            this.googleTurnPending = false;
            this.googleLoading = false;
            const retained = enabled && !showDetail && !!this.googleTiles;
            if (retained && this.googleTiles) {
                this.googleTiles.cancelPendingLoad();
                for (const tile of this.googleTiles.loadedModelTiles) tile.root.setEnabled(false);
                this.googleFarHidden = true;
            } else {
                this.googleTiles?.dispose(); this.googleTiles = undefined;
                this.googleFarHidden = false;
            }
            this.updateGoogleCredits();
            this.canvas.dataset.googleTiles = "0";
            this.setPhotorealisticActive(false);
            this.googleStatus(enabled ? retained ? "Google 3D · retained for closer views"
                : "Google 3D · zoom in to street scale" : "Google 3D off");
            return;
        }
        if (this.googleFarHidden) {
            this.googleFarHidden = false;
            for (const tile of this.googleTiles?.loadedModelTiles ?? []) tile.root.setEnabled(true);
            this.refreshBuildingReplacements();
        }
        if (!this.googleKey) {
            this.googleLoading = false;
            this.googleStatus("Google 3D unavailable · local key missing; toggle to retry");
            return;
        }
        this.googleTimer = setTimeout(async () => {
            this.googleTimer = undefined;
            if (generation !== this.googleGeneration) return;
            const { meanSeaLevel } = await import("egm96-universal");
            if (generation !== this.googleGeneration) return;
            const currentView = this.navigator.getView();
            const provider = this.googleTiles ??= new Google3DTiles(this.detailGlobe, {
                apiKey: this.googleKey,
                origin: { latitude: currentView.latitude, longitude: currentView.longitude },
                maxTiles: 2048,
                maximumDisplayGeometricError: 33,
                maximumInitialErrorRatio: 2,
                cullToCamera: true,
                fullRadiusDemand: true,
                referenceImageHeight: 2160,
                referenceFovY: 0.8,
                coverageRadius: 15 * 1609.344,
                heightOffset: -meanSeaLevel(currentView.latitude, currentView.longitude),
            });
            provider.maxDepth = quality === "auto" || quality === "32" ? 64 : Number(quality);
            // Select the area around the viewer first. A city-wide required
            // region sent thousands of hierarchy requests before nearby models
            // could appear, even when most of Manhattan was off screen.
            provider.coverageRadius = 15 * 1609.344;
            provider.coverageRegion = undefined;
            const requestedError = new URLSearchParams(location.search).get("sse");
            const screenError = requestedError === null ? NaN : Number(requestedError);
            const targetScreenError = Number.isFinite(screenError) && screenError >= 0.5
                ? screenError : quality === "20" ? 2 : quality === "auto" ? 1 : 0.75;
            provider.maximumScreenSpaceError = targetScreenError;
            provider.maximumDisplayGeometricError = 33;
            provider.maximumInitialErrorRatio = 2;
            provider.maxTiles = 2048;
            provider.maxPendingHierarchy = 32;
            this.googleLoading = true;
            this.googleTurnPending = false;
            this.googlePassStartedAt = performance.now();
            this.googleStatus("Google 3D · streaming visible detail…");
            const started = performance.now();
            try {
                this.canvas.dataset.googleSelectionRadius = String(Math.round(provider.coverageRadius!));
                this.canvas.dataset.googleSelectionCenter = `${currentView.latitude.toFixed(5)},${currentView.longitude.toFixed(5)}`;
                this.googleSelectionCenter = { latitude: currentView.latitude, longitude: currentView.longitude };
                const loaded = await provider.load();
                if (generation !== this.googleGeneration) return;
                const selectedCenter = provider.selectedCoverageCenter;
                if (selectedCenter) {
                    this.googleSelectionCenter = selectedCenter;
                    this.canvas.dataset.googleSelectionCenter = `${selectedCenter.latitude.toFixed(5)},${selectedCenter.longitude.toFixed(5)}`;
                }
                this.setPhotorealisticActive(loaded.length > 0);
                this.canvas.dataset.googleTiles = String(loaded.length);
                this.canvas.dataset.googleLoadMs = String(Math.round(performance.now() - started));
                this.canvas.dataset.googleRootMs = String(Math.round(provider.stats.rootMs));
                this.canvas.dataset.googleFrontierTraversalMs = String(Math.round(provider.stats.frontierTraversalMs));
                this.canvas.dataset.googleFrontierBudgetScanMs = String(Math.round(provider.stats.frontierBudgetScanMs));
                this.canvas.dataset.googleFrontierBudgetScanCount = String(provider.stats.frontierBudgetScanCount);
                this.canvas.dataset.googleFrontierYieldCount = String(provider.stats.frontierYieldCount);
                this.canvas.dataset.googleFrontierCommitMs = String(Math.round(provider.stats.frontierCommitMs));
                this.canvas.dataset.googleReplacementMs = String(Math.round(provider.stats.replacementMs));
                this.canvas.dataset.googleModelWaitMs = String(Math.round(provider.stats.modelWaitMs));
                this.canvas.dataset.googlePeakHierarchyActive = String(provider.stats.peakHierarchyActive);
                this.canvas.dataset.googlePeakModelActive = String(provider.stats.peakModelActive);
                this.canvas.dataset.googlePeakNetworkActive = String(provider.stats.peakNetworkActive);
                this.canvas.dataset.googleFirstLoadMs ??= this.canvas.dataset.googleLoadMs;
                this.canvas.dataset.googleFirstLoadTiles ??= String(loaded.length);
                this.canvas.dataset.googleFirstRootMs ??= this.canvas.dataset.googleRootMs;
                this.canvas.dataset.googleFirstFrontierTraversalMs ??= this.canvas.dataset.googleFrontierTraversalMs;
                this.canvas.dataset.googleFirstFrontierCommitMs ??= this.canvas.dataset.googleFrontierCommitMs;
                this.canvas.dataset.googleFirstReplacementMs ??= this.canvas.dataset.googleReplacementMs;
                this.canvas.dataset.googleFirstModelWaitMs ??= this.canvas.dataset.googleModelWaitMs;
                this.canvas.dataset.googleFirstDetailLimited ??= String(provider.stats.detailLimitedTiles);
                this.canvas.dataset.googleFirstSourceLimited ??= String(provider.stats.sourceLimitedTiles);
                this.canvas.dataset.googleVisibleDetailLimited = String(provider.stats.visibleDetailLimitedTiles);
                this.canvas.dataset.googleOffscreenDetailLimited = String(provider.stats.offscreenDetailLimitedTiles);
                this.canvas.dataset.googleVisibleSourceLimited = String(provider.stats.visibleSourceLimitedTiles);
                this.canvas.dataset.googleOffscreenSourceLimited = String(provider.stats.offscreenSourceLimitedTiles);
                const limited = provider.stats.detailLimitedTiles + provider.stats.sourceLimitedTiles;
                this.canvas.dataset.googleFullRadiusQuality = limited ? "known-incomplete" : "unverified";
                this.canvas.dataset.googleForegroundLoads = String(Number(this.canvas.dataset.googleForegroundLoads ?? 0) + 1);
                this.updateGoogleCredits();
                this.googleStatus(loaded.length ? `Google 3D · ${loaded.length} tiles${limited
                    ? ` · ${provider.stats.detailLimitedTiles} budget-limited / ${provider.stats.sourceLimitedTiles} source-limited`
                    : " · full-radius quality unverified"}` : "Google 3D · no coverage here");
            } catch (error) {
                const reason = (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, "[request]");
                console.warn("Google 3D loading failed:", reason);
                if (generation === this.googleGeneration) this.googleStatus(`Google 3D unavailable · ${reason}`);
            } finally {
                if (generation === this.googleGeneration) {
                    this.googleLoading = false;
                    if (this.googleViewKey !== key || this.googleTurnPending)
                        this.scheduleGoogleTiles(this.googleViewKey !== key);
                }
            }
        }, 35);
    }

    private updateDistanceLayers(view: GlobeView): void {
        this.updateSatelliteAttribution(view);
        if (view.zoom < 8 && !this.distanceLayers.length) return;
        const detailed15MileRadius = (document.getElementById("googleTiles") as HTMLInputElement).checked;
        const plans = globeLODPlan(view.zoom, detailed15MileRadius);
        if (!this.distanceLayers.length) {
            // Construct near tiers first so their scene observers request
            // imagery and elevation before the much larger horizon windows.
            for (const plan of [...plans].reverse()) {
                const globe = new GlobeSet(this.scene, this.engine, {
                    radius: GLOBE_RADIUS, backingSurface: false, attribution: false, geometryBudgetMs: 0.5,
                });
                globe.setOptimizationOptions({ freezeTileWorldMatrices: true, disableTilePicking: true, disableTileCollisions: true });
                globe.rasterConcurrency = detailed15MileRadius && plan.group === 2 ? 8
                    : plan.group >= 4 ? 4 : 2;
                globe.setRasterProvider(new RasterOSM(globe));
                globe.createGeometry(new Vector2(plan.size, plan.size), 20, plan.precision);
                for (const tile of globe.ourTiles) this.registerTerrain(tile.mesh, plan.group);
                const data = new GlobeDataController(globe, { elevation: this.elevation.load,
                    concurrency: detailed15MileRadius && plan.group === 2 ? 8
                        : plan.group === 5 ? 6 : plan.group >= 3 ? 4 : 1,
                    minTerrainZoom: 5, prioritizeVisible: true,
                    minBuildingZoom: MIN_GLOBE_BUILDING_ZOOM, maxBuildingZoom: 14 });
                this.distanceLayers.unshift({ globe, data, key: "" });
            }
            this.configureDistanceLayers();
            this.syncDistanceStyles();
        }
        this.distanceLayers.forEach((layer, index) => {
            const plan = plans[index];
            layer.globe.rasterConcurrency = detailed15MileRadius && plan.group === 2 ? 8
                : plan.group >= 4 ? 4 : 2;
            layer.data.options.concurrency = detailed15MileRadius && plan.group === 2 ? 8
                : plan.group === 5 ? 6 : plan.group >= 3 ? 4 : 1;
            if (layer.buildings) layer.buildings.loadConcurrency = detailed15MileRadius && plan.group === 2 ? 12 : 6;
            // At global zooms use a small valid world window rather than repeating tiles.
            const size = view.zoom < 8 ? 1 : Math.min(plan.size, 2 ** plan.zoom);
            if (layer.globe.ourTiles.length !== size * size) {
                this.terrainTransition.capture(layer.globe, plan.zoom, view.latitude, view.longitude, true);
                this.buildingTransition.capture(layer.globe, plan.zoom, view.latitude, view.longitude, true);
                layer.globe.createGeometry(new Vector2(size, size), 20, plan.precision);
                for (const tile of layer.globe.ourTiles) this.registerTerrain(tile.mesh, plan.group);
                layer.key = "";
                layer.visible = undefined;
                layer.data.invalidate(false, (document.getElementById("buildings") as HTMLInputElement).checked);
            }
            const visible = view.zoom >= 8;
            if (layer.visible !== visible) {
                this.terrainBatcher.invalidate();
                for (const tile of layer.globe.ourTiles) tile.mesh.isVisible = visible;
                layer.visible = visible;
            }
            layer.globe.ourAttribution.advancedTexture.rootContainer.isVisible = false;
            const math = layer.globe.ourTileMath;
            const tileX = math.lon_to_tile(view.longitude, plan.zoom);
            const tileY = math.lat_to_tile(Math.max(-85, Math.min(85, view.latitude)), plan.zoom);
            const previous = layer.key.split("/").map(Number);
            const deltaX = Math.abs(tileX - previous[1]);
            const wrap = 2 ** plan.zoom;
            // Recenter the regional window on every tile crossing so Shift
            // movement keeps the full 15-mile disk inside its ready coverage.
            const slack = detailed15MileRadius && plan.group === 2 ? 0 : 1;
            if (previous[0] === plan.zoom && Math.min(deltaX, wrap - deltaX) <= slack
                && Math.abs(tileY - previous[2]) <= slack) return;
            const key = `${plan.zoom}/${tileX}/${tileY}`;
            this.terrainTransition.capture(layer.globe, plan.zoom, view.latitude, view.longitude);
            this.buildingTransition.capture(layer.globe, plan.zoom, view.latitude, view.longitude);
            layer.key = key;
            layer.globe.updateRaster(view.latitude, view.longitude, plan.zoom);
            if (plan.zoom <= 14) this.onFinerOvertureCoverageChanged(layer.globe);
        });
    }

    private applyMapStyle(globe: GlobeSet): void {
        const style = (document.getElementById("basemap") as HTMLSelectElement).value;
        const token = (document.getElementById("mapboxToken") as HTMLInputElement).value.trim();
        if (style === "gebco") globe.setRasterProvider(new RasterGEBCO(globe));
        else if (style === "satellite" && token) {
            const raster = new RasterMB(globe);
            raster.accessToken = token;
            raster.doResBoost = globe === this.detailGlobe
                || globe === this.distanceLayers[this.distanceLayers.length - 1]?.globe;
            globe.setRasterProvider(raster);
        } else if (style === "satellite" && this.satelliteSession)
            globe.setRasterProvider(new RasterGoogleSatellite(globe, this.googleKey, this.satelliteSession));
        else globe.setRasterProvider(new RasterOSM(globe));
    }

    private syncDistanceStyles(): void {
        for (const layer of this.distanceLayers) {
            this.applyMapStyle(layer.globe);
            layer.key = "";
        }
    }

    private configureDistanceLayers(): void {
        const terrain = (document.getElementById("terrain") as HTMLInputElement).checked;
        const buildings = (document.getElementById("buildings") as HTMLInputElement).checked;
        const exaggeration = Number((document.getElementById("exaggeration") as HTMLInputElement).value);
        this.distanceLayers.forEach((layer, index) => {
            if (this.overtureURL && !layer.buildings) {
                layer.buildings = new BuildingsOverture(layer.globe, this.overtureURL);
                layer.buildings.doMerge = true;
                layer.buildings.batchGeometry = true;
                layer.buildings.batchVisibilityFilter = (lat, lon, bounds) =>
                    !this.googleCoversFootprint(lat, lon, bounds)
                    && !this.finerOvertureCoverage.get(layer.globe)?.covers(bounds);
                layer.buildings.onTileResolved = () => this.onFinerOvertureCoverageChanged(layer.globe);
                layer.buildings.tileCoverageFilter = tile => this.googleCoversTile(layer.globe, tile);
                layer.buildings.loadConcurrency = (document.getElementById("googleTiles") as HTMLInputElement).checked
                    && index === 1 ? 12 : 6;
                layer.buildings.setOptimizationOptions({ freezeWorldMatrices: true, disablePicking: true, prioritizeRequestsByDistance: true });
                layer.buildings.buildingFeatureFilter = feature => this.keepBuildingFeature(feature.geometry?.coordinates, layer.globe, Number(feature.properties?.height) || 4);
                layer.buildings.buildingsCreatedPerFrame = 64;
                layer.buildings.creationTimeBudgetMs = 2;
                layer.buildings.buildingMeshTransform = mesh => { this.layers.add(mesh, 7); };
            }
            const terrainChanged = layer.data.options.elevation !== (terrain ? this.elevation.load : undefined)
                || layer.data.options.exaggeration !== exaggeration;
            const buildingsChanged = layer.data.options.buildings !== (buildings ? layer.buildings : undefined);
            layer.data.options.buildings = buildings ? layer.buildings : undefined;
            layer.data.options.elevation = terrain ? this.elevation.load : undefined;
            layer.data.options.exaggeration = exaggeration;
            layer.lodKey = undefined;
            if (!terrain) for (const tile of layer.globe.ourTiles) {
                if (layer.globe.isTileGeometryReady(tile)) layer.globe.applyElevationGrid(tile, new Array((layer.globe.meshPrecision + 1) ** 2).fill(0), layer.globe.meshPrecision);
            }
            if (terrainChanged || buildingsChanged) layer.data.invalidate(!terrainChanged, buildings);
        });
    }

    private exitInspection(): void {
        if (!this.inspecting) return;
        const view = this.navigator.getView();
        this.navigator.setViewSource();
        this.navigator.setView(view.latitude, view.longitude, { altitude: view.altitude });
        this.inspecting.dispose();
        this.inspecting = undefined;
        this.scene.activeCamera = this.camera;
        this.camera.attachControl(this.canvas, true);
        document.getElementById("inspect")!.textContent = "Tilt view";
        this.syncOrientationControls(0, 0);
    }

    private inspectionBasis() {
        const view = this.inspecting ? this.detailGlobe.getSurfaceCoordinates(this.inspecting.position) : this.navigator.getView();
        const up = this.detailGlobe.getSurfaceNormal(view.latitude, view.longitude);
        const longitude = view.longitude * Math.PI / 180;
        const east = new Vector3(-Math.cos(longitude), 0, -Math.sin(longitude));
        const north = Vector3.Cross(east, up).normalize();
        return { up, east, north };
    }

    private orientView(tilt: number, heading: number, targetHeightMetres = 0, distanceMetres?: number): void {
        const view = this.navigator.getView();
        const preserveEye = this.inspecting?.position.clone();
        const { up, east, north } = this.inspectionBasis();
        if (!this.inspecting) {
            if (this.tourTimer) {
                clearInterval(this.tourTimer);
                this.tourTimer = undefined;
                document.getElementById("tour")!.textContent = "Guided tour";
            }
            // Stop any flight at the place the user is currently looking at.
            this.navigator.setView(view.latitude, view.longitude, { altitude: view.altitude });
            const target = this.detailGlobe.getSurfacePosition(view.latitude, view.longitude,
                this.detailGlobe.sampleElevation(view.latitude, view.longitude) + targetHeightMetres * this.detailGlobe.metresToWorld);
            this.camera.detachControl();
            const camera = new ArcRotateCamera("local inspection", 0, 1, distanceMetres ? distanceMetres * this.detailGlobe.metresToWorld : view.altitude, target, this.scene);
            camera.upVector = up;
            camera.lowerBetaLimit = 0.001;
            camera.upperBetaLimit = Math.PI - 0.001;
            camera.minZ = Math.max(0.0000001, view.altitude * 0.0001);
            camera.lowerRadiusLimit = Math.max(0.00001, view.altitude / 100);
            camera.upperRadiusLimit = view.altitude * 8;
            camera.wheelDeltaPercentage = 0.03;
            camera.panningSensibility = 500 / camera.radius;
            camera.inertia = 0.65;
            camera.angularSensibilityX = camera.angularSensibilityY = 1500;
            // Local exploration uses translation and looking, never an orbit pivot.
            camera.inputs.clear();
            camera.onAfterCheckInputsObservable.add(() => this.keepInspectionAboveGround(camera));
            this.scene.activeCamera = camera;
            this.inspecting = camera;
            this.navigator.setViewSource(camera);
            document.getElementById("inspect")!.textContent = "Top down";
        }
        const camera = this.inspecting;
        const pitch = Math.max(0.001, tilt * Math.PI / 180);
        const bearing = heading * Math.PI / 180;
        const offset = up.scale(Math.cos(pitch))
            .subtract(north.scale(Math.sin(pitch) * Math.cos(bearing)))
            .subtract(east.scale(Math.sin(pitch) * Math.sin(bearing)));
        camera.inertialAlphaOffset = camera.inertialBetaOffset = 0;
        if (preserveEye) {
            lookFromEye(camera, up, offset);
        } else camera.setPosition(camera.getTarget().add(offset.scale(camera.radius)));
        this.keepInspectionAboveGround(camera);
        this.syncOrientationControls(tilt, heading);
    }

    private keepInspectionAboveGround(camera: ArcRotateCamera): void {
        camera.getViewMatrix(true);
        const location = this.detailGlobe.getSurfaceCoordinates(camera.position);
        const minimum = this.detailGlobe.sampleElevation(location.latitude, location.longitude)
            + 2 * this.detailGlobe.metresToWorld;
        if (location.elevation < minimum) {
            moveEye(camera, this.detailGlobe.getSurfacePosition(location.latitude, location.longitude, minimum).subtract(camera.position));
            camera.inertialBetaOffset = camera.inertialRadiusOffset = 0;
        }
    }

    private syncOrientationControls(tilt: number, heading: number): void {
        for (const [id, value] of [["tilt", tilt], ["heading", heading]] as const) {
            const rounded = id === "heading" ? Math.round(value) % 360 : Math.min(179, Math.round(value));
            const input = document.getElementById(id) as HTMLInputElement;
            const output = document.getElementById(`${id}Value`)!;
            if (input.value !== String(rounded)) input.value = String(rounded);
            if (output.textContent !== `${rounded}°`) output.textContent = `${rounded}°`;
        }
    }

    private updateOrientation(): void {
        if (!this.inspecting) return;
        const { up, east, north } = this.inspectionBasis();
        const direction = this.inspecting.position.subtract(this.inspecting.getTarget()).normalize();
        const tilt = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(direction, up)))) * 180 / Math.PI;
        const heading = (Math.atan2(-Vector3.Dot(direction, east), -Vector3.Dot(direction, north)) * 180 / Math.PI + 360) % 360;
        this.syncOrientationControls(tilt, heading);
    }

    private translateInspection(shift: Vector3): void {
        const camera = this.inspecting;
        if (!camera) return;
        moveEye(camera, shift);
        this.keepInspectionAboveGround(camera);
    }

    private movementSpeed(): number {
        const location = this.detailGlobe.getSurfaceCoordinates(this.inspecting!.position);
        const height = location.elevation - this.detailGlobe.sampleElevation(location.latitude, location.longitude);
        return Math.max(10 * this.detailGlobe.metresToWorld, height * 0.8);
    }

    private finishBenchmark(message?: string): void {
        const run = this.benchmark;
        const result = run?.profile.summary();
        if (this.longFrameObserver) {
            this.recordLongFrames(this.longFrameObserver.takeRecords());
            this.longFrameObserver.disconnect();
            this.longFrameObserver = undefined;
        }
        this.benchmark = undefined;
        const textures = new Set<GPUTexture>();
        if (this.engine.isWebGPU) for (const texture of this.engine.getLoadedTexturesCache()) {
            const resource = texture._hardwareTexture?.underlyingResource as GPUTexture | undefined;
            if (resource) textures.add(resource);
        }
        let textureBytes = 0;
        for (const texture of textures) {
            const bytes = texture.format.includes("32float") && texture.format.includes("stencil") ? 8
                : texture.format.startsWith("rgba16") ? 8 : 4;
            for (let mip = 0; mip < texture.mipLevelCount; mip++)
                textureBytes += (texture.format.startsWith("bc7")
                    ? Math.ceil(Math.max(1, texture.width >> mip) / 4) * Math.ceil(Math.max(1, texture.height >> mip) / 4) * 16
                    : Math.max(1, texture.width >> mip) * Math.max(1, texture.height >> mip) * bytes)
                    * texture.depthOrArrayLayers * texture.sampleCount;
        }
        const memory = textures.size ? ` · ${textures.size} texture allocations / ${(textureBytes / 1048576).toFixed(0)} MiB estimated` : "";
        const longFrame = this.longestAnimationFrame
            ? ` · longest animation frame ${this.longestAnimationFrame.toFixed(0)} ms (${this.longestFrameScript}; ${this.longestFrameBreakdown})` : "";
        const phases = [...this.benchmarkPhaseMax].map(([name, duration]) => `${name} ${duration.toFixed(0)} ms`).join(", ");
        document.getElementById("benchmark")!.textContent = "Measure frame pacing";
        document.getElementById("benchmarkResult")!.textContent = message ?? (result
            ? `${result.samples} frames · average ${result.fps.toFixed(1)} FPS · 1% low ${result.low1.toFixed(1)} FPS · 0.1% low ${result.low01.toFixed(1)} FPS · p99.9 ${result.p999.toFixed(1)} ms · worst ${result.worst.toFixed(1)} ms · selection center lag up to ${((run?.maxSelectionLagMeters ?? 0) / 1000).toFixed(1)} km · visible quality ${run?.qualityFailures ? `FAILED ${run.qualityFailures}/${run.qualitySamples} samples` : "unverified"} (up to ${run?.maxUnderDetailedTiles ?? 0} coarse and ${run?.maxMissingVisibleTiles ?? 0} missing tiles, ${Math.round(run?.maxVisibleErrorRatio ?? 0)}× error) · full-radius quality ${run?.knownIncomplete ? "known incomplete" : "unverified"}; diagnostic only${memory}${longFrame} · phase max: ${phases}` : "");
    }

    private sampleBenchmarkPhase(name: string, started: number): void {
        if (!this.benchmark) return;
        this.benchmarkPhaseMax.set(name, Math.max(this.benchmarkPhaseMax.get(name) ?? 0, performance.now() - started));
    }

    private recordLongFrames(entries: PerformanceEntry[]): void {
        for (const entry of entries as Array<PerformanceEntry & { renderStart?: number;
            styleAndLayoutStart?: number; blockingDuration?: number; scripts?: Array<{
            duration: number; sourceFunctionName?: string; sourceURL?: string }> }>) {
            if (entry.duration <= this.longestAnimationFrame) continue;
            this.longestAnimationFrame = entry.duration;
            const script = entry.scripts?.reduce((longest, current) =>
                !longest || current.duration > longest.duration ? current : longest, undefined as
                    { duration: number; sourceFunctionName?: string; sourceURL?: string } | undefined);
            const source = script?.sourceURL?.split("?")[0].split("/").pop() ?? "browser";
            this.longestFrameScript = script
                ? `${script.sourceFunctionName || source} ${script.duration.toFixed(0)} ms` : "unattributed";
            const totalScript = entry.scripts?.reduce((total, item) => total + item.duration, 0) ?? 0;
            const beforeRender = entry.renderStart === undefined ? 0 : entry.renderStart - entry.startTime;
            const afterRender = entry.renderStart === undefined ? 0 : entry.startTime + entry.duration - entry.renderStart;
            this.longestFrameBreakdown = `${entry.scripts?.length ?? 0} scripts / ${totalScript.toFixed(0)} ms script, `
                + `${beforeRender.toFixed(0)} ms before render, ${afterRender.toFixed(0)} ms after render, `
                + `${(entry.blockingDuration ?? 0).toFixed(0)} ms blocking`;
        }
    }

    private updateBenchmark(): void {
        const run = this.benchmark;
        if (!run) return;
        const seconds = (performance.now() - run.started) / 1000;
        if (seconds >= 60) { this.finishBenchmark(); return; }
        if (run.moving && this.inspecting) {
            const position = run.fullSpeed ? seconds : Math.sin(seconds * Math.PI / 15);
            this.translateInspection(run.shift.scale(position - run.previous));
            run.previous = position;
            this.orientView(run.tilt, (run.heading + seconds * 6) % 360);
        }
        if (this.canvas.dataset.googleFullRadiusQuality === "known-incomplete") run.knownIncomplete = true;
        if (performance.now() - run.lastQualitySampleAt >= 500) {
            run.lastQualitySampleAt = performance.now();
            run.qualitySamples++;
            const quality = this.googleTiles?.measureVisibleQuality();
            if (!quality?.visibleTiles || quality.underDetailedTiles > 0 || quality.missingVisibleTiles > 0) run.qualityFailures++;
            run.maxVisibleErrorRatio = Math.max(run.maxVisibleErrorRatio, quality?.worstErrorRatio ?? 0);
            run.maxUnderDetailedTiles = Math.max(run.maxUnderDetailedTiles, quality?.underDetailedTiles ?? 0);
            run.maxMissingVisibleTiles = Math.max(run.maxMissingVisibleTiles, quality?.missingVisibleTiles ?? 0);
        }
        const selectionCenter = this.googleTiles?.selectedCoverageCenter ?? this.googleSelectionCenter;
        if (selectionCenter) {
            const view = this.navigator.getView();
            const radians = Math.PI / 180;
            const dLat = (view.latitude - selectionCenter.latitude) * radians;
            const dLon = (view.longitude - selectionCenter.longitude) * radians;
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(view.latitude * radians)
                * Math.cos(selectionCenter.latitude * radians) * Math.sin(dLon / 2) ** 2;
            run.maxSelectionLagMeters = Math.max(run.maxSelectionLagMeters,
                2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a))));
        }
        document.getElementById("benchmarkResult")!.textContent = `Measuring ${run.moving ? "movement and streaming" : "current view"} · ${Math.floor(seconds)} / 60 s`;
    }

    private updateMovement(): void {
        const camera = this.inspecting;
        if (!camera) return;
        const forwardInput = Number(this.movementKeys.has("w")) - Number(this.movementKeys.has("s"));
        const rightInput = Number(this.movementKeys.has("d")) - Number(this.movementKeys.has("a"));
        const verticalInput = Number(this.movementKeys.has("e")) - Number(this.movementKeys.has("q"));
        if (!forwardInput && !rightInput && !verticalInput) return;
        const { up, north } = this.inspectionBasis();
        const forward = camera.getTarget().subtract(camera.position);
        forward.subtractInPlace(up.scale(Vector3.Dot(forward, up)));
        if (forward.lengthSquared() < 1e-16) forward.copyFrom(north);
        forward.normalize();
        const right = Vector3.Cross(up, forward).normalize();
        const direction = forward.scale(forwardInput).add(right.scale(rightInput)).add(up.scale(verticalInput)).normalize();
        this.translateInspection(direction.scale(this.movementSpeed()
            * (this.movementKeys.has("shift") ? 4 : 1) * Math.min(this.engine.getDeltaTime(), 50) / 1000));
    }

    private setupPointerNavigation(): void {
        let lookPointer: number | undefined;
        let lastX = 0, lastY = 0, lookTilt = 0, lookHeading = 0;
        this.canvas.addEventListener("contextmenu", event => event.preventDefault());
        this.canvas.addEventListener("pointerdown", event => {
            if (!this.inspecting || event.button !== 0 && event.button !== 2) return;
            event.preventDefault();
            this.canvas.focus();
            lookPointer = event.pointerId;
            lookTilt = Number((document.getElementById("tilt") as HTMLInputElement).value);
            lookHeading = Number((document.getElementById("heading") as HTMLInputElement).value);
            lastX = event.clientX; lastY = event.clientY;
            this.canvas.setPointerCapture(event.pointerId);
        });
        this.canvas.addEventListener("pointermove", event => {
            if (!this.inspecting || event.pointerId !== lookPointer) return;
            const dx = event.clientX - lastX, dy = event.clientY - lastY;
            lastX = event.clientX; lastY = event.clientY;
            lookTilt = Math.max(0.1, Math.min(179, lookTilt - dy * 0.15));
            lookHeading = (lookHeading + dx * 0.15 + 360) % 360;
            this.orientView(lookTilt, lookHeading);
        });
        const stopLooking = () => { lookPointer = undefined; };
        this.canvas.addEventListener("pointerup", stopLooking);
        this.canvas.addEventListener("pointercancel", stopLooking);
        this.canvas.addEventListener("lostpointercapture", stopLooking);
        window.addEventListener("keydown", event => {
            const target = event.target as HTMLInputElement;
            if (target?.tagName === "TEXTAREA" || target?.isContentEditable
                || target?.tagName === "INPUT" && target.type !== "range" && target.type !== "checkbox") return;
            if (this.inspecting && ["w", "a", "s", "d", "q", "e", "shift"].includes(event.key.toLowerCase()) && !event.ctrlKey && !event.metaKey) {
                event.preventDefault(); this.movementKeys.add(event.key.toLowerCase());
            }
        });
        window.addEventListener("keyup", event => this.movementKeys.delete(event.key.toLowerCase()));
        window.addEventListener("blur", () => this.movementKeys.clear());
        this.canvas.addEventListener(
            "wheel",
            (event) => {
                event.preventDefault();
                if (this.inspecting) {
                    const direction = this.inspecting.getTarget().subtract(this.inspecting.position).normalize();
                    this.translateInspection(direction.scale(-Math.max(-300, Math.min(300, event.deltaY)) / 300 * this.movementSpeed()));
                    return;
                }
                const view = this.navigator.getView();
                const direction = event.deltaY < 0 ? 1 : -1;
                const targetZoom = Math.max(
                    3,
                    Math.min(18, view.zoom + direction),
                );
                const targetAltitude =
                    this.navigator.getAltitudeForZoom(targetZoom);
                const blend = Math.min(
                    1,
                    Math.max(0.15, Math.abs(event.deltaY) / 500),
                );
                this.camera.radius =
                    DETAIL_RADIUS +
                    this.detailGlobe.sampleElevation(
                        view.latitude,
                        view.longitude,
                    ) +
                    view.altitude +
                    (targetAltitude - view.altitude) * blend;
                this.navigator.refresh();
            },
            { passive: false },
        );

        this.canvas.addEventListener("dblclick", (event) => {
            if (this.inspecting) return;
            const rect = this.canvas.getBoundingClientRect();
            const coordinates = this.navigator.getCoordinatesAtScreenPoint(
                (event.clientX - rect.left) * this.engine.getRenderWidth() / rect.width,
                (event.clientY - rect.top) * this.engine.getRenderHeight() / rect.height,
            );
            if (coordinates === undefined) {
                return;
            }

            const zoom = Math.min(18, this.navigator.getView().zoom + 2);
            this.navigator.flyTo(coordinates.latitude, coordinates.longitude, {
                zoom,
                durationMs: 850,
            });
        });
    }

    private changeZoom(change: number): void {
        if (this.inspecting) {
            this.translateInspection(this.inspecting.getTarget().subtract(this.inspecting.position).normalize().scale(this.movementSpeed() * change));
            return;
        }
        const view = this.navigator.getView();
        this.navigator.flyTo(view.latitude, view.longitude, {
            zoom: Math.max(3, Math.min(18, view.zoom + change)),
            durationMs: 350,
        });
    }

    private updateReadout(readout: HTMLDivElement, view: GlobeView): void {
        readout.textContent = `${view.latitude.toFixed(4)}°, ${view.longitude.toFixed(4)}° · z${view.zoom}`;
        (document.getElementById("compareEarth") as HTMLAnchorElement).href =
            `https://earth.google.com/web/search/${view.latitude.toFixed(6)},${view.longitude.toFixed(6)}/`;
        readout.dataset.zoom = String(view.zoom);
        readout.dataset.latitude = String(view.latitude);
        readout.dataset.longitude = String(view.longitude);
    }
}

async function startDemo(): Promise<void> {
    let engine: GlobeEngine | undefined;
    if (new URLSearchParams(location.search).get("renderer") === "webgpu") {
        const { StreamingWebGPUEngine: WebGPUEngine } = await import("./StreamingWebGPUEngine");
        await import("@babylonjs/core/Engines/WebGPU/Extensions/index");
        if (!await WebGPUEngine.IsSupportedAsync) throw new Error("WebGPU is unavailable in this browser");
        const gpu = new WebGPUEngine(document.getElementById("renderCanvas") as unknown as HTMLCanvasElement, {
            powerPreference: "high-performance", antialias: true, stencil: true,
            adaptToDeviceRatio: true, useHighPrecisionMatrix: true, useLargeWorldRendering: true,
            deviceDescriptor: { requiredFeatures: ["timestamp-query", "depth32float-stencil8"] },
        });
        await gpu.initAsync();
        gpu.compatibilityMode = false;
        gpu.enableGPUTimingMeasurements = true;
        engine = gpu;
    }
    new GlobeDemo(engine).start();
}
void startDemo().catch(error => {
    document.getElementById("loadingStatus")!.textContent = String(error);
    console.error(error);
});
