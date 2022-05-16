/* Web-Based-VR-Tutorial Project Template
* Author: Evan Suma Rosenberg <suma@umn.edu> and Blair MacIntyre <blair@cc.gatech.edu>
* License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
*/

// Extended by David J. Zielinski

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { EngineStore } from "@babylonjs/core";
import { Vector2 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Color3 } from "@babylonjs/core/Maths/math";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { Color4 } from "@babylonjs/core/Maths/math";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder"
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
//import { AdvancedDynamicTexture } from "@babylonjs/gui/2D";
import "@babylonjs/core/Materials/standardMaterial"
import "@babylonjs/inspector";
import '@babylonjs/core/Debug/debugLayer';

import TileSet from "babylonjs-mapping";

class Game {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;

    private ourTS: TileSet;
    private mapboxKey: string;

    private maxPrecision=64;

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

    public async getMapboxKey(url: string) {
        console.log("trying to fetch: " + url);
        const res = await fetch(url);
        console.log("  fetch returned: " + res.status);

        if (res.status != 200) {
            console.error("unable to load mapbox key!");
            return;
        }

        const text = await res.text();
     
        this.mapboxKey=text;
    }

    private async createScene() {
        this.scene.clearColor = new Color4(135 / 255, 206 / 255, 235 / 255, 1.0);

        var camera = new UniversalCamera("camera1", new Vector3(130, 50, 0), this.scene); //grand canyon

        camera.setTarget(Vector3.Zero());
        camera.attachControl(this.canvas, true);

        camera.speed = 0.5;
        camera.angularSensibility = 8000;
        
        //from https://doc.babylonjs.com/divingDeeper/environment/skybox
        var skybox = MeshBuilder.CreateBox("skyBox", { size: 1000.0 }, this.scene);
        var skyboxMaterial = new StandardMaterial("skyBox", this.scene);
        skyboxMaterial.backFaceCulling = false;
        skyboxMaterial.reflectionTexture = new CubeTexture("textures/TropicalSunnyDay", this.scene);
        //skyboxMaterial.reflectionTexture = new CubeTexture("textures/skybox", scene);
        skyboxMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
        skyboxMaterial.diffuseColor = new Color3(0, 0, 0);
        skyboxMaterial.specularColor = new Color3(0, 0, 0);
        skybox.material = skyboxMaterial;
                
        var light = new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);
        light.intensity = 0.5;

        var light2 = new DirectionalLight("DirectionalLight", new Vector3(0, -1, 1), this.scene);
        light2.intensity=0.5;        

        this.ourTS = new TileSet(4,50,this.maxPrecision,this.scene, this.engine);
        await this.getMapboxKey("mapbox-key.txt");
        this.ourTS.setRasterProvider("MB",this.mapboxKey);
       
        const zoom = 14; 

        this.ourTS.updateRaster(36.10054279295824, -112.11265952053303, zoom); //grand canyon

        this.ourTS.generateTerrain(1.0).then(() => {
            console.log("all terrain ready!");
        });

        // Show the debug scene explorer and object inspector
        // You should comment this out when you build your final program 
        this.scene.debugLayer.show();
    }

    // The main update loop will be executed once per frame before the scene is rendered
    // modify camera flythrough?
    private update(): void {
        this.ourTS.processBuildingRequests();

    }
}
/******* End of the Game class ******/

// start the game
var game = new Game();
game.start();