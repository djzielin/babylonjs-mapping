import earcut from "earcut";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type GlobeSet from "../core/GlobeSet.js";
import type { feature } from "./GeoJSON.js";

/** Direct flat-roof extrusion; no intermediate Babylon meshes or world matrices. */
export class GlobeBuildingBatch {
    public readonly positions: number[] = [];
    public readonly normals: number[] = [];
    public readonly indices: number[] = [];
    public featureCount = 0;
    public readonly ranges: { latitude: number; longitude: number; start: number; end: number }[] = [];
    constructor(private globe: GlobeSet, public readonly origin: Vector3) {}
    private vertex(point: Vector3, normal: Vector3): number {
        const index = this.positions.length / 3;
        this.positions.push(point.x - this.origin.x, point.y - this.origin.y, point.z - this.origin.z);
        this.normals.push(normal.x, normal.y, normal.z);
        return index;
    }
    private triangle(a: number, b: number, c: number, normal: Vector3): void {
        const pa = Vector3.FromArray(this.positions, a * 3);
        const pb = Vector3.FromArray(this.positions, b * 3);
        const pc = Vector3.FromArray(this.positions, c * 3);
        // Babylon's default left-handed front faces have clockwise winding.
        if (Vector3.Dot(Vector3.Cross(pb.subtract(pa), pc.subtract(pa)), normal) > 0) this.indices.push(a, c, b);
        else this.indices.push(a, b, c);
    }
    public append(feature: feature, defaultHeight: number, exaggeration: number): void {
        const startIndex = this.indices.length;
        let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
        const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates as number[][][]]
            : feature.geometry.coordinates as number[][][][];
        const supplied = Number(feature.properties?.height);
        const height = Math.max(0, Number.isFinite(supplied) ? supplied : defaultHeight) * exaggeration * this.globe.metresToWorld;
        const minHeight = Math.max(0, Number(feature.properties?.min_height) || 0) * exaggeration * this.globe.metresToWorld;
        if (height <= minHeight) return;
        for (const polygon of polygons) {
            const rings = polygon.map((ring, index) => {
                const points = ring.filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));
                if (points.length > 1 && points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1]) points.pop();
                let area = 0;
                for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; area += a[0] * b[1] - b[0] * a[1]; }
                if ((area > 0) !== (index === 0)) points.reverse();
                return points;
            }).filter(ring => ring.length >= 3);
            if (!rings.length) continue;
            const flat: number[] = [], holes: number[] = [], tops: Vector3[] = [], bottoms: Vector3[] = [], roof: number[] = [];
            const reference = rings[0][0];
            for (const [ringIndex, ring] of rings.entries()) {
                if (ringIndex) holes.push(tops.length);
                const start = tops.length;
                for (const [lon, lat] of ring) {
                    west = Math.min(west, lon); east = Math.max(east, lon); south = Math.min(south, lat); north = Math.max(north, lat);
                    flat.push(lon - reference[0], lat - reference[1]);
                    const ground = this.globe.sampleElevation(lat, lon);
                    const up = this.globe.getSurfaceNormal(lat, lon);
                    const bottom = this.globe.getSurfacePosition(lat, lon, ground + minHeight);
                    const top = bottom.add(up.scale(height - minHeight));
                    bottoms.push(bottom); tops.push(top); roof.push(this.vertex(top, up));
                }
                for (let i = 0; i < ring.length; i++) {
                    const a = start + i, b = start + (i + 1) % ring.length;
                    const up = tops[a].normalizeToNew();
                    const normal = Vector3.Cross(up, bottoms[b].subtract(bottoms[a])).normalize();
                    const wall = [this.vertex(bottoms[a], normal), this.vertex(bottoms[b], normal), this.vertex(tops[b], normal), this.vertex(tops[a], normal)];
                    this.triangle(wall[0], wall[1], wall[2], normal); this.triangle(wall[0], wall[2], wall[3], normal);
                }
            }
            const triangles = earcut(flat, holes, 2);
            const up = tops[0].normalizeToNew();
            for (let i = 0; i < triangles.length; i += 3) this.triangle(roof[triangles[i]], roof[triangles[i + 1]], roof[triangles[i + 2]], up);
            if (minHeight > 0) {
                const underside = bottoms.map(point => this.vertex(point, up.negate()));
                for (let i = 0; i < triangles.length; i += 3) this.triangle(underside[triangles[i]], underside[triangles[i + 1]], underside[triangles[i + 2]], up.negate());
            }
        }
        if (this.indices.length > startIndex) this.ranges.push({ latitude: (south + north) / 2, longitude: (west + east) / 2, start: startIndex, end: this.indices.length });
        this.featureCount++;
    }
    public vertexData(): VertexData {
        const data = new VertexData();
        data.positions = new Float32Array(this.positions); data.normals = new Float32Array(this.normals); data.indices = new Uint32Array(this.indices);
        return data;
    }
}
