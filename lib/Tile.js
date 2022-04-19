"use strict";
//based on this example: https://www.babylonjs-playground.com/#866PVL#5
Object.defineProperty(exports, "__esModule", { value: true });
//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";
var Tile = /** @class */ (function () {
    function Tile() {
        this.eastSeamFixed = false;
        this.northSeamFixed = false;
        this.northEastSeamFixed = false;
    }
    return Tile;
}());
exports.default = Tile;
