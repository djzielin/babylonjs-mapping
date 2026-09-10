import { Engine } from "@babylonjs/core/Engines/engine.js";
import { BoundingBox } from "@babylonjs/core/Culling/boundingBox.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3, Vector2, Vector3 } from "@babylonjs/core/Maths/math.js";
import { Scene } from "@babylonjs/core/scene.js";

import Tile from "./Tile.js";
import GlobeTileMath from "./GlobeTileMath.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import TileSet from "./TileSet.js";

const DEGREES_TO_RADIANS = Math.PI / 180;
const DEFAULT_GLOBE_RADIUS = 100;
const MAX_MERCATOR_LATITUDE = 85.05112878;
const POLAR_CAP_SCALE = 1.0001;
// Tile patches are triangulated chords between points on the sphere. Keep the
// backing surface far enough inside the chords that it cannot occlude them at
// the default mesh precision.
const BACKING_SURFACE_SCALE = 0.98;

export interface GlobeSetOptions {
    /** Radius of the globe in Babylon world units. */
    radius?: number;
    /** Blend the outer tile band into a coarser globe layer; default zero. */
    edgeFadeTiles?: number;
    /** Optional CPU budget per frame for new patches; default builds synchronously. */
    geometryBudgetMs?: number;
    /** Creates a recessed fill sphere behind raster tiles. Defaults to true. */
    backingSurface?: boolean;
    /** Shows this layer's raster attribution. Defaults to true. */
    attribution?: boolean;
}

export interface GlobeCoordinates {
    latitude: number;
    longitude: number;
    elevation: number;
}

/**
 * A spherical TileSet for globe-centric map displays.
 *
 * GlobeSet keeps TileSet's raster-provider and tile-lifecycle API, but turns
 * each Web-Mercator raster tile into a curved patch on a sphere. The
 * `tileWidth` argument passed to createGeometry is retained for TileSet
 * compatibility; the visible globe size is controlled by `radius`.
 *
 * Raster, DEM, and GeoJSON providers share the normal TileSet lifecycle.
 * Elevations are radial; feature footprints are projected after extrusion so
 * courtyards, roofs, roads, and points retain their existing geometry.
 */
export default class GlobeSet extends TileSet {
    public override readonly isGlobe = true;
    private flatMath: GlobeTileMath;
    private edgeFadeTiles = 0;
    private edgeFadeKeys = new WeakMap<Tile, string>();
    private geometryKeys = new WeakMap<Tile, string>();
    private elevationTileMap = new Map<string, Tile>();
    private tileDirections = new WeakMap<Tile, number[]>();
    private originalElevations = new WeakMap<Tile, { key: string; heights: number[] }>();
    private geometryBudgetMs = Infinity;
    private geometryQueue: Tile[] = [];
    public get pendingGeometryCount(): number {
        return this.geometryQueue.length;
    }
    public override isTileGeometryReady(tile: Tile): boolean {
        return (
            this.geometryKeys.get(tile) ===
            `${tile.tileCoords}/${this.radius}/${this.meshPrecision}`
        );
    }
    private flushGeometry(): void {
        const deadline = performance.now() + this.geometryBudgetMs;
        let processed = 0;
        while (
            this.geometryQueue.length &&
            (processed === 0 || performance.now() < deadline)
        ) {
            const tile = this.geometryQueue.shift()!;
            if (tile.mesh.isDisposed()) continue;
            this.updateTileGeometry(tile);
            this.updateEdgeFade(tile);
            if (tile.material?.diffuseTexture?.isReady())
                tile.mesh.setEnabled(true);
            processed++;
        }
    }
    /** Metres of elevation per world unit use a fixed spherical Earth radius. */
    public get metresToWorld(): number {
        return this.radius / 6378137;
    }
    public override getGeometryMath(): GlobeTileMath {
        return this.flatMath;
    }
    private _radius: number;
    private backingMesh?: Mesh;
    private polarCapMeshes: Mesh[] = [];
    private attributionEnabled = true;

