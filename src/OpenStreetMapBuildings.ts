import { Scene } from "@babylonjs/core/scene";
import { Vector2 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Color3 } from "@babylonjs/core/Maths/math";
import { Color4 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder"
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

import Earcut from 'earcut';
import { fetch } from 'cross-fetch'

import Tile from "./Tile";
import TileSet from "./TileSet";

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

interface coordinatePair extends Array<number> { }
interface coordinateSet extends Array<coordinatePair> { }

interface geometryJSON {
    "type": string;
    "coordinates": coordinateSet[];
}

interface featurePropertiesJSON {
    "type": string;
    "height": number;
    "levels": number;
}

interface featuresJSON {
    "id": string;
    "type": string;
    "properties": featurePropertiesJSON;
    "geometry": geometryJSON;
}

interface BuildingsJSON {
    "type": string;
    "features": featuresJSON[];
}

export default class OpenStreetMap {



    //https://osmbuildings.org/documentation/data/
    //GET http(s)://({abcd}.)data.osmbuildings.org/0.2/anonymous/tile/15/{x}/{y}.json

    private osmBuildingServers: string[] = ["https://a.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://b.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://c.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://d.data.osmbuildings.org/0.2/anonymous/tile/"];

    private heightScaleFixer = 1.0;
    private buildingMaterial: StandardMaterial;

    constructor(private tileSet: TileSet, private scene: Scene){
        this.buildingMaterial = new StandardMaterial("buildingMaterial", this.scene);
        this.buildingMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8);
        this.buildingMaterial.freeze();
    }

    public setExaggeration(tileScale: number, exaggeration: number) {
        this.heightScaleFixer = tileScale * exaggeration;
    }

    public generateBuildingsForTile(tile: Tile) {
        if (tile.tileCoords.z > 16) {
            console.error("Zoom level of: " + tile.tileCoords.z + " is too large! This means that buildings won't work!");
            return;
        }

        const url = this.osmBuildingServers[0] + tile.tileCoords.z + "/" + tile.tileCoords.x + "/" + tile.tileCoords.y + ".json";

        console.log("trying to fetch: " + url);

        fetch(url).then((res) => {
            //console.log("  fetch returned: " + res.status);

            if (res.status == 200) {
                res.text().then(
                    (text) => {

                        const tileBuildings: BuildingsJSON = JSON.parse(text);
                        console.log("number of buildings in this tile: " + tileBuildings.features.length);

                        for (const f of tileBuildings.features) {
                            this.generateSingleBuilding(f, tile);
                        }
                    });
            }
            else {
                console.error("unable to fetch: " + url);
            }
        });
    }

    private generateSingleBuilding(f: featuresJSON, tile: Tile) {
        if (f.geometry.type == "Polygon") {
            for (let i = 0; i < f.geometry.coordinates.length; i++) {
                //var customMesh = new Mesh("custom", this.scene);

                const numPoints = f.geometry.coordinates[i].length;

                const positions: number[] = [];
                const positions3D: Vector3[] = [];

                //skip final coord (as it seems to duplicate the first)
                //also need to do this backwards to get normals / winding correct
                for (let e = f.geometry.coordinates[i].length - 2; e >= 0; e--) {

                    const v2 = new Vector2(f.geometry.coordinates[i][e][0], f.geometry.coordinates[i][e][1]);
                    //const v2World = this.tileSet.GetPositionOnTile(v2, new Vector2(tile.tileNum.x, tile.tileNum.y));
                    const v2World = this.tileSet.GetWorldPosition(v2);
                    //console.log("  v2world: " + v2World);

                    positions.push(v2World.x);
                    positions.push(v2World.y);

                    positions3D.push(new Vector3(v2World.x, 0.0, v2World.y));
                }
                (window as any).earcut = Earcut;
                var ourMesh = MeshBuilder.ExtrudePolygon("building",
                    {
                        shape: positions3D,
                        depth: f.properties.height * this.heightScaleFixer
                    },
                    this.scene);

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
    } 
}