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
import { ActionManager, InstancedMesh, Material } from "@babylonjs/core";
import { ExecuteCodeAction } from "@babylonjs/core";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Button } from "@babylonjs/gui/2D/controls/button";
import { Control, Checkbox } from "@babylonjs/gui/2D/controls"; 
import { StackPanel, Rectangle, TextBlock, Image} from "@babylonjs/gui/2D/controls"; 
import { SceneLoader } from "@babylonjs/core";
import {ISceneLoaderAsyncResult} from "@babylonjs/core";
import { BoundingInfo } from "@babylonjs/core";

import "@babylonjs/core/Materials/standardMaterial"
import "@babylonjs/inspector";

import CsvData from "./CsvData";
//import OpenStreetMap from "./babylonjs-mapping/OpenStreetMap";
//import MapBox from "./babylonjs-mapping/MapBox";

import TileSet from "babylonjs-mapping";
import PropertyGUI from "./propertyGUI";
import { ProjectionType } from "babylonjs-mapping";
import { conflictingValuesPlaceholder } from "@babylonjs/inspector/lines/targetsProxy";

export interface propertiesCharlotte {
    "Shape_Leng": number;
    "Shape_Area": number;
    "Block_numb": string;
    "Drawing_nu": string;
    "Plot_numbe": string;
    "Land_type": string;
    "Housing_co": string;
    "Church": string;
}

export interface CustomBuildings {
    "id": string;
    "filename": string;
}

export interface AllCustomBuildings {
    "buildings": CustomBuildings[];
}

export class Game {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    public scene: Scene;

    private ourCSV: CsvData;
    private ourTS: TileSet;

    private lastSelectedBuildingIndex: number=-1;
    private lastSelectedBuilding: Mesh;
    private previousButton: Button;

    public allBuildings: Mesh[] = [];

    public advancedTexture: AdvancedDynamicTexture;

    public propertyGUIs: PropertyGUI[]=[];
    public ourCustomBuildings: AllCustomBuildings;

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

    private loadCustomBuildingsJSON(){
        const url=window.location.href + "custom_buildings.json";

        fetch(url).then((res) => {
            //console.log("  fetch returned: " + res.status);

            if (res.status == 200) {
                res.text().then(
                    (text) => {
                        //console.log("about to json parse for tile: " + tile.tileCoords);
                        if (text.length == 0) {
                            //console.log("no buildings in this tile!");
                            return;
                        }
                        this.ourCustomBuildings = JSON.parse(text);
                    }
                )
            }
        });
    }

    private async replaceSimpleBuildingsWithCustom() {
        const buildingMaterial = new StandardMaterial("merged buildingMaterial");
        buildingMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8);
        

