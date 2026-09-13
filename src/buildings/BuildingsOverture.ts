import { BuildingWorkBudget } from "./BuildingWorkBudget.js";
import { BuildingWorkerPool } from "./BuildingWorkerPool.js";
import type { BuildingGeometryResult } from "./GlobeBuildingWorker.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
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
    private batches = new WeakMap<Mesh, { batch: { ranges: GlobeBuildingBatch["ranges"]; indices: Uint32Array }; mask: Uint8Array }>();
    private archive: PMTiles;
    private static archives = new Map<string, PMTiles>();
    private static encoded = new WeakMap<PMTiles, Map<string, Promise<Uint8Array | undefined>>>();
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
            if (factor === 1 && this.batchGeometry && this.doMerge && this.tileSet.isGlobe && !this.buildingMeshFilter && !this.buildingLOD.enabled) {
                let rawCache = BuildingsOverture.encoded.get(this.archive);
                if (!rawCache) { rawCache = new Map(); BuildingsOverture.encoded.set(this.archive, rawCache); }
                const rawKey = `${z}/${x}/${y}`;
                let raw = rawCache.get(rawKey);
                if (!raw) {
                    raw = this.archive.getZxy(z, x, y).then(response => response ? new Uint8Array(response.data) : undefined)
                        .catch(error => { rawCache!.delete(rawKey); throw error; });
                    rawCache.set(rawKey, raw);
                    while (rawCache.size > 16) rawCache.delete(rawCache.keys().next().value!);
                }
                const bytes = await raw;
                if (request.cancelled || !request.tile.tileCoords.equals(request.tileCoords)) { this.removePendingRequest(requestIndex, request); return; }
                const vector = bytes && new VectorTile(new PbfReader(bytes));
                const features = function*(provider: BuildingsOverture): Generator<feature> {
                    if (vector) for (const layer of ["building", "building_part"]) yield* provider.layerFeatures(vector, layer, x, y, z);
                };
                await this.buildBatch(request, features(this));
                this.removePendingRequest(requestIndex, request);
                return;
            }
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
                    if (!feature.geometry) return false;
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

    private async buildBatch(request: BuildingRequest, features: Iterable<feature>): Promise<void> {
        const globe = this.tileSet as GlobeSet;
        const batch = new GlobeBuildingBatch(globe, request.tile.mesh.getAbsolutePosition().clone());
        const specialized: feature[] = [];
        const worker = BuildingWorkerPool.forScene(globe.scene);
        const regular: feature[] = [];
        const elevations = new Map<string, number>();
        const work = BuildingWorkBudget.forScene(globe.scene);
        const priority = () => Vector3.DistanceSquared(request.tile.mesh.getAbsolutePosition(), globe.scene.activeCamera?.globalPosition ?? batch.origin);
        for (const feature of features) {
            if (request.cancelled || !request.tile.tileCoords.equals(request.tileCoords)) return;
            if (this.buildingFeatureFilter && !this.buildingFeatureFilter(feature, request.tile, request.epsgType)) continue;
            if (resolveRoofSpec(feature.properties ?? {}, Number(feature.properties?.height) || this.defaultBuildingHeight)) specialized.push(feature);
            else if (!worker) batch.append(feature, this.defaultBuildingHeight, this.exaggeration);
            else {
                regular.push(feature);
                const coordinates: unknown[] = [feature.geometry?.coordinates];
                while (coordinates.length) {
                    const point = coordinates.pop();
                    if (!Array.isArray(point)) continue;
                    if (typeof point[0] === "number" && typeof point[1] === "number") {
                        const key = `${point[1]}/${point[0]}`;
                        if (!elevations.has(key)) elevations.set(key, globe.sampleElevation(point[1], point[0]));
                    } else coordinates.push(...point);
                }
            }
            const pause = work.checkpoint(priority);
            if (pause) await pause;
        }
        if (request.cancelled || request.tile.mesh.isDisposed() || !request.tile.tileCoords.equals(request.tileCoords)) return;
        let result: BuildingGeometryResult | undefined;
        const valid = () => !request.cancelled && !request.tile.mesh.isDisposed() && request.tile.tileCoords.equals(request.tileCoords);
        if (worker && regular.length) {
            try {
                result = await worker.run({ features: regular, elevations, radius: globe.radius, metresToWorld: globe.metresToWorld,
                    origin: batch.origin.asArray(), defaultHeight: this.defaultBuildingHeight, exaggeration: this.exaggeration }, valid,
                    priority);
            } catch {
                // CSP and unsupported worker environments retain the same geometry path.
                for (const feature of regular) {
                    if (!valid()) return;
                    batch.append(feature, this.defaultBuildingHeight, this.exaggeration);
                    const pause = work.checkpoint(priority);
                    if (pause) await pause;
                }
            }
        }
        const pause = work.checkpoint(priority);
        if (pause) await pause;
        if (!valid()) return;
        const vertices = result ? Object.assign(new VertexData(), { positions: result.positions, normals: result.normals, indices: result.indices }) : batch.vertexData();
        const mesh = vertices.positions!.length ? new Mesh("Overture building batch", globe.scene) : undefined;
        if (mesh) {
            vertices.applyToMesh(mesh);
            mesh.position.copyFrom(batch.origin);
            mesh.material = this.buildingMaterial;
            mesh.metadata = { buildingCount: result?.featureCount ?? batch.featureCount };
            this.batches.set(mesh, { batch: { ranges: result?.ranges ?? batch.ranges, indices: vertices.indices as Uint32Array }, mask: new Uint8Array() });
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
        const ranges = data.batch.ranges;
        const mask = new Uint8Array(ranges.length);
        let count = 0, changed = data.mask.length !== mask.length;
        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];
            mask[i] = Number(!this.batchVisibilityFilter || this.batchVisibilityFilter(range.latitude, range.longitude));
            if (mask[i]) count += range.end - range.start;
            if (mask[i] !== data.mask[i]) changed = true;
        }
        if (!changed) return;
        data.mask = mask;
        mesh.setEnabled(count > 0);
        if (!count) return;
        if (count === data.batch.indices.length) { mesh.setIndices(data.batch.indices); return; }
        const indices = new Uint32Array(count);
        let offset = 0;
        for (let i = 0; i < ranges.length; i++) if (mask[i]) {
            const range = ranges[i];
            indices.set(data.batch.indices.subarray(range.start, range.end), offset);
            offset += range.end - range.start;
        }
        mesh.setIndices(indices);
    }

    private appendLayerFeatures(
        vectorTile: VectorTile,
        layerName: string,
        x: number,
        y: number,
        z: number,
        output: feature[],
    ): void {
        for (const feature of this.layerFeatures(vectorTile, layerName, x, y, z)) output.push(feature);
    }

    private *layerFeatures(vectorTile: VectorTile, layerName: string, x: number, y: number, z: number): Generator<feature> {
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

            yield {
                id: String(source.id ?? properties.id ?? layerName + "-" + index),
                type: "Feature",
                properties,
                geometry: {
                    type: source.geometry.type,
                    coordinates: source.geometry.coordinates,
                },
            };
        }
    }
}
