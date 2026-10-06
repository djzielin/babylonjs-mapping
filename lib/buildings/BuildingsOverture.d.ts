import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type Tile from "../core/Tile.js";
import type TileSet from "../core/TileSet.js";
import { RetrievalLocation } from "../shared/Retrieval.js";
import Buildings, { BuildingRequest } from "./Buildings.js";
export declare const OVERTURE_TILES_BASE_URL = "https://overturemaps-extras-us-west-2.s3.amazonaws.com";
/**
 * Resolves the newest public Overture buildings PMTiles archive.
 * Overture retains a rotating set of releases, so resolving it at runtime keeps
 * examples from depending on an archive that may later be removed.
 */
export declare function resolveLatestOvertureBuildingsURL(baseURL?: string): Promise<string>;
/**
 * Loads Overture's public building PMTiles directly in the browser.
 */
export default class BuildingsOverture extends Buildings {
    /** Tile coordinate keys to omit, useful when a finer building tier covers them. */
    excludedTileKeys: Set<string>;
    /** Direct globe batches when doMerge is enabled and no per-mesh filter is installed. */
    batchGeometry: boolean;
    /** Hide covered footprints by updating indices while preserving prepared vertices. */
    batchVisibilityFilter?: (latitude: number, longitude: number, bounds?: {
        id?: string;
        south: number;
        west: number;
        north: number;
        east: number;
    }) => boolean;
    /** Notifies a viewer when prepared batch geometry can replace its fallback. */
    onTileResolved?: (tile: Tile) => void;
    /** Route uncovered tiles through the viewer's admission queue when installed. */
    onTileReloadRequested?: (tile: Tile) => void;
    /** Omit an entire vector tile when loaded imagery already replaces every building in it. */
    tileCoverageFilter?: (tile: Tile) => boolean;
    private skippedCoverageTiles;
    private batches;
    private archive;
    private static archives;
    private static encoded;
    private static decoded;
    constructor(tileSet: TileSet, archiveURL: string, retrievalLocation?: RetrievalLocation);
    SubmitLoadTileRequest(tile: Tile): void;
    SubmitLoadAllRequest(): void;
    generateBuildings(): void;
    protected handleLoadTileRequest(request: BuildingRequest, requestIndex?: number): void;
    private loadTile;
    private buildBatch;
    updateBatchVisibility(coverageOnlyGrows?: boolean, shouldUpdateTile?: (tile: Tile) => boolean): void;
    onBuildingCreated(mesh: Mesh): void;
    private buildingVisible;
    private updateMeshVisibility;
    private appendLayerFeatures;
    private layerFeatures;
}
