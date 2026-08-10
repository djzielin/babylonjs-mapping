import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import Earcut from "earcut";
const METERS_PER_LEVEL = 3;
const EPSILON = 1e-7;
function finiteNumber(value) {
    const numberValue = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
}
/**
 * Resolve the subset of roof tags that can be generated from a footprint
 * alone. OSM Buildings uses camelCase/raw OSM keys, while Overture uses
 * snake_case schema fields.
 */
export function resolveRoofSpec(properties, totalHeight) {
    const rawShape = properties.roofShape ??
        properties["roof:shape"] ??
        properties.roof_shape;
    if (typeof rawShape !== "string") {
        return undefined;
    }
    const normalizedShape = rawShape.toLowerCase();
    const shape = normalizedShape === "pyramid"
        ? "pyramidal"
        : normalizedShape;
    if (!["gabled", "hipped", "pyramidal", "skillion"].includes(shape)) {
        return undefined;
    }
    const explicitHeight = finiteNumber(properties.roofHeight ??
        properties["roof:height"] ??
        properties.roof_height);
    const roofLevels = finiteNumber(properties.roofLevels ??
        properties["roof:levels"] ??
        properties.roof_levels);
    const requestedHeight = explicitHeight ?? (roofLevels === undefined ? METERS_PER_LEVEL : roofLevels * METERS_PER_LEVEL);
    const height = Math.min(Math.max(requestedHeight, 0), Math.max(totalHeight, 0));
    if (height <= 0) {
        return undefined;
    }
    const direction = finiteNumber(properties.roofDirection ??
        properties["roof:direction"] ??
        properties.roof_direction);
    return { shape, height, direction };
}
function ringWithoutClosingPoint(ring) {
    if (ring.length < 2) {
        return ring.slice();
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    return first.equalsWithEpsilon(last, EPSILON)
        ? ring.slice(0, -1)
        : ring.slice();
}
function getBounds(points) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const point of points) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
    }
    return { minX, maxX, minZ, maxZ };
}
function getCenter(points) {
    const bounds = getBounds(points);
    return new Vector3((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
}
function isConvex(points) {
    let winding = 0;
    for (let index = 0; index < points.length; index++) {
        const a = points[index];
        const b = points[(index + 1) % points.length];
        const c = points[(index + 2) % points.length];
        const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
        // The mapping scale can make otherwise ordinary footprints very
        // small in Babylon units, so compare this squared-unit value against
        // a squared tolerance.
        if (Math.abs(cross) <= EPSILON * EPSILON) {
            continue;
        }
        const currentWinding = Math.sign(cross);
        if (winding !== 0 && currentWinding !== winding) {
            return false;
        }
        winding = currentWinding;
    }
    return winding !== 0;
}
function getAxes(points, direction) {
    if (direction !== undefined) {
        const radians = direction * Math.PI / 180;
        const slope = new Vector2(Math.sin(radians), -Math.cos(radians)).normalize();
        return { slope, ridge: new Vector2(-slope.y, slope.x) };
    }
    const bounds = getBounds(points);
    const ridge = bounds.maxX - bounds.minX >= bounds.maxZ - bounds.minZ
        ? new Vector2(1, 0)
        : new Vector2(0, 1);
    return { ridge, slope: new Vector2(-ridge.y, ridge.x) };
}
function projection(point, center, axis) {
    return (point.x - center.x) * axis.x + (point.z - center.z) * axis.y;
}
function getProjectionExtent(points, center, axis) {
    return Math.max(...points.map((point) => Math.abs(projection(point, center, axis))), EPSILON);
}
function addTriangle(geometry, a, b, c, baseHeight) {
    let vertices = [a, b, c];
    const worldA = new Vector3(a.point.x, baseHeight + a.height, a.point.z);
    const worldB = new Vector3(b.point.x, baseHeight + b.height, b.point.z);
    const worldC = new Vector3(c.point.x, baseHeight + c.height, c.point.z);
    const normal = Vector3.Cross(worldB.subtract(worldA), worldC.subtract(worldA));
    // Roof planes should always face the sky regardless of source-ring
    // winding. Vertical closure faces are emitted in both directions because
    // they may belong to either an outer ring or a courtyard.
    if (normal.y < 0) {
        vertices = [a, c, b];
    }
    let offset = geometry.positions.length / 3;
    for (const vertex of vertices) {
        geometry.positions.push(vertex.point.x, baseHeight + vertex.height, vertex.point.z);
    }
    geometry.indices.push(offset, offset + 1, offset + 2);
    if (Math.abs(normal.y) <= EPSILON * EPSILON) {
        offset = geometry.positions.length / 3;
        for (const vertex of vertices.slice().reverse()) {
            geometry.positions.push(vertex.point.x, baseHeight + vertex.height, vertex.point.z);
        }
        geometry.indices.push(offset, offset + 1, offset + 2);
    }
}
function addQuad(geometry, a, b, baseHeight) {
    if (a.height <= EPSILON && b.height <= EPSILON) {
        return;
    }
    const bottomA = { point: a.point, height: 0 };
    const bottomB = { point: b.point, height: 0 };
    addTriangle(geometry, bottomA, bottomB, b, baseHeight);
    addTriangle(geometry, bottomA, b, a, baseHeight);
}
function addBoundarySkirts(geometry, rings, heightAt, baseHeight) {
    for (const sourceRing of rings) {
        const ring = ringWithoutClosingPoint(sourceRing);
        for (let index = 0; index < ring.length; index++) {
            const next = (index + 1) % ring.length;
            addQuad(geometry, { point: ring[index], height: heightAt(ring[index]) }, { point: ring[next], height: heightAt(ring[next]) }, baseHeight);
        }
    }
}
function addTriangulatedSurface(geometry, rings, heightAt, baseHeight) {
    const points = [];
    const flattened = [];
    const holes = [];
    for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
        const ring = ringWithoutClosingPoint(rings[ringIndex]);
        if (ringIndex > 0) {
            holes.push(points.length);
        }
        for (const point of ring) {
            points.push(point);
            flattened.push(point.x, point.z);
        }
    }
    const triangles = Earcut(flattened, holes, 2);
    for (let index = 0; index < triangles.length; index += 3) {
        const a = points[triangles[index]];
        const b = points[triangles[index + 1]];
        const c = points[triangles[index + 2]];
        addTriangle(geometry, { point: a, height: heightAt(a) }, { point: b, height: heightAt(b) }, { point: c, height: heightAt(c) }, baseHeight);
    }
}
function addPyramidalSurface(geometry, ring, center, roofHeight, baseHeight) {
    for (let index = 0; index < ring.length; index++) {
        const next = (index + 1) % ring.length;
        addTriangle(geometry, { point: ring[index], height: 0 }, { point: ring[next], height: 0 }, { point: center, height: roofHeight }, baseHeight);
    }
}
function pointOnRidge(center, ridge, distance) {
    return new Vector3(center.x + ridge.x * distance, 0, center.z + ridge.y * distance);
}
function addRidgeSurface(geometry, ring, center, ridge, halfRidgeLength, roofHeight, baseHeight) {
    for (let index = 0; index < ring.length; index++) {
        const next = (index + 1) % ring.length;
        const pointA = ring[index];
        const pointB = ring[next];
        const projectionA = Math.max(-halfRidgeLength, Math.min(halfRidgeLength, projection(pointA, center, ridge)));
        const projectionB = Math.max(-halfRidgeLength, Math.min(halfRidgeLength, projection(pointB, center, ridge)));
        const ridgeA = pointOnRidge(center, ridge, projectionA);
        const ridgeB = pointOnRidge(center, ridge, projectionB);
        if (Math.abs(projectionA - projectionB) <= EPSILON) {
            addTriangle(geometry, { point: pointA, height: 0 }, { point: pointB, height: 0 }, { point: ridgeA, height: roofHeight }, baseHeight);
            continue;
        }
        addTriangle(geometry, { point: pointA, height: 0 }, { point: pointB, height: 0 }, { point: ridgeB, height: roofHeight }, baseHeight);
        addTriangle(geometry, { point: pointA, height: 0 }, { point: ridgeB, height: roofHeight }, { point: ridgeA, height: roofHeight }, baseHeight);
    }
}
function addHippedSurface(geometry, ring, center, ridge, slope, roofHeight, baseHeight) {
    const ridgeExtent = getProjectionExtent(ring, center, ridge);
    const slopeExtent = getProjectionExtent(ring, center, slope);
    const halfRidgeLength = Math.max(ridgeExtent - slopeExtent, 0);
    if (halfRidgeLength <= EPSILON) {
        addPyramidalSurface(geometry, ring, center, roofHeight, baseHeight);
        return;
    }
    addRidgeSurface(geometry, ring, center, ridge, halfRidgeLength, roofHeight, baseHeight);
}
function createMesh(geometry, material, scene) {
    if (geometry.indices.length === 0) {
        return undefined;
    }
    const normals = [];
    VertexData.ComputeNormals(geometry.positions, geometry.indices, normals);
    const mesh = new Mesh("roof", scene);
    mesh.setVerticesData(VertexBuffer.PositionKind, geometry.positions);
    mesh.setVerticesData(VertexBuffer.NormalKind, normals);
    mesh.setVerticesData(VertexBuffer.UVKind, new Array((geometry.positions.length / 3) * 2).fill(0));
    mesh.setIndices(geometry.indices);
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
}
export function createRoofMesh(rings, spec, baseHeight, heightScale, material, scene) {
    if (rings.length === 0) {
        return undefined;
    }
    const outerRing = ringWithoutClosingPoint(rings[0]);
    if (outerRing.length < 3) {
        return undefined;
    }
    const scaledBaseHeight = baseHeight * heightScale;
    const scaledRoofHeight = spec.height * heightScale;
    const center = getCenter(outerRing);
    const { slope, ridge } = getAxes(outerRing, spec.direction);
    const geometry = { positions: [], indices: [] };
    if (spec.shape === "pyramidal" || spec.shape === "hipped" || spec.shape === "gabled") {
        // A single apex/ridge fan cannot correctly preserve holes. In that
        // uncommon case, or for a concave outline, retain the flat cap.
        if (rings.length > 1 || !isConvex(outerRing)) {
            return undefined;
        }
        if (spec.shape === "pyramidal") {
            addPyramidalSurface(geometry, outerRing, center, scaledRoofHeight, scaledBaseHeight);
        }
        else if (spec.shape === "hipped") {
            addHippedSurface(geometry, outerRing, center, ridge, slope, scaledRoofHeight, scaledBaseHeight);
        }
        else {
            const ridgeExtent = getProjectionExtent(outerRing, center, ridge);
            addRidgeSurface(geometry, outerRing, center, ridge, ridgeExtent, scaledRoofHeight, scaledBaseHeight);
        }
    }
    else {
        const slopeExtent = getProjectionExtent(outerRing, center, slope);
        const heightAt = (point) => {
            const relative = projection(point, center, slope) / slopeExtent;
            return ((relative + 1) / 2) * scaledRoofHeight;
        };
        addTriangulatedSurface(geometry, rings, heightAt, scaledBaseHeight);
        addBoundarySkirts(geometry, rings, heightAt, scaledBaseHeight);
    }
    return createMesh(geometry, material, scene);
}
//# sourceMappingURL=RoofBuilder.js.map