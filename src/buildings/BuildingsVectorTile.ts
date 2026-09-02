import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

import type Tile from "../core/Tile.js";
import type TileSet from "../core/TileSet.js";
import { EPSG_Type } from "../core/TileMath.js";
import { RetrievalLocation } from "../shared/Retrieval.js";
import Buildings, { BuildingRequest, BuildingRequestType } from "./Buildings.js";
import type { feature, geometry, topLevel } from "./GeoJSON.js";

/** Mapbox Streets v8 Vector Tiles API URL template. */
export const MAPBOX_STREETS_VECTOR_TILE_URL =
    "https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/{z}/{x}/{y}.vector.pbf";

/** The Streets v8 layer containing road geometries. */
export const MAPBOX_STREETS_ROAD_LAYER = "road";

export type VectorTileDataLoader = (url: string) => Promise<ArrayBuffer>;
export type VectorTileDecoder = (data: ArrayBuffer) => VectorTile;

interface VectorTileFeatureDocument {
    id?: number | string;
    properties?: Record<string, unknown>;
    geometry?: {
        type: string;
        coordinates: unknown;
    } | null;
}

interface VectorTileLayerLike {
    length: number;
    feature(index: number): {
        toGeoJSON(x: number, y: number, z: number): VectorTileFeatureDocument;
    };
}

interface VectorTileLike {
    layers: Record<string, VectorTileLayerLike | undefined>;
}

async function defaultVectorTileDataLoader(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Unable to load vector tile (${response.status} ${response.statusText}).`);
    }

    return response.arrayBuffer();
}

function defaultVectorTileDecoder(data: ArrayBuffer): VectorTile {
    return new VectorTile(new PbfReader(data));
}

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
    public accessToken = "";
    public sourceLayers: string[];
    public readonly tileURL: string;

    private readonly dataLoader: VectorTileDataLoader;
    private readonly decoder: VectorTileDecoder;

    constructor(
        tileSet: TileSet,
        tileURL = MAPBOX_STREETS_VECTOR_TILE_URL,
        sourceLayers: readonly string[] = [MAPBOX_STREETS_ROAD_LAYER],
        retrievalLocation = RetrievalLocation.Remote,
        dataLoader: VectorTileDataLoader = defaultVectorTileDataLoader,
        decoder: VectorTileDecoder = defaultVectorTileDecoder,
    ) {
        super("Vector Tile", tileSet, retrievalLocation);
        this.tileURL = tileURL;
        this.sourceLayers = [...sourceLayers];
        this.dataLoader = dataLoader;
        this.decoder = decoder;

        // Roads should read as low profiles by default while remaining above
        // the raster surface. Applications can tune both values as needed.
        this.defaultBuildingHeight = 0.05;
    }

    public override generateBuildings(): void {
        if (this.tileURL === MAPBOX_STREETS_VECTOR_TILE_URL && this.accessToken.trim().length === 0) {
            throw new Error("A Mapbox access token is required to load the default Streets vector tiles.");
        }

        super.generateBuildings();
        this.tileSet.ourAttribution.addAttribution("MB");
    }

    public override SubmitLoadTileRequest(tile: Tile): void {
        const tileCoords = tile.tileCoords.clone();
        const request: BuildingRequest = {
            requestType: BuildingRequestType.LoadTile,
            tile,
            tileCoords,
            epsgType: EPSG_Type.EPSG_4326,
            url: this.getTileURL(tileCoords),
            inProgress: false,
            flipWinding: false,
        };
        this.buildingRequests.push(request);
    }

    public override SubmitLoadAllRequest(): void {
        throw new Error("Vector tiles must be loaded as individual tiles.");
    }

    /** Resolves the configured URL template and appends the Mapbox token. */
    public getTileURL(tileCoords: Tile["tileCoords"]): string {
        const url = this.tileURL
            .replace(/\{z\}/g, String(tileCoords.z))
            .replace(/\{x\}/g, String(tileCoords.x))
            .replace(/\{y\}/g, String(tileCoords.y));

        if (this.accessToken.trim().length === 0) {
            return url;
        }

        const separator = url.includes("?") ? "&" : "?";
        return `${url}${separator}access_token=${encodeURIComponent(this.accessToken)}`;
    }

    protected override handleLoadTileRequest(
        request: BuildingRequest,
        _requestIndex = 0,
    ): void {
        request.inProgress = true;
        void this.loadTile(request);
    }

    private async loadTile(request: BuildingRequest): Promise<void> {
        try {
            const data = await this.dataLoader(request.url!);
            if (!request.tile.tileCoords.equals(request.tileCoords)) {
                this.removeRequest(request);
                return;
            }

            const vectorTile = this.decoder(data) as unknown as VectorTileLike;
            const collection = this.toFeatureCollection(
                vectorTile,
                request.tileCoords.x,
                request.tileCoords.y,
                request.tileCoords.z,
            );
            this.ProcessGeoJSON(request, collection);
            this.removeRequest(request);
        } catch (error) {
            console.error(this.prettyName() + "unable to load vector tile:", error);
            this.removeRequest(request);
        }
    }

    private removeRequest(request: BuildingRequest): void {
        const requestIndex = this.buildingRequests.indexOf(request);
        if (requestIndex >= 0) {
            this.removePendingRequest(requestIndex);
        }
    }

    private toFeatureCollection(
        vectorTile: VectorTileLike,
        x: number,
        y: number,
        z: number,
    ): topLevel {
        const features: feature[] = [];
        for (const layerName of this.sourceLayers) {
            const layer = vectorTile.layers[layerName];
            if (!layer) {
                continue;
            }

            for (let index = 0; index < layer.length; index++) {
                const source = layer.feature(index).toGeoJSON(x, y, z);
                const normalizedGeometry = this.normalizeGeometry(source.geometry);
                if (!normalizedGeometry) {
                    continue;
                }

                features.push({
                    id: String(source.id ?? `${layerName}-${index}`),
                    type: "Feature",
                    properties: {
                        ...(source.properties ?? {}),
                        sourceLayer: layerName,
                    },
                    geometry: normalizedGeometry,
                });
            }
        }

        return {
            type: "FeatureCollection",
            features,
        };
    }

    private normalizeGeometry(sourceGeometry: VectorTileFeatureDocument["geometry"]): geometry | null {
        if (!sourceGeometry) {
            return null;
        }

        if (sourceGeometry.type === "LineString") {
            return {
                type: "MultiLineString",
                coordinates: [sourceGeometry.coordinates],
            };
        }

        if (
            sourceGeometry.type === "MultiLineString" ||
            sourceGeometry.type === "Polygon" ||
            sourceGeometry.type === "MultiPolygon" ||
            sourceGeometry.type === "Point"
        ) {
            return {
                type: sourceGeometry.type,
                coordinates: sourceGeometry.coordinates,
            };
        }

        return null;
    }
}
