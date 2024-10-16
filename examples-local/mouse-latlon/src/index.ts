/* Web-Based-VR-Tutorial Project Template
* Author: Evan Suma Rosenberg <suma@umn.edu> and Blair MacIntyre <blair@cc.gatech.edu>
* License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
*/

// Extended by David J. Zielinski

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Button } from "@babylonjs/gui/2D/controls/button";
import { TextBlock } from "@babylonjs/gui";
import { Control } from "@babylonjs/gui";
import { StandardMaterial } from "@babylonjs/core";
import { MeshBuilder } from "@babylonjs/core";
import {ProjectionType} from "../../../lib/TileMath"; 

import "@babylonjs/core/Materials/standardMaterial"
import "@babylonjs/inspector";

//import TileSet from "babylonjs-mapping";
import TileSet from "../../../lib/TileSet"
import TileMath from "../../../lib/TileMath";
import BuildingsOSM from "../../../lib/BuildingsOSM";
import RasterOSM from "../../../lib/RasterOSM";

class Game {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;

    private ourTS: TileSet;
    private ourOSM: BuildingsOSM;
    private ourTileMath: TileMath;
    private textBlock: TextBlock;

    private redMaterial: StandardMaterial;
    private ourSphere: Mesh;

    constructor() {
        // Get the canvas element 
        this.canvas = document.getElementById("renderCanvas") as unknown as HTMLCanvasElement;

        // Generate the BABYLON 3D engine
        this.engine = new Engine(this.canvas, true);

        // Creates a basic Babylon Scene object
        this.scene = new Scene(this.engine);
    }

    public setupMaterials() {
        this.redMaterial = new StandardMaterial("redMaterial", this.scene);
        this.redMaterial.diffuseColor = new Color3(1, 0, 0); // Red diffuse color
        this.redMaterial.specularColor = new Color3(0.5, 0.5, 0.5); // Specular light reflection (optional)
        this.redMaterial.emissiveColor = new Color3(0.2, 0, 0); // Slight red glow (optional)
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

        this.textBlock = new TextBlock();
        this.textBlock.text = "";
        this.textBlock.color = "white";
        this.textBlock.fontSize = 24;

        this.textBlock.textVerticalAlignment=Control.VERTICAL_ALIGNMENT_TOP;
        this.textBlock.textHorizontalAlignment=Control.HORIZONTAL_ALIGNMENT_LEFT;

        this.textBlock.left = "10px";
        this.textBlock.top = "10px"; 

        // Add the text block to the texture
        ourOverlay.addControl(this.textBlock);    
    
    }

    private async createScene() {
        this.scene.clearColor = new Color4(135 / 255, 206 / 255, 235 / 255, 1.0);
        this.setupMaterials();

        var camera = new UniversalCamera("camera1", new Vector3(0, 40, -80), this.scene);
        camera.setTarget(Vector3.Zero());
        camera.attachControl(this.canvas, true);
        camera.speed = 0.5;
        camera.angularSensibility = 8000;

        var light = new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);
        light.intensity = 0.5;

        var light2 = new DirectionalLight("DirectionalLight", new Vector3(0, -1, 1), this.scene);
        light2.intensity = 0.5;

        // Create a sphere mesh and apply the red material
        this.ourSphere = MeshBuilder.CreateSphere("sphere", { diameter: 1 }, this.scene);
        this.ourSphere.position = new Vector3(0, 1, 0);
        this.ourSphere.material = this.redMaterial; // Assign red material to sphere
        this.ourSphere.isPickable=false;

        this.ourTS = new TileSet(this.scene, this.engine);
        this.ourTS.setRasterProvider(new RasterOSM(this.ourTS)); //raster basemap to OSM
        this.ourTS.createGeometry(new Vector2(4, 4), 20, 2); //4x4 tile set, 20m width of each tile, and 2 divisions on each tile
        this.ourTS.updateRaster(35.2258461, -80.8400777, 16); //lat, lon, zoom. takes us to charlotte. 

        this.ourTileMath=new TileMath(this.ourTS);

        const accessToken = await this.getKey("osmb-key.txt");
        this.ourOSM = new BuildingsOSM(this.ourTS);
        this.ourOSM.accessToken = accessToken;
        this.ourOSM.doMerge=true;
        this.ourOSM.exaggeration=1;
        this.ourOSM.generateBuildings();

        // Show the debug scene explorer and object inspector
        // You should comment this out when you build your final program 
        this.scene.debugLayer.show();

        this.setupHelpText();
        this.setupMouseCallback();
    }

    public setupMouseCallback() { //original from ChatGPT
        // Mouse move event listener
        this.canvas.addEventListener("mousemove", (event) => {
            this.scene.debugLayer.hide();

            const pickResult = this.scene.pick(event.clientX, event.clientY); // Get 3D coordinates from 2D mouse position
            this.scene.debugLayer.show();

            this.textBlock.text = `Mouse 2D pos: (${event.clientX}, ${event.clientY})\n`

            if (pickResult.hit) {
                //console.log("Mouse moved over: ", pickResult.pickedMesh.name);               

                if (pickResult.pickedMesh) {
                    const pickName = pickResult.pickedMesh.name;
                    this.textBlock.text += "Mouse is over mesh: " + pickName + "\n";
                }
                if (pickResult.pickedPoint) {
                    const pickPoint: Vector3 = pickResult.pickedPoint;
                    this.textBlock.text += ("Pick Point: " +
                        pickPoint.x.toFixed(2) + "," +
                        pickPoint.y.toFixed(2) + "," +
                        pickPoint.z.toFixed(2) + "\n");

                    this.ourSphere.position=pickResult.pickedPoint;

                    const tileCoords=this.ourTileMath.GamePosToTile(pickResult.pickedPoint);

                    this.textBlock.text += ("Tile Coords: " + 
                        tileCoords.x.toFixed(2) + ","+ 
                        tileCoords.y.toFixed(2) + "\n");

                    const lonLat=this.ourTileMath.tile2lonlat(tileCoords);

                    this.textBlock.text+= ("Lon/Lat: " + 
                        lonLat.x.toFixed(6)+ ","+ 
                        lonLat.y.toFixed(6) + "\n");

                    const backCalculatedPos=this.ourTileMath.GetWorldPosition(lonLat,ProjectionType.EPSG_4326,this.ourTS.zoom);
                    
                    this.textBlock.text += ("Point Calcd: " +
                        backCalculatedPos.x.toFixed(2) + "," +
                        backCalculatedPos.y.toFixed(2) + "," +
                        backCalculatedPos.z.toFixed(2) + "\n");
                }
            }
        });
    }

    private update(): void {

}

}
/******* End of the Game class ******/

// start the game
var game = new Game();
game.start();