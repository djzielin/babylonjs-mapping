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
    private static archives = new Map<string, PMTiles>();
    private static decoded = new WeakMap<PMTiles, Map<string, Promise<feature[]>>>();

    constructor(
        tileSet: TileSet,
        archiveURL: string,
        retrievalLocation = RetrievalLocation.Remote,
    ) {
        super("Overture", tileSet, retrievalLocation);
        this.archive = BuildingsOverture.archives.get(archiveURL) ?? new PMTiles(archiveURL);
        BuildingsOverture.archives.set(archiveURL, this.archive);
        while (BuildingsOverture.archives.size > 4) BuildingsOverture.archives.delete(BuildingsOverture.archives.keys().next().value!);
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
            const header = await this.archive.getHeader();
            const z = Math.min(request.tileCoords.z, header.maxZoom);
            const factor = 2 ** (request.tileCoords.z - z);
            const count = 2 ** z;
            const x = ((Math.floor(request.tileCoords.x / factor) % count) + count) % count;
            const y = Math.floor(request.tileCoords.y / factor);
            let cache = BuildingsOverture.decoded.get(this.archive);
            if (!cache) { cache = new Map(); BuildingsOverture.decoded.set(this.archive, cache); }
            const key = `${z}/${x}/${y}`;
            let decoded = cache.get(key);
            if (!decoded) {
                decoded = this.archive.getZxy(z, x, y).then(response => {
                    const features: feature[] = [];
                    if (response) {
                        const vectorTile = new VectorTile(new PbfReader(response.data));
                        this.appendLayerFeatures(vectorTile, "building", x, y, z, features);
                        this.appendLayerFeatures(vectorTile, "building_part", x, y, z, features);
                    }
                    return features;
                }).catch(error => { cache!.delete(key); throw error; });
                cache.set(key, decoded);
                while (cache.size > 64) cache.delete(cache.keys().next().value!);
            }
            const features = await decoded;
            if (request.cancelled || !request.tile.tileCoords.equals(request.tileCoords)) {
                this.removePendingRequest(requestIndex, request);
                return;
            }

            const collection: topLevel = {
                type: "FeatureCollection",
                features: factor === 1 ? features : features.filter(feature => {
                    const polygons = feature.geometry.type === 'Polygon'
                        ? [feature.geometry.coordinates as number[][][]] : feature.geometry.coordinates as number[][][][];
                    const points = polygons.reduce<number[][]>((all,p) => all.concat(p[0]), []);
                    if (!points.length) return false;
                    const lon = points.reduce((sum,p)=>sum+p[0],0)/points.length;
                    const lat = points.reduce((sum,p)=>sum+p[1],0)/points.length;
                    const tx = this.tileSet.ourTileMath.lon_to_tile(lon,request.tileCoords.z);
                    const ty = this.tileSet.ourTileMath.lat_to_tile(lat,request.tileCoords.z);
                    const n=2**request.tileCoords.z;
                    return tx===((request.tileCoords.x%n)+n)%n && ty===request.tileCoords.y;
                }),
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