    public constructor(
        scene: Scene,
        engine: Engine,
        options: GlobeSetOptions = {},
    ) {
        super(scene, engine);
        this.geometryBudgetMs = options.geometryBudgetMs ?? Infinity;
        this.edgeFadeTiles = options.edgeFadeTiles ?? 0;
        if (!Number.isFinite(this.edgeFadeTiles) || this.edgeFadeTiles < 0) throw new RangeError("edgeFadeTiles must be non-negative");
        if (this.geometryBudgetMs <= 0 || Number.isNaN(this.geometryBudgetMs))
            throw new RangeError("geometryBudgetMs must be positive");
        scene.onBeforeRenderObservable.add(() => this.flushGeometry());
        this._radius = DEFAULT_GLOBE_RADIUS;
        this.flatMath = new GlobeTileMath(this, true);
        this.ourTileMath = new GlobeTileMath(this);
        this.attributionEnabled = options.attribution !== false;
        const attributionLayer = this.ourAttribution.advancedTexture.layer;
        if (attributionLayer) attributionLayer.isEnabled = this.attributionEnabled;

        if (options.radius !== undefined) {
            this.radius = options.radius;
        }

        if (options.backingSurface !== false) {
            this.createBackingMesh();
        }
    }

    /** Radius of the globe in Babylon world units. */
    public get radius(): number {
        return this._radius;
    }

    public set radius(value: number) {
        if (!Number.isFinite(value) || value <= 0) {
            throw new RangeError(
                "radius must be a finite number greater than zero.",
            );
        }

        this._radius = value;

        if (this.backingMesh !== undefined) {
            const backingScale = this.radius * BACKING_SURFACE_SCALE;
            this.backingMesh.scaling.set(
                backingScale,
                backingScale,
                backingScale,
            );
        }
        const polarCapScale = this.radius * POLAR_CAP_SCALE;
        for (const polarCap of this.polarCapMeshes) {
            polarCap.scaling.set(polarCapScale, polarCapScale, polarCapScale);
        }

        if (this.isGeometryCreated) {
            for (const tile of this.ourTiles) {
                if (tile.tileCoords !== undefined) {
                    this.updateTileGeometry(tile);
                }
            }
        }
    }

    /**
     * Convert longitude, latitude, and an optional radial offset to globe
     * coordinates. Longitude zero is on +Z and increases toward -X (east-right in Babylon's left-handed scene); latitude
     * increases toward +Y.
     */
    public getSurfacePosition(
        latitude: number,
        longitude: number,
        elevation = 0,
    ): Vector3 {
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
            throw new RangeError(
                "latitude must be a finite value between -90 and 90 degrees.",
            );
        }
        if (!Number.isFinite(longitude)) {
            throw new RangeError("longitude must be a finite number.");
        }
        if (!Number.isFinite(elevation) || this.radius + elevation <= 0) {
            throw new RangeError(
                "elevation must keep the resulting globe radius positive.",
            );
        }

        const latitudeRadians = latitude * DEGREES_TO_RADIANS;
        const longitudeRadians = longitude * DEGREES_TO_RADIANS;
        const radialDistance = this.radius + elevation;
        const horizontalDistance = radialDistance * Math.cos(latitudeRadians);

