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
import { RetrievalType } from "../../../lib/Buildings";
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
        //this.ourTS.createGeometry(new Vector2(1,1), 25, 2);
        this.ourTS.updateRaster(35.2258461, -80.8400777, 16); //lat, lon, zoom. takes us to charlotte. 

        const url2a = "https://dservices1.arcgis.com/XBhYkoXKJCRHbe7M/arcgis/services/Building_Union_ExportFeatures_Corrected_Data_Sep_3/WFSServer?";
        const layer2a = "Building_Union_ExportFeatures_Corrected_Data_Sep_3:Building_Union_ExportFeatures1"

        const customBuildingGenerator = new BuildingsWFS(
            "buildings1",
            url2a,
            layer2a,
            EPSG_Type.EPSG_4326,
            this.ourTS);

        customBuildingGenerator.setupAGOL();
        customBuildingGenerator.retrievalType=RetrievalType.AllData; //NEW: lets try and pull all the data at once!
        customBuildingGenerator.doMerge = false;
        customBuildingGenerator.buildingMaterial=this.ourBlueMaterial;
        customBuildingGenerator.generateBuildings();

        const url2b = "https://dservices1.arcgis.com/XBhYkoXKJCRHbe7M/arcgis/services/DukeSanborn_Buildings_1951/WFSServer?";
        const layer2b = "DukeSanborn_Buildings_1951:DukeSanborn_Buildings_1951"

        const customBuildingGenerator2 = new BuildingsWFS(
            "buildings2",
            url2b,
            layer2b,
            EPSG_Type.EPSG_4326,
            this.ourTS);

        customBuildingGenerator2.setupAGOL();
        customBuildingGenerator2.retrievalType=RetrievalType.AllData; //NEW: lets try and pull all the data at once!
        customBuildingGenerator2.doMerge = false;
        customBuildingGenerator2.buildingMaterial = this.ourRedMaterial;
        customBuildingGenerator2.generateBuildings();    

        const obs1Promise = new Promise<void>((resolve) => {
            customBuildingGenerator.onCaughtUpObservable.addOnce(() => {
                resolve();
            });
        });
        
        const obs2Promise = new Promise<void>((resolve) => {
            customBuildingGenerator2.onCaughtUpObservable.addOnce(() => {
                resolve();
            });
        });

        Promise.all([obs1Promise,obs2Promise]).then(() => {
            this.setupBuildingsArrays(); // Trigger after both are done
            this.processMetaData(this.allBuildings1, "Building_Union_ExportFeatures_Corrected_Data_Sep_3");
            this.processMetaData(this.allBuildings2, "DukeSanborn_Buildings_1951");
            this.dumpData();
        });        
        
        /* const url2 = "https://dservices1.arcgis.com/XBhYkoXKJCRHbe7M/arcgis/services/VBC_2_7_24_BuildingUnion_WFS/WFSServer?";
        const layer2 = "VBC_2_7_24_BuildingUnion_WFS:Building_Union";

        const customBuildingGenerator3 = new BuildingsWFS(
            "buildings_orig",
            url2,
            layer2,
            ProjectionType.EPSG_4326,
            this.ourTS);

        customBuildingGenerator3.setupAGOL();
        customBuildingGenerator3.doMerge = false;
        customBuildingGenerator3.buildingMaterial = this.ourGreenMaterial;
        customBuildingGenerator3.generateBuildings();  
        
        customBuildingGenerator3.onCaughtUpObservable.addOnce(() => {
            this.setupBuildings();
        });  */

        // Show the debug scene explorer and object inspector
        // You should comment this out when you build your final program 
        this.scene.debugLayer.show();
        
        this.setupHelpText();
    }

    public setupBuildingsArrays(){
        for (let t of this.ourTS.ourTiles) {
            for (let b of t.buildings) {
                if (b.ShapeType === "buildings1") {
                    this.allBuildings1.push(b.mesh);
                }
                if (b.ShapeType === "buildings2") {
                    this.allBuildings2.push(b.mesh);
                }
            }
        }
    }

    public processMetaData(allBuildings: Mesh[], dataSource: string){
           
        //parse metadata into easy to use Map
        for (let i = 0; i < allBuildings.length; i++) {
            const b = allBuildings[i];
            const props = b.metadata as propertiesCharlotte;
            const ourMap: Map<string, string> = new Map<string, string>();

            ourMap.set("Additional_Information", props.Additional_Information ? props.Additional_Information : "none");
            ourMap.set("Address", props.Address ? props.Address : "none");
            ourMap.set("Block_Number", props.Block_Number ? props.Block_Number : "0");
            ourMap.set("Date", props.Date ? props.Date : "none");
            ourMap.set("Drawing_Number", props.Drawing_Number ? props.Drawing_Number : "none");
            ourMap.set("GlobalID", props.GlobalID ? props.GlobalID : "none");
            ourMap.set("GmlID", props.GmlID ? props.GmlID : "none");
            ourMap.set("Housing_Condition", props.Housing_Condition ? props.Housing_Condition : "none");
            ourMap.set("Land_Type", props.Land_Type ? props.Land_Type : "none");
            ourMap.set("OBJECTID", props.OBJECTID ? props.OBJECTID.toString() : "0");
            ourMap.set("Plot_Number", props.Plot_Number ? props.Plot_Number : "0");
            ourMap.set("Shape_Length", props.Shape__Length ? props.Shape__Length.toString() : "0");
            ourMap.set("Shape_Area", props.Shape__Area ? props.Shape__Area.toString() : "0");              
            ourMap.set("Story", props.Story ? props.Story : "0");
            ourMap.set("Street", props.Street ? props.Street : "none");
 
            b.name = ourMap.get("Address") + " " + ourMap.get("Street");
            
            const a=ourMap.get("Address")!.replace(/,/g, "");
            const s=ourMap.get("Street")!.replace(/,/g, "");

            const row=ourMap.get("OBJECTID")+dataSource[0]+","+a  + "," + s + "," + dataSource + "\n";
            this.buildingDumpCSV+=row;           
        }
    }

    public dumpData() {
        //dump data out to file for user!
        var a = document.createElement("a");
        a.href = window.URL.createObjectURL(new Blob([this.buildingDumpCSV], { type: "text/plain" }));
        a.download = "buildings.csv";
        a.click();
    }

    private update(): void {

    }

}
/******* End of the Game class ******/

// start the game
var game = new Game();
game.start();