        for (let c of this.ourCustomBuildings.buildings) {
            var loadResult: ISceneLoaderAsyncResult = await SceneLoader.ImportMeshAsync("", "./", c.filename, this.scene);
            console.log("number of meshes loaded: " + loadResult.meshes.length);

            const realMeshes: Mesh[] = [];

            for (let m of loadResult.meshes) {
                if (m.getClassName() == "Mesh") {
                    const pureMesh = m as Mesh;

                    if (pureMesh.getTotalVertices() > 0) {
                        realMeshes.push(pureMesh);
                    }
                } else if (m.getClassName() == "InstancedMesh") {
                    //per https://forum.babylonjs.com/t/how-to-replace-instancedmesh-with-a-mesh/6185
                    const instanceMesh = m as InstancedMesh;
                    const newMesh = instanceMesh.sourceMesh.clone(instanceMesh.name + "non_instance", instanceMesh.parent)
                    newMesh.position = instanceMesh.position.clone();
                    if (instanceMesh.rotationQuaternion)
                        newMesh.rotationQuaternion = instanceMesh.rotationQuaternion.clone();
                    newMesh.scaling = instanceMesh.scaling.clone();

                    if (newMesh.getTotalVertices() > 0) {
                        realMeshes.push(newMesh);
                    }
                }
            }

            console.log("trying to merge now");
            const merged = Mesh.MergeMeshes(realMeshes);
            if (merged) {
                console.log("succesfully merged building pieces");
                merged.name = "merged_building_pieces";
            } else {
                console.log("unable to merge all building meshes!");
                continue;
            }

            for (let m of loadResult.meshes) {
                m.dispose();
            }
            for (let t of loadResult.transformNodes) {
                t.dispose();
            }

            for (let l of loadResult.lights) {
                l.dispose();
            }
            for (let g of loadResult.geometries) {
                g.dispose();
            }

            console.log("custom building loaded for: " + c.id);

            for (let b of this.allBuildings) {
              
                if(b.name.includes(c.id)){ //DANGER: this is dangerous!, as 11 will be found in 1011
                    console.log("found site for custom building!");
                    
                    b.showBoundingBox=true;
                    merged.showBoundingBox=true;
                    const bbounds: BoundingInfo=b.getBoundingInfo()
                    const ibounds: BoundingInfo=merged.getBoundingInfo();

                    const correctRadius=bbounds.boundingSphere.radius;
                    const importRadius=ibounds.boundingSphere.radius;
                    const scaleCorrection=correctRadius/importRadius;
                    merged.scaling=merged.scaling.multiplyByFloats(scaleCorrection,scaleCorrection,scaleCorrection);

                    /*const correctPosition=bbounds.boundingSphere.center;
                    const importPosition=ibounds.boundingSphere.center;
                    const positionCorrection=correctPosition.subtract(importPosition);
                    merged.position=merged.position.add(positionCorrection);*/


                }
                
            }
        }
        console.log("finished loading all custom buildings");
    }

    private async createScene() {
        this.loadCustomBuildingsJSON();

        this.scene.clearColor = new Color4(135/255,206/255,235/255, 1.0);

        var camera = new UniversalCamera("camera1", new Vector3(10, 10, -50), this.scene);
    
        //var camera = new UniversalCamera("camera1", new Vector3(90, 45, 0), this.scene); //grand canyon
        
        camera.setTarget(new Vector3(15,-15,30));
        camera.attachControl(this.canvas, true);

        camera.speed=0.5;
        camera.angularSensibility=8000;
        

        var light = new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);
        light.intensity = 0.5;

        var light2 = new DirectionalLight("DirectionalLight", new Vector3(0, -1, 1), this.scene);
        light2.intensity=0.5;

        this.ourCSV = new CsvData();
        await this.ourCSV.processURL(window.location.href + "JCSU.csv");

        this.ourTS = new TileSet(new Vector2(4,4), 25, 2, this.scene,this.engine);
        this.ourTS.setRasterProvider("OSM");

        this.ourTS.updateRaster(35.2258461, -80.8400777, 16); //charlotte
        //this.ourTS.generateBuildings(3, true);
        this.ourTS.generateBuildingsCustom("https://virtualblackcharlotte.net/geoserver/Charlotte/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=Charlotte%3AFootprint_Test&outputFormat=application%2Fjson",ProjectionType.EPSG_3857,2,false);


        /*var myMaterial = new StandardMaterial("infoSpotMaterial", this.scene);
        myMaterial.diffuseColor = new Color3(0, 1, 0.25);
        myMaterial.freeze();*/

        var myMaterialHighlight = new StandardMaterial("infoSpotMaterialHighlight", this.scene);
        myMaterialHighlight.diffuseColor = new Color3(1, 1, 1);
        myMaterialHighlight.freeze();

        this.advancedTexture = this.ourTS.getAdvancedDynamicTexture();

        this.ourTS.osmBuildings.onCustomLoaded.add(() => {
           
            for (let t of this.ourTS.ourTiles) {
                //console.log("tile: " + t.mesh.name + " contains buildings: " + t.buildings.length);
                for (let b of t.buildings) {
                    this.allBuildings.push(b);
                }
            }
            console.log("buildings found: " + this.allBuildings.length);

            for (let i = 0; i < this.allBuildings.length; i++) {
                const b = this.allBuildings[i];
                const props = b.metadata as propertiesCharlotte;
                const ourMap: Map<string,string>=new Map<string,string>();          
                
                ourMap.set("Shape_Leng",props.Shape_Leng.toString());
                ourMap.set("Shape_Area",props.Shape_Area.toString());
                ourMap.set("Block_numb", props.Block_numb);
                ourMap.set("Drawing_nu", props.Drawing_nu);
                ourMap.set("Plot_numbe", props.Plot_numbe);
                ourMap.set("Land_type", props.Land_type);
                ourMap.set("Housing_co", props.Housing_co);
                ourMap.set("Church", props.Church);

                b.metadata=ourMap; //replace interface data with our new map!
            }

            var panel = new StackPanel();   
            panel.width = "200px";
            panel.height = 1.0;
            panel.isVertical = true;
            panel.background = "white";
            panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    
            this.advancedTexture.addControl(panel);

            const pgui=new PropertyGUI("Land_type", this);
            pgui.generateGUI(panel);
            this.propertyGUIs.push(pgui);

            const pgui1=new PropertyGUI("Housing_co", this);
            pgui1.generateGUI(panel);
            this.propertyGUIs.push(pgui1);

            const pgui2 = new PropertyGUI("Church", this);
            pgui2.generateGUI(panel);
            this.propertyGUIs.push(pgui2);

            this.replaceSimpleBuildingsWithCustom().then(() => {

                console.log("setting up buildings to be clickable now");
                for (let i = 0; i < this.allBuildings.length; i++) {
                    const b = this.allBuildings[i];
                    b.isPickable = true;
                    //console.log("setting up building: " + b.name);
                    b.actionManager = new ActionManager(this.scene);
                    b.actionManager.registerAction(
                        new ExecuteCodeAction(
                            {
                                trigger: ActionManager.OnPickTrigger //OnPointerOverTrigger
                            },
                            () => {
                                console.log("user clicked on building: " + b.name);

                                const originalMaterial = b.material;
                                b.material = myMaterialHighlight;

                                if (this.lastSelectedBuildingIndex == i) {
                                    console.log("user clicked object that is already selected!");
                                    return;
                                }


                                if (this.lastSelectedBuildingIndex >= 0) {
                                    this.lastSelectedBuilding.material = originalMaterial;
                                    this.advancedTexture.removeControl(this.previousButton);
                                    this.previousButton.dispose();
                                }

                                const props = b.metadata as Map<string, string>;

                                let popupText: string = "";
                                popupText += "id: " + b.name + "\n";
                                popupText += "Block_numb: " + props.get("Block_numb") + "\n";
                                popupText += "Drawing_nu: " + props.get("Drawing_nu") + "\n";
                                popupText += "Plot_numbe: " + props.get("Plot_numbe") + "\n";
                                popupText += "Land_type: " + props.get("Land_type") + "\n";
                                popupText += "Housing_co: " + props.get("Housing_co") + "\n";
                                popupText += "Church: " + props.get("Church") + "\n";

                                const button: Button = Button.CreateSimpleButton("but", popupText);
                                button.width = "300px";
                                button.height = "200px";
                                button.color = "white";

                                button.background = "black";
                                button.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
                                button.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;

                                if (button.textBlock) {
                                    button.textBlock.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
                                }
                                this.advancedTexture.addControl(button);

                                button.onPointerClickObservable.add(() => {
                                    console.log("user clicked on button");
                                    b.material = originalMaterial;
                                    this.lastSelectedBuildingIndex = -1;
                                    this.advancedTexture.removeControl(button);
                                    button.dispose();
                                });

                                this.lastSelectedBuildingIndex = i;
                                this.lastSelectedBuilding = b;
                                this.previousButton = button;

                            }
                        )
                    );
                }
            });
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