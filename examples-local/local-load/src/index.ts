/* Web-Based-VR-Tutorial Project Template
* Author: Evan Suma Rosenberg <suma@umn.edu> and Blair MacIntyre <blair@cc.gatech.edu>
* License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
*/

// Extended by David J. Zielinski

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math";
import { Color4 } from "@babylonjs/core/Maths/math";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Button } from "@babylonjs/gui/2D/controls/button";
import { TextBlock } from "@babylonjs/gui";
import { Control } from "@babylonjs/gui";
import { StandardMaterial } from "@babylonjs/core";
import "@babylonjs/core/Materials/standardMaterial"
import "@babylonjs/inspector";

import TileSet from "../../../lib/TileSet"
import BuildingsOSM from "../../../lib/BuildingsOSM";
import RasterOSM from "../../../lib/RasterOSM";
import BuildingsWFS from "../../../lib/BuildingsWFS";
import { RetrievalLocation, RetrievalType } from "../../../lib/Buildings";
import { EPSG_Type }     from "../../../lib/TileMath";

export interface propertiesCharlotte {
    "Additional_Information": string;    
    "Address": string;
    "Block_Number": string;
    "Date": string
    "Drawing_Number": string;
    "GlobalID": string;
    "GmlID": string;
    "Housing_Condition": string;
    "Land_Type": string;
    "OBJECTID": number;
    "Plot_Number": string;
    "Shape__Area": number;
    "Shape__Length": number;
    "Story": string;
    "Street": string;
}

class Game {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;

    private ourTS: TileSet;

    public allBuildings1: Mesh[] = [];
    public allBuildings2: Mesh[] = [];

    private ourBlueMaterial: StandardMaterial;
    private ourRedMaterial: StandardMaterial;
    private ourGreenMaterial: StandardMaterial;

    public buildingDumpCSV="";

    constructor() {
        // Get the canvas element 
        this.canvas = document.getElementById("renderCanvas") as unknown as HTMLCanvasElement;

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
        /*const ourOverlay = this.ourTS.getAdvancedDynamicTexture();

        const textBlock = new TextBlock();
        textBlock.text = "On Desktop, use arrow keys and mouse to navigate";
        textBlock.color = "white";
        textBlock.fontSize = 24;

        textBlock.textVerticalAlignment=Control.VERTICAL_ALIGNMENT_TOP;
        textBlock.textHorizontalAlignment=Control.HORIZONTAL_ALIGNMENT_LEFT;

        textBlock.left = "10px";
        textBlock.top = "10px"; 

        // Add the text block to the texture
        ourOverlay.addControl(textBlock);    
        */    
    }

    private async createScene() {
        this.scene.clearColor = new Color4(135 / 255, 206 / 255, 235 / 255, 1.0);

        var camera = new UniversalCamera("camera1", new Vector3(0, 40, -80), this.scene);
        camera.setTarget(Vector3.Zero());
        camera.attachControl(this.canvas, true);
        camera.speed=0.5;
        camera.angularSensibility=8000;
        
        var light = new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);
        light.intensity = 0.5;

        var light2 = new DirectionalLight("DirectionalLight", new Vector3(0, -1, 1), this.scene);
        light2.intensity=0.5;

        this.ourBlueMaterial = new StandardMaterial("blue_color", this.scene);
        this.ourBlueMaterial.diffuseColor = new Color3(0.0, 0.0, 1.0);

        this.ourRedMaterial = new StandardMaterial("red_color", this.scene);
        this.ourRedMaterial.diffuseColor = new Color3(1.0, 0.0, 0.0);

        this.ourGreenMaterial = new StandardMaterial("green_color", this.scene);
        this.ourGreenMaterial.diffuseColor = new Color3(0.0, 1.0, 0.0);

        this.ourTS = new TileSet(this.scene,this.engine);
        this.ourTS.setRasterProvider(new RasterOSM(this.ourTS)); //raster basemap to OSM
        this.ourTS.createGeometry(new Vector2(4,4), 25, 2); //4x4 tile set, 20m width of each tile, and 2 divisions on each tile
        this.ourTS.updateRaster(35.2258461, -80.8400777, 16); //lat, lon, zoom. takes us to charlotte. 

        const url2a = "https://dservices1.arcgis.com/XBhYkoXKJCRHbe7M/arcgis/services/Building_Union_ExportFeatures_Corrected_Data_Sep_3/WFSServer?";
        const layer2a = "Building_Union_ExportFeatures_Corrected_Data_Sep_3:Building_Union_ExportFeatures1"

        const customBuildingGenerator = new BuildingsWFS(
            "buildings1",
            url2a,
            layer2a,
            EPSG_Type.EPSG_4326,
            //this.ourTS,RetrievalLocation.Remote_and_Save);
            this.ourTS,RetrievalLocation.Local);

        customBuildingGenerator.setupAGOL();
        customBuildingGenerator.retrievalType=RetrievalType.AllData; //NEW: lets try and pull all the data at once!
        customBuildingGenerator.doMerge = false;
        customBuildingGenerator.buildingMaterial=this.ourBlueMaterial;
        customBuildingGenerator.generateBuildings();

        customBuildingGenerator.onCaughtUpObservable.addOnce(() => {
              
        });        
        
       
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