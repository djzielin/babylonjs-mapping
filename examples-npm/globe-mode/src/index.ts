import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color4 } from "@babylonjs/core/Maths/math";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";

import { GlobeSet, RasterOSM } from "babylonjs-mapping";

class GlobeDemo {
    private readonly canvas: HTMLCanvasElement;
    private readonly engine: Engine;
    private readonly scene: Scene;

    public constructor() {
        this.canvas = document.getElementById("renderCanvas") as unknown as HTMLCanvasElement;
        this.engine = new Engine(this.canvas, true);
        this.scene = new Scene(this.engine);
    }

    public start(): void {
        this.createScene();

        this.engine.runRenderLoop(() => this.scene.render());
        window.addEventListener("resize", () => this.engine.resize());
    }

    private createScene(): void {
        this.scene.clearColor = new Color4(5 / 255, 10 / 255, 22 / 255, 1);

        const globe = new GlobeSet(this.scene, this.engine, { radius: 60 });
        globe.setRasterProvider(new RasterOSM(globe));
        globe.createGeometry(new Vector2(4, 4), 20, 8);

        // At zoom 2, this center selects tile rows 3..0, covering the full
        // Web-Mercator world from west to east and north to south.
        globe.updateRaster(40.98, 0, 2);

        const camera = new ArcRotateCamera(
            "globe camera",
            -Math.PI / 2,
            Math.PI / 2.4,
            155,
            Vector3.Zero(),
            this.scene,
        );
        camera.attachControl(this.canvas, true);
        camera.lowerRadiusLimit = 75;
        camera.upperRadiusLimit = 350;
        camera.wheelDeltaPercentage = 0.01;

        const hemisphere = new HemisphericLight("hemisphere", new Vector3(0, 1, 0), this.scene);
        hemisphere.intensity = 0.55;

        const sun = new DirectionalLight("sun", new Vector3(-1, -0.5, 1), this.scene);
        sun.intensity = 0.8;

        const marker = MeshBuilder.CreateSphere(
            "Charlotte marker",
            { diameter: 3.5, segments: 16 },
            this.scene,
        );
        marker.position = globe.getSurfacePosition(35.2271, -80.8431, 2);

        const markerMaterial = new StandardMaterial("marker material", this.scene);
        markerMaterial.diffuseColor.set(0.95, 0.08, 0.04);
        markerMaterial.emissiveColor.set(0.3, 0.01, 0);
        marker.material = markerMaterial;
    }
}

new GlobeDemo().start();
