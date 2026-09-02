import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color4, Vector2, Vector3 } from "@babylonjs/core/Maths/math";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { StackPanel } from "@babylonjs/gui/2D/controls/stackPanel";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";

import { RasterGEBCO, TileSet } from "babylonjs-mapping";

class Game {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;
    private tileSet: TileSet;

    constructor() {
        this.canvas = document.getElementById("renderCanvas") as unknown as HTMLCanvasElement;
        this.engine = new Engine(this.canvas, true);
        this.scene = new Scene(this.engine);
    }

    public start(): void {
        this.createScene();

        this.engine.runRenderLoop(() => {
            this.scene.render();
        });

        window.addEventListener("resize", () => {
            this.engine.resize();
        });
    }

    private createScene(): void {
        this.scene.clearColor = new Color4(0.02, 0.055, 0.11, 1);

        const camera = new ArcRotateCamera(
            "camera1",
            -Math.PI / 2,
            1.12,
            390,
            Vector3.Zero(),
            this.scene,
        );
        camera.attachControl(this.canvas, true);
        camera.lowerRadiusLimit = 175;
        camera.upperRadiusLimit = 900;
        camera.wheelPrecision = 35;
        camera.panningSensibility = 0;

        const hemisphere = new HemisphericLight("hemisphere", new Vector3(0, 1, 0), this.scene);
        hemisphere.intensity = 0.8;

        const sunlight = new DirectionalLight("sunlight", new Vector3(-0.4, -1, 0.6), this.scene);
        sunlight.intensity = 0.35;

        this.tileSet = new TileSet(this.scene, this.engine);
        this.tileSet.createGeometry(new Vector2(4, 3), 100, 2);
        this.tileSet.setRasterProvider(new RasterGEBCO(this.tileSet));
        this.tileSet.updateRaster(11.35, 142.2, 6); // Mariana Trench region

        this.setupHelpText();
    }

    private setupHelpText(): void {
        const overlay = this.tileSet.getAdvancedDynamicTexture();
        const panel = new Rectangle("info-panel");
        panel.width = "390px";
        panel.height = "182px";
        panel.cornerRadius = 14;
        panel.thickness = 1;
        panel.color = "#63e6ff";
        panel.background = "#06182be6";
        panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        panel.left = "24px";
        panel.top = "24px";
        overlay.addControl(panel);

        const content = new StackPanel("info-content");
        content.width = "350px";
        panel.addControl(content);

        const title = new TextBlock("title", "GEBCO BATHYMETRY");
        title.height = "34px";
        title.color = "#ffffff";
        title.fontSize = 23;
        title.fontWeight = "bold";
        title.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        content.addControl(title);

        const region = new TextBlock("region", "Mariana Trench · colour-shaded elevation");
        region.height = "27px";
        region.color = "#a5efff";
        region.fontSize = 14;
        region.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        content.addControl(region);

        const legend = new StackPanel("legend");
        legend.height = "21px";
        legend.isVertical = false;
        legend.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        for (const color of ["#08145f", "#07549a", "#008eaf", "#44c4bd", "#e8d9ae"]) {
            const swatch = new Rectangle("swatch");
            swatch.width = "70px";
            swatch.height = "18px";
            swatch.background = color;
            swatch.thickness = 0;
            legend.addControl(swatch);
        }
        content.addControl(legend);

        const scale = new TextBlock("scale", "deeper  ←  ocean depth  →  land");
        scale.height = "23px";
        scale.color = "#d2f7ff";
        scale.fontSize = 12;
        scale.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        content.addControl(scale);

        const controls = new TextBlock("controls", "Drag to orbit · scroll to zoom");
        controls.height = "28px";
        controls.color = "#ffffff";
        controls.fontSize = 13;
        controls.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        content.addControl(controls);

        const source = new TextBlock("source", "GEBCO WMS · latest global grid");
        source.height = "25px";
        source.color = "#8fa8b8";
        source.fontSize = 12;
        source.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        content.addControl(source);
    }
}

new Game().start();
