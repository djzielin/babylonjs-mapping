import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";

import { Google3DTiles, RasterOSM, TileSet } from "babylonjs-mapping";

class Google3DTilesDemo {
    private readonly canvas = document.getElementById("renderCanvas") as unknown as HTMLCanvasElement;
    private readonly form = document.getElementById("loadForm") as HTMLFormElement;
    private readonly locationInput = document.getElementById("location") as HTMLSelectElement;
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

        this.form.addEventListener("submit", (event) => {
            event.preventDefault();
            void this.load();
        });

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
        this.tileSet.updateRaster(latitude, longitude, 16);
    }

    private async load(): Promise<void> {
        if (!this.apiKey) {
            this.setStatus("error", "Google API key is not configured.");
            return;
        }

        this.loadButton.disabled = true;
        this.setStatus("loading", "Loading the Google 3D Tiles hierarchy…");
        this.canvas.dataset.loadedTiles = "0";

        try {
            this.googleTiles?.dispose();
            this.setLocation();
            this.googleTiles = new Google3DTiles(this.tileSet, {
                apiKey: this.apiKey,
                maxDepth: 8,
                maxTiles: 72,
            });

            const loaded = await this.googleTiles.load();
            this.canvas.dataset.loadedTiles = String(loaded.length);

            if (loaded.length === 0) {
                this.setStatus("error", "The hierarchy loaded, but no model tiles matched this area.");
                return;
            }

            const sourceCount = this.googleTiles.getAttributions().length;
            this.setStatus(
                "ready",
                `${loaded.length} model tiles loaded${sourceCount ? ` · ${sourceCount} credited data sources` : ""}.`,
            );
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus("error", message);
            console.error("Unable to load Google Photorealistic 3D Tiles:", error);
        } finally {
            this.loadButton.disabled = false;
        }
    }

    private setStatus(state: "idle" | "loading" | "ready" | "error", message: string): void {
        this.status.dataset.state = state;
        this.status.textContent = message;
        this.canvas.dataset.state = state;
    }
}

new Google3DTilesDemo();
