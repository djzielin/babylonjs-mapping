/* Web-Based-VR-Tutorial Project Template
* Author: Evan Suma Rosenberg <suma@umn.edu> and Blair MacIntyre <blair@cc.gatech.edu>
* License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
*/

// Extended by David J. Zielinski

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4, Quaternion } from "@babylonjs/core/Maths/math";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Button } from "@babylonjs/gui/2D/controls/button";
import { TextBlock } from "@babylonjs/gui";
import { Control } from "@babylonjs/gui";
import { StandardMaterial } from "@babylonjs/core";
import { Color3 } from "@babylonjs/core/Maths/math";
import { DynamicTexture } from "@babylonjs/core";
import { Matrix } from "@babylonjs/core/Maths/math";
import "@babylonjs/core/Materials/standardMaterial"
import "@babylonjs/inspector";

//Note: these imports are for doing this locally. 
import TileSet from      "../../../lib/TileSet"
import BuildingsOSM from "../../../lib/BuildingsOSM";
import RasterOSM from    "../../../lib/RasterOSM";
import BuildingsWFS from "../../../lib/BuildingsWFS";
import { ProjectionType } from "../../../lib/TileMath";
import TileBuilding from "../../../lib/TileBuilding";
import { coordinateArray, coordinateArrayOfArrays } from "../../../lib/GeoJSON";
import { MeshBuilder } from "@babylonjs/core";
import {LineTestReturnPacket} from "../../../lib/TileBuilding";

class Game {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;

    private ourTS: TileSet;
    private ourPoints: BuildingsWFS;
    private loadedStreets: TileBuilding[]=[];

    private lastSelectedSphereIndex: number=-1;
    private lastSelectedSphere: Mesh;
    private previousButton: Button;

    public ourBlackMaterial: StandardMaterial;

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

        this.ourBlackMaterial = new StandardMaterial("black_color", this.scene);
        this.ourBlackMaterial.diffuseColor = new Color3(0, 0, 0);
        this.ourBlackMaterial.freeze();
        
        var light = new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);
        light.intensity = 0.5;

        var light2 = new DirectionalLight("DirectionalLight", new Vector3(0, -1, 1), this.scene);
        light2.intensity=0.5;

        this.ourTS = new TileSet(this.scene,this.engine);
        this.ourTS.setRasterProvider(new RasterOSM(this.ourTS)); //raster basemap to OSM
        this.ourTS.createGeometry(new Vector2(4,4), 20, 2); //4x4 tile set, 20m width of each tile, and 2 divisions on each tile
        this.ourTS.updateRaster(35.2258461, -80.8400777, 16); //lat, lon, zoom. takes us to charlotte. 

        const url3 = "https://dservices1.arcgis.com/XBhYkoXKJCRHbe7M/arcgis/services/Brooklyn_Businesses_3/WFSServer?";
        const layer3 = "Brooklyn_Businesses_3:BrooklynBusinesses3"

        this.ourPoints = new BuildingsWFS(
            "streets",
            url3,
            layer3,
            ProjectionType.EPSG_4326,
            this.ourTS
        );

        this.ourPoints.setupAGOL();
        this.ourPoints.doMerge = false;
        this.ourPoints.defaultBuildingHeight = 0.1;
        this.ourPoints.buildingMaterial = this.ourBlackMaterial;
        this.ourPoints.generateBuildings();

        this.ourPoints.onCaughtUpObservable.addOnce(() => {
            console.log("completed loading all points!");
            //this.setupLines();
        });


        // Show the debug scene explorer and object inspector
        // You should comment this out when you build your final program 
        this.scene.debugLayer.show();

        this.setupHelpText();
    }

    /*private setupLines(){
        for (let t of this.ourTS.ourTiles) {
            console.log("tile: " + t.mesh.name + " contains buildings: " + t.buildings.length);
            for (let b of t.buildings) {
                console.log("  building shape type: " + b.ShapeType);
                if(b.ShapeType=="streets"){
                    console.log("    found a street!");
                    this.loadedStreets.push(b);
                }
            }
        }
        console.log("total number of streets found: " + this.loadedStreets.length);

        for (let i = 0; i < this.loadedStreets.length; i++) {
            const s1 = this.loadedStreets[i];
            for (let e = i + 1; e < this.loadedStreets.length; e++) {
                const s2 = this.loadedStreets[e];

                const result = s1.findLineIntersectionPoint(s2);

                if (result) {
                    const result_packet = result as LineTestReturnPacket;
                    const intersectionName = s1.mesh.name + " and " + s2.mesh.name

                    console.log("found intersection at: " + intersectionName);

                    const sphere = MeshBuilder.CreateSphere("sphere", { diameter: 0.5 }, this.scene);
                    sphere.position = result.p;
                    sphere.name = intersectionName;

                    const upPos = result.p.add(new Vector3(0, 0.5, 0));
                    const sign1 = this.drawStreetSign(s1, upPos, result.dir1);
                    sign1.setParent(sphere);

                    const upPos2 = result.p.add(new Vector3(0, 1.0, 0));
                    const sign2 = this.drawStreetSign(s2, upPos2, result.dir2);
                    sign2.setParent(sphere);

                    sphere.setParent(s1.tile.mesh);
                }
            }
        }
    }  */

    private update(): void {

    }

}
/******* End of the Game class ******/

// start the game
var game = new Game();
game.start();