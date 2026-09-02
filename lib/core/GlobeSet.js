import { BoundingBox } from "@babylonjs/core/Culling/boundingBox.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3, Vector3 } from "@babylonjs/core/Maths/math.js";
import TileSet from "./TileSet.js";
const DEGREES_TO_RADIANS = Math.PI / 180;
const DEFAULT_GLOBE_RADIUS = 100;
const MAX_MERCATOR_LATITUDE = 85.05112878;
const POLAR_CAP_SCALE = 1.0001;
// Tile patches are triangulated chords between points on the sphere. Keep the
// backing surface far enough inside the chords that it cannot occlude them at
// the default mesh precision.
const BACKING_SURFACE_SCALE = 0.98;
/**
 * A spherical TileSet for globe-centric map displays.
 *
 * GlobeSet keeps TileSet's raster-provider and tile-lifecycle API, but turns
 * each Web-Mercator raster tile into a curved patch on a sphere. The
 * `tileWidth` argument passed to createGeometry is retained for TileSet
 * compatibility; the visible globe size is controlled by `radius`.
 *
 * Raster content is supported directly. Planar building and terrain
 * providers should not be used with GlobeSet yet because those providers
 * currently generate geometry in flat map space. Use getSurfacePosition() to
 * place application-owned markers or other globe overlays.
 */
