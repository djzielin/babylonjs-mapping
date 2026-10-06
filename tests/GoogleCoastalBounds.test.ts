import { describe, expect, it, vi } from "vitest";
import { Matrix, Mesh, NullEngine, Scene, VertexData } from "@babylonjs/core";
import { safeToSkipGoogleCoastalRepair } from "../src/google/GoogleCoastalBounds";
import { removeCoastalSkirtTriangles } from "../src/google/Google3DTiles";

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const points = (...heights: number[]) => heights.flatMap(height => [0, height, 0]);
function storedHeights(positions: ArrayLike<number>, matrix: ArrayLike<number>, scale: number, radius?: number) {
    const heights: number[] = [];
    for (let index = 0; index < positions.length; index += 3) {
        const x = positions[index] * matrix[0] + positions[index + 1] * matrix[4] + positions[index + 2] * matrix[8] + matrix[12];
        const y = positions[index] * matrix[1] + positions[index + 1] * matrix[5] + positions[index + 2] * matrix[9] + matrix[13];
        const z = positions[index] * matrix[2] + positions[index + 1] * matrix[6] + positions[index + 2] * matrix[10] + matrix[14];
        heights.push(Math.fround((radius === undefined ? y : Math.hypot(x, y, z) - radius) / scale));
    }
    return heights;
}
function random(seed = 0x42571) {
    return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
}
function transform(next: () => number, translation: number[]) {
    let x = next() - 0.5, y = next() - 0.5, z = next() - 0.5, w = next() - 0.5;
    const length = Math.hypot(x, y, z, w); x /= length; y /= length; z /= length; w /= length;
    const scales = Array.from({ length: 3 }, () => (0.01 + next() * 3) * (next() < 0.5 ? -1 : 1));
    return [(1 - 2 * (y * y + z * z)) * scales[0], 2 * (x * y + w * z) * scales[0], 2 * (x * z - w * y) * scales[0], 0,
        2 * (x * y - w * z) * scales[1], (1 - 2 * (x * x + z * z)) * scales[1], 2 * (y * z + w * x) * scales[1], 0,
        2 * (x * z + w * y) * scales[2], 2 * (y * z - w * x) * scales[2], (1 - 2 * (x * x + y * y)) * scales[2], 0,
        ...translation, 1];
}

