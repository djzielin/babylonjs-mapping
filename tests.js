import { Vector2 } from "@babylonjs/core/Maths/math";
import TileMath from "./lib/TileMath";

var tm=new TileMath(undefined);

console.log("Running some math tests...");

var webMercator=new Vector2(-8905559.263461886,4163881.144064293);
var answer=new Vector2(-80,35);
console.log("should be: " + answer);

var result1=tm.epsg3857toEpsg4326_turf(webMercator);
console.log("Result_turf: " + result1);

var result2=tm.epsg3857toEpsg4326_auravant(webMercator);
console.log("Result_auravant: " + result2);

