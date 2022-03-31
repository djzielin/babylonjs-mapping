//based on this example: https://www.babylonjs-playground.com/#866PVL#5

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

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

interface coordinatePair extends Array<number> { }
interface coordinateSet extends Array<coordinatePair> { }

interface geometryJSON{
        "type": string;
        "coordinates": coordinateSet[];
}

interface featurePropertiesJSON{
    "type": string;
    "height": number;
    "levels": number;
} 

interface featuresJSON{
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

    private widthMeters=100;

    private xmin: number = -this.widthMeters/2;
    private zmin: number = -this.widthMeters/2; 
    private xmax: number = this.widthMeters/2; 
    private zmax: number = this.widthMeters/2; 

    private tileList: Vector3[]=[];

    private osmServers: string[]=["https://a.tile.openstreetmap.org/","https://b.tile.openstreetmap.org/","https://c.tile.openstreetmap.org/"];


    // Precision - number of subdivisions on the height and the width of each tile.
    private precision = {
        "w": 1,
        "h": 1
    };

    // Subdivisions - number of subdivisions (tiles) on the height and the width of the map.
    private subdivisions = { //TODO; try changing these and make sure things are ok
        'w': 4,
        'h': 4
    };

    private tiledGround: Mesh; 
    private multiMat: MultiMaterial;
    private zoom = 0;
    private tileCorner: Vector2;
    private buildingMaterial: StandardMaterial;

    constructor(private scene: Scene) {

    }

