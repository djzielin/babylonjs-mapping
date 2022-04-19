"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var math_1 = require("@babylonjs/core/Maths/math");
var math_2 = require("@babylonjs/core/Maths/math");
var math_3 = require("@babylonjs/core/Maths/math");
var meshBuilder_1 = require("@babylonjs/core/Meshes/meshBuilder");
var standardMaterial_1 = require("@babylonjs/core/Materials/standardMaterial");
var earcut_1 = require("earcut");
var cross_fetch_1 = require("cross-fetch");
var OpenStreetMap = /** @class */ (function () {
    function OpenStreetMap(tileSet, scene) {
        this.tileSet = tileSet;
        this.scene = scene;
        //https://osmbuildings.org/documentation/data/
        //GET http(s)://({abcd}.)data.osmbuildings.org/0.2/anonymous/tile/15/{x}/{y}.json
        this.osmBuildingServers = ["https://a.data.osmbuildings.org/0.2/anonymous/tile/",
            "https://b.data.osmbuildings.org/0.2/anonymous/tile/",
            "https://c.data.osmbuildings.org/0.2/anonymous/tile/",
            "https://d.data.osmbuildings.org/0.2/anonymous/tile/"];
        this.heightScaleFixer = 1.0;
        this.buildingMaterial = new standardMaterial_1.StandardMaterial("buildingMaterial", this.scene);
        this.buildingMaterial.diffuseColor = new math_3.Color3(0.8, 0.8, 0.8);
        this.buildingMaterial.freeze();
    }
    OpenStreetMap.prototype.setExaggeration = function (tileScale, exaggeration) {
        this.heightScaleFixer = tileScale * exaggeration;
    };
    OpenStreetMap.prototype.generateBuildingsForTile = function (tile) {
        var _this = this;
        if (tile.tileCoords.z > 16) {
            console.error("Zoom level of: " + tile.tileCoords.z + " is too large! This means that buildings won't work!");
            return;
        }
        var url = this.osmBuildingServers[0] + tile.tileCoords.z + "/" + tile.tileCoords.x + "/" + tile.tileCoords.y + ".json";
        console.log("trying to fetch: " + url);
        cross_fetch_1.fetch(url).then(function (res) {
            //console.log("  fetch returned: " + res.status);
            if (res.status == 200) {
                res.text().then(function (text) {
                    var tileBuildings = JSON.parse(text);
                    console.log("number of buildings in this tile: " + tileBuildings.features.length);
                    for (var _i = 0, _a = tileBuildings.features; _i < _a.length; _i++) {
                        var f = _a[_i];
                        _this.generateSingleBuilding(f, tile);
                    }
                });
            }
            else {
                console.error("unable to fetch: " + url);
            }
        });
    };
    OpenStreetMap.prototype.generateSingleBuilding = function (f, tile) {
        if (f.geometry.type == "Polygon") {
            for (var i = 0; i < f.geometry.coordinates.length; i++) {
                //var customMesh = new Mesh("custom", this.scene);
                var numPoints = f.geometry.coordinates[i].length;
                var positions = [];
                var positions3D = [];
                //skip final coord (as it seems to duplicate the first)
                //also need to do this backwards to get normals / winding correct
                for (var e = f.geometry.coordinates[i].length - 2; e >= 0; e--) {
                    var v2 = new math_1.Vector2(f.geometry.coordinates[i][e][0], f.geometry.coordinates[i][e][1]);
                    //const v2World = this.tileSet.GetPositionOnTile(v2, new Vector2(tile.tileNum.x, tile.tileNum.y));
                    var v2World = this.tileSet.GetWorldPosition(v2);
                    //console.log("  v2world: " + v2World);
                    positions.push(v2World.x);
                    positions.push(v2World.y);
                    positions3D.push(new math_2.Vector3(v2World.x, 0.0, v2World.y));
                }
                window.earcut = earcut_1.default;
                var ourMesh = meshBuilder_1.MeshBuilder.ExtrudePolygon("building", {
                    shape: positions3D,
                    depth: f.properties.height * this.heightScaleFixer
                }, this.scene);
                ourMesh.position.y = f.properties.height * this.heightScaleFixer;
                ourMesh.parent = tile.mesh;
                ourMesh.material = this.buildingMaterial; //all buildings will use same material
                ourMesh.isPickable = false;
                ourMesh.bakeCurrentTransformIntoVertices();
                ourMesh.freezeWorldMatrix();
            }
        }
        else {
            //TODO: support other geometry types?
            console.error("unknown building geometry type: " + f.geometry.type);
        }
    };
    return OpenStreetMap;
}());
exports.default = OpenStreetMap;
