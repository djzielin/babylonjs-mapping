/* Web-Based-VR-Tutorial Project Template
* Author: Evan Suma Rosenberg <suma@umn.edu> and Blair MacIntyre <blair@cc.gatech.edu>
* License: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
*/

// Extended by David J. Zielinski

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math";
import { Color4 } from "@babylonjs/core/Maths/math";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { TextBlock } from "@babylonjs/gui";
import { Control } from "@babylonjs/gui";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import "@babylonjs/core/Materials/standardMaterial"

import TileSet from "../../../lib/TileSet"
import Buildings from "../../../lib/Buildings";
import BuildingsOSM from "../../../lib/BuildingsOSM";
import BuildingsOverture, {
    resolveLatestOvertureBuildingsURL,
} from "../../../lib/BuildingsOverture";
import RasterMB from "../../../lib/RasterMB";
import RasterOSM from "../../../lib/RasterOSM";
import Raster from "../../../lib/Raster";
import { EPSG_Type }     from "../../../lib/TileMath";

const TOKYO = new Vector2(139.7671, 35.6812);
const MOUNT_FUJI = new Vector2(138.7274, 35.3606);
const LANDSCAPE_CENTER = new Vector2(
    (TOKYO.x + MOUNT_FUJI.x) / 2,
    (TOKYO.y + MOUNT_FUJI.y) / 2,
);
const LANDSCAPE_ZOOM = 11;
const MID_BUILDING_ZOOM = 13;
const BUILDING_ZOOM = 14;
const DETAIL_BUILDING_ZOOM = 15;
const LANDSCAPE_TILE_WIDTH = 100;
const MID_BUILDING_TILE_WIDTH = LANDSCAPE_TILE_WIDTH /
    Math.pow(2, MID_BUILDING_ZOOM - LANDSCAPE_ZOOM);
const BUILDING_TILE_WIDTH = LANDSCAPE_TILE_WIDTH / Math.pow(2, BUILDING_ZOOM - LANDSCAPE_ZOOM);
const DETAIL_BUILDING_TILE_WIDTH = LANDSCAPE_TILE_WIDTH /
    Math.pow(2, DETAIL_BUILDING_ZOOM - LANDSCAPE_ZOOM);
const TRANSPARENT_PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL0WQAAAABJRU5ErkJggg==";

class Game {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;

    private terrainTileSet: TileSet;
    private overviewBuildingTileSet: TileSet;
    private midBuildingTileSet: TileSet;
    private nearBuildingTileSet: TileSet;
    private innerBuildingTileSet: TileSet;
    private detailBuildingTileSet: TileSet;
    private overviewBuildings: BuildingsOverture;
    private midBuildings: BuildingsOverture;
    private nearBuildings: BuildingsOverture;
    private innerBuildings: BuildingsOverture;
    private detailBuildings: Buildings;
    private statusText: TextBlock;
    private framesUntilPerformanceSample = 60;

    constructor() {
        // Get the canvas element
        this.canvas = document.getElementById("renderCanvas") as unknown as HTMLCanvasElement;

        // Generate the BABYLON 3D engine
        this.engine = new Engine(this.canvas, false);

        // Creates a basic Babylon Scene object
        this.scene = new Scene(this.engine);
        this.scene.skipPointerMovePicking = true;
    }

    start(): void {
       // Create the scene and then execute this function afterwards
       this.createScene().then(() => {

           // Register a render loop to repeatedly render the scene
           this.engine.runRenderLoop(() => {
               this.update();
               this.scene.render();
           });

           // Watch for browser/canvas resize events
           window.addEventListener("resize", () => {
               this.engine.resize();
           });
       });
    }

    public async getKey(url: string, optional = false): Promise<string> {
        console.log("trying to fetch: " + url);
        const res = await fetch(url);
        console.log("  fetch returned: " + res.status);

        if (res.status != 200) {
            if (!optional) {
                console.warn("unable to load key: " + url);
            }
            return "";
        }

        const text = await res.text();
        return text;
    }

