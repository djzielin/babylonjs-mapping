// example of bringing in user position (lat/lon) data points
// example of "real" ie 1:1 object scale

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
import { Color4 } from "@babylonjs/core/Maths/math";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder"
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ActionManager } from "@babylonjs/core";
import { ExecuteCodeAction } from "@babylonjs/core";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Button } from "@babylonjs/gui/2D/controls/button";
import { TextBlock } from "@babylonjs/gui";
import { Control } from "@babylonjs/gui";

import "@babylonjs/core/Materials/standardMaterial"
import "@babylonjs/inspector";

import CsvData from "./CsvData";
//import OpenStreetMap from "./babylonjs-mapping/OpenStreetMap";
//import MapBox from "./babylonjs-mapping/MapBox";

import TileSet from "babylonjs-mapping";
import BuildingsOSM from "babylonjs-mapping/lib/BuildingsOSM";
import { ProjectionType } from "babylonjs-mapping/lib/TileMath";
import RasterOSM from "babylonjs-mapping/lib/RasterOSM";

class Game {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;

    private ourCSV: CsvData;
    private ourTS: TileSet;
    private ourOSM: BuildingsOSM;

    private lastSelectedSphereIndex: number=-1;
    private lastSelectedSphere: Mesh;
    private previousButton: Button;

    private spherePositions: Vector3[]=[];

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
        textBlock.text = "On Desktop, use arrow keys and mouse to navigate\nclick on green info spots";
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
        this.scene.clearColor = new Color4(135/255,206/255,235/255, 1.0);

        var camera = new UniversalCamera("camera1", new Vector3(0, 800, -1500), this.scene);
        camera.setTarget(Vector3.Zero());
        camera.attachControl(this.canvas, true);
        camera.speed=10;
        camera.angularSensibility=2000;        

        var light = new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);
        light.intensity = 0.5;

        var light2 = new DirectionalLight("DirectionalLight", new Vector3(0, -1, 1), this.scene);
        light2.intensity=0.5;

        this.ourCSV = new CsvData();
        await this.ourCSV.processURL(window.location.href + "JCSU.csv");

        this.ourTS = new TileSet(this.scene,this.engine);

        const tileSize=this.ourTS.ourTileMath.computeTileRealWidthMeters(35.2258461, 16); //this is how 1:1 scale is setup 
        this.ourTS.createGeometry(new Vector2(4,4), tileSize, 2);

        this.ourTS.setRasterProvider(new RasterOSM(this.ourTS));

        this.ourTS.updateRaster(35.2258461, -80.8400777, 16); //charlotte

        const accessToken=await this.getKey("osmb-key.txt"); //new: OSMB now requires access token
        this.ourOSM=new BuildingsOSM(this.ourTS);
        this.ourOSM.accessToken=accessToken;
        this.ourOSM.doMerge=true;
        this.ourOSM.exaggeration=1;
        this.ourOSM.generateBuildings();

        var myMaterial = new StandardMaterial("infoSpotMaterial", this.scene);
        myMaterial.diffuseColor = new Color3(0, 1, 0.25);
        myMaterial.freeze();

        var myMaterialHighlight = new StandardMaterial("infoSpotMaterialHighlight", this.scene);
        myMaterialHighlight.diffuseColor = new Color3(1, 1, 0.25);
        myMaterialHighlight.freeze();

        var advancedTexture = AdvancedDynamicTexture.CreateFullscreenUI("UI");

        for (let i = 0; i < this.ourCSV.numRows(); i++) {

            const ourPos = this.ourCSV.getCoordinates(i);
            console.log("trying to place: " + ourPos);
            const convertedPos = this.ourTS.ourTileMath.GetWorldPosition(ourPos, ProjectionType.EPSG_4326);

            const sphere = MeshBuilder.CreateSphere(this.ourCSV.getRow(i)[2], { diameter: 20.0, segments: 4 }, this.scene);

            sphere.position=convertedPos;
            sphere.isVisible = true;
            sphere.material = myMaterial;

            //make sure we arent overlapping with existing sphere
            for(let v of this.spherePositions){
                const d=Vector3.Distance(v,sphere.position);

                if(d<1.0){
                    console.log("overlap detected on: " + sphere.name);
                    sphere.position.x+=Math.random()*40-20.0; //move it over a bit
                    sphere.position.z+=Math.random()*40-20.0;
                    break;
                }
            }
            this.spherePositions.push(sphere.position.clone());

            sphere.actionManager = new ActionManager(this.scene);
            sphere.actionManager.registerAction(
                new ExecuteCodeAction(
                    {
                        trigger: ActionManager.OnPickTrigger //OnPointerOverTrigger
                    },
                    () => {
                        console.log("over item: " + sphere.name);
                        sphere.material = myMaterialHighlight;

                        if(this.lastSelectedSphereIndex==i){
                            console.log("user clicked object that is already selected!");
                            return;
                        }


                        if (this.lastSelectedSphereIndex >= 0) {
                            this.lastSelectedSphere.material = myMaterial;
                            advancedTexture.removeControl(this.previousButton);
                            this.previousButton.dispose();
                        }                     

                        const text="Name: " + sphere.name + "\n\n" + "Description: " + this.ourCSV.getRow(i)[3];

                        const button: Button = Button.CreateSimpleButton("but", text);
                        button.width = 0.5;
                        button.height = 0.25;
                        button.color = "white";
                        button.background = "black";

                        advancedTexture.addControl(button);    

                        button.onPointerClickObservable.add( ()=>{
                            console.log("user clicked on button");
                            sphere.material = myMaterial;
                            this.lastSelectedSphereIndex=-1;
                            advancedTexture.removeControl(button);
                            button.dispose();
                        });
                    
                        this.lastSelectedSphereIndex = i;
                        this.lastSelectedSphere = sphere;
                        this.previousButton=button;
                    }
                )
            );

            sphere.bakeCurrentTransformIntoVertices();
            sphere.freezeWorldMatrix();            
        }

        // Show the debug scene explorer and object inspector
        // You should comment this out when you build your final program 
        this.scene.debugLayer.show();
        this.setupHelpText();
    }

    private update(): void {
       
    }

}
/******* End of the Game class ******/

// start the game
var game = new Game();
game.start();