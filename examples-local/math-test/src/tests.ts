import { Vector2 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import TileMath from "../../../lib/TileMath";

var tm=new TileMath(undefined);

console.log("Running some math tests...");

var webMercator=new Vector2(-8905559.263461886,4163881.144064293);
console.log("EPSG 3857: " + webMercator);
var answer=new Vector2(-80,35);
console.log("EPSG 4326: " + answer);

var result1=tm.epsg3857toEpsg4326(webMercator);
console.log("Calcd 4326: " + result1);
console.log("   difference: " + answer.subtract(result1));

var resultReverse=tm.epsg4326toEpsg3857(answer);
console.log("Calcd 3857: " + resultReverse); 
console.log("   difference: " + webMercator.subtract(resultReverse));
console.log("===================================================");

var tileTest=new Vector3(18049,25907,16);
console.log("looking at tile: " + tileTest);
var result=tm.tile2lonlat(tileTest);

console.log("lon/lat: " + result);