    public setupHelpText(hasMapboxKey: boolean, buildingSource: string) {
        const ourOverlay = this.terrainTileSet.getAdvancedDynamicTexture();
        const missingData = [
            !hasMapboxKey ? "Missing public/mapbox-key.txt (terrain)" : "",
            buildingSource === "unavailable" ? "Building data unavailable" : "",
        ].filter(Boolean);

        this.statusText = new TextBlock();
        this.statusText.text = [
            "TOKYO TO MOUNT FUJI",
            ...missingData,
            "Explore Tokyo's skyline with Mount Fuji in the distance",
            "Arrow keys move · mouse looks around",
        ].join("\n");
        this.statusText.color = missingData.length > 0 ? "#fff2a8" : "white";
        this.statusText.fontSize = 18;
        this.statusText.lineSpacing = 4;
        this.statusText.resizeToFit = true;
        this.statusText.paddingLeft = "16px";
        this.statusText.paddingTop = "16px";
        this.statusText.textVerticalAlignment=Control.VERTICAL_ALIGNMENT_TOP;
        this.statusText.textHorizontalAlignment=Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.statusText.verticalAlignment=Control.VERTICAL_ALIGNMENT_TOP;
        this.statusText.horizontalAlignment=Control.HORIZONTAL_ALIGNMENT_LEFT;

        ourOverlay.addControl(this.statusText);
    }

    private async createScene() {
        this.scene.clearColor = new Color4(135 / 255, 206 / 255, 235 / 255, 1.0);

        var camera = new UniversalCamera("camera1", Vector3.Zero(), this.scene);
        camera.attachControl(this.canvas, true);
        camera.speed=3;
        camera.angularSensibility=8000;
        camera.maxZ = 2000;

        var light = new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);
        light.intensity = 0.5;

        var light2 = new DirectionalLight("DirectionalLight", new Vector3(0, -1, 1), this.scene);
        light2.intensity=0.5;

        const [mapboxKey, oneGeoKey] = await Promise.all([
            this.getKey("mapbox-key.txt"),
            this.getKey("osmb-key.txt", true),
        ]);

        this.terrainTileSet = new TileSet(this.scene,this.engine);
        if (mapboxKey) {
            const satellite = new RasterMB(this.terrainTileSet);
            satellite.accessToken = mapboxKey.trim();
            satellite.doResBoost = true;
            this.terrainTileSet.setRasterProvider(satellite);
        } else {
            this.terrainTileSet.setRasterProvider(new RasterOSM(this.terrainTileSet));
        }
        this.terrainTileSet.createGeometry(new Vector2(8, 6), LANDSCAPE_TILE_WIDTH, 64);
        this.terrainTileSet.updateRaster(LANDSCAPE_CENTER.y, LANDSCAPE_CENTER.x, LANDSCAPE_ZOOM);

        const tokyoWorld = this.terrainTileSet.ourTileMath.EPSG_to_Game(TOKYO, EPSG_Type.EPSG_4326);
        const fujiWorld = this.terrainTileSet.ourTileMath.EPSG_to_Game(MOUNT_FUJI, EPSG_Type.EPSG_4326);
        camera.position.copyFrom(tokyoWorld.add(new Vector3(12, 10, 12)));
        camera.setTarget(fujiWorld.add(new Vector3(0, 2, 0)));

