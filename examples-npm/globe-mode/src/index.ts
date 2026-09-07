import { setupAddressSearch } from "./AddressSearch";
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
    private landmarkRetryAt = 0;

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
        });
        this.setupPointerNavigation();
        this.setupDataControls();
        this.engine.runRenderLoop(() => {
            this.scene.render();
            this.updateOrientation();
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
        const enabled = (document.getElementById("landmarks") as HTMLInputElement).checked;
        const token = (document.getElementById("mapboxToken") as HTMLInputElement).value.trim();
        if (!enabled || !token || this.detailGlobe.zoom < 14) {
            this.landmarks?.dispose();
            this.landmarks = undefined;
            this.landmarkKey = "";
            return;
        }
        if (this.landmarks && this.landmarks.accessToken !== token) {
            this.landmarks.dispose();
            this.landmarks = undefined;
            this.landmarkKey = "";
        }
        if (this.detailGlobe.pendingGeometryCount > 0) return;
        // Landmark requests follow geography independently of the slower
        // footprint queue, including custom addresses and drag navigation.
        const key = this.detailGlobe.ourTiles.map(t => t.tileCoords.toString()).join("|");
        if (key === this.landmarkKey) return;
        if (performance.now() < this.landmarkRetryAt) return;
        this.landmarkKey = key;
        const provider = this.landmarks ??= new BuildingsMB(this.detailGlobe);
        provider.accessToken = token;
        void provider.generateBuildings().then(tiles => {
            for (const tile of tiles)
                for (const mesh of tile.asset.meshes) mesh.renderingGroupId = 1;
        }).catch(() => {
            if (provider !== this.landmarks || key !== this.landmarkKey) return;
            this.landmarkKey = "";
            this.landmarkRetryAt = performance.now() + 15000;
            this.message("Landmark request failed; retrying shortly. Check the Mapbox token if this persists.");
        });
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
            this.exitInspection();
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

    private exitInspection(): void {
        if (!this.inspecting) return;
        this.inspecting.dispose();
        this.inspecting = undefined;
        this.scene.activeCamera = this.camera;
        this.camera.attachControl(this.canvas, true);
        document.getElementById("inspect")!.textContent = "Tilt view";
        this.syncOrientationControls(0, 0);
    }

    private inspectionBasis() {
        const view = this.navigator.getView();
        const up = this.detailGlobe.getSurfaceNormal(view.latitude, view.longitude);
        const longitude = view.longitude * Math.PI / 180;
        const east = new Vector3(-Math.cos(longitude), 0, -Math.sin(longitude));
        const north = Vector3.Cross(east, up).normalize();
        return { up, east, north };
    }

    private orientView(tilt: number, heading: number): void {
        const view = this.navigator.getView();
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
                this.detailGlobe.sampleElevation(view.latitude, view.longitude));
            this.camera.detachControl();
            const camera = new ArcRotateCamera("local inspection", 0, 1, view.altitude, target, this.scene);
            camera.upVector = up;
            camera.lowerBetaLimit = 0.001;
            camera.upperBetaLimit = Math.PI / 2 - 0.001;
            camera.minZ = Math.max(0.0000001, view.altitude * 0.0001);
            camera.lowerRadiusLimit = Math.max(0.00001, view.altitude / 100);
            camera.upperRadiusLimit = view.altitude * 8;
            camera.wheelDeltaPercentage = 0.03;
            camera.panningSensibility = 0;
            camera.inertia = 0.65;
            camera.angularSensibilityX = camera.angularSensibilityY = 1500;
            camera.onAfterCheckInputsObservable.add(() => this.keepInspectionAboveGround(camera));
            camera.attachControl(this.canvas, true);
            this.scene.activeCamera = camera;
            this.inspecting = camera;
            document.getElementById("inspect")!.textContent = "Top down";
        }
        const camera = this.inspecting;
        const pitch = Math.max(0.001, tilt * Math.PI / 180);
        const bearing = heading * Math.PI / 180;
        const offset = up.scale(Math.cos(pitch))
            .subtract(north.scale(Math.sin(pitch) * Math.cos(bearing)))
            .subtract(east.scale(Math.sin(pitch) * Math.sin(bearing)));
        camera.inertialAlphaOffset = camera.inertialBetaOffset = 0;
        camera.setPosition(camera.getTarget().add(offset.scale(camera.radius)));
        this.keepInspectionAboveGround(camera);
        this.syncOrientationControls(tilt, heading);
    }

    private keepInspectionAboveGround(camera: ArcRotateCamera): void {
        camera.getViewMatrix(true);
        const location = this.detailGlobe.getSurfaceCoordinates(camera.position);
        const minimum = this.detailGlobe.sampleElevation(location.latitude, location.longitude)
            + 2 * this.detailGlobe.metresToWorld;
        if (location.elevation < minimum) {
            camera.setPosition(this.detailGlobe.getSurfacePosition(location.latitude, location.longitude, minimum));
            camera.inertialBetaOffset = camera.inertialRadiusOffset = 0;
        }
    }

    private syncOrientationControls(tilt: number, heading: number): void {
        for (const [id, value] of [["tilt", tilt], ["heading", heading]] as const) {
            const rounded = id === "heading" ? Math.round(value) % 360 : Math.min(89, Math.round(value));
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
        if (this.inspecting) {
            this.inspecting.radius = Math.max(this.inspecting.lowerRadiusLimit!, Math.min(this.inspecting.upperRadiusLimit!, this.inspecting.radius * 2 ** -change));
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
        readout.dataset.zoom = String(view.zoom);
        readout.dataset.latitude = String(view.latitude);
        readout.dataset.longitude = String(view.longitude);
    }
}

new GlobeDemo().start();