    public createBaseMap() {
        this.tiledGround = MeshBuilder.CreateTiledGround("Tiled Ground",
            {
                xmin: this.xmin,
                zmin: this.zmin,
                xmax: this.xmax,
                zmax: this.zmax,
                subdivisions: this.subdivisions,
                precision: this.precision
            },
            this.scene); //old method (above) is deprecated

        this.tiledGround.enableEdgesRendering();
        this.tiledGround.enableEdgesRendering(.95);
        this.tiledGround.edgesWidth = 2.0;
        this.tiledGround.edgesColor = new Color4(0, 0, 0, 1);

        // Needed variables to set subMeshes
        const verticesCount = this.tiledGround.getTotalVertices();
        const tileIndicesLength = this.tiledGround.getIndices()!.length / (this.subdivisions.w * this.subdivisions.h);

        // Set subMeshes of the tiled ground
        this.tiledGround.subMeshes = [];
        let index = 0;
        let base = 0;
        for (var row = 0; row < this.subdivisions.h; row++) {
            for (var col = 0; col < this.subdivisions.w; col++) {
                var submesh = new SubMesh(index++, 0, verticesCount, base, tileIndicesLength, this.tiledGround);
                this.tiledGround.subMeshes.push(submesh);
                base += tileIndicesLength;
            }
        }

        this.buildingMaterial = new StandardMaterial("buildingMaterial", this.scene);
        this.buildingMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8);
        this.buildingMaterial.freeze();
    }

    //https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
    private lon2tile(lon: number, zoom: number): number { return (Math.floor((lon+180)/360*Math.pow(2,zoom))); }
    private lat2tile(lat: number, zoom: number): number { return (Math.floor((1-Math.log(Math.tan(lat*Math.PI/180) + 1/Math.cos(lat*Math.PI/180))/Math.PI)/2 *Math.pow(2,zoom))); }

    //without floor
    private lon2tileExact(lon: number, zoom: number): number { return (((lon + 180) / 360 * Math.pow(2, zoom))); }
    private lat2tileExact(lat: number, zoom: number): number { return (((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))); }

    public getTileFromLatLon(coordinates: Vector2, zoom: number) {

        console.log("computing for lon: " + coordinates.x + " lat: " + coordinates.y + " zoom: " + zoom);

        const x = this.lon2tile(coordinates.x, zoom);
        console.log("tile x: " + x);

        const y = this.lat2tile(coordinates.y, zoom);
        console.log("tile y: " + y);

        return new Vector2(x, y);
    }

    public computeCornerTile(coordinates: Vector2, zoom: number): Vector2 {
        console.log("computing corner tile: " + coordinates);

        const cornerTile = this.getTileFromLatLon(coordinates, zoom);
        console.log("center tile: " + cornerTile);

        cornerTile.x -= this.subdivisions.w / 2;
        cornerTile.y += this.subdivisions.h / 2;

        console.log("corner tile: " + cornerTile);

        return cornerTile;
    }

    //https://wiki.openstreetmap.org/wiki/Zoom_levels
    //Stile = C ∙ cos(latitude) / 2^zoomlevel

    public computeTileWidthMeters(coordinates: Vector2, zoom: number): number {
        const C = 40075016.686;
        const latRadians = coordinates.y * Math.PI / 180.0;
        return (C * Math.cos(latRadians) / Math.pow(2, zoom));
    }

    public computeTileScale(): number {
        const tileMeters = this.computeTileWidthMeters(this.tileCorner, this.zoom);
        console.log("tile (real world) width in meters: " + tileMeters);

        const tileWorldMeters = this.widthMeters / this.subdivisions.w;
        console.log("tile (in game) width in meteres: " + tileWorldMeters);

        const result = tileWorldMeters / tileMeters;
        console.log("scale of tile (in game) (1.0 would be true size): " + result);

        return result;
    }

    public GetWorldPosition(coordinates: Vector2): Vector2 {
        //console.log("computing world for lon: " + coordinates.x + " lat: " + coordinates.y + " zoom: " + this.zoom);

        const x: number = this.lon2tileExact(coordinates.x, this.zoom);
        const y: number = this.lat2tileExact(coordinates.y, this.zoom);

        //console.log("raw x: " + x + " raw y: " + y);

        const xFixed: number = (x - this.tileCorner.x) / this.subdivisions.w * this.widthMeters - this.widthMeters / 2;
        const yFixed: number = ((this.tileCorner.y + 1) - y) / this.subdivisions.h * this.widthMeters - this.widthMeters / 2;

        //console.log("fixed x: " + xFixed + " fixed y: " + yFixed);

        return new Vector2(xFixed, yFixed);
    }

    public updateBaseMap(centerCoords: Vector2, zoom: number) {
        this.tileCorner = this.computeCornerTile(centerCoords, zoom);
        this.zoom = zoom;

        console.log("Tile Base: " + this.tileCorner);

        if (this.multiMat) {
            this.multiMat.dispose(false, true, true);
        }

        this.tileList = []; //empty array

        this.multiMat = new MultiMaterial("multi", this.scene);

        let index = 0;

        for (let row = 0; row < this.subdivisions.h; row++) {
            for (let col = 0; col < this.subdivisions.w; col++) {

                const material = new StandardMaterial("material" + row + "-" + col, this.scene);

                const extension = ".png";

                const tileX = this.tileCorner.x + col;
                const tileY = this.tileCorner.y - row;

                const prefix = this.osmServers[index % 3];
                index++;

                const url = prefix + zoom + "/" + (tileX) + "/" + (tileY) + extension;

                console.log("trying to get: " + url);

                material.diffuseTexture = new Texture(url, this.scene);
                material.diffuseTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
                material.diffuseTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
                material.specularColor = new Color3(0, 0, 0);
                material.alpha = 1.0;
                // material.backFaceCulling = false;

                this.multiMat.subMaterials.push(material);
                this.tileList.push(new Vector3(tileX, tileY, zoom)); //store for later
            }
        }

        // Define multimat as material of the tiled ground
        this.tiledGround.material = this.multiMat;
    }

    //https://osmbuildings.org/documentation/data/
    //GET http(s)://({abcd}.)data.osmbuildings.org/0.2/anonymous/tile/15/{x}/{y}.json

    private osmBuildingServers: string[] = ["https://a.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://b.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://c.data.osmbuildings.org/0.2/anonymous/tile/",
        "https://d.data.osmbuildings.org/0.2/anonymous/tile/"];

    public generateSingleBuilding(f: featuresJSON, heightScaleFixer: number) {
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
                    const v2World = this.GetWorldPosition(v2);
                    //console.log("  v2world: " + v2World);

                    positions.push(v2World.x);
                    positions.push(v2World.y);

                    positions3D.push(new Vector3(v2World.x, 0.0, v2World.y));
                }
                (window as any).earcut = Earcut;
                var ourMesh = MeshBuilder.ExtrudePolygon("building",
                    {
                        shape: positions3D,
                        depth: f.properties.height * heightScaleFixer
                    },
                    this.scene);

                ourMesh.position.y = f.properties.height * heightScaleFixer; //TODO figure out proper scaling
                ourMesh.parent = this.tiledGround;
                ourMesh.material=this.buildingMaterial; //all buildings will use same material
                ourMesh.isPickable=false;

                ourMesh.bakeCurrentTransformIntoVertices();
                ourMesh.freezeWorldMatrix();
            }
        }
        else {
            //TODO: support other geometry types?
            console.error("unknown building geometry type: " + f.geometry.type);
        }
    }

    public async generateBuildings(exaggeration: number) {
        if (this.zoom > 16) {
            console.error("Zoom level of: " + this.zoom + " is too large! This means that buildings won't work!");
            return;
        }      

        const heightScaleFixer = this.computeTileScale() * exaggeration;

        for (const v of this.tileList) {
            const url = this.osmBuildingServers[0] + v.z + "/" + v.x + "/" + v.y + ".json";

            console.log("trying to fetch: " + url);

            fetch(url).then((res) => {
                //console.log("  fetch returned: " + res.status);

                if (res.status == 200) {
                    res.text().then(
                        (text) => {

                            const tileBuildings: BuildingsJSON = JSON.parse(text);
                            console.log("number of buildings in this tile: " + tileBuildings.features.length);

                            for (const f of tileBuildings.features) {
                                this.generateSingleBuilding(f, heightScaleFixer);
                            }
                        });
                }
                else {
                    console.error("unable to fetch: " + url);
                }
            });
        }
    }
}