        this.overviewBuildingTileSet = this.createTransparentTileSet(
            new Vector2(8, 6),
            LANDSCAPE_TILE_WIDTH,
            LANDSCAPE_CENTER,
            LANDSCAPE_ZOOM,
        );
        const tokyoLandscapeTile = this.terrainTileSet.ourTileMath.EPSG_to_Tile(
            TOKYO,
            EPSG_Type.EPSG_4326,
            LANDSCAPE_ZOOM,
        );
        const midCenter = this.getChildCoverageCenter(
            tokyoLandscapeTile,
            LANDSCAPE_ZOOM,
            MID_BUILDING_ZOOM,
        );
        this.midBuildingTileSet = this.createTransparentTileSet(
            new Vector2(4, 4),
            MID_BUILDING_TILE_WIDTH,
            midCenter,
            MID_BUILDING_ZOOM,
        );
        const tokyoMidTile = this.terrainTileSet.ourTileMath.EPSG_to_Tile(
            TOKYO,
            EPSG_Type.EPSG_4326,
            MID_BUILDING_ZOOM,
        );
        const detailCenter = this.getChildCoverageCenter(
            tokyoMidTile,
            MID_BUILDING_ZOOM,
            BUILDING_ZOOM,
        );
        this.nearBuildingTileSet = this.createTransparentTileSet(
            new Vector2(2, 2),
            BUILDING_TILE_WIDTH,
            detailCenter,
            BUILDING_ZOOM,
        );
        const tokyoDetailTile = this.terrainTileSet.ourTileMath.EPSG_to_Tile(
            TOKYO,
            EPSG_Type.EPSG_4326,
            BUILDING_ZOOM,
        );
        const innerCenter = this.getChildCoverageCenter(
            tokyoDetailTile,
            BUILDING_ZOOM,
            DETAIL_BUILDING_ZOOM,
        );
        this.innerBuildingTileSet = this.createTransparentTileSet(
            new Vector2(2, 2),
            DETAIL_BUILDING_TILE_WIDTH,
            innerCenter,
            DETAIL_BUILDING_ZOOM,
        );
        this.detailBuildingTileSet = this.createTransparentTileSet(
            new Vector2(1, 1),
            DETAIL_BUILDING_TILE_WIDTH,
            TOKYO,
            DETAIL_BUILDING_ZOOM,
        );
        this.setTileSetVisibility(this.nearBuildingTileSet, 0);
        this.setTileSetVisibility(this.innerBuildingTileSet, 0);
        this.setTileSetVisibility(this.detailBuildingTileSet, 0);

        const buildingMaterial = new StandardMaterial("tokyo-buildings", this.scene);
        buildingMaterial.diffuseColor = new Color3(0.82, 0.84, 0.88);
        buildingMaterial.emissiveColor = new Color3(0.12, 0.12, 0.12);
        buildingMaterial.specularColor = new Color3(0.08, 0.08, 0.08);
        buildingMaterial.freeze();

        let terrainReady = Promise.resolve();
        if (mapboxKey) {
            this.terrainTileSet.ourTerrainMB.accessToken = mapboxKey.trim();
            terrainReady = this.terrainTileSet.generateTerrain(2.5).then(() => {
                this.terrainTileSet.setupTerrainLOD(
                    [48, 32, 16, 8, 4, 2, 0],
                    [100, 250, 800, 1100, 1400, 1650, 1900],
                    2,
                );
                const tokyoHeight = this.sampleTerrainHeight(tokyoWorld);
                const fujiHeight = this.sampleTerrainHeight(fujiWorld);
                camera.position.copyFrom(
                    tokyoWorld.add(new Vector3(10, tokyoHeight + 14, 10)),
                );
                camera.setTarget(
                    fujiWorld.add(new Vector3(0, fujiHeight * 0.8, 0)),
                );
                this.canvas.dataset.fujiHeight = fujiHeight.toFixed(1);
                console.log("Tokyo–Fuji terrain and terrain LOD are ready.");
            }).catch((error) => {
                console.error("Unable to load Tokyo–Fuji terrain:", error);
            });
        } else {
            console.warn("No Mapbox key found; terrain elevation is disabled.");
        }

        let buildingSource = "unavailable";
        const requestedBuildingSource = new URLSearchParams(window.location.search)
            .get("buildings")
            ?.toLowerCase();
        const useOneGeo = requestedBuildingSource === "onegeo" ||
            (requestedBuildingSource !== "overture" && Boolean(oneGeoKey));

