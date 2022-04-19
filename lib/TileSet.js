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
var math_2 = require("@babylonjs/core/Maths/math");
var math_3 = require("@babylonjs/core/Maths/math");
var meshBuilder_1 = require("@babylonjs/core/Meshes/meshBuilder");
var standardMaterial_1 = require("@babylonjs/core/Materials/standardMaterial");
var texture_1 = require("@babylonjs/core/Materials/Textures/texture");
var Tile_1 = require("./Tile");
var OpenStreetMap_1 = require("./OpenStreetMap");
var MapBox_1 = require("./MapBox");
var OpenStreetMapBuildings_1 = require("./OpenStreetMapBuildings");
//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";
var TileSet = /** @class */ (function () {
    function TileSet(subdivisions, totalWidthMeters, meshPrecision, scene) {
        this.totalWidthMeters = totalWidthMeters;
        this.meshPrecision = meshPrecision;
        this.scene = scene;
        //for terrain DEM
        this.globalMinHeight = Number.POSITIVE_INFINITY;
        this.ourTiles = [];
        this.exaggeration = 3;
        this.zoom = 0;
        this.subdivisions = new math_1.Vector2(subdivisions, subdivisions); //TODO: in future support differring tile numbers in X and Y
        this.tileWidth = this.totalWidthMeters / this.subdivisions.x;
        this.xmin = -this.totalWidthMeters / 2;
        this.zmin = -this.totalWidthMeters / 2;
        this.xmax = this.totalWidthMeters / 2;
        this.zmax = this.totalWidthMeters / 2;
        for (var y = 0; y < this.subdivisions.y; y++) {
            for (var x = 0; x < this.subdivisions.x; x++) {
                var ground = this.makeSingleTileMesh(x, y, this.meshPrecision);
                var t = new Tile_1.default();
                t.mesh = ground;
                t.colRow = new math_1.Vector2(x, y);
                this.ourTiles.push(t);
            }
        }
        this.osmBuildings = new OpenStreetMapBuildings_1.default(this, this.scene);
        this.ourMB = new MapBox_1.default(this, this.scene);
    }
    ;
    TileSet.prototype.makeSingleTileMesh = function (x, y, precision) {
        var ground = meshBuilder_1.MeshBuilder.CreateGround("ground", { width: this.tileWidth, height: this.tileWidth, updatable: true, subdivisions: precision }, this.scene);
        ground.position.z = this.zmin + (y + 0.5) * this.tileWidth;
        ground.position.x = this.xmin + (x + 0.5) * this.tileWidth;
        ground.bakeCurrentTransformIntoVertices();
        ground.freezeWorldMatrix();
        //ground.cullingStrategy=Mesh.CULLINGSTRATEGY_STANDARD; //experimenting with differnt culling
        //ground.alwaysSelectAsActiveMesh=true; //trying to eliminate mesh popping when close by
        return ground;
    };
    TileSet.prototype.setRasterProvider = function (providerName, accessToken) {
        this.rasterProvider = providerName;
        this.accessToken = accessToken !== null && accessToken !== void 0 ? accessToken : "";
        this.ourMB.accessToken = this.accessToken;
    };
    //https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
    TileSet.prototype.lon2tile = function (lon, zoom) { return (Math.floor((lon + 180) / 360 * Math.pow(2, zoom))); };
    TileSet.prototype.lat2tile = function (lat, zoom) { return (Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))); };
    //without rounding
    TileSet.prototype.lon2tileExact = function (lon, zoom) { return (((lon + 180) / 360 * Math.pow(2, zoom))); };
    TileSet.prototype.lat2tileExact = function (lat, zoom) { return (((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))); };
    TileSet.prototype.getTileFromLatLon = function (coordinates, zoom) {
        console.log("computing for lon: " + coordinates.x + " lat: " + coordinates.y + " zoom: " + zoom);
        var x = this.lon2tile(coordinates.x, zoom);
        console.log("tile x: " + x);
        var y = this.lat2tile(coordinates.y, zoom);
        console.log("tile y: " + y);
        return new math_1.Vector2(x, y);
    };
    TileSet.prototype.computeCornerTile = function (coordinates, zoom) {
        console.log("computing corner tile: " + coordinates);
        var cornerTile = this.getTileFromLatLon(coordinates, zoom);
        console.log("center tile: " + cornerTile);
        cornerTile.x -= this.subdivisions.x / 2;
        cornerTile.y += this.subdivisions.y / 2;
        console.log("corner tile: " + cornerTile);
        return cornerTile;
    };
    //https://wiki.openstreetmap.org/wiki/Zoom_levels
    //Stile = C ∙ cos(latitude) / 2^zoomlevel
    TileSet.prototype.computeTiletotalWidthMeters = function (coordinates, zoom) {
        if (zoom == 0) {
            console.log("ERROR: zoom not setup yet!");
            return 0;
        }
        console.log("tryign to compute tile width for lat: " + coordinates.y);
        var C = 40075016.686;
        var latRadians = coordinates.y * Math.PI / 180.0;
        return C * Math.cos(latRadians) / Math.pow(2, zoom); //seems to need abs?
    };
    TileSet.prototype.computeTileScale = function () {
        var tileMeters = this.computeTiletotalWidthMeters(this.centerCoords, this.zoom);
        console.log("tile (real world) width in meters: " + tileMeters);
        var tileWorldMeters = this.totalWidthMeters / this.subdivisions.x;
        console.log("tile (in game) width in meteres: " + tileWorldMeters);
        var result = tileWorldMeters / tileMeters;
        console.log("scale of tile (in game) (1.0 would be true size): " + result);
        return result;
    };
    TileSet.prototype.GetWorldPosition = function (coordinates) {
        //console.log("computing world for lon: " + coordinates.x + " lat: " + coordinates.y + " zoom: " + this.zoom);
        var x = this.lon2tileExact(coordinates.x, this.zoom);
        var y = this.lat2tileExact(coordinates.y, this.zoom);
        //console.log("raw x: " + x + " raw y: " + y);
        var xFixed = (x - this.tileCorner.x) / this.subdivisions.x * this.totalWidthMeters - this.totalWidthMeters / 2;
        var yFixed = ((this.tileCorner.y + 1) - y) / this.subdivisions.y * this.totalWidthMeters - this.totalWidthMeters / 2;
        //console.log("fixed x: " + xFixed + " fixed y: " + yFixed);
        return new math_1.Vector2(xFixed, yFixed);
    };
    TileSet.prototype.updateRaster = function (centerCoords, zoom) {
        this.centerCoords = centerCoords;
        this.tileCorner = this.computeCornerTile(centerCoords, zoom);
        this.zoom = zoom;
        console.log("Tile Base: " + this.tileCorner);
        for (var _i = 0, _a = this.ourTiles; _i < _a.length; _i++) {
            var t = _a[_i];
            if (t.material) {
                t.material.dispose(true, true, false);
            }
        }
        for (var y = 0; y < this.subdivisions.y; y++) {
            for (var x = 0; x < this.subdivisions.x; x++) {
                var material = new standardMaterial_1.StandardMaterial("material" + y + "-" + x, this.scene);
                var tileX = this.tileCorner.x + x;
                var tileY = this.tileCorner.y - y;
                var url = "";
                if (this.rasterProvider == "OSM") {
                    url = OpenStreetMap_1.default.getRasterURL(new math_1.Vector2(tileX, tileY), this.zoom);
                }
                else if (this.rasterProvider == "MB") {
                    url = this.ourMB.getRasterURL(new math_1.Vector2(tileX, tileY), this.zoom, true);
                }
                material.diffuseTexture = new texture_1.Texture(url, this.scene);
                material.diffuseTexture.wrapU = texture_1.Texture.CLAMP_ADDRESSMODE;
                material.diffuseTexture.wrapV = texture_1.Texture.CLAMP_ADDRESSMODE;
                material.specularColor = new math_3.Color3(0, 0, 0);
                material.alpha = 1.0;
                // material.backFaceCulling = false;
                material.freeze(); //optimization
                var tileIndex = x + y * this.subdivisions.x;
                var tile = this.ourTiles[tileIndex];
                tile.mesh.material = material;
                tile.material = material;
                tile.tileCoords = new math_2.Vector3(tileX, tileY, zoom); //store for later              
            }
        }
    };
    TileSet.prototype.generateBuildings = function (exaggeration) {
        this.osmBuildings.setExaggeration(this.computeTileScale(), exaggeration);
        for (var _i = 0, _a = this.ourTiles; _i < _a.length; _i++) {
            var t = _a[_i];
            this.osmBuildings.generateBuildingsForTile(t);
        }
    };
    TileSet.prototype.updateTerrain = function (exaggeration) {
        return __awaiter(this, void 0, void 0, function () {
            var _i, _a, t, _b, _c, t, _d, _e, t, _f, _g, t2, _h, _j, t;
            return __generator(this, function (_k) {
                switch (_k.label) {
                    case 0:
                        this.ourMB.setExaggeration(this.computeTileScale(), exaggeration);
                        _i = 0, _a = this.ourTiles;
                        _k.label = 1;
                    case 1:
                        if (!(_i < _a.length)) return [3 /*break*/, 4];
                        t = _a[_i];
                        return [4 /*yield*/, this.ourMB.getTileTerrain(t, true)];
                    case 2:
                        _k.sent();
                        _k.label = 3;
                    case 3:
                        _i++;
                        return [3 /*break*/, 1];
                    case 4:
                        for (_b = 0, _c = this.ourTiles; _b < _c.length; _b++) {
                            t = _c[_b];
                            if (t.minHeight < this.globalMinHeight) {
                                this.globalMinHeight = t.minHeight;
                            }
                        }
                        console.log("lowest point in tileset is: " + this.globalMinHeight);
                        //Fix Seams Here
                        for (_d = 0, _e = this.ourTiles; _d < _e.length; _d++) {
                            t = _e[_d];
                            for (_f = 0, _g = this.ourTiles; _f < _g.length; _f++) {
                                t2 = _g[_f];
                                if ((t.tileCoords.x == (t2.tileCoords.x - 1)) && (t.tileCoords.y == t2.tileCoords.y)) {
                                    if (t.eastSeamFixed == false) {
                                        this.ourMB.fixEastSeam(t, t2);
                                    }
                                }
                                if ((t.tileCoords.x == t2.tileCoords.x) && (t.tileCoords.y == (t2.tileCoords.y + 1))) {
                                    if (t.northSeamFixed == false) {
                                        this.ourMB.fixNorthSeam(t, t2);
                                    }
                                }
                                if ((t.tileCoords.x == (t2.tileCoords.x - 1)) && (t.tileCoords.y == (t2.tileCoords.y + 1))) {
                                    if (t.northEastSeamFixed == false) {
                                        this.ourMB.fixNorthEastSeam(t, t2);
                                    }
                                }
                            }
                        }
                        for (_h = 0, _j = this.ourTiles; _h < _j.length; _h++) {
                            t = _j[_h];
                            this.ourMB.applyHeightArrayToMesh(t.mesh, t, this.meshPrecision, -this.globalMinHeight);
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    TileSet.prototype.setupTerrainLOD = function (precisions, distances) {
        for (var _i = 0, _a = this.ourTiles; _i < _a.length; _i++) {
            var t = _a[_i];
            for (var i = 0; i < precisions.length; i++) {
                var precision = precisions[i];
                var distance = distances[i];
                if (precision > 0) {
                    var loadMesh = this.makeSingleTileMesh(t.colRow.x, t.colRow.y, precision);
                    this.ourMB.applyHeightArrayToMesh(loadMesh, t, precision, -this.globalMinHeight);
                    loadMesh.material = t.material;
                    t.mesh.addLODLevel(distance, loadMesh);
                }
                else {
                    t.mesh.addLODLevel(distance, null);
                }
            }
        }
    };
    return TileSet;
}());
exports.default = TileSet;
