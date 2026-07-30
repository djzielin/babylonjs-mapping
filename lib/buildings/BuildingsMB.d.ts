import { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { Vector3 } from "@babylonjs/core/Maths/math.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type TileSet from "../core/TileSet.js";
export type MapboxModelTileLoader = (url: string, scene: Scene) => Promise<AssetContainer | undefined>;
export interface LoadedMapboxModelTile {
    tileCoords: Vector3;
    root: TransformNode;
    asset: AssetContainer;
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
    readonly tileSet: TileSet;
    private readonly modelTileLoader;
    accessToken: string;
    exaggeration: number;
    readonly sourceZoom = 14;
    readonly tileExtent = 8192;
    readonly tileset = "mapbox.mapbox-3dbuildings-v1";
    private readonly loadedTiles;
    private readonly inFlightTiles;
    private desiredTileKeys;
    private attributionAdded;
    constructor(tileSet: TileSet, modelTileLoader?: MapboxModelTileLoader);
    get loadedModelTiles(): readonly LoadedMapboxModelTile[];
    getModelURL(tileCoords: Vector3): string;
    private getRequiredSourceTiles;
    private createTileRoot;
    private disposeTile;
    private loadTile;
    /**
     * Loads the landmark tiles that overlap the current TileSet.
     * Calling this again after updateRaster() reuses unchanged tiles and
     * disposes tiles that are no longer visible.
     */
    generateBuildings(): Promise<readonly LoadedMapboxModelTile[]>;
    dispose(): void;
}