export default class GlobeSet extends TileSet {
    constructor(scene, engine, options = {}) {
        super(scene, engine);
        this.polarCapMeshes = [];
        this.attributionEnabled = true;
        this._radius = DEFAULT_GLOBE_RADIUS;
        this.attributionEnabled = options.attribution !== false;
        if (options.radius !== undefined) {
            this.radius = options.radius;
        }
        if (options.backingSurface !== false) {
            this.createBackingMesh();
        }
    }
    /** Radius of the globe in Babylon world units. */
    get radius() {
        return this._radius;
    }
    set radius(value) {
        if (!Number.isFinite(value) || value <= 0) {
            throw new RangeError("radius must be a finite number greater than zero.");
        }
        this._radius = value;
        if (this.backingMesh !== undefined) {
            const backingScale = this.radius * BACKING_SURFACE_SCALE;
            this.backingMesh.scaling.set(backingScale, backingScale, backingScale);
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
     * coordinates. Longitude zero is on +Z and increases toward +X; latitude
     * increases toward +Y.
     */
    getSurfacePosition(latitude, longitude, elevation = 0) {
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
            throw new RangeError("latitude must be a finite value between -90 and 90 degrees.");
        }
        if (!Number.isFinite(longitude)) {
            throw new RangeError("longitude must be a finite number.");
        }
        if (!Number.isFinite(elevation) || this.radius + elevation <= 0) {
            throw new RangeError("elevation must keep the resulting globe radius positive.");
        }
        const latitudeRadians = latitude * DEGREES_TO_RADIANS;
        const longitudeRadians = longitude * DEGREES_TO_RADIANS;
        const radialDistance = this.radius + elevation;
        const horizontalDistance = radialDistance * Math.cos(latitudeRadians);
        return new Vector3(horizontalDistance * Math.sin(longitudeRadians), radialDistance * Math.sin(latitudeRadians), horizontalDistance * Math.cos(longitudeRadians));
    }
    /** Return the outward unit normal at a longitude/latitude location. */
    getSurfaceNormal(latitude, longitude) {
        return this.getSurfacePosition(latitude, longitude).normalize();
    }
    /** Convert a Babylon world position back to globe coordinates. */
    getSurfaceCoordinates(position) {
        const radialDistance = position.length();
        if (!Number.isFinite(radialDistance) || radialDistance === 0) {
            throw new RangeError("position must be a finite, non-zero vector.");
        }
        return {
            latitude: Math.asin(position.y / radialDistance) / DEGREES_TO_RADIANS,
            longitude: Math.atan2(position.x, position.z) / DEGREES_TO_RADIANS,
            elevation: radialDistance - this.radius,
        };
    }
    /**
     * Return a point on a raster tile's curved surface. `u` runs west to east
     * and `v` runs north to south, both in the inclusive range 0..1.
     */
    getTileSurfacePosition(tileCoords, u = 0.5, v = 0.5, elevation = 0) {
        if (!Number.isFinite(u) || u < 0 || u > 1 || !Number.isFinite(v) || v < 0 || v > 1) {
            throw new RangeError("tile surface coordinates u and v must be between 0 and 1.");
        }
        const longitude = this.ourTileMath.tile_to_lon(tileCoords.x + u, tileCoords.z);
        const latitude = this.ourTileMath.tile_to_lat(tileCoords.y + v, tileCoords.z);
        return this.getSurfacePosition(latitude, longitude, elevation);
    }
    /**
     * The base class creates a temporary ground mesh before raster coordinates
     * are known. updateRaster() replaces its vertices with the corresponding
     * spherical tile patch once tile coordinates are available.
     */
    makeSingleTileMesh(_x, _y, precision) {
        const mesh = MeshBuilder.CreateGround("globe tile", {
            width: this.tileWidth,
            height: this.tileWidth,
            updatable: true,
            subdivisions: precision,
        }, this.scene);
        mesh.position.set(0, 0, 0);
        return mesh;
    }
    updateRaster(lat, lon, zoom) {
        super.updateRaster(lat, lon, zoom);
        for (const tile of this.ourTiles) {
            this.updateTileGeometry(tile);
        }
    }
    reuseRasterTilesOnUpdate() {
        return true;
    }
    showRasterAttribution() {
        return this.attributionEnabled;
    }
    createBackingMesh() {
        this.backingMesh = MeshBuilder.CreateSphere("globe backing", { diameter: 2, segments: 32 }, this.scene);
        this.backingMesh.isPickable = false;
        const material = new StandardMaterial("globe backing material", this.scene);
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
    createPolarCap(name, north, material) {
        const segments = 64;
        const rings = 4;
        const columns = segments + 1;
        const positions = [];
        const normals = [];
        const indices = [];
        for (let row = 0; row <= rings; row++) {
            const progress = row / rings;
            const latitude = north
                ? 90 - (90 - MAX_MERCATOR_LATITUDE) * progress
                : -MAX_MERCATOR_LATITUDE - (90 - MAX_MERCATOR_LATITUDE) * progress;
            const latitudeRadians = latitude * DEGREES_TO_RADIANS;
            const horizontalDistance = Math.cos(latitudeRadians);
            for (let column = 0; column <= segments; column++) {
                const longitude = column / segments * 2 * Math.PI;
                const x = horizontalDistance * Math.sin(longitude);
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
                indices.push(topLeft, topRight, bottomLeft, topRight, bottomRight, bottomLeft);
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
    updateTileGeometry(tile) {
        const precision = this.meshPrecision;
        const columns = precision + 1;
        const positions = [];
        const uvs = [];
        const indices = [];
        for (let row = 0; row <= precision; row++) {
            const v = row / precision;
            for (let column = 0; column <= precision; column++) {
                const u = column / precision;
                const position = this.getTileSurfacePosition(tile.tileCoords, u, v);
                positions.push(position.x, position.y, position.z);
                // Match Babylon's ground UV convention so raster north stays
                // at the top of the source image.
                uvs.push(u, 1 - v);
            }
        }
        for (let row = 0; row < precision; row++) {
            for (let column = 0; column < precision; column++) {
                const topLeft = row * columns + column;
                const topRight = topLeft + 1;
                const bottomLeft = topLeft + columns;
                const bottomRight = bottomLeft + 1;
                // The order makes the front face point away from the globe.
                indices.push(topLeft, topRight, bottomLeft, topRight, bottomRight, bottomLeft);
            }
        }
        const normals = [];
        VertexData.ComputeNormals(positions, indices, normals);
        const vertexData = new VertexData();
        vertexData.positions = positions;
        vertexData.normals = normals;
        vertexData.uvs = uvs;
        vertexData.indices = indices;
        vertexData.applyToMesh(tile.mesh, true);
        tile.mesh.position.set(0, 0, 0);
        tile.mesh.rotation.set(0, 0, 0);
        tile.mesh.scaling.set(1, 1, 1);
        tile.mesh.computeWorldMatrix(true);
        const bounds = tile.mesh.getBoundingInfo().boundingBox;
        tile.box2D = new BoundingBox(new Vector3(bounds.minimumWorld.x, -this.radius, bounds.minimumWorld.z), new Vector3(bounds.maximumWorld.x, this.radius, bounds.maximumWorld.z));
    }
}
//# sourceMappingURL=GlobeSet.js.map