        let overtureURL = "";
        try {
            overtureURL = await resolveLatestOvertureBuildingsURL();
            this.overviewBuildings = new BuildingsOverture(
                this.overviewBuildingTileSet,
                overtureURL,
            );
            this.overviewBuildings.buildingMaterial = buildingMaterial;
            this.overviewBuildings.exaggeration = 1;
            this.overviewBuildings.doMerge = true;
            this.overviewBuildings.buildingsCreatedPerFrame = 500;
            this.overviewBuildings.excludedTileKeys.add(
                new Vector3(
                    tokyoLandscapeTile.x,
                    tokyoLandscapeTile.y,
                    LANDSCAPE_ZOOM,
                ).toString(),
            );

            this.midBuildings = new BuildingsOverture(
                this.midBuildingTileSet,
                overtureURL,
            );
            this.midBuildings.buildingMaterial = buildingMaterial;
            this.midBuildings.exaggeration = 1;
            this.midBuildings.doMerge = true;
            this.midBuildings.buildingsCreatedPerFrame = 500;
            this.midBuildings.excludedTileKeys.add(
                new Vector3(
                    tokyoMidTile.x,
                    tokyoMidTile.y,
                    MID_BUILDING_ZOOM,
                ).toString(),
            );

            this.nearBuildings = new BuildingsOverture(
                this.nearBuildingTileSet,
                overtureURL,
            );
            this.nearBuildings.buildingMaterial = buildingMaterial;
            this.nearBuildings.exaggeration = 1;
            this.nearBuildings.doMerge = true;
            this.nearBuildings.buildingsCreatedPerFrame = 500;
            this.nearBuildings.excludedTileKeys.add(
                new Vector3(
                    tokyoDetailTile.x,
                    tokyoDetailTile.y,
                    BUILDING_ZOOM,
                ).toString(),
            );

            const tokyoInnerTile = this.terrainTileSet.ourTileMath.EPSG_to_Tile(
                TOKYO,
                EPSG_Type.EPSG_4326,
                DETAIL_BUILDING_ZOOM,
            );
            this.innerBuildings = new BuildingsOverture(
                this.innerBuildingTileSet,
                overtureURL,
            );
            this.innerBuildings.buildingMaterial = buildingMaterial;
            this.innerBuildings.exaggeration = 1;
            this.innerBuildings.doMerge = true;
            this.innerBuildings.buildingsCreatedPerFrame = 500;
            this.innerBuildings.excludedTileKeys.add(
                new Vector3(
                    tokyoInnerTile.x,
                    tokyoInnerTile.y,
                    DETAIL_BUILDING_ZOOM,
                ).toString(),
            );
        } catch (error) {
            console.error("Unable to load an Overture building release:", error);
        }

        if (useOneGeo && oneGeoKey) {
            const oneGeoBuildings = new BuildingsOSM(this.detailBuildingTileSet);
            oneGeoBuildings.accessToken = oneGeoKey.trim();
            this.detailBuildings = oneGeoBuildings;
            buildingSource = "ONEGEO";
        } else if (overtureURL) {
            if (useOneGeo) {
                console.warn("ONEGEO was requested without public/osmb-key.txt; using Overture.");
            }
            this.detailBuildings = new BuildingsOverture(
                this.detailBuildingTileSet,
                overtureURL,
            );
            buildingSource = "Overture Maps";
        }

        let overviewReady = Promise.resolve();
        if (this.overviewBuildings) {
            overviewReady = new Promise((resolve) => {
                this.overviewBuildings.onCaughtUpObservable.addOnce(() => resolve());
            });
            this.overviewBuildings.generateBuildings();
        }

        let midReady = Promise.resolve();
        if (this.midBuildings) {
            midReady = new Promise((resolve) => {
                this.midBuildings.onCaughtUpObservable.addOnce(() => resolve());
            });
            this.midBuildings.generateBuildings();
        }

        let detailsReady = Promise.resolve();
        let nearReady = Promise.resolve();
        if (this.nearBuildings) {
            nearReady = new Promise((resolve) => {
                this.nearBuildings.onCaughtUpObservable.addOnce(() => resolve());
            });
            this.nearBuildings.generateBuildings();
        }

