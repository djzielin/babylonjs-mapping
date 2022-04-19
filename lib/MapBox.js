"use strict";
//based on this example: https://www.babylonjs-playground.com/#866PVL#5
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var math_1 = require("@babylonjs/core/Maths/math");
var texture_1 = require("@babylonjs/core/Materials/Textures/texture");
var core_1 = require("@babylonjs/core");
//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";
var MapBox = /** @class */ (function () {
    function MapBox(tileSet, scene) {
        //sku code generation from:
        //https://github.com/mapbox/mapbox-gl-js/blob/992514ac5471c1231d8a1951bc6752a65aa9e3e6/src/util/sku_token.js
        this.tileSet = tileSet;
        this.scene = scene;
        this.mbServer = "https://api.mapbox.com/v4/";
        this.index = 0;
        this.accessToken = "";
        this.heightScaleFixer = 0;
        var SKU_ID = '01';
        var TOKEN_VERSION = '1';
        var base62chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        // sessionRandomizer is a randomized 10-digit base-62 number
        var sessionRandomizer = '';
        for (var i = 0; i < 10; i++) {
            sessionRandomizer += base62chars[Math.floor(Math.random() * 62)];
        }
        this.skuToken = [TOKEN_VERSION, SKU_ID, sessionRandomizer].join('');
    }
    //https://docs.mapbox.com/api/maps/raster-tiles/
    MapBox.prototype.getRasterURL = function (tileCoords, zoom, doResBoost) {
        var mapType = "mapbox.satellite";
        var prefix = this.mbServer;
        var boostParam = doResBoost ? "@2x" : "";
        var extension = ".jpg90"; //can do jpg70 to reduce quality & bandwidth
        var accessParam = "?access_token=" + this.accessToken;
        var url = prefix + mapType + "/" + zoom + "/" + (tileCoords.x) + "/" + (tileCoords.y) + boostParam + extension + accessParam;
        this.index++;
        return url;
    };
    ///////////////////////////////////////////////////////////////////////////
    // TERRAIN
    ///////////////////////////////////////////////////////////////////////////
    MapBox.prototype.setExaggeration = function (tileScale, exaggeration) {
        this.heightScaleFixer = tileScale * exaggeration;
    };
    //based on code from
    //https://www.babylonjs-playground.com/#DXARSP#30
    MapBox.prototype.GetAsyncTexture = function (url) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var texture = new texture_1.Texture(url, _this.scene, true, false, texture_1.Texture.NEAREST_SAMPLINGMODE, function () {
                resolve(texture);
            }, function (message) {
                reject(message);
            });
        });
    };
    //https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-dem-v1/
    MapBox.prototype.getTileTerrain = function (tile, doResBoost) {
        return __awaiter(this, void 0, void 0, function () {
            var prefix, boostParam, mapType, extension, skuParam, accessParam, url, ourTex, ourBuff;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (tile.tileCoords.z > 15 && doResBoost == false) {
                            console.log("DEM not supported beyond level 15 (if not doing res boost)");
                            return [2 /*return*/];
                        }
                        if (tile.tileCoords.z > 14 && doResBoost == true) {
                            console.log("DEM not supported beyond 14 (is doing res boost)");
                            return [2 /*return*/];
                        }
                        tile.dem = []; //to reclaim memory?
                        prefix = this.mbServer;
                        boostParam = doResBoost ? "@2x" : "";
                        mapType = "mapbox.mapbox-terrain-dem-v1";
                        extension = ".pngraw";
                        skuParam = "?sku=" + this.skuToken;
                        accessParam = "&access_token=" + this.accessToken;
                        url = prefix + mapType + "/" + (tile.tileCoords.z) + "/" + (tile.tileCoords.x) + "/" + (tile.tileCoords.y) + boostParam + extension + skuParam + accessParam;
                        console.log("trying to fetch: " + url);
                        return [4 /*yield*/, this.GetAsyncTexture(url)];
                    case 1:
                        ourTex = _a.sent();
                        if (ourTex) {
                            if (ourTex.readPixels()) {
                                if (ourTex.readPixels().buffer) {
                                    tile.demDimensions = new math_1.Vector2(ourTex.getSize().width, ourTex.getSize().height);
                                    ourBuff = new Uint8Array(ourTex.readPixels().buffer);
                                    this.convertRGBtoDEM(ourBuff, tile);
                                }
                            }
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    //https://docs.mapbox.com/data/tilesets/guides/access-elevation-data/
    MapBox.prototype.convertRGBtoDEM = function (ourBuff, tile) {
        var heightDEM = [];
        var maxHeight = Number.NEGATIVE_INFINITY;
        var minHeight = Number.POSITIVE_INFINITY;
        console.log("Converting Image Buffer to Height Array");
        //const d: DecodedPng = decode(ourBuff);    
        //const image: Uint8Array = new Uint8Array(d.data);
        console.log("  image height: " + tile.demDimensions.y);
        console.log("  image width: " + tile.demDimensions.x);
        for (var i = 0; i < ourBuff.length; i += 4) {
            //documentation: height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
            var R = ourBuff[i + 0];
            var G = ourBuff[i + 1];
            var B = ourBuff[i + 2];
            //const A = image[i + 3]; //unused
            var height = -10000.0 + ((R * 256.0 * 256.0 + G * 256.0 + B) * 0.1);
            if (height > maxHeight) {
                maxHeight = height;
            }
            if (height < minHeight) {
                minHeight = height;
            }
            heightDEM.push(height);
        }
        console.log("  terrain ranges from : " + minHeight.toFixed(2) + " to " + maxHeight.toFixed(2));
        console.log("  height delta: " + (maxHeight - minHeight).toFixed(2));
        tile.dem = heightDEM;
        tile.minHeight = minHeight;
        tile.maxHeight = maxHeight;
    };
    MapBox.prototype.applyHeightArrayToMesh = function (mesh, tile, meshPrecision, heightAdjustment) {
        var positions = mesh.getVerticesData(core_1.VertexBuffer.PositionKind);
        var subdivisions = meshPrecision + 1;
        // console.log("height fixer: " + this.heightScaleFixer);
        //console.log("subdivisions: " + subdivisions);
        for (var y = 0; y < subdivisions; y++) {
            for (var x = 0; x < subdivisions; x++) {
                //console.log("---------------------------------------");
                var percent = new math_1.Vector2(x / (subdivisions - 1), y / (subdivisions - 1));
                var demIndex = this.computeIndexByPercent(percent, tile.demDimensions);
                //console.log("dem height: " + tile.dem[demIndex]);
                var height = (tile.dem[demIndex] + heightAdjustment) * this.heightScaleFixer;
                var meshIndex = 1 + (x + y * subdivisions) * 3;
                //console.log("mesh index: " + meshIndex);
                positions[meshIndex] = height;
            }
        }
        mesh.updateVerticesData(core_1.VertexBuffer.PositionKind, positions);
    };
    MapBox.prototype.computeIndexByPercent = function (percent, maxPixel) {
        var pixelX = Math.floor(percent.x * (maxPixel.x - 1));
        var pixelY = Math.floor(percent.y * (maxPixel.y - 1));
        var total = pixelY * maxPixel.x + pixelX;
        //console.log("Percent: " + percent.x + " " + percent.y + " Pixel: "+ pixelX + " " + pixelY + " Total: " + total);
        return total;
    };
    MapBox.prototype.fixNorthSeam = function (tile, tileUpper) {
        var dem1 = tile.dem;
        var dem2 = tileUpper.dem;
        var dimensions = tile.demDimensions;
        for (var x = 0; x < dimensions.x; x++) {
            var pos1Index = x;
            var pos2Index = x + dimensions.x * (dimensions.y - 1); //last row
            var height1 = dem1[pos1Index];
            var height2 = dem2[pos2Index];
            dem1[pos1Index] = height2;
        }
        tile.northSeamFixed = true;
    };
    MapBox.prototype.fixEastSeam = function (tile, tileRight) {
        //console.log("fixing right seam!");
        //console.log("dem size: "+ tile.dem.length);
        var dem1 = tile.dem;
        var dem2 = tileRight.dem;
        var dimensions = tile.demDimensions;
        //console.log("dem dimensions: " + dimensions.x + " " + dimensions.y);
        for (var y = 0; y < dimensions.y; y++) {
            var pos1Index = (dimensions.x - 1) + y * dimensions.x; //right most col
            var pos2Index = y * dimensions.x; //left most col
            var height1 = dem1[pos1Index];
            var height2 = dem2[pos2Index];
            dem1[pos1Index] = height2;
        }
        tile.eastSeamFixed = true;
    };
    MapBox.prototype.fixNorthEastSeam = function (tile, tileUpperRight) {
        //console.log("dem size: "+ tile.dem.length);
        var dem1 = tile.dem;
        var dem2 = tileUpperRight.dem;
        var dimensions = tile.demDimensions;
        var pos1Index = (dimensions.x - 1); //upper right
        var pos2Index = (dimensions.y - 1) * dimensions.x; //lower left
        var height1 = dem1[pos1Index];
        var height2 = dem2[pos2Index];
        dem1[pos1Index] = height2;
        tile.northEastSeamFixed = true;
    };
    return MapBox;
}());
exports.default = MapBox;
