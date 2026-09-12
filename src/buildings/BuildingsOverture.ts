import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type GlobeSet from "../core/GlobeSet.js";
import { GlobeBuildingBatch } from "./GlobeBuildingBatch.js";
import { resolveRoofSpec } from "./RoofBuilder.js";
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
    /** Direct globe batches when doMerge is enabled and no per-mesh filter is installed. */
    public batchGeometry = false;
    /** Hide covered footprints by updating indices while preserving prepared vertices. */
    public batchVisibilityFilter?: (latitude: number, longitude: number) => boolean;
    private batches = new WeakMap<Mesh, { batch: { ranges: GlobeBuildingBatch["ranges"]; indices: Uint32Array }; mask: string }>();
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
                while (cache.size > 16) cache.delete(cache.keys().next().value!);
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
            if (this.batchGeometry && this.doMerge && this.tileSet.isGlobe && !this.buildingMeshFilter && !this.buildingLOD.enabled)
                await this.buildBatch(request, collection.features);
            else this.ProcessGeoJSON(request, collection);
            this.removePendingRequest(requestIndex, request);
        } catch (error) {
            console.error(this.prettyName() + "unable to load PMTiles building data:", error);
            this.removePendingRequest(requestIndex, request);
        }
    }

    private async buildBatch(request: BuildingRequest, features: feature[]): Promise<void> {
        const globe = this.tileSet as GlobeSet;
        const batch = new GlobeBuildingBatch(globe, request.tile.mesh.getAbsolutePosition().clone());
        const specialized: feature[] = [];
        let yielded = performance.now();
        for (const feature of features) {
            if (request.cancelled || !request.tile.tileCoords.equals(request.tileCoords)) return;
            if (this.buildingFeatureFilter && !this.buildingFeatureFilter(feature, request.tile, request.epsgType)) continue;
            if (resolveRoofSpec(feature.properties ?? {}, Number(feature.properties?.height) || this.defaultBuildingHeight)) specialized.push(feature);
            else batch.append(feature, this.defaultBuildingHeight, this.exaggeration);
            if (performance.now() - yielded > 4) {
                await new Promise<void>(resolve => setTimeout(resolve, 0));
                yielded = performance.now();
            }
        }
        if (request.cancelled || request.tile.mesh.isDisposed() || !request.tile.tileCoords.equals(request.tileCoords)) return;
        const mesh = batch.positions.length ? new Mesh("Overture building batch", globe.scene) : undefined;
        if (mesh) {
            const vertices = batch.vertexData();
            vertices.applyToMesh(mesh);
            mesh.position.copyFrom(batch.origin);
            mesh.material = this.buildingMaterial;
            mesh.metadata = { buildingCount: batch.featureCount };
            this.batches.set(mesh, { batch: { ranges: batch.ranges, indices: vertices.indices as Uint32Array }, mask: "" });
            mesh.setParent(request.tile.mesh);
            this.buildingMeshTransform?.(mesh);
            this.applyBuildingMeshOptions(mesh);
        }
        // Swap only when the complete new tile is usable.
        request.tile.deleteBuildings();
        if (mesh) { request.tile.buildingBatches.push(mesh); this.updateMeshVisibility(mesh); }
        if (specialized.length) this.ProcessGeoJSON({ ...request, mergeAfterLoad: false }, { type: "FeatureCollection", features: specialized });
    }

    public updateBatchVisibility(): void {
        for (const tile of this.tileSet.ourTiles) {
            for (const mesh of tile.buildingBatches) this.updateMeshVisibility(mesh);
            if (this.batchGeometry && this.tileSet.isGlobe) for (const building of tile.buildings) {
                const point = (this.tileSet as GlobeSet).getSurfaceCoordinates(building.mesh.getBoundingInfo().boundingBox.centerWorld);
                building.mesh.setEnabled(!this.batchVisibilityFilter || this.batchVisibilityFilter(point.latitude, point.longitude));
            }
        }
    }

    private updateMeshVisibility(mesh: Mesh): void {
        const data = this.batches.get(mesh);
        if (!data || mesh.isDisposed()) return;
        const visible = data.batch.ranges.map(range => !this.batchVisibilityFilter || this.batchVisibilityFilter(range.latitude, range.longitude));
        const mask = visible.map(value => value ? "1" : "0").join("");
        if (data.mask === mask) return;
        data.mask = mask;
        const indices: number[] = [];
        for (let i = 0; i < visible.length; i++) if (visible[i]) {
            const range = data.batch.ranges[i];
            for (let index = range.start; index < range.end; index++) indices.push(data.batch.indices[index]);
        }
        mesh.setEnabled(indices.length > 0);
        if (indices.length) mesh.setIndices(new Uint32Array(indices));
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
