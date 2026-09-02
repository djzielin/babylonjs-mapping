import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { EPSG_Type } from "../core/TileMath.js";
import { RetrievalLocation } from "../shared/Retrieval.js";
import Buildings, { BuildingRequestType } from "./Buildings.js";
/** Mapbox Streets v8 Vector Tiles API URL template. */
export const MAPBOX_STREETS_VECTOR_TILE_URL = "https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/{z}/{x}/{y}.vector.pbf";
/** The Streets v8 layer containing road geometries. */
export const MAPBOX_STREETS_ROAD_LAYER = "road";
async function defaultVectorTileDataLoader(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Unable to load vector tile (${response.status} ${response.statusText}).`);
    }
    return response.arrayBuffer();
}
function defaultVectorTileDecoder(data) {
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
    constructor(tileSet, tileURL = MAPBOX_STREETS_VECTOR_TILE_URL, sourceLayers = [MAPBOX_STREETS_ROAD_LAYER], retrievalLocation = RetrievalLocation.Remote, dataLoader = defaultVectorTileDataLoader, decoder = defaultVectorTileDecoder) {
        super("Vector Tile", tileSet, retrievalLocation);
        this.accessToken = "";
        this.tileURL = tileURL;
        this.sourceLayers = [...sourceLayers];
        this.dataLoader = dataLoader;
        this.decoder = decoder;
        // Roads should read as low profiles by default while remaining above
        // the raster surface. Applications can tune both values as needed.
        this.defaultBuildingHeight = 0.05;
    }
    generateBuildings() {
        if (this.tileURL === MAPBOX_STREETS_VECTOR_TILE_URL && this.accessToken.trim().length === 0) {
            throw new Error("A Mapbox access token is required to load the default Streets vector tiles.");
        }
        super.generateBuildings();
        this.tileSet.ourAttribution.addAttribution("MB");
    }
    SubmitLoadTileRequest(tile) {
        const tileCoords = tile.tileCoords.clone();
        const request = {
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
    SubmitLoadAllRequest() {
        throw new Error("Vector tiles must be loaded as individual tiles.");
    }
    /** Resolves the configured URL template and appends the Mapbox token. */
    getTileURL(tileCoords) {
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
    handleLoadTileRequest(request, _requestIndex = 0) {
        request.inProgress = true;
        void this.loadTile(request);
    }
    async loadTile(request) {
        try {
            const data = await this.dataLoader(request.url);
            if (!request.tile.tileCoords.equals(request.tileCoords)) {
                this.removeRequest(request);
                return;
            }
            const vectorTile = this.decoder(data);
            const collection = this.toFeatureCollection(vectorTile, request.tileCoords.x, request.tileCoords.y, request.tileCoords.z);
            this.ProcessGeoJSON(request, collection);
            this.removeRequest(request);
        }
        catch (error) {
            console.error(this.prettyName() + "unable to load vector tile:", error);
            this.removeRequest(request);
        }
    }
    removeRequest(request) {
        const requestIndex = this.buildingRequests.indexOf(request);
        if (requestIndex >= 0) {
            this.removePendingRequest(requestIndex);
        }
    }
    toFeatureCollection(vectorTile, x, y, z) {
        const features = [];
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
    normalizeGeometry(sourceGeometry) {
        if (!sourceGeometry) {
            return null;
        }
        if (sourceGeometry.type === "LineString") {
            return {
                type: "MultiLineString",
                coordinates: [sourceGeometry.coordinates],
            };
        }
        if (sourceGeometry.type === "MultiLineString" ||
            sourceGeometry.type === "Polygon" ||
            sourceGeometry.type === "MultiPolygon" ||
            sourceGeometry.type === "Point") {
            return {
                type: sourceGeometry.type,
                coordinates: sourceGeometry.coordinates,
            };
        }
        return null;
    }
}
//# sourceMappingURL=BuildingsVectorTile.js.map