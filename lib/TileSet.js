import { EngineStore } from "@babylonjs/core";
import { Vector2, Vector3, Color3 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Observable } from "@babylonjs/core";
import Tile from './Tile';
import TileMath, { EPSG_Type } from './TileMath';
import Attribution from "./Attribution";
import "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/inspector";
import '@babylonjs/core/Debug/debugLayer';
import RasterOSM from "./RasterMB";
import TerrainMB from "./TerrainMB";
var TileRequestType;
(function (TileRequestType) {
    TileRequestType[TileRequestType["LoadTile"] = 0] = "LoadTile";
})(TileRequestType || (TileRequestType = {}));
export var RetrievalType;
(function (RetrievalType) {
    RetrievalType[RetrievalType["IndividualTiles"] = 0] = "IndividualTiles";
    RetrievalType[RetrievalType["AllData"] = 1] = "AllData";
})(RetrievalType || (RetrievalType = {}));
export var RetrievalLocation;
(function (RetrievalLocation) {
    RetrievalLocation[RetrievalLocation["Remote"] = 0] = "Remote";
    RetrievalLocation[RetrievalLocation["Local"] = 1] = "Local";
    RetrievalLocation[RetrievalLocation["Remote_and_Save"] = 2] = "Remote_and_Save";
})(RetrievalLocation || (RetrievalLocation = {}));
export default class TileSet {
    /**
    * this doesn't do much, just sets up a linkage between our library and users main project
    * @param scene the babylonjs scene, helps us get around a bug, where the main app and the library are in 2 different contexts
    * @param engine see above description for scene
    */
    constructor(scene, engine) {
        this.scene = scene;
        this.engine = engine;
        this.ourTiles = [];
        this.ourTilesMap = new Map();
        this.doRasterResBoost = true;
        this.doTerrainResBoost = false;
        this.zoom = 0;
        this.hasAlpha = false;
        this.streetExtensionAmount = 0.25; //TODO; fix this to be in some sort of units that make sense, instead of game-world coordinates. 
        this.tileRequests = [];
        this.requestsProcessedSinceCaughtUp = 0;
        this.onCaughtUpObservable = new Observable;
        this.isGeometrySetup = false;
        EngineStore._LastCreatedScene = this.scene; //gets around a babylonjs bug where we aren't in the same context between the main app and the mapping library
        EngineStore.Instances.push(this.engine);
        this.ourAttribution = new Attribution(this.scene);
        this.ourTileMath = new TileMath(this);
        this.setRasterProvider(new RasterOSM(this)); //set default raster basemap to OSM
        this.ourTerrainMB = new TerrainMB(this, this.scene); //TODO: this should really be a terrain provider, in case we can get terrain from more than just MapBox
        const observer = this.scene.onBeforeRenderObservable.add(() => {
            this.processTileRequests(); //TODO: investigate WebWorker or other "threading" techniques, instead of calling every frame
        });
    }
    /**
    * setup a ground plane tile set. this sets up just the underlying meshes, but doesn't populate them with content yet
    * @param numTiles how many tiles in the x and y directions
    * @param tileWidth width in meters of a single tile
    * @param meshPrecision how many numTiles in each tile's mesh. need more for terrain type meshes, less if no height change on mesh.
    */
    createGeometry(numTiles, tileWidth, meshPrecision) {
        //inspiration from this example: https://www.babylonjs-playground.com/#866PVL#5
        this.numTiles = numTiles;
        this.tileWidth = tileWidth;
        this.meshPrecision = meshPrecision;
        this.totalWidthMeters = tileWidth * numTiles.x;
        this.totalHeightMeters = tileWidth * numTiles.y;
        this.xmin = -this.totalWidthMeters / 2;
        this.zmin = -this.totalHeightMeters / 2;
        this.xmax = this.totalWidthMeters / 2;
        this.zmax = this.totalHeightMeters / 2;
        for (let y = 0; y < this.numTiles.y; y++) {
            for (let x = 0; x < this.numTiles.x; x++) {
                const mesh = this.makeSingleTileMesh(x, y, this.meshPrecision);
                const t = new Tile(mesh, this);
                this.ourTiles.push(t);
            }
        }
        this.isGeometrySetup = true;
    }
    prettyName() {
        return "[Tile] ";
    }
    processTileRequests() {
        if (this.isGeometrySetup == false) {
            return;
        }
        if (this.tileRequests.length == 0) {
            if (this.requestsProcessedSinceCaughtUp > 0) {
                console.log(this.prettyName() + "caught up on all tile generation requests! (processed " + this.requestsProcessedSinceCaughtUp + " requests)");
                this.requestsProcessedSinceCaughtUp = 0;
                this.onCaughtUpObservable.notifyObservers(true);
            }
            return;
        }
        //console.log("tile requests remaining in queue: " + this.tileRequests.length);
        const request = this.tileRequests[0];
        if (request.requestType == TileRequestType.LoadTile) {
            if (request.inProgress == false) {
                console.log(this.prettyName() + "trying to load tile raster: " + request.url);
                request.texture = new Texture(request.url, this.scene);
                request.inProgress = true;
                return;
            }
            if (request.inProgress == true) {
                if (request.texture) {
                    if (request.texture.isReady()) {
                        console.log(this.prettyName() + "tile raster is ready: " + request.url);
                        const material = request.mesh.material;
                        material.unfreeze();
                        material.diffuseTexture = request.texture;
                        material.diffuseTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
                        material.diffuseTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
                        material.diffuseTexture.hasAlpha = this.hasAlpha;
                        material.freeze(); //optimization
                        request.mesh.setEnabled(true); //show it!
                        this.requestsProcessedSinceCaughtUp++;
                        this.tileRequests.shift(); //pop request off front of queue
                        return;
                    }
                    if (request.texture.loadingError) {
                        console.warn(this.prettyName() + "error loading texture for: " + request.url);
                        this.requestsProcessedSinceCaughtUp++;
                        this.tileRequests.shift(); //pop request off front of queue
                        return;
                    }
                }
            }
        }
    }
    getAdvancedDynamicTexture() {
        return this.ourAttribution.advancedTexture;
    }
    makeSingleTileMesh(x, y, precision) {
        const ground = MeshBuilder.CreateGround("tile", { width: this.tileWidth, height: this.tileWidth, updatable: true, subdivisions: precision }, this.scene);
        ground.position.z = this.zmin + (y + 0.5) * this.tileWidth;
        ground.position.x = this.xmin + (x + 0.5) * this.tileWidth;
        //ground.bakeCurrentTransformIntoVertices(); //optimization
        //ground.freezeWorldMatrix(); //optimization
        return ground;
    }
    isBuildingDuplicate(newBuilding) {
        for (let t of this.ourTiles) {
            for (let existingBuilding of t.buildings) {
                if (existingBuilding.isBBoxContainedOnTile) {
                    continue; //don't need to consider buildings fully contained on a tile
                }
                else {
                    if (existingBuilding.doVerticesMatch(newBuilding)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
    disableGroundCulling() {
        for (let t of this.ourTiles) {
            t.mesh.alwaysSelectAsActiveMesh = true;
        }
    }
    setRasterProvider(rp) {
        this.ourRasterProvider = rp;
    }
    /**
    * update all the tiles in the tileset
    * @param lat latitude. conceptually the y position in decimal
    * @param lon longitude. conceptually the x position in decimal
    * @param zoom standard tile mapping zoom levels 0 (whole earth) - 20 (building)
    */
    updateRaster(lat, lon, zoom) {
        if (this.isGeometrySetup == false) {
            console.error("can't updateRaster! geometry not setup yet!");
            return;
        }
        this.zoom = zoom;
        this.centerCoords = new Vector2(lon, lat);
        this.tileCorner = this.ourTileMath.computeCornerTile(this.centerCoords, EPSG_Type.EPSG_4326, this.zoom);
        this.tileScale = this.ourTileMath.computeTileScale();
        this.ourAttribution.addAttribution(this.ourRasterProvider.name);
        //console.log("Tile Base: " + this.tileCorner);
        let tileIndex = 0;
        for (let y = 0; y < this.numTiles.y; y++) {
            for (let x = 0; x < this.numTiles.x; x++) {
                const tileX = this.tileCorner.x + x;
                const tileY = this.tileCorner.y - y;
                const tile = this.ourTiles[tileIndex];
                this.updateSingleRasterTile(tile, tileX, tileY);
                tileIndex++;
            }
        }
    }
    updateSingleRasterTile(tile, tileX, tileY) {
        tile.tileCoords = new Vector3(tileX, tileY, this.zoom); //store for later     
        this.ourTilesMap.set(tile.tileCoords.toString(), tile);
        tile.mesh.setEnabled(false);
        let material;
        if (tile.material) {
            material = tile.material;
            material.unfreeze();
            const texture = material.diffuseTexture;
            if (texture) { //get rid of texture if it already exists  
                texture.dispose();
            }
        }
        else {
            material = new StandardMaterial("material" + tileX + "-" + tileY, this.scene);
            material.specularColor = new Color3(0, 0, 0);
            material.alpha = 1.0;
            tile.mesh.material = material;
            tile.material = material;
            // material.backFaceCulling = false;
        }
        let url = "";
        url = this.ourRasterProvider.getRasterURL(new Vector2(tileX, tileY), this.zoom);
        const request = {
            requestType: TileRequestType.LoadTile,
            tile: tile,
            tileCoords: tile.tileCoords.clone(),
            url: url,
            mesh: tile.mesh,
            texture: null,
            inProgress: false
        };
        this.tileRequests.push(request);
        console.log(this.prettyName() + "submitted tile raster load request for: " + tile.tileCoords + " URL: " + url);
        tile.mesh.name = "Tile_" + tileX + "_" + tileY;
    }
    /**
    * moves all the tiles in the set. when a tile reaches the edge, it is moved
    * to the opposite side of the tileset, e.g. a tile comes off the right
    * edge and moves to the left edge. useful for trying to achieve an endless
    * scrolling type effect, where the user doesn't move but the ground
    * underneath does
    * @param movX x, ie left-right amount to move
    * @param movZ z, ie forward-back amount to move
    * @param reloadLimitPerFrame limit how many tiles we update per frame, to prevent stuttering
    * @param doBuildingsOSM should we spawn OSM Buildings on the new tile?
    * @param doMerge should we merge all those OSM Buildings into one mesh? as an optimization
    */
    moveAllTiles(movX, movZ, reloadLimitPerFrame, buildingCreator) {
        for (const t of this.ourTiles) {
            t.mesh.position.x += movX;
            t.mesh.position.z += movZ;
        }
        let tilesReloaded = 0;
        for (const t of this.ourTiles) {
            if (t.mesh.position.x < this.xmin) {
                console.log("Tile: " + t.tileCoords + " is below xMin");
                this.moveHelper(t, new Vector3(this.totalWidthMeters, 0, 0), new Vector3(this.numTiles.x, 0, 0), buildingCreator);
                tilesReloaded++;
                if (tilesReloaded < reloadLimitPerFrame) {
                    return;
                }
            }
            if (t.mesh.position.x > this.xmax) {
                console.log("Tile: " + t.tileCoords + " is above xMax");
                this.moveHelper(t, new Vector3(-this.totalWidthMeters, 0, 0), new Vector3(-this.numTiles.x, 0, 0), buildingCreator);
                tilesReloaded++;
                if (tilesReloaded < reloadLimitPerFrame) {
                    return;
                }
            }
            if (t.mesh.position.z < this.zmin) {
                console.log("Tile: " + t.tileCoords + " is below zmin");
                this.moveHelper(t, new Vector3(0, 0, this.totalHeightMeters), new Vector3(0, -this.numTiles.y, 0), buildingCreator);
                tilesReloaded++;
                if (tilesReloaded < reloadLimitPerFrame) {
                    return;
                }
            }
            if (t.mesh.position.z > this.zmax) {
                console.log("Tile: " + t.tileCoords + " is above zmax");
                this.moveHelper(t, new Vector3(0, 0, -this.totalHeightMeters), new Vector3(0, this.numTiles.y, 0), buildingCreator);
                tilesReloaded++;
                if (tilesReloaded < reloadLimitPerFrame) {
                    return;
                }
            }
        }
    }
    moveHelper(t, meshMoveAmount, tileCoordAdjustment, buildingCreator) {
        t.deleteBuildings();
        t.mesh.position = t.mesh.position.add(meshMoveAmount);
        this.ourTilesMap.delete(t.tileCoords.toString());
        let newTileCoords = t.tileCoords.add(tileCoordAdjustment);
        this.updateSingleRasterTile(t, newTileCoords.x, newTileCoords.y);
        if (buildingCreator) {
            buildingCreator.SubmitLoadTileRequest(t);
        }
    }
    async generateTerrain(exaggeration) {
        await this.ourTerrainMB.updateAllTerrainTiles(exaggeration);
    }
    getTerrainLowestY() {
        return this.ourTerrainMB.globalMinHeight;
    }
}
//# sourceMappingURL=TileSet.js.map