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
    private archive;
    constructor(tileSet: TileSet, archiveURL: string, retrievalLocation?: RetrievalLocation);
    SubmitLoadTileRequest(tile: Tile): void;
    SubmitLoadAllRequest(): void;
    generateBuildings(): void;
    protected handleLoadTileRequest(request: BuildingRequest, requestIndex?: number): void;
    private loadTile;
    private appendLayerFeatures;
}
