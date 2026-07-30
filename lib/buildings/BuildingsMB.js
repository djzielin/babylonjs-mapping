import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader.js";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { EPSG_Type } from "../core/TileMath.js";
const DEFAULT_SOURCE_ZOOM = 14;
const DEFAULT_TILE_EXTENT = 8192;
const DEFAULT_TILESET = "mapbox.mapbox-3dbuildings-v1";
const MAPBOX_MODEL_SERVER = "https://api.mapbox.com/3dtiles/v1/";
async function defaultModelTileLoader(url, scene) {
    const response = await fetch(url);
    if (response.status === 204 || response.status === 404) {
        return undefined;
    }
    if (!response.ok) {
        throw new Error(`Unable to load Mapbox model tile (${response.status} ${response.statusText}).`);
    }
    const file = new File([await response.arrayBuffer()], "mapbox-model-tile.glb", { type: "model/gltf-binary" });
    await import("@babylonjs/loaders/glTF/index.js");
    return SceneLoader.LoadAssetContainerAsync("", file, scene, undefined, ".glb");
}
/**
 * Loads Mapbox's public landmark-building GLB tiles into Babylon map space.
 *
 * The source is a fixed zoom-14 batched-model tileset. Horizontal coordinates
 * are tile-local values in a 0..8192 extent and the third axis is elevation in
 * meters. Babylon's glTF loader also performs its standard right-to-left-handed
 * conversion, which is accounted for by the root transform below.
 */
export default class BuildingsMB {
    constructor(tileSet, modelTileLoader = defaultModelTileLoader) {
        this.tileSet = tileSet;
        this.modelTileLoader = modelTileLoader;
        this.accessToken = "";
        this.exaggeration = 1;
        this.sourceZoom = DEFAULT_SOURCE_ZOOM;
        this.tileExtent = DEFAULT_TILE_EXTENT;
        this.tileset = DEFAULT_TILESET;
        this.loadedTiles = new Map();
        this.inFlightTiles = new Map();
        this.desiredTileKeys = new Set();
        this.attributionAdded = false;
    }
    get loadedModelTiles() {
        return Array.from(this.loadedTiles.values());
    }
    getModelURL(tileCoords) {
        const query = new URLSearchParams({ access_token: this.accessToken });
        return `${MAPBOX_MODEL_SERVER}${this.tileset}/${tileCoords.z}/${tileCoords.x}/${tileCoords.y}.glb?${query.toString()}`;
    }
    getRequiredSourceTiles() {
        const required = new Map();
        const zoomDifference = this.tileSet.zoom - this.sourceZoom;
        const parentFactor = Math.pow(2, zoomDifference);
        for (const tile of this.tileSet.ourTiles) {
            const sourceCoords = new Vector3(Math.floor(tile.tileCoords.x / parentFactor), Math.floor(tile.tileCoords.y / parentFactor), this.sourceZoom);
            required.set(sourceCoords.toString(), sourceCoords);
        }
        return required;
    }
    createTileRoot(tileCoords) {
        const root = new TransformNode(`Mapbox landmark tile ${tileCoords.z}/${tileCoords.x}/${tileCoords.y}`, this.tileSet.scene);
        const topLeft = new Vector2(this.tileSet.ourTileMath.tile_to_lon(tileCoords.x, tileCoords.z), this.tileSet.ourTileMath.tile_to_lat(tileCoords.y, tileCoords.z));
        root.position = this.tileSet.ourTileMath.EPSG_to_Game(topLeft, EPSG_Type.EPSG_4326);
        const sourceTileWidth = this.tileSet.tileWidth
            * Math.pow(2, this.tileSet.zoom - this.sourceZoom);
        const horizontalScale = sourceTileWidth / this.tileExtent;
        // Mapbox model tiles are X/Y-horizontal and Z-up. Rotating -90° about
        // X maps source Y southward to Babylon -Z and source Z to Babylon +Y.
        // The negative X scale cancels Babylon's glTF handedness conversion.
        root.scaling = new Vector3(-horizontalScale, horizontalScale, this.tileSet.tileScale * this.exaggeration);
        root.rotation.x = -Math.PI / 2;
        return root;
    }
    disposeTile(key) {
        const loaded = this.loadedTiles.get(key);
        if (loaded === undefined) {
            return;
        }
        loaded.asset.dispose();
        loaded.root.dispose(false, false);
        this.loadedTiles.delete(key);
    }
    loadTile(tileCoords) {
        const key = tileCoords.toString();
        const loaded = this.loadedTiles.get(key);
        if (loaded !== undefined) {
            return Promise.resolve(loaded);
        }
        const inFlight = this.inFlightTiles.get(key);
        if (inFlight !== undefined) {
            return inFlight;
        }
        const request = this.modelTileLoader(this.getModelURL(tileCoords), this.tileSet.scene).then((asset) => {
            if (asset === undefined) {
                return undefined;
            }
            if (!this.desiredTileKeys.has(key)) {
                asset.dispose();
                return undefined;
            }
            const root = this.createTileRoot(tileCoords);
            asset.addAllToScene();
            for (const node of asset.rootNodes) {
                node.parent = root;
            }
            const result = {
                tileCoords: tileCoords.clone(),
                root,
                asset,
            };
            this.loadedTiles.set(key, result);
            return result;
        }).finally(() => {
            this.inFlightTiles.delete(key);
        });
        this.inFlightTiles.set(key, request);
        return request;
    }
    /**
     * Loads the landmark tiles that overlap the current TileSet.
     * Calling this again after updateRaster() reuses unchanged tiles and
     * disposes tiles that are no longer visible.
     */
    async generateBuildings() {
        this.tileSet.assertRasterSetup("generate Mapbox landmark buildings");
        if (this.accessToken.trim().length === 0) {
            throw new Error("A Mapbox access token is required to generate landmark buildings.");
        }
        if (!Number.isFinite(this.exaggeration) || this.exaggeration <= 0) {
            throw new RangeError("exaggeration must be a finite number greater than zero.");
        }
        if (this.tileSet.zoom < this.sourceZoom) {
            throw new RangeError(`Mapbox landmark buildings require zoom ${this.sourceZoom} or greater.`);
        }
        const required = this.getRequiredSourceTiles();
        this.desiredTileKeys = new Set(required.keys());
        for (const key of this.loadedTiles.keys()) {
            if (!required.has(key)) {
                this.disposeTile(key);
            }
        }
        await Promise.all(Array.from(required.values(), (tileCoords) => this.loadTile(tileCoords)));
        if (!this.attributionAdded) {
            this.tileSet.ourAttribution.addAttribution("MBMODEL");
            this.attributionAdded = true;
        }
        return this.loadedModelTiles;
    }
    dispose() {
        this.desiredTileKeys.clear();
        for (const key of Array.from(this.loadedTiles.keys())) {
            this.disposeTile(key);
        }
    }
}
//# sourceMappingURL=BuildingsMB.js.map