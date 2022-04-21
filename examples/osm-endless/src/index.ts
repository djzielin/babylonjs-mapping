/* Web-Based-VR-Tutorial Project Template
* Author: Evan Suma Rosenberg <suma@umn.edu> and Blair MacIntyre <blair@cc.gatech.edu>
* License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
*/

// Extended by David J. Zielinski

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector2 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Color3 } from "@babylonjs/core/Maths/math";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder"
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ActionManager, KeyboardEventTypes, KeyboardInfo } from "@babylonjs/core";
import { ExecuteCodeAction } from "@babylonjs/core";
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

import * as GUI from "@babylonjs/gui/";

import "@babylonjs/core/Materials/standardMaterial"
import "@babylonjs/inspector";

import CsvData from "./CsvData";
//import OpenStreetMap from "./babylonjs-mapping/OpenStreetMap";
//import MapBox from "./babylonjs-mapping/MapBox";

import TileSet from "babylonjs-mapping";

class Game {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;

    private ourCSV: CsvData;
    private ourTS: TileSet;

    private lastSelectedSphereIndex: number=-1;
    private lastSelectedSphere: Mesh;
    //private previousButton: GUI.Button;

    private spherePositions: Vector3[]=[];

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

    private async createScene() {
        /*
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
        */

        this.camera = new UniversalCamera("camera1", new Vector3(0, 10, 0), this.scene);
        //var camera = new UniversalCamera("camera1", new Vector3(90, 45, 0), this.scene); //grand canyon

        //this.camera.setTarget(new Vector3(0,0,1));
        this.camera.attachControl(this.canvas, true);

        this.camera.speed=0.0;
        this.camera.angularSensibility=8000;  
        

        var light = new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);
        light.intensity = 0.5; 

        var light2 = new DirectionalLight("DirectionalLight", new Vector3(0, -1, 1), this.scene);
        light2.intensity=0.5;

        this.ourCSV = new CsvData();
        await this.ourCSV.processURL(window.location.href + "JCSU.csv");

        this.ourTS = new TileSet(16, 25, 2, this.scene,);
        this.ourTS.setRasterProvider("OSM");
 
        const centerCoords = new Vector2(-80.8400777, 35.21); //charlotte
        //const centerCoords = new Vector2(-112.11265952053303, 36.10054279295824); //grand canyon
        //const centerCoords = new Vector2(31.254708, 29.852183); //egypt

        this.ourTS.updateRaster(centerCoords, 16);

        //for troubleshooting Lat/Lon to world coordinates calculations
        /*var myMaterial = new StandardMaterial("infoSpotMaterial", this.scene);
        myMaterial.diffuseColor = new Color3(1, 0, 0.25);
        const convertedPos=this.ourTS.GetWorldPosition(new Vector2(-80.842656,35.2182254));
        
        const sphere = MeshBuilder.CreateSphere("test", { diameter: 1.0, segments: 4 }, this.scene);
        sphere.position.y = 0;
        sphere.position.x = convertedPos.x;
        sphere.position.z = convertedPos.y;
        sphere.material=myMaterial;
        */

        this.ourTS.generateBuildings(3,true);        

        // Show the debug scene explorer and object inspector
        // You should comment this out when you build your final program
        this.scene.debugLayer.show(); 


        this.scene.onKeyboardObservable.add((e: KeyboardInfo) => {
            if (e.type == KeyboardEventTypes.KEYDOWN) {
                if(e.event.key=="d"){
                    this.keyRight=true;
                }
                if(e.event.key=="a"){
                    this.keyLeft=true;
                }
                if(e.event.key=="w"){
                    this.keyUp=true;
                }
                if(e.event.key=="s"){
                    this.keyDown=true;
                }

            } else {
                console.log("key up: " + e.event.key);

                if(e.event.key=="d"){
                    this.keyRight=false;
                }
                if(e.event.key=="a"){
                    this.keyLeft=false;
                }
                if(e.event.key=="w"){
                    this.keyUp=false;
                }
                if(e.event.key=="s"){
                    this.keyDown=false;
                }
            }           
        });
    }

    // The main update loop will be executed once per frame before the scene is rendered
    // modify camera flythrough?
    private update(): void {
        const fVec=Vector3.TransformCoordinates(Vector3.Forward(), this.camera.getWorldMatrix());
        const rVec=Vector3.TransformCoordinates(Vector3.Right(), this.camera.getWorldMatrix());
      
        const deltaTimeSeconds=this.engine.getDeltaTime()*0.001;

        let movVec: Vector3=Vector3.Zero();
        let forwardAmount=0;
        let rightAmount=0;
        
        if(this.keyLeft){
            rightAmount+=10*deltaTimeSeconds;
        }
        if(this.keyRight){
            rightAmount+=-10*deltaTimeSeconds;
        }
        if(this.keyUp){
            forwardAmount+=-10*deltaTimeSeconds; 
        }
        if(this.keyDown){
            forwardAmount+=10*deltaTimeSeconds;
        }

        if(Math.abs(forwardAmount)>0.0 || Math.abs(rightAmount)>0.0){
            movVec=movVec.add(fVec.multiplyByFloats(forwardAmount,forwardAmount,forwardAmount));
            movVec=movVec.add(rVec.multiplyByFloats(rightAmount,rightAmount,rightAmount));
            this.ourTS.moveAllTiles(movVec.x, movVec.z, true, true, true);
        }

        this.ourTS.processBuildingRequests();
    }

}
/******* End of the Game class ******/

// start the game
var game = new Game();
game.start();