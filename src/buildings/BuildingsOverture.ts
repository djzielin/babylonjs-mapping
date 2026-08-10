import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { PMTiles } from "pmtiles";

import type Tile from "../core/Tile.js";
import type TileSet from "../core/TileSet.js";
import { EPSG_Type } from "../core/TileMath.js";
import { RetrievalLocation } from "../shared/Retrieval.js";
import Buildings, { BuildingRequest, BuildingRequestType } from "./Buildings.js";
import type { feature, topLevel } from "./GeoJSON.js";

export const OVERTURE_TILES_BASE_URL =
    "https://overturemaps-extras-us-west-2.s3.amazonaws.com";

/**
 * Resolves the newest public Overture buildings PMTiles archive.
 * Overture retains a rotating set of releases, so resolving it at runtime keeps
 * examples from depending on an archive that may later be removed.
 */
export async function resolveLatestOvertureBuildingsURL(
    baseURL = OVERTURE_TILES_BASE_URL,
): Promise<string> {
    const normalizedBaseURL = baseURL.replace(/\/$/, "");
    const response = await fetch(
        normalizedBaseURL + "/?list-type=2&prefix=tiles/&delimiter=/",
    );

    if (!response.ok) {
        throw new Error("Unable to list Overture tile releases: HTTP " + response.status);
    }

    const listing = await response.text();
    const releases = Array.from(
        listing.matchAll(/<Prefix>tiles\/([^<]+)\/<\/Prefix>/g),
        (match) => match[1],
    ).sort();

    const latestRelease = releases[releases.length - 1];
    if (!latestRelease) {
        throw new Error("No Overture tile releases were found.");
    }

    return normalizedBaseURL + "/tiles/" + latestRelease + "/buildings.pmtiles";
}

/**
 * Loads Overture's public building PMTiles directly in the browser.
 */
export default class BuildingsOverture extends Buildings {
    /** Tile coordinate keys to omit, useful when a finer building tier covers them. */
    public excludedTileKeys: Set<string> = new Set();
    private archive: PMTiles;

    constructor(
        tileSet: TileSet,
        archiveURL: string,
        retrievalLocation = RetrievalLocation.Remote,
    ) {
        super("Overture", tileSet, retrievalLocation);
        this.archive = new PMTiles(archiveURL);
    }

    public override SubmitLoadTileRequest(tile: Tile): void {
        if (this.excludedTileKeys.has(tile.tileCoords.toString())) {
            return;
        }

        const request: BuildingRequest = {
            requestType: BuildingRequestType.LoadTile,
            tile,
            tileCoords: tile.tileCoords.clone(),
            epsgType: EPSG_Type.EPSG_4326,
            inProgress: false,
            flipWinding: false,
        };
        this.enqueueBuildingRequest(request);
    }

    public override SubmitLoadAllRequest(): void {
        throw new Error("Overture buildings must be loaded as individual tiles.");
    }

    public override generateBuildings(): void {
        super.generateBuildings();
        this.tileSet.ourAttribution.addAttribution("OVERTURE");
    }

    protected override handleLoadTileRequest(
        request: BuildingRequest,
        requestIndex = 0,
    ): void {
        request.inProgress = true;
        void this.loadTile(request, requestIndex);
    }

    private async loadTile(request: BuildingRequest, requestIndex: number): Promise<void> {
        try {
            const { x, y, z } = request.tileCoords;
            const tileResponse = await this.archive.getZxy(z, x, y);

            if (request.tile.tileCoords.equals(request.tileCoords) === false) {
                this.removePendingRequest(requestIndex, request);
                return;
            }

            if (!tileResponse) {
                this.removePendingRequest(requestIndex, request);
                return;
            }

            const vectorTile = new VectorTile(new PbfReader(tileResponse.data));
            const features: feature[] = [];

            this.appendLayerFeatures(vectorTile, "building", x, y, z, features);
            this.appendLayerFeatures(vectorTile, "building_part", x, y, z, features);

            const collection: topLevel = {
                type: "FeatureCollection",
                features,
            };
            this.ProcessGeoJSON(request, collection);
            this.removePendingRequest(requestIndex, request);
        } catch (error) {
            console.error(this.prettyName() + "unable to load PMTiles building data:", error);
            this.removePendingRequest(requestIndex, request);
        }
    }

    private appendLayerFeatures(
        vectorTile: VectorTile,
        layerName: string,
        x: number,
        y: number,
        z: number,
        output: feature[],
    ): void {
        const layer = vectorTile.layers[layerName];
        if (!layer) {
            return;
        }

        for (let index = 0; index < layer.length; index++) {
            const source = layer.feature(index).toGeoJSON(x, y, z);
            const properties = { ...(source.properties ?? {}) };

            if (properties.is_underground === true) {
                continue;
            }
            if (layerName === "building" && properties.has_parts === true) {
                continue;
            }
            if (source.geometry.type !== "Polygon" && source.geometry.type !== "MultiPolygon") {
                continue;
            }

            if (properties.height === undefined && typeof properties.num_floors === "number") {
                properties.height = properties.num_floors * 3;
            }
            if (properties.name === undefined && typeof properties["@name"] === "string") {
                properties.name = properties["@name"];
            }

            output.push({
                id: String(source.id ?? properties.id ?? layerName + "-" + index),
                type: "Feature",
                properties,
                geometry: {
                    type: source.geometry.type,
                    coordinates: source.geometry.coordinates,
                },
            });
        }
    }
}