        let innerReady = Promise.resolve();
        if (this.innerBuildings) {
            innerReady = new Promise((resolve) => {
                this.innerBuildings.onCaughtUpObservable.addOnce(() => resolve());
            });
            this.innerBuildings.generateBuildings();
        }

        if (this.detailBuildings) {
            this.detailBuildings.buildingMaterial = buildingMaterial;
            this.detailBuildings.exaggeration = 1;
            this.detailBuildings.buildingsCreatedPerFrame = 100;
            this.detailBuildings.buildingLOD = {
                enabled: true,
                distance: 20,
            };
            detailsReady = new Promise((resolve) => {
                this.detailBuildings.onCaughtUpObservable.addOnce(() => resolve());
            });
            this.detailBuildings.generateBuildings();
        }

        void Promise.all([terrainReady, overviewReady]).then(() => {
            this.alignMergedTierToTerrain(
                this.overviewBuildingTileSet,
                LANDSCAPE_CENTER,
                500,
            );
        });
        void Promise.all([terrainReady, midReady]).then(() => {
            this.alignMergedTierToTerrain(
                this.midBuildingTileSet,
                midCenter,
                250,
            );
        });
        void Promise.all([terrainReady, nearReady]).then(() => {
            this.alignMergedTierToTerrain(
                this.nearBuildingTileSet,
                detailCenter,
                160,
            );
            this.setTileSetVisibility(this.nearBuildingTileSet, 1);
        });
        void Promise.all([terrainReady, innerReady]).then(() => {
            this.alignMergedTierToTerrain(
                this.innerBuildingTileSet,
                innerCenter,
                100,
            );
            this.setTileSetVisibility(this.innerBuildingTileSet, 1);
        });
        void Promise.all([terrainReady, detailsReady]).then(() => {
            this.alignDetailsToTerrain(tokyoWorld);
            this.setTileSetVisibility(this.detailBuildingTileSet, 1);
        });

