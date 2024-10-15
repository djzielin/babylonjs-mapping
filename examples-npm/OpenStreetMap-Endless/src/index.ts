/* Web-Based-VR-Tutorial Project Template
* Author: Evan Suma Rosenberg <suma@umn.edu> and Blair MacIntyre <blair@cc.gatech.edu>
* License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
*/

// Extended by David J. Zielinski

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector2 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Color4 } from "@babylonjs/core/Maths/math";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ActionManager, KeyboardEventTypes, KeyboardInfo } from "@babylonjs/core";

import { TextBlock } from "@babylonjs/gui";
import { Control } from "@babylonjs/gui";

import "@babylonjs/core/Materials/standardMaterial"
import "@babylonjs/inspector";

import BuildingsOSM from "babylonjs-mapping/lib/BuildingsOSM";
import TileSet from "babylonjs-mapping";
import RasterOSM from "babylonjs-mapping/lib/RasterOSM";

class Game {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;

    private ourTS: TileSet;
    private ourOSM: BuildingsOSM;

    private lastSelectedSphereIndex: number = -1;
    private lastSelectedSphere: Mesh;
    //private previousButton: GUI.Button;

    private spherePositions: Vector3[] = [];

    private keyRight: boolean;
    private keyLeft: boolean;
    private keyUp: boolean;
    private keyDown: boolean;

    private camera: UniversalCamera;

    constructor() {
        // Get the canvas element 
        this.canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

        // Generate the BABYLON 3D engine
        this.engine = new Engine(this.canvas, true);

        // Creates a basic Babylon Scene object
        this.scene = new Scene(this.engine);
    }

    start(): void {
        // Create the scene and then execute this function afterwards
        this.createScene().then(() => {

            // Register a render loop to repeatedly render the scene
            this.engine.runRenderLoop(() => {
                this.update();
                this.scene.render();
            });

            // Watch for browser/canvas resize events
            window.addEventListener("resize", () => {
                this.engine.resize();
            });
        });
    }

    public async getKey(url: string): Promise<string> {
        console.log("trying to fetch: " + url);
        const res = await fetch(url);
        console.log("  fetch returned: " + res.status);

        if (res.status != 200) {
            console.error("unable to load key!");
            return "";
        }

        const text = await res.text();
        return text;
    }

    public setupHelpText() {
        const ourOverlay = this.ourTS.getAdvancedDynamicTexture();

        const textBlock = new TextBlock();
        textBlock.text = "On Desktop, use AWSD and mouse to navigate";
        textBlock.color = "white";
        textBlock.fontSize = 24;

        textBlock.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        textBlock.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;

        textBlock.left = "10px";
        textBlock.top = "10px";

        // Add the text block to the texture
        ourOverlay.addControl(textBlock);
    }

    private async createScene() {

        this.scene.clearColor = new Color4(135 / 255, 206 / 255, 235 / 255, 1.0);

        this.camera = new UniversalCamera("camera1", new Vector3(0, 10, 0), this.scene);
        //var camera = new UniversalCamera("camera1", new Vector3(90, 45, 0), this.scene); //grand canyon

        //this.camera.setTarget(new Vector3(0,0,1));
        this.camera.attachControl(this.canvas, true);

        this.camera.speed = 0.0;
        this.camera.angularSensibility = 8000;


        var light = new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);
        light.intensity = 0.5;

        var light2 = new DirectionalLight("DirectionalLight", new Vector3(0, -1, 1), this.scene);
        light2.intensity = 0.5;
        light2.parent = this.camera;

        this.ourTS = new TileSet(this.scene, this.engine);
        this.ourTS.createGeometry(new Vector2(14, 14), 25, 2);
        this.ourTS.setRasterProvider(new RasterOSM(this.ourTS));
        this.ourTS.updateRaster(35.21, -80.8400777, 16); //charlotte

        const accessToken = await this.getKey("osmb-key.txt");
        this.ourOSM = new BuildingsOSM(this.ourTS);
        this.ourOSM.accessToken = accessToken;
        this.ourOSM.doMerge = true;
        this.ourOSM.exaggeration = 3;
        this.ourOSM.generateBuildings();

        // Show the debug scene explorer and object inspector
        // You should comment this out when you build your final program
        this.scene.debugLayer.show();
        this.setupHelpText();

        this.scene.onKeyboardObservable.add((e: KeyboardInfo) => {
            if (e.type == KeyboardEventTypes.KEYDOWN) {
                if (e.event.key == "d") {
                    this.keyRight = true;
                }
                if (e.event.key == "a") {
                    this.keyLeft = true;
                }
                if (e.event.key == "w") {
                    this.keyUp = true;
                }
                if (e.event.key == "s") {
                    this.keyDown = true;
                }

            } else {
                console.log("key up: " + e.event.key);

                if (e.event.key == "d") {
                    this.keyRight = false;
                }
                if (e.event.key == "a") {
                    this.keyLeft = false;
                }
                if (e.event.key == "w") {
                    this.keyUp = false;
                }
                if (e.event.key == "s") {
                    this.keyDown = false;
                }
            }
        });
    }

    // The main update loop will be executed once per frame before the scene is rendered
    // modify camera flythrough?
    private update(): void {
        const fVec = Vector3.TransformCoordinates(Vector3.Forward(), this.camera.getWorldMatrix());
        const rVec = Vector3.TransformCoordinates(Vector3.Right(), this.camera.getWorldMatrix());

        const deltaTimeSeconds = this.engine.getDeltaTime() * 0.001;

        let movVec: Vector3 = Vector3.Zero();
        let forwardAmount = 0;
        let rightAmount = 0;

        if (this.keyLeft) {
            rightAmount += 10 * deltaTimeSeconds;
        }
        if (this.keyRight) {
            rightAmount += -10 * deltaTimeSeconds;
        }
        if (this.keyUp) {
            forwardAmount += -10 * deltaTimeSeconds;
        }
        if (this.keyDown) {
            forwardAmount += 10 * deltaTimeSeconds;
        }

        if (Math.abs(forwardAmount) > 0.0 || Math.abs(rightAmount) > 0.0) {
            movVec = movVec.add(fVec.multiplyByFloats(forwardAmount, forwardAmount, forwardAmount));
            movVec = movVec.add(rVec.multiplyByFloats(rightAmount, rightAmount, rightAmount));
            this.ourTS.moveAllTiles(movVec.x, movVec.z, 100, this.ourOSM);
        }
    }

}
/******* End of the Game class ******/

// start the game
var game = new Game();
game.start();