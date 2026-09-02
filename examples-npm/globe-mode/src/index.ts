import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color4 } from "@babylonjs/core/Maths/math";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";

import { GlobeNavigator, GlobeSet, RasterOSM, type GlobeView } from "babylonjs-mapping";

interface LocationPreset {
    name: string;
    latitude: number;
    longitude: number;
    zoom: number;
}

const GLOBE_RADIUS = 60;
const DETAIL_RADIUS = 60.08;
const HOME_VIEW: LocationPreset = {
    name: "Charlotte, NC",
    latitude: 35.2271,
    longitude: -80.8431,
    zoom: 3,
};
const LOCATIONS: LocationPreset[] = [
    HOME_VIEW,
    { name: "Grand Canyon", latitude: 36.1069, longitude: -112.1129, zoom: 11 },
    { name: "Mount Everest", latitude: 27.9881, longitude: 86.925, zoom: 11 },
    { name: "Paris", latitude: 48.8566, longitude: 2.3522, zoom: 12 },
    { name: "Sydney", latitude: -33.8688, longitude: 151.2093, zoom: 11 },
    { name: "Tokyo", latitude: 35.6762, longitude: 139.6503, zoom: 11 },
];

class GlobeDemo {
    private readonly canvas: HTMLCanvasElement;
    private readonly engine: Engine;
    private readonly scene: Scene;
    private navigator: GlobeNavigator;
    private detailGlobe: GlobeSet;
    private camera: ArcRotateCamera;

    public constructor() {
        this.canvas = document.getElementById("renderCanvas") as unknown as HTMLCanvasElement;
        this.engine = new Engine(this.canvas, true);
        this.scene = new Scene(this.engine);
    }

    public start(): void {
        this.createScene();
        this.setupLocationControls();
        this.setupPointerNavigation();

        this.engine.runRenderLoop(() => this.scene.render());
        window.addEventListener("resize", () => {
            this.engine.resize();
            this.navigator.refresh(true);
        });
    }

    private createScene(): void {
        this.scene.clearColor = new Color4(5 / 255, 10 / 255, 22 / 255, 1);

        const baseGlobe = new GlobeSet(this.scene, this.engine, { radius: GLOBE_RADIUS });
        baseGlobe.setRasterProvider(new RasterOSM(baseGlobe));
        baseGlobe.createGeometry(new Vector2(4, 4), 20, 16);
        baseGlobe.updateRaster(40.98, 0, 2);

        // The detail layer follows the camera. Its small radial offset avoids
        // z-fighting while the zoom-2 base remains visible during tile loads.
        this.detailGlobe = new GlobeSet(this.scene, this.engine, {
            radius: DETAIL_RADIUS,
            backingSurface: false,
            attribution: false,
        });
        this.detailGlobe.setRasterProvider(new RasterOSM(this.detailGlobe));
        this.detailGlobe.createGeometry(new Vector2(5, 5), 20, 12);

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
        this.navigator.setView(HOME_VIEW.latitude, HOME_VIEW.longitude, { zoom: HOME_VIEW.zoom });

        const hemisphere = new HemisphericLight("hemisphere", new Vector3(0, 1, 0), this.scene);
        hemisphere.intensity = 0.55;

        const sun = new DirectionalLight("sun", new Vector3(-1, -0.5, 1), this.scene);
        sun.intensity = 0.8;

        const marker = MeshBuilder.CreateSphere(
            "Charlotte marker",
            { diameter: 3.5, segments: 16 },
            this.scene,
        );
        marker.position = baseGlobe.getSurfacePosition(35.2271, -80.8431, 2.2);

        const markerMaterial = new StandardMaterial("marker material", this.scene);
        markerMaterial.diffuseColor.set(0.95, 0.08, 0.04);
        markerMaterial.emissiveColor.set(0.3, 0.01, 0);
        marker.material = markerMaterial;
    }

    private setupLocationControls(): void {
        const form = document.getElementById("locationForm") as HTMLFormElement;
        const preset = document.getElementById("locationPreset") as HTMLSelectElement;
        const latitude = document.getElementById("latitude") as HTMLInputElement;
        const longitude = document.getElementById("longitude") as HTMLInputElement;
        const zoomIn = document.getElementById("zoomIn") as HTMLButtonElement;
        const zoomOut = document.getElementById("zoomOut") as HTMLButtonElement;
        const home = document.getElementById("home") as HTMLButtonElement;
        const readout = document.getElementById("viewReadout") as HTMLDivElement;

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
            this.navigator.flyTo(Number(latitude.value), Number(longitude.value), {
                zoom: Math.max(8, this.navigator.getView().zoom),
                durationMs: 1200,
            });
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
            this.updateReadout(readout, view);
        });
        this.updateReadout(readout, this.navigator.getView());
    }

    private setupPointerNavigation(): void {
        this.canvas.addEventListener("wheel", (event) => {
            event.preventDefault();
            const view = this.navigator.getView();
            const direction = event.deltaY < 0 ? 1 : -1;
            const targetZoom = Math.max(3, Math.min(18, view.zoom + direction));
            const targetAltitude = this.navigator.getAltitudeForZoom(targetZoom);
            const blend = Math.min(1, Math.max(0.15, Math.abs(event.deltaY) / 500));
            this.camera.radius = DETAIL_RADIUS
                + view.altitude
                + (targetAltitude - view.altitude) * blend;
            this.navigator.refresh();
        }, { passive: false });

        this.canvas.addEventListener("dblclick", (event) => {
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
