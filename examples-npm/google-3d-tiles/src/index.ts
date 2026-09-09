import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";

import { EPSG_Type, Google3DTiles, RasterOSM, TileSet } from "babylonjs-mapping";

class Google3DTilesDemo {
    private readonly canvas = document.getElementById("renderCanvas") as unknown as HTMLCanvasElement;
    private readonly form = document.getElementById("loadForm") as HTMLFormElement;
    private readonly locationInput = document.getElementById("location") as HTMLSelectElement;
    private readonly qualityInput = document.getElementById("quality") as HTMLSelectElement;
    private readonly loadButton = document.getElementById("loadButton") as HTMLButtonElement;
    private readonly status = document.getElementById("status") as HTMLDivElement;
    private readonly engine = new Engine(this.canvas, true);
    private readonly scene = new Scene(this.engine);
    private readonly camera: ArcRotateCamera;
    private readonly tileSet: TileSet;
    private googleTiles: Google3DTiles | undefined;
    private apiKey = "";

    public constructor() {
        this.scene.clearColor = new Color4(0.025, 0.05, 0.08, 1);

        this.camera = new ArcRotateCamera(
            "camera",
            -Math.PI / 2,
            Math.PI / 3.1,
            310,
            new Vector3(0, 15, 0),
            this.scene,
        );
        this.camera.attachControl(this.canvas, true);
        this.camera.lowerRadiusLimit = 15;
        this.camera.upperRadiusLimit = 900;
        this.camera.wheelPrecision = 22;
        this.camera.panningSensibility = 0;

        const light = new HemisphericLight("ambient light", new Vector3(0.2, 1, -0.4), this.scene);
        light.intensity = 1.15;

        this.tileSet = new TileSet(this.scene, this.engine);
        this.tileSet.createGeometry(new Vector2(4, 4), 100, 2);
        this.tileSet.setRasterProvider(new RasterOSM(this.tileSet));
        this.setLocation();

        this.locationInput.addEventListener("change", () => {
            this.qualityInput.value = this.locationInput.selectedOptions[0].dataset.detail ?? "22";
        });

        this.form.addEventListener("submit", (event) => {
            event.preventDefault();
            void this.load();
        });

        document.getElementById("resetView")!.addEventListener("click", () => this.resetView());

        this.engine.runRenderLoop(() => this.scene.render());
        window.addEventListener("resize", () => this.engine.resize());
        void this.initialize();
    }

    private async initialize(): Promise<void> {
        try {
            const response = await fetch("google-key.txt", { cache: "no-store" });
            if (!response.ok) {
                throw new Error(`google-key.txt returned ${response.status}`);
            }
            this.apiKey = (await response.text()).trim();
            if (!this.apiKey) {
                throw new Error("google-key.txt is empty");
            }
            await this.load();
        } catch (error: unknown) {
            console.error("Unable to read the Google Maps Platform API key:", error);
            this.setStatus(
                "error",
                "Google API key is not configured. Add public/google-key.txt or the Pages repository secret.",
            );
        }
    }

    private setLocation(): void {
        const [latitude, longitude] = this.locationInput.value.split(",").map(Number);
        this.tileSet.updateRaster(latitude, longitude, Number(this.locationInput.selectedOptions[0].dataset.zoom ?? 17));
        this.resetView();
    }

    private resetView(): void {
        const [latitude, longitude] = this.locationInput.value.split(",").map(Number);
        const target = this.tileSet.ourTileMath.EPSG_to_Game(new Vector2(longitude, latitude), EPSG_Type.EPSG_4326);
        target.y = Number(this.locationInput.selectedOptions[0].dataset.targetHeight ?? 65);
        this.camera.setTarget(target);
        this.camera.alpha = Number(this.locationInput.selectedOptions[0].dataset.cameraAlpha ?? -Math.PI / 2.4);
        this.camera.beta = Math.PI / 3.1;
        this.camera.radius = Number(this.locationInput.selectedOptions[0].dataset.cameraRadius ?? 440);
    }

    private async load(): Promise<void> {
        if (!this.apiKey) {
            this.setStatus("error", "Google API key is not configured.");
            return;
        }

        for (const tile of this.tileSet.ourTiles) tile.mesh.isVisible = true;
        this.tileSet.ourAttribution.advancedTexture.rootContainer.isVisible = true;
        document.getElementById("attribution")!.hidden = true;
        this.loadButton.disabled = true;
        this.locationInput.disabled = true;
        this.qualityInput.disabled = true;
        this.setStatus("loading", "Loading the Google 3D Tiles hierarchy…");
        this.canvas.dataset.loadedTiles = "0";

        try {
            this.googleTiles?.dispose();
            this.setLocation();
            this.googleTiles = new Google3DTiles(this.tileSet, {
                apiKey: this.apiKey,
                maxDepth: Number(this.qualityInput.value),
                maxTiles: 256,
            });

            const loaded = await this.googleTiles.load();
            this.canvas.dataset.loadedTiles = String(loaded.length);

            if (loaded.length === 0) {
                this.setStatus("error", "The hierarchy loaded, but no model tiles matched this area.");
                return;
            }

            // Google terrain uses ellipsoid heights, which can be below the
            // flat raster plane. Hide that plane so it cannot cut through models.
            for (const tile of this.tileSet.ourTiles) tile.mesh.isVisible = false;
            const attributions = this.googleTiles.getAttributions();
            const sourceCount = attributions.length;
            document.getElementById("dataCredits")!.textContent = attributions.join("; ");
            document.getElementById("attribution")!.hidden = false;
            this.tileSet.ourAttribution.advancedTexture.rootContainer.isVisible = false;
            this.setStatus(
                "ready",
                `${loaded.length} model tiles loaded${sourceCount ? ` · ${sourceCount} credited data source${sourceCount === 1 ? "" : "s"}` : ""}.`
                    + (loaded.length >= this.googleTiles.maxTiles ? " Tile limit reached; lower detail for wider coverage." : ""),
            );
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus("error", message);
            console.error("Unable to load Google Photorealistic 3D Tiles:", error);
        } finally {
            this.loadButton.disabled = false;
            this.locationInput.disabled = false;
            this.qualityInput.disabled = false;
        }
    }

    private setStatus(state: "idle" | "loading" | "ready" | "error", message: string): void {
        this.status.dataset.state = state;
        this.status.textContent = message;
        this.canvas.dataset.state = state;
    }
}

new Google3DTilesDemo();
