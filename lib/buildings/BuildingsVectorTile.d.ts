import { VectorTile } from "@mapbox/vector-tile";
import type Tile from "../core/Tile.js";
import type TileSet from "../core/TileSet.js";
import { RetrievalLocation } from "../shared/Retrieval.js";
import Buildings, { BuildingRequest } from "./Buildings.js";
/** Mapbox Streets v8 Vector Tiles API URL template. */
export declare const MAPBOX_STREETS_VECTOR_TILE_URL = "https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/{z}/{x}/{y}.vector.pbf";
/** The Streets v8 layer containing road geometries. */
export declare const MAPBOX_STREETS_ROAD_LAYER = "road";
export type VectorTileDataLoader = (url: string) => Promise<ArrayBuffer>;
export type VectorTileDecoder = (data: ArrayBuffer) => VectorTile;
/**
 * Loads Mapbox Vector Tiles (or another compatible MVT endpoint) into the
 * library's existing GeoJSON extrusion pipeline.
 *
 * LineString features are normalized to MultiLineString because that is the
 * geometry shape supported by GeoJSON's line extrusion path. Source-layer
 * selection is configurable so the same provider can load road, traffic, or
 * other line layers from a custom vector tileset.
 */
export default class BuildingsVectorTile extends Buildings {
    accessToken: string;
    sourceLayers: string[];
    readonly tileURL: string;
    private readonly dataLoader;
    private readonly decoder;
    constructor(tileSet: TileSet, tileURL?: string, sourceLayers?: readonly string[], retrievalLocation?: RetrievalLocation, dataLoader?: VectorTileDataLoader, decoder?: VectorTileDecoder);
    generateBuildings(): void;
    SubmitLoadTileRequest(tile: Tile): void;
    SubmitLoadAllRequest(): void;
    /** Resolves the configured URL template and appends the Mapbox token. */
    getTileURL(tileCoords: Tile["tileCoords"]): string;
    protected handleLoadTileRequest(request: BuildingRequest, _requestIndex?: number): void;
    private loadTile;
    private removeRequest;
    private toFeatureCollection;
    private normalizeGeometry;
}