describe("conservative coastal bounds", () => {
    it.each([undefined, 60])("preserves the exact 5/-15/25 metre proof boundaries with radius %s", radius => {
        const matrix = identity(); if (radius !== undefined) matrix[13] = radius;
        const skip = (...values: number[]) => safeToSkipGoogleCoastalRepair(points(...values), matrix, 1, radius);
        expect(skip(5, 50, 100)).toBe(true);
        expect(skip(5 - 0.00001, 50, 100)).toBe(false);
        expect(skip(-100, -50, -15)).toBe(false);
        expect(skip(-100, -50, -15 - 0.00001)).toBe(true);
        expect(skip(-20, -10, 5)).toBe(true);
        expect(skip(-20, -10, 5 + 0.00001)).toBe(false);
    });

    it("uses stored Float32 heights rather than stricter unrounded source values", () => {
        expect(safeToSkipGoogleCoastalRepair(points(5 - 1e-8, 50, 100), identity(), 1)).toBe(true);
        expect(safeToSkipGoogleCoastalRepair(points(-100, -50, -15 - 1e-8), identity(), 1)).toBe(false);
        expect(safeToSkipGoogleCoastalRepair(points(-20, -10, 5 + 1e-8), identity(), 1)).toBe(true);
    });

    it("cannot skip genuine coastal skirts or wide bounds that enclose the origin", () => {
        const engine = new NullEngine(), scene = new Scene(engine), mesh = new Mesh("coastal", scene);
        try {
            const data = new VertexData(); data.positions = [0, -50, 0, 1, 0, 0, 0, 0, 1]; data.indices = [0, 1, 2]; data.applyToMesh(mesh);
            mesh.position.y = 60;
            const matrix = mesh.computeWorldMatrix(true).m;
            expect(safeToSkipGoogleCoastalRepair(data.positions, matrix, 1, 60)).toBe(false);
            expect(removeCoastalSkirtTriangles(mesh, 1, 60)).toBe(1);
            expect(mesh.getIndices()).toEqual([]);
            expect(safeToSkipGoogleCoastalRepair([-100, 0, 0, 100, 0, 0, 0, 100, 0], identity(), 1, 60)).toBe(false);
        } finally { scene.dispose(); engine.dispose(); }
    });

    it("falls through for non-finite, projective, degenerate and sheared input", () => {
        for (const field of [0, 3, 5, 7, 11, 15]) {
            const matrix = identity(); matrix[field] = field === 15 ? 2 : field % 4 === 3 ? 0.01 : NaN;
            expect(safeToSkipGoogleCoastalRepair(points(100, 200, 300), matrix, 1, 60)).toBe(false);
        }
        const shear = identity(); shear[4] = 0.01;
        expect(safeToSkipGoogleCoastalRepair(points(100, 200, 300), shear, 1)).toBe(false);
        const degenerate = identity(); degenerate[0] = 0;
        expect(safeToSkipGoogleCoastalRepair(points(100, 200, 300), degenerate, 1, 60)).toBe(false);
        expect(safeToSkipGoogleCoastalRepair(points(100, Infinity, 300), identity(), 1)).toBe(false);
        expect(safeToSkipGoogleCoastalRepair(points(100, 200, 300), identity(), 0)).toBe(false);
        expect(safeToSkipGoogleCoastalRepair(points(100, 200, 300), identity(), 1, NaN)).toBe(false);
        expect(safeToSkipGoogleCoastalRepair(points(100, 200, 300), identity(), 1e-300)).toBe(false);
        expect(safeToSkipGoogleCoastalRepair({ length: Infinity }, identity(), 1)).toBe(false);
    });

    it("keeps every proven randomized transformed bound inside the existing Float32 no-skirt rules", () => {
        const next = random(); let proven = 0;
        for (let sample = 0; sample < 1600; sample++) {
            const radius = sample % 2 ? undefined : sample % 4 ? 6378137 : 60;
            const scale = sample % 3 ? 1 : 60 / 6378137;
            const direction = [next() - 0.5, next() - 0.5, next() - 0.5], length = Math.hypot(...direction);
            const altitude = (next() - 0.2) * 400 * scale;
            const translation = radius === undefined ? [next() * 100, altitude, next() * 100]
                : direction.map(value => value / length * (radius + altitude));
            const matrix = transform(next, translation);
            const spread = (sample % 5 ? 3 : 80) * scale;
            const positions = Float32Array.from({ length: 45 }, () => (next() - 0.5) * spread);
            if (!safeToSkipGoogleCoastalRepair(positions, matrix, scale, radius)) continue;
            proven++;
            const heights = storedHeights(positions, matrix, scale, radius), min = Math.min(...heights), max = Math.max(...heights);
            expect(min >= 5 || max < -15 || max - min <= 25).toBe(true);
            const ordered = [...heights].sort((a, b) => a - b);
            const lowSurface = ordered[Math.floor(ordered.length * 0.2)];
            expect(lowSurface < -15 || lowSurface > 30 || heights.every(height => height >= lowSurface - 25)).toBe(true);
        }
        expect(proven).toBeGreaterThan(800);
    });

    it("leaves old triangle indices and submesh ranges untouched for randomized proven skips", () => {
        const engine = new NullEngine(), scene = new Scene(engine), next = random(13); let checked = 0;
        try {
            for (let sample = 0; sample < 100; sample++) {
                const radius = sample % 2 ? undefined : 60;
                const matrix = transform(next, [0, (radius ?? 0) + 100, 0]);
                const positions = Array.from({ length: 45 }, () => (next() - 0.5) * 3);
                if (!safeToSkipGoogleCoastalRepair(positions, matrix, 1, radius)) continue;
                const mesh = new Mesh("parity", scene), data = new VertexData();
                data.positions = positions; data.indices = Array.from({ length: 15 }, (_, index) => index); data.applyToMesh(mesh);
                vi.spyOn(mesh, "computeWorldMatrix").mockReturnValue({ m: matrix } as unknown as Matrix);
                const before = [...mesh.getIndices()!], ranges = mesh.subMeshes.map(part => [part.indexStart, part.indexCount]);
                expect(removeCoastalSkirtTriangles(mesh, 1, radius)).toBe(0);
                expect([...mesh.getIndices()!]).toEqual(before);
                expect(mesh.subMeshes.map(part => [part.indexStart, part.indexCount])).toEqual(ranges);
                mesh.dispose(); checked++;
            }
            expect(checked).toBe(100);
        } finally { scene.dispose(); engine.dispose(); vi.restoreAllMocks(); }
    });
});
