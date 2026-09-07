import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader.js";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";

import type TileSet from "../core/TileSet.js";
import { EPSG_Type } from "../core/TileMath.js";

const DEFAULT_SOURCE_ZOOM = 14;
const DEFAULT_TILE_EXTENT = 8192;
const DEFAULT_TILESET = "mapbox.mapbox-3dbuildings-v1";
const MAPBOX_MODEL_SERVER = "https://api.mapbox.com/3dtiles/v1/";

export type MapboxModelTileLoader = (
    url: string,
    scene: Scene,
) => Promise<AssetContainer | undefined>;

export interface LoadedMapboxModelTile {
    tileCoords: Vector3;
    root: TransformNode;
    asset: AssetContainer;
}

async function defaultModelTileLoader(
    url: string,
    scene: Scene,
): Promise<AssetContainer | undefined> {
    const response = await fetch(url);
    if (response.status === 204 || response.status === 404) {
        return undefined;
    }
    if (!response.ok) {
        throw new Error(`Unable to load Mapbox model tile (${response.status} ${response.statusText}).`);
    }

    const file = new File(
        [await response.arrayBuffer()],
        "mapbox-model-tile.glb",
        { type: "model/gltf-binary" },
    );
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
    public accessToken = "";
    public exaggeration = 1;
    public readonly sourceZoom = DEFAULT_SOURCE_ZOOM;
    public readonly tileExtent = DEFAULT_TILE_EXTENT;
    public readonly tileset = DEFAULT_TILESET;

    private readonly loadedTiles = new Map<string, LoadedMapboxModelTile>();
    private readonly inFlightTiles = new Map<string, Promise<LoadedMapboxModelTile | undefined>>();
    private desiredTileKeys = new Set<string>();
    private attributionAdded = false;
    private readonly emptyTileKeys = new Set<string>();

    constructor(
        public readonly tileSet: TileSet,
        private readonly modelTileLoader: MapboxModelTileLoader = defaultModelTileLoader,
    ) {
    }

    public get loadedModelTiles(): readonly LoadedMapboxModelTile[] {
        return Array.from(this.loadedTiles.values());
    }

    public getModelURL(tileCoords: Vector3): string {
        const query = new URLSearchParams({ access_token: this.accessToken });
        return `${MAPBOX_MODEL_SERVER}${this.tileset}/${tileCoords.z}/${tileCoords.x}/${tileCoords.y}.glb?${query.toString()}`;
    }

    private getRequiredSourceTiles(): Map<string, Vector3> {
        const required = new Map<string, Vector3>();
        const zoomDifference = this.tileSet.zoom - this.sourceZoom;
        const parentFactor = Math.pow(2, zoomDifference);

        for (const tile of this.tileSet.ourTiles) {
            const sourceCoords = new Vector3(
                Math.floor(tile.tileCoords.x / parentFactor),
                Math.floor(tile.tileCoords.y / parentFactor),
                this.sourceZoom,
            );
            required.set(sourceCoords.toString(), sourceCoords);
        }

        return required;
    }

    private createTileRoot(tileCoords: Vector3): TransformNode {
        const root = new TransformNode(
            `Mapbox landmark tile ${tileCoords.z}/${tileCoords.x}/${tileCoords.y}`,
            this.tileSet.scene,
        );
        this.updateTileRoot(root, tileCoords);
        return root;
    }

    private updateTileRoot(root: TransformNode, tileCoords: Vector3): void {
        const topLeft = new Vector2(
            this.tileSet.ourTileMath.tile_to_lon(tileCoords.x, tileCoords.z),
            this.tileSet.ourTileMath.tile_to_lat(tileCoords.y, tileCoords.z),
        );
        root.position = this.tileSet.getGeometryMath().EPSG_to_Game(
            topLeft,
            EPSG_Type.EPSG_4326,
        );

        const sourceTileWidth = this.tileSet.tileWidth
            * Math.pow(2, this.tileSet.zoom - this.sourceZoom);
        const horizontalScale = sourceTileWidth / this.tileExtent;

        // Mapbox model tiles are X/Y-horizontal and Z-up. Rotating -90° about
        // X maps source Y southward to Babylon -Z and source Z to Babylon +Y.
        // The negative X scale cancels Babylon's glTF handedness conversion.
        root.scaling = new Vector3(
            -horizontalScale,
            horizontalScale,
            this.tileSet.tileScale * this.exaggeration,
        );
        root.rotation.x = -Math.PI / 2;
    }

    private disposeTile(key: string): void {
        const loaded = this.loadedTiles.get(key);
        if (loaded === undefined) {
            return;
        }

        loaded.asset.dispose();
        loaded.root.dispose(false, false);
        this.loadedTiles.delete(key);
    }

    private loadTile(tileCoords: Vector3): Promise<LoadedMapboxModelTile | undefined> {
        const key = tileCoords.toString();
        if (this.emptyTileKeys.has(key)) return Promise.resolve(undefined);
        const loaded = this.loadedTiles.get(key);
        if (loaded !== undefined) {
            if (!this.tileSet.isGlobe) this.updateTileRoot(loaded.root, tileCoords);
            return Promise.resolve(loaded);
        }

        const inFlight = this.inFlightTiles.get(key);
        if (inFlight !== undefined) {
            return inFlight;
        }

        const request = this.modelTileLoader(
            this.getModelURL(tileCoords),
            this.tileSet.scene,
        ).then((asset) => {
            if (asset === undefined) {
                // Most locations have no bespoke model tile. Remember these
                // responses while exploring nearby overzoomed raster tiles.
                if (this.emptyTileKeys.size >= 128) this.emptyTileKeys.delete(this.emptyTileKeys.values().next().value!);
                this.emptyTileKeys.add(key);
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

            if (this.tileSet.isGlobe) {
                for (const mesh of [...asset.meshes].reverse()) {
                    if (mesh instanceof Mesh && mesh.getTotalVertices() > 0) this.tileSet.projectFeatureMesh(mesh);
                }
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
    public async generateBuildings(): Promise<readonly LoadedMapboxModelTile[]> {
        this.tileSet.assertRasterSetup("generate Mapbox landmark buildings");
        if (this.accessToken.trim().length === 0) {
            throw new Error("A Mapbox access token is required to generate landmark buildings.");
        }
        if (!Number.isFinite(this.exaggeration) || this.exaggeration <= 0) {
            throw new RangeError("exaggeration must be a finite number greater than zero.");
        }
        if (this.tileSet.zoom < this.sourceZoom) {
            throw new RangeError(
                `Mapbox landmark buildings require zoom ${this.sourceZoom} or greater.`,
            );
        }

        const required = this.getRequiredSourceTiles();
        this.desiredTileKeys = new Set(required.keys());
        for (const key of this.loadedTiles.keys()) {
            if (!required.has(key)) {
                this.disposeTile(key);
            }
        }

        await Promise.all(
            Array.from(required.values(), (tileCoords) => this.loadTile(tileCoords)),
        );
        if (!this.attributionAdded) {
            this.tileSet.ourAttribution.addAttribution("MBMODEL");
            this.attributionAdded = true;
        }
        return this.loadedModelTiles;
    }

    public dispose(): void {
        this.desiredTileKeys.clear();
        for (const key of Array.from(this.loadedTiles.keys())) {
            this.disposeTile(key);
        }
    }
}