        this.setupHelpText(Boolean(mapboxKey), buildingSource);
    }

    private createTransparentTileSet(
        dimensions: Vector2,
        tileWidth: number,
        center: Vector2,
        zoom: number,
    ): TileSet {
        const tileSet = new TileSet(this.scene, this.engine);
        const invisibleRaster = new Raster("", tileSet);
        invisibleRaster.getRasterURL = () => TRANSPARENT_PIXEL;
        tileSet.setRasterProvider(invisibleRaster);
        tileSet.hasAlpha = true;
        tileSet.createGeometry(dimensions, tileWidth, 1);
        tileSet.updateRaster(center.y, center.x, zoom);

        for (const tile of tileSet.ourTiles) {
            if (tile.mesh.material) {
                tile.mesh.material.alpha = 0;
            }
        }
        return tileSet;
    }

    private setTileSetVisibility(tileSet: TileSet, visibility: number): void {
        for (const tile of tileSet.ourTiles) {
            tile.mesh.visibility = visibility;
        }
    }

    private getChildCoverageCenter(
        parentTile: Vector2,
        parentZoom: number,
        childZoom: number,
    ): Vector2 {
        const scale = Math.pow(2, childZoom - parentZoom);
        const centerX = parentTile.x * scale + scale / 2;
        const centerY = parentTile.y * scale + (scale - 1) / 2;
        return new Vector2(
            this.terrainTileSet.ourTileMath.tile_to_lon(centerX, childZoom),
            this.terrainTileSet.ourTileMath.tile_to_lat(centerY, childZoom),
        );
    }

    private alignMergedTierToTerrain(
        tileSet: TileSet,
        reference: Vector2,
        cullDistance: number,
    ): void {
        const terrainReference = this.terrainTileSet.ourTileMath.EPSG_to_Game(
            reference,
            EPSG_Type.EPSG_4326,
        );
        const tierReference = tileSet.ourTileMath.EPSG_to_Game(
            reference,
            EPSG_Type.EPSG_4326,
        );
        const alignment = terrainReference.subtract(tierReference);

        for (const tile of tileSet.ourTiles) {
            const mesh = tile.mergedBuildingMesh;
            if (!mesh) {
                continue;
            }
            mesh.unfreezeWorldMatrix();
            mesh.position.addInPlace(alignment);
            mesh.computeWorldMatrix(true);
            mesh.refreshBoundingInfo();
            const bounds = mesh.getBoundingInfo().boundingBox;
            mesh.position.y += this.sampleTerrainHeight(bounds.centerWorld) -
                bounds.minimumWorld.y + 0.01;
            mesh.computeWorldMatrix(true);
            mesh.refreshBoundingInfo();
            mesh.addLODLevel(cullDistance, null);
            mesh.freezeWorldMatrix();
        }
    }

    private alignDetailsToTerrain(tokyoWorld: Vector3): void {
        const buildingTokyoWorld = this.detailBuildingTileSet.ourTileMath.EPSG_to_Game(TOKYO, EPSG_Type.EPSG_4326);
        const alignment = tokyoWorld.subtract(buildingTokyoWorld);

        for (const tile of this.detailBuildingTileSet.ourTiles) {
            for (const building of tile.buildings) {
                const mesh = building.mesh;
                mesh.unfreezeWorldMatrix();
                mesh.position.addInPlace(alignment);
                mesh.computeWorldMatrix(true);
                mesh.refreshBoundingInfo();

                const bounds = mesh.getBoundingInfo().boundingBox;
                const terrainHeight = this.sampleTerrainHeight(bounds.centerWorld);
                mesh.position.y += terrainHeight - bounds.minimumWorld.y + 0.01;
                mesh.computeWorldMatrix(true);
                mesh.refreshBoundingInfo();
                mesh.addLODLevel(60, null);
                mesh.freezeWorldMatrix();
            }
        }
    }

    private sampleTerrainHeight(worldPosition: Vector3): number {
        const exactTile = this.terrainTileSet.ourTileMath.Game_to_Tile(worldPosition);
        const tileX = Math.floor(exactTile.x);
        const tileY = Math.floor(exactTile.y);
        const tile = this.terrainTileSet.ourTilesMap.get(
            new Vector3(tileX, tileY, LANDSCAPE_ZOOM).toString(),
        );

        if (!tile?.terrainLoaded) {
            return 0;
        }

        const precision = this.terrainTileSet.meshPrecision;
        const subdivisions = precision + 1;
        const sampleX = Math.min(Math.max((exactTile.x - tileX) * precision, 0), precision);
        const sampleY = Math.min(Math.max((exactTile.y - tileY) * precision, 0), precision);
        const x0 = Math.floor(sampleX);
        const x1 = Math.min(Math.ceil(sampleX), precision);
        const y0 = Math.floor(sampleY);
        const y1 = Math.min(Math.ceil(sampleY), precision);
        const tx = sampleX - x0;
        const ty = sampleY - y0;
        const positions = tile.mesh.getVerticesData(VertexBuffer.PositionKind);

        if (!positions) {
            return 0;
        }

        const heightAt = (x: number, y: number) =>
            positions[1 + (x + y * subdivisions) * 3];
        const top = heightAt(x0, y0) + (heightAt(x1, y0) - heightAt(x0, y0)) * tx;
        const bottom = heightAt(x0, y1) + (heightAt(x1, y1) - heightAt(x0, y1)) * tx;
        return top + (bottom - top) * ty;
    }

    private update(): void {
        this.framesUntilPerformanceSample--;
        if (this.framesUntilPerformanceSample <= 0) {
            this.canvas.dataset.fps = this.engine.getFps().toFixed(1);
            this.canvas.dataset.meshes = this.scene.meshes.length.toString();
            this.canvas.dataset.activeMeshes =
                this.scene.getActiveMeshes().length.toString();
            this.framesUntilPerformanceSample = 60;
        }
    }

}
/******* End of the Game class ******/

// start the game
var game = new Game();
game.start();