        return new Vector3(
            -horizontalDistance * Math.sin(longitudeRadians),
            radialDistance * Math.sin(latitudeRadians),
            horizontalDistance * Math.cos(longitudeRadians),
        );
    }

    /** Return the outward unit normal at a longitude/latitude location. */
    public getSurfaceNormal(latitude: number, longitude: number): Vector3 {
        return this.getSurfacePosition(latitude, longitude).normalize();
    }

    /** Convert a Babylon world position back to globe coordinates. */
    public getSurfaceCoordinates(position: Vector3): GlobeCoordinates {
        const radialDistance = position.length();
        if (!Number.isFinite(radialDistance) || radialDistance === 0) {
            throw new RangeError("position must be a finite, non-zero vector.");
        }

        return {
            latitude:
                Math.asin(position.y / radialDistance) / DEGREES_TO_RADIANS,
            longitude: Math.atan2(-position.x, position.z) / DEGREES_TO_RADIANS,
            elevation: radialDistance - this.radius,
        };
    }

    /**
     * Return a point on a raster tile's curved surface. `u` runs west to east
     * and `v` runs north to south, both in the inclusive range 0..1.
     */
    public getTileSurfacePosition(
        tileCoords: Vector3,
        u = 0.5,
        v = 0.5,
        elevation = 0,
    ): Vector3 {
        if (
            !Number.isFinite(u) ||
            u < 0 ||
            u > 1 ||
            !Number.isFinite(v) ||
            v < 0 ||
            v > 1
        ) {
            throw new RangeError(
                "tile surface coordinates u and v must be between 0 and 1.",
            );
        }

        const longitude = this.ourTileMath.tile_to_lon(
            tileCoords.x + u,
            tileCoords.z,
        );
        const latitude = this.ourTileMath.tile_to_lat(
            tileCoords.y + v,
            tileCoords.z,
        );
        return this.getSurfacePosition(latitude, longitude, elevation);
    }

    /**
     * The base class creates a temporary ground mesh before raster coordinates
     * are known. updateRaster() replaces its vertices with the corresponding
     * spherical tile patch once tile coordinates are available.
     */
    public override makeSingleTileMesh(
        _x: number,
        _y: number,
        precision: number,
    ): Mesh {
        const mesh = MeshBuilder.CreateGround(
            "globe tile",
            {
                width: this.tileWidth,
                height: this.tileWidth,
                updatable: true,
                // Detailed buffers are built under the patch-generation
                // budget once coordinates are known. LOD meshes need their
                // requested topology immediately.
                subdivisions: precision === this.meshPrecision ? 1 : precision,
            },
            this.scene,
        );
        mesh.position.set(0, 0, 0);
        if (precision === this.meshPrecision) mesh.setEnabled(false);
        return mesh;
    }

    public override updateRaster(lat: number, lon: number, zoom: number): void {
        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lon) ||
            !Number.isInteger(zoom) ||
            zoom < 0 ||
            zoom > 22
        )
            throw new RangeError("Invalid globe view");
        lat = Math.max(
            -MAX_MERCATOR_LATITUDE,
            Math.min(MAX_MERCATOR_LATITUDE, lat),
        );
        lon = ((((lon + 180) % 360) + 360) % 360) - 180;
        super.updateRaster(lat, lon, zoom);

        this.elevationTileMap.clear();
        this.geometryQueue = [];
        const count = 2 ** this.zoom;
        for (const tile of this.ourTiles) {
            if (!this.isTileGeometryReady(tile)) this.geometryQueue.push(tile);
            this.elevationTileMap.set(
                `${((tile.tileCoords.x % count) + count) % count}/${tile.tileCoords.y}`,
                tile,
            );
        }
        this.flushGeometry();
        if (this.edgeFadeTiles) for (const tile of this.ourTiles) if (this.isTileGeometryReady(tile)) this.updateEdgeFade(tile);
    }

    protected override reuseRasterTilesOnUpdate(): boolean {
        return true;
    }

    protected override showRasterAttribution(): boolean {
        return this.attributionEnabled;
    }

    /** Signed elevation grids (including bathymetry) are supplied in metres. */
    public setElevationData(
        tile: Tile,
        data: ArrayLike<number>,
        width: number,
        height: number,
        exaggeration = 1,
    ): void {
        if (
            !this.ourTiles.includes(tile) ||
            !Number.isInteger(width) ||
            !Number.isInteger(height) ||
            width < 2 ||
            height < 2 ||
            data.length !== width * height ||
            !Number.isFinite(exaggeration) ||
            exaggeration < 0
        )
            throw new RangeError("Invalid elevation grid");
        const dem = Array.from(data);
        if (
            dem.some(
                (v) =>
                    !Number.isFinite(v) ||
                    this.radius + v * this.metresToWorld * exaggeration <= 0,
            )
        )
            throw new RangeError("Invalid elevation sample");
        tile.dem = dem;
        tile.demDimensions = new Vector2(width, height);
        const heights: number[] = [];
        const p = this.meshPrecision;
        for (let y = 0; y <= p; y++)
            for (let x = 0; x <= p; x++) {
                const sx = (x / p) * (width - 1),
                    sy = (y / p) * (height - 1);
                const x0 = Math.floor(sx),
                    y0 = Math.floor(sy),
                    x1 = Math.min(x0 + 1, width - 1),
                    y1 = Math.min(y0 + 1, height - 1);
                const tx = sx - x0,
                    ty = sy - y0;
                const a =
                    dem[y0 * width + x0] * (1 - tx) + dem[y0 * width + x1] * tx;
                const b =
                    dem[y1 * width + x0] * (1 - tx) + dem[y1 * width + x1] * tx;
                heights.push(
                    (a * (1 - ty) + b * ty) * this.metresToWorld * exaggeration,
                );
            }
        tile.minHeight = dem.reduce((a, b) => Math.min(a, b), Infinity);
        tile.maxHeight = dem.reduce((a, b) => Math.max(a, b), -Infinity);
        this.originalElevations.set(tile, { key: tile.tileCoords.toString(), heights: heights.slice() });
        tile.elevationHeights = heights;
        tile.terrainLoaded = true;
        this.joinElevationBorders(tile);
    }

    /** Weld shared samples before uploading; no vertical walls are needed between patches. */
    private joinElevationBorders(changed: Tile): void {
        const p = this.meshPrecision, n = p + 1, world = 2 ** this.zoom * p;
        const groups = new Map<string, { tile: Tile; index: number; height: number }[]>();
        const dirty = new Set<Tile>([changed]);
        for (const tile of this.ourTiles) {
            const original = this.originalElevations.get(tile);
            if (!tile.terrainLoaded || !original || original.key !== tile.tileCoords.toString() || original.heights.length !== n * n) continue;
            for (let y = 0; y <= p; y++) for (let x = 0; x <= p; x++) {
                if (x !== 0 && x !== p && y !== 0 && y !== p) continue;
                const key = `${((tile.tileCoords.x * p + x) % world + world) % world}/${tile.tileCoords.y * p + y}`;
                const group = groups.get(key) ?? [];
                group.push({ tile, index: y * n + x, height: original.heights[y * n + x] });
                groups.set(key, group);
            }
        }
        for (const group of groups.values()) {
            if (group.length < 2) continue;
            const height = group.reduce((sum, item) => sum + item.height, 0) / group.length;
            for (const item of group) {
                if (item.tile.elevationHeights![item.index] === height) continue;
                item.tile.elevationHeights![item.index] = height;
                dirty.add(item.tile);
            }
        }
        for (const tile of dirty) this.applyElevationGrid(tile, tile.elevationHeights!, p);
    }

    public override applyElevationGrid(
        tile: Tile,
        heights: number[],
        precision: number,
    ): void {
        tile.clearTerrainLOD();
        tile.elevationHeights = heights;
        this.applyGlobeHeights(tile.mesh, tile, precision, heights);
    }

    public applyGlobeHeights(
        mesh: Mesh,
        tile: Tile,
        precision: number,
        heights: number[],
    ): void {
        const positions: number[] = [];
        const directions =
            precision === this.meshPrecision
                ? this.tileDirections.get(tile)
                : undefined;
        for (let y = 0; y <= precision; y++)
            for (let x = 0; x <= precision; x++) {
                const i = y * (precision + 1) + x;
                if (directions) {
                    const radius = this.radius + heights[i];
                    positions.push(
                        directions[i * 3] * radius,
                        directions[i * 3 + 1] * radius,
                        directions[i * 3 + 2] * radius,
                    );
                } else {
                    const point = this.getTileSurfacePosition(
                        tile.tileCoords,
                        x / precision,
                        y / precision,
                        heights[i],
                    );
                    positions.push(point.x, point.y, point.z);
                }
            }
        if (mesh === tile.mesh) {
            const n = precision + 1;
            const indices: number[] = [],
                uvs: number[] = [];
            for (let y = 0; y <= precision; y++)
                for (let x = 0; x <= precision; x++)
                    uvs.push(x / precision, 1 - y / precision);
            for (let y = 0; y < precision; y++)
                for (let x = 0; x < precision; x++) {
                    const a = y * n + x;
                    indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
                }
            mesh.setIndices(indices);
            mesh.setVerticesData(VertexBuffer.UVKind, uvs, true);
        }
        const origin = tile.mesh.position;
        if (mesh !== tile.mesh) mesh.position.setAll(0);
        for (let i = 0; i < positions.length; i += 3) {
            positions[i] -= origin.x;
            positions[i + 1] -= origin.y;
            positions[i + 2] -= origin.z;
        }
        mesh.setVerticesData(VertexBuffer.PositionKind, positions, true);
        const normals: number[] = [];
        VertexData.ComputeNormals(positions, mesh.getIndices()!, normals);
        mesh.setVerticesData(VertexBuffer.NormalKind, normals, true);
        mesh.refreshBoundingInfo();
    }

    /** Warp already-extruded feature vertices and their LOD meshes once, at load time. */
    public override projectFeatureMesh(mesh: Mesh): void {
        const wasFrozen = mesh.isWorldMatrixFrozen;
        mesh.unfreezeWorldMatrix();
        const world = mesh.computeWorldMatrix(true).clone();
        const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
        if (!positions) return;
        const projected: number[] = [];
        for (let i = 0; i < positions.length; i += 3) {
            const flat = Vector3.TransformCoordinates(
                new Vector3(positions[i], positions[i + 1], positions[i + 2]),
                world,
            );
            const ll = this.flatMath.Game_to_LonLat(flat);
            const point = this.getSurfacePosition(
                ll.y,
                ll.x,
                (flat.y / this.tileScale) * this.metresToWorld +
                    this.sampleElevation(ll.y, ll.x),
            );
            projected.push(point.x, point.y, point.z);
        }
        mesh.setParent(null);
        const origin = new Vector3(projected[0], projected[1], projected[2]);
        for (let i = 0; i < projected.length; i += 3) {
            projected[i] -= origin.x;
            projected[i + 1] -= origin.y;
            projected[i + 2] -= origin.z;
        }
        mesh.position.copyFrom(origin);
        mesh.rotation.setAll(0);
        mesh.rotationQuaternion = null;
        mesh.scaling.setAll(1);
        // The east/north/up basis preserves the source mesh winding.

        mesh.setVerticesData(VertexBuffer.PositionKind, projected, true);
        const normals: number[] = [];
        VertexData.ComputeNormals(projected, mesh.getIndices()!, normals);
        mesh.setVerticesData(VertexBuffer.NormalKind, normals, true);
        mesh.computeWorldMatrix(true);
        mesh.refreshBoundingInfo();
        // A radial detailed mesh must not switch to a planar billboard.
        for (const lod of [...mesh.getLODLevels()]) {
            mesh.removeLODLevel(lod.mesh);
            lod.mesh?.dispose();
        }
        if (wasFrozen) mesh.freezeWorldMatrix();
    }

    /** Bilinear loaded-surface elevation in world units; zero where data is absent. */
    public sampleElevation(latitude: number, longitude: number): number {
        const x = this.ourTileMath.lon_to_tileExact(longitude, this.zoom);
        const y = this.ourTileMath.lat_to_tileExact(latitude, this.zoom);
        const n = 2 ** this.zoom;
        const tile = this.elevationTileMap.get(
            `${((Math.floor(x) % n) + n) % n}/${Math.floor(y)}`,
        );
        if (!tile?.elevationHeights) return 0;
        const p = this.meshPrecision,
            sx = (x - Math.floor(x)) * p,
            sy = (y - Math.floor(y)) * p;
        const x0 = Math.floor(sx),
            y0 = Math.floor(sy),
            x1 = Math.min(x0 + 1, p),
            y1 = Math.min(y0 + 1, p),
            tx = sx - x0,
            ty = sy - y0,
            h = tile.elevationHeights;
        return (
            (h[y0 * (p + 1) + x0] * (1 - tx) + h[y0 * (p + 1) + x1] * tx) *
                (1 - ty) +
            (h[y1 * (p + 1) + x0] * (1 - tx) + h[y1 * (p + 1) + x1] * tx) * ty
        );
    }

    private createBackingMesh(): void {
        this.backingMesh = MeshBuilder.CreateSphere(
            "globe backing",
            { diameter: 2, segments: 32 },
            this.scene,
        );
        this.backingMesh.isPickable = false;

        const material = new StandardMaterial(
            "globe backing material",
            this.scene,
        );
        material.diffuseColor = new Color3(0.17, 0.42, 0.52);
        material.emissiveColor = new Color3(0.02, 0.05, 0.07);
        material.specularColor = Color3.Black();
        material.disableLighting = true;
        material.backFaceCulling = false;
        this.backingMesh.material = material;

        const backingScale = this.radius * BACKING_SURFACE_SCALE;
        this.backingMesh.scaling.set(backingScale, backingScale, backingScale);

        this.polarCapMeshes = [
            this.createPolarCap("globe north polar cap", true, material),
            this.createPolarCap("globe south polar cap", false, material),
        ];
    }

    private createPolarCap(
        name: string,
        north: boolean,
        material: StandardMaterial,
    ): Mesh {
        const segments = 64;
        const rings = 4;
        const columns = segments + 1;
        const positions: number[] = [];
        const normals: number[] = [];
        const indices: number[] = [];

        for (let row = 0; row <= rings; row++) {
            const progress = row / rings;
            const latitude = north
                ? 90 - (90 - MAX_MERCATOR_LATITUDE) * progress
                : -MAX_MERCATOR_LATITUDE -
                  (90 - MAX_MERCATOR_LATITUDE) * progress;
            const latitudeRadians = latitude * DEGREES_TO_RADIANS;
            const horizontalDistance = Math.cos(latitudeRadians);

            for (let column = 0; column <= segments; column++) {
                const longitude = (column / segments) * 2 * Math.PI;
                const x = -horizontalDistance * Math.sin(longitude);
                const y = Math.sin(latitudeRadians);
                const z = horizontalDistance * Math.cos(longitude);
                positions.push(x, y, z);
                normals.push(x, y, z);
            }
        }

        for (let row = 0; row < rings; row++) {
            for (let column = 0; column < segments; column++) {
                const topLeft = row * columns + column;
                const topRight = topLeft + 1;
                const bottomLeft = topLeft + columns;
                const bottomRight = bottomLeft + 1;
                indices.push(
                    topLeft,
                    bottomLeft,
                    topRight,
                    topRight,
                    bottomLeft,
                    bottomRight,
                );
            }
        }

        const mesh = new Mesh(name, this.scene);
        const vertexData = new VertexData();
        vertexData.positions = positions;
        vertexData.normals = normals;
        vertexData.indices = indices;
        vertexData.applyToMesh(mesh, false);

        const scale = this.radius * POLAR_CAP_SCALE;
        mesh.scaling.set(scale, scale, scale);
        mesh.material = material;
        mesh.isPickable = false;
        return mesh;
    }

    private updateEdgeFade(tile: Tile): void {
        if (!this.edgeFadeTiles) return;
        const count = 2 ** this.zoom;
        const centerX = this.ourTileMath.lon_to_tile(this.centerCoords.x, this.zoom);
        const offsetX = (x: number) => ((x - centerX + count / 2) % count + count) % count - count / 2;
        const xs = this.ourTiles.map(t => offsetX(t.tileCoords.x));
        const ys = this.ourTiles.map(t => t.tileCoords.y);
        const left = Math.min(...xs), right = Math.max(...xs) + 1;
        const top = Math.min(...ys), bottom = Math.max(...ys) + 1;
        const tx = offsetX(tile.tileCoords.x), ty = tile.tileCoords.y;
        const key = `${left}/${right}/${top}/${bottom}/${tx}/${ty}/${this.meshPrecision}`;
        if (this.edgeFadeKeys.get(tile) === key) return;
        this.edgeFadeKeys.set(tile, key);
        const colors: number[] = [];
        for (let y = 0; y <= this.meshPrecision; y++) for (let x = 0; x <= this.meshPrecision; x++) {
            const u = tx + x / this.meshPrecision, v = ty + y / this.meshPrecision;
            const d = Math.min(u - left, right - u, v - top, bottom - v);
            const a = Math.max(0, Math.min(1, d / this.edgeFadeTiles));
            colors.push(1, 1, 1, a * a * (3 - 2 * a));
        }
        tile.mesh.setVerticesData(VertexBuffer.ColorKind, colors, true);
        tile.mesh.hasVertexAlpha = true;
        if (tile.material) tile.material.forceDepthWrite = true;
    }

    private updateTileGeometry(tile: Tile): void {
        const key = `${tile.tileCoords}/${this.radius}/${this.meshPrecision}`;
        if (this.geometryKeys.get(tile) === key) return;
        this.geometryKeys.set(tile, key);
        this.edgeFadeKeys.delete(tile);
        const wasFrozen = tile.mesh.isWorldMatrixFrozen;
        tile.mesh.unfreezeWorldMatrix();
        const precision = this.meshPrecision;
        const columns = precision + 1;
        const positions: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];

        const longitudeSin: number[] = [],
            longitudeCos: number[] = [],
            directions: number[] = [];
        for (let column = 0; column <= precision; column++) {
            const longitude =
                this.ourTileMath.tile_to_lon(
                    tile.tileCoords.x + column / precision,
                    tile.tileCoords.z,
                ) * DEGREES_TO_RADIANS;
            longitudeSin.push(Math.sin(longitude));
            longitudeCos.push(Math.cos(longitude));
        }
        for (let row = 0; row <= precision; row++) {
            const v = row / precision;
            const latitude =
                this.ourTileMath.tile_to_lat(
                    tile.tileCoords.y + v,
                    tile.tileCoords.z,
                ) * DEGREES_TO_RADIANS;
            const sin = Math.sin(latitude),
                cos = Math.cos(latitude);
            for (let column = 0; column <= precision; column++) {
                const x = -cos * longitudeSin[column],
                    z = cos * longitudeCos[column];
                directions.push(x, sin, z);
                positions.push(
                    x * this.radius,
                    sin * this.radius,
                    z * this.radius,
                );
                uvs.push(column / precision, 1 - v);
            }
        }
        this.tileDirections.set(tile, directions);

        for (let row = 0; row < precision; row++) {
            for (let column = 0; column < precision; column++) {
                const topLeft = row * columns + column;
                const topRight = topLeft + 1;
                const bottomLeft = topLeft + columns;
                const bottomRight = bottomLeft + 1;

                // The order makes the front face point away from the globe.
                indices.push(
                    topLeft,
                    bottomLeft,
                    topRight,
                    topRight,
                    bottomLeft,
                    bottomRight,
                );
            }
        }

        const normals = directions.slice();

        // Keep fine geometry near a local origin to retain centimetre detail
        // when vertex buffers are converted to Float32 on the GPU.
        const origin =
            tile.tileCoords.z >= 10
                ? this.getTileSurfacePosition(tile.tileCoords)
                : Vector3.Zero();
        for (let i = 0; i < positions.length; i += 3) {
            positions[i] -= origin.x;
            positions[i + 1] -= origin.y;
            positions[i + 2] -= origin.z;
        }
        const vertexData = new VertexData();
        vertexData.positions = positions;
        vertexData.normals = normals;
        vertexData.uvs = uvs;
        vertexData.indices = indices;
        vertexData.applyToMesh(tile.mesh, true);

        tile.mesh.position.copyFrom(origin);
        tile.mesh.rotation.set(0, 0, 0);
        tile.mesh.scaling.set(1, 1, 1);
        tile.mesh.computeWorldMatrix(true);
        if (wasFrozen) tile.mesh.freezeWorldMatrix();

        const bounds = tile.mesh.getBoundingInfo().boundingBox;
        tile.box2D = new BoundingBox(
            new Vector3(
                bounds.minimumWorld.x,
                -this.radius,
                bounds.minimumWorld.z,
            ),
            new Vector3(
                bounds.maximumWorld.x,
                this.radius,
                bounds.maximumWorld.z,
            ),
        );
    }
}
