/* Web-Based-VR-Tutorial Project Template
* Author: Evan Suma Rosenberg <suma@umn.edu> and Blair MacIntyre <blair@cc.gatech.edu>
* License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
*/

// Extended by David J. Zielinski

import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import TileMath from "../../../lib/TileMath";

class Game {
    
    public outputDiv: HTMLElement | null;

    constructor() {
        // Get the canvas element 
        //this.canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
        //this.canvas = document.getElementById("renderCanvas") as unknown as HTMLCanvasElement; //recent node 20.17.0 on mac seems to need this?
        this.outputDiv = document.getElementById('output');
        
        if(this.outputDiv){
            this.outputDiv.style.whiteSpace = 'pre-wrap'; //per chatgpt
            this.outputDiv.textContent="";
        }

        // Generate the BABYLON 3D engine
        //this.engine = new Engine(this.canvas, true);

        // Creates a basic Babylon Scene object
        //this.scene = new Scene(this.engine);
    }

    public print(text: string){
        if(this.outputDiv){
            this.outputDiv.textContent+=text+"\n";
        }
    }

    start(): void {
        var tm=new TileMath(undefined);

        this.print("Running some math tests...");
       
        //https://epsg.io/transform#s_srs=4326&t_srs=3857&x=-80.0000000&y=35.0000000
        
        var webMercatorAnswer=new Vector2(-8905559.263461886,4163881.144064293);
        var LatLonAnswer=new Vector2(-80,35);

        this.print("===================================================");
        this.print("Lets test converting 4326 vs 3857");

        var result1=tm.epsg3857_to_Epsg4326(webMercatorAnswer);
        this.print("Calcd 3857 to 4326: " + result1);
        this.print("   difference: " + LatLonAnswer.subtract(result1));
        this.print("");

        var result2=tm.epsg4326_to_Epsg3857(LatLonAnswer);
        this.print("Calcd 4326 to 3857: " + result2); 
        this.print("   difference: " + webMercatorAnswer.subtract(result2));
        this.print("===================================================");
        
        var tileTest=new Vector3(18049,25907,16);
        this.print("looking at tile: " + tileTest);
        
        var result=tm.tile_to_lonlat(tileTest);
        this.print("lon/lat: " + result);   
    }   

}
/******* End of the Game class ******/

// start the game
var game = new Game();
game.start();