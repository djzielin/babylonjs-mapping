import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color4 } from "@babylonjs/core/Maths/math";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";

import {
    GlobeNavigator,
    GlobeSet,
    RasterOSM,
    RasterGEBCO,
    RasterMB,
    GlobeDataController,
    TerrainRGB,
    BuildingsOverture,
    BuildingsVectorTile,
    BuildingsMB,
    resolveLatestOvertureBuildingsURL,
    GeoJSON,
    EPSG_Type,
    type GlobeView,
} from "babylonjs-mapping";

interface LocationPreset {
    name: string;
    latitude: number;
    longitude: number;
    zoom: number;
}

const GLOBE_RADIUS = 60;
const DETAIL_RADIUS = 60;
const HOME_VIEW: LocationPreset = {
    name: "Charlotte, NC",
    latitude: 35.2271,
    longitude: -80.8431,
    zoom: 3,
};
const LOCATIONS: LocationPreset[] = [
    HOME_VIEW,
    {
        name: "Manhattan · buildings",
        latitude: 40.706,
        longitude: -74.009,
        zoom: 16,
    },
    {
        name: "Mariana Trench · seabed",
        latitude: 11.35,
        longitude: 142.2,
        zoom: 8,
    },
    {
        name: "Monterey Canyon · coastline",
        latitude: 36.73,
        longitude: -122.02,
        zoom: 11,
    },
    { name: "Date line · Fiji", latitude: -17.71, longitude: 179.99, zoom: 9 },
    { name: "Grand Canyon", latitude: 36.1069, longitude: -112.1129, zoom: 13 },
    { name: "Mount Everest", latitude: 27.9881, longitude: 86.925, zoom: 13 },
    { name: "Paris", latitude: 48.8566, longitude: 2.3522, zoom: 15 },
    { name: "Sydney", latitude: -33.8688, longitude: 151.2093, zoom: 13 },
    { name: "Tokyo", latitude: 35.6762, longitude: 139.6503, zoom: 13 },
];

class GlobeDemo {
    private readonly canvas: HTMLCanvasElement;
    private readonly engine: Engine;
    private readonly scene: Scene;
    private navigator: GlobeNavigator;
    private detailGlobe: GlobeSet;
    private camera: ArcRotateCamera;
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

    public constructor() {
        this.canvas = document.getElementById(
            "renderCanvas",
        ) as unknown as HTMLCanvasElement;
        this.engine = new Engine(this.canvas, true, {
            useHighPrecisionMatrix: true,
        });
        this.scene = new Scene(this.engine);
    }

    public start(): void {
        this.createScene();
        this.setupLocationControls();
        this.setupPointerNavigation();
        this.setupDataControls();
        this.engine.runRenderLoop(() => {
            this.scene.render();
            this.updateLandmarks();
            if (performance.now() - this.lastStats > 500) {
                this.lastStats = performance.now();
                const stat = this.data.stats;
                document.getElementById("performance")!.textContent =
                    `${this.engine.getFps().toFixed(0)} FPS · ${this.scene.getActiveMeshes().length} active meshes · ${this.scene.getTotalVertices().toLocaleString()} vertices · ${stat.active} detail jobs · ${stat.completed} completed · ${stat.failed} errors`;
            }
        });
        window.addEventListener("resize", () => {
            this.engine.resize();
            this.navigator.refresh(true);
        });
    }

    private createScene(): void {
        this.scene.clearColor = new Color4(5 / 255, 10 / 255, 22 / 255, 1);

        const baseGlobe = new GlobeSet(this.scene, this.engine, {
            radius: GLOBE_RADIUS,
        });
        baseGlobe.setRasterProvider(new RasterOSM(baseGlobe));
        baseGlobe.createGeometry(new Vector2(4, 4), 20, 16);
        baseGlobe.updateRaster(40.98, 0, 2);

        // The detail layer follows the camera. Its small radial offset avoids
        // z-fighting while the zoom-2 base remains visible during tile loads.
        this.detailGlobe = new GlobeSet(this.scene, this.engine, {
            radius: DETAIL_RADIUS,
            geometryBudgetMs: 4,
            backingSurface: false,
            attribution: false,
        });
        this.detailGlobe.setRasterProvider(new RasterOSM(this.detailGlobe));
        this.detailGlobe.createGeometry(new Vector2(5, 5), 20, 16);
        for (const tile of this.detailGlobe.ourTiles)
            tile.mesh.renderingGroupId = 1;
        this.data = new GlobeDataController(this.detailGlobe, {
            elevation: this.elevation.load,
            concurrency: 4,
            minTerrainZoom: 5,
            exaggeration: 1,
        });
        this.data.onErrorObservable.add((error) => this.message(error.message));
        void resolveLatestOvertureBuildingsURL()
            .then((url) => {
                this.buildings = new BuildingsOverture(this.detailGlobe, url);
                this.buildings.doMerge = true;
                this.buildings.buildingsCreatedPerFrame = 32;
                this.buildings.buildingMeshTransform = (mesh) => {
                    mesh.renderingGroupId = 1;
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
                this.detailGlobe.ourAttribution.addAttribution("OVERTURE");
                this.data.invalidate();
                this.message(
                    "Terrain and Overture buildings ready. Buildings stream at zoom 14+.",
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
            tileUpdateDelayMs: 180,
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
            if (!terrain.checked)
                for (const tile of this.detailGlobe.ourTiles) {
                    const p = this.detailGlobe.meshPrecision;
                    this.detailGlobe.applyElevationGrid(
                        tile,
                        new Array((p + 1) * (p + 1)).fill(0),
                        p,
                    );
                }
            this.data.invalidate();
        };
        terrain.addEventListener("change", reload);
        buildings.addEventListener("change", reload);
        exaggeration.addEventListener("change", reload);
        document
            .getElementById("retry")!
            .addEventListener("click", () => this.data.invalidate());
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
                this.roads.doMerge = true;
                this.roads.buildingMaterial.diffuseColor.set(0.92, 0.57, 0.18);
                this.roads.buildingMeshTransform = (mesh) => {
                    mesh.renderingGroupId = 1;
                };
            }
            this.data.options.features =
                enabled && this.roads ? [this.roads] : [];
            this.data.invalidate();
        });
        document.getElementById("landmarks")!.addEventListener("change", () => {
            if (
                !(document.getElementById("landmarks") as HTMLInputElement)
                    .checked
            ) {
                this.landmarks?.dispose();
                this.landmarkKey = "";
            }
        });
        const basemap = document.getElementById("basemap") as HTMLSelectElement;
        basemap.addEventListener("change", () => {
            if (basemap.value === "gebco")
                this.detailGlobe.setRasterProvider(
                    new RasterGEBCO(this.detailGlobe),
                );
            else if (basemap.value === "satellite") {
                const token = (
                    document.getElementById("mapboxToken") as HTMLInputElement
                ).value.trim();
                if (!token) {
                    this.message(
                        "Enter a Mapbox public token to use satellite imagery.",
                    );
                    return;
                }
                const raster = new RasterMB(this.detailGlobe);
                raster.accessToken = token;
                this.detailGlobe.setRasterProvider(raster);
            } else
                this.detailGlobe.setRasterProvider(
                    new RasterOSM(this.detailGlobe),
                );
            this.navigator.refresh(true);
        });
        document.getElementById("inspect")!.addEventListener("click", () => {
            if (this.inspecting) {
                this.inspecting.dispose();
                this.inspecting = undefined;
                this.scene.activeCamera = this.camera;
                this.camera.attachControl(this.canvas, true);
                document.getElementById("inspect")!.textContent =
                    "Inspect in 3D";
                return;
            }
            const view = this.navigator.getView();
            if (view.zoom < 12) {
                this.message(
                    "Zoom to 12 or closer to inspect terrain and buildings from an angle.",
                );
                return;
            }
            const ground = this.detailGlobe.sampleElevation(
                view.latitude,
                view.longitude,
            );
            const target = this.detailGlobe.getSurfacePosition(
                view.latitude,
                view.longitude,
                ground,
            );
            const up = this.detailGlobe.getSurfaceNormal(
                view.latitude,
                view.longitude,
            );
            const east = new Vector3(
                -Math.cos((view.longitude * Math.PI) / 180),
                0,
                -Math.sin((view.longitude * Math.PI) / 180),
            );
            this.camera.detachControl();
            const camera = new ArcRotateCamera(
                "local inspection",
                0,
                1,
                view.altitude,
                target,
                this.scene,
            );
            camera.upVector = up;
            camera.setPosition(
                target
                    .add(up.scale(view.altitude))
                    .add(east.scale(view.altitude)),
            );
            camera.minZ = 0.000001;
            camera.lowerRadiusLimit = 0.0001;
            camera.upperRadiusLimit = view.altitude * 8;
            camera.wheelDeltaPercentage = 0.03;
            camera.panningSensibility = 0;
            camera.attachControl(this.canvas, true);
            this.scene.activeCamera = camera;
            this.inspecting = camera;
            document.getElementById("inspect")!.textContent = "Return to globe";
        });
        document.getElementById("tour")!.addEventListener("click", () => {
            if (this.tourTimer) {
                clearInterval(this.tourTimer);
                this.tourTimer = undefined;
                document.getElementById("tour")!.textContent = "Guided tour";
                return;
            }
            let i = 1;
            const next = () => {
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
                        mesh.renderingGroupId = 1;
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
        if (!(document.getElementById("landmarks") as HTMLInputElement).checked)
            return;
        const token = (
            document.getElementById("mapboxToken") as HTMLInputElement
        ).value.trim();
        if (!token) return;
        if (this.detailGlobe.zoom < 15) {
            this.landmarks?.dispose();
            this.landmarkKey = "";
            return;
        }
        if (
            this.data.stats.active > 0 ||
            this.detailGlobe.pendingGeometryCount > 0
        )
            return;
        const key = this.detailGlobe.ourTiles
            .map((t) => t.tileCoords.toString())
            .join("|");
        if (key === this.landmarkKey) return;
        this.landmarkKey = key;
        this.landmarks ??= new BuildingsMB(this.detailGlobe);
        this.landmarks.accessToken = token;
        void this.landmarks
            .generateBuildings()
            .then((tiles) => {
                for (const tile of tiles)
                    for (const mesh of tile.asset.meshes)
                        mesh.renderingGroupId = 1;
            })
            .catch((error) => this.message(`Landmarks: ${error.message}`));
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
            const location = LOCATIONS[Number(preset.value)];
            latitude.value = String(location.latitude);
            longitude.value = String(location.longitude);
            this.navigator.flyTo(location.latitude, location.longitude, {
                zoom: location.zoom,
                durationMs: 1400,
            });
        });

        form.addEventListener("submit", (event) => {
            event.preventDefault();
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
            preset.value = "0";
            latitude.value = String(HOME_VIEW.latitude);
            longitude.value = String(HOME_VIEW.longitude);
            this.navigator.flyTo(HOME_VIEW.latitude, HOME_VIEW.longitude, {
                zoom: HOME_VIEW.zoom,
                durationMs: 1200,
            });
        });

        this.navigator.onViewChangedObservable.add((view) => {
            const precision = view.zoom < 5 ? 16 : 64;
            if (this.detailGlobe.meshPrecision !== precision) {
                this.detailGlobe.createGeometry(
                    new Vector2(5, 5),
                    20,
                    precision,
                );
                for (const tile of this.detailGlobe.ourTiles)
                    tile.mesh.renderingGroupId = 1;
                this.data.invalidate();
            }
            this.updateReadout(readout, view);
        });
        this.updateReadout(readout, this.navigator.getView());
    }

    private setupPointerNavigation(): void {
        this.canvas.addEventListener(
            "wheel",
            (event) => {
                if (this.inspecting) return;
                event.preventDefault();
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
                event.clientX - rect.left,
                event.clientY - rect.top,
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
        const view = this.navigator.getView();
        this.navigator.flyTo(view.latitude, view.longitude, {
            zoom: Math.max(3, Math.min(18, view.zoom + change)),
            durationMs: 350,
        });
    }

    private updateReadout(readout: HTMLDivElement, view: GlobeView): void {
        readout.textContent = `${view.latitude.toFixed(4)}°, ${view.longitude.toFixed(4)}° · z${view.zoom}`;
        readout.dataset.zoom = String(view.zoom);
        readout.dataset.latitude = String(view.latitude);
        readout.dataset.longitude = String(view.longitude);
    }
}

new GlobeDemo().start();
