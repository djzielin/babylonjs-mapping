import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Material } from "@babylonjs/core/Materials/material";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateLines } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

const ARC_POINTS = 32;
/** The footprint drawn at the destination, in the arriving user's metres: about a standing space. */
const FOOTPRINT = 1;
/** Smallest the marker may look, as a fraction of its distance, so a far one is still seen. */
const MIN_ANGULAR = 0.025;

/**
 * Where a click will take you, as in Half-Life: Alyx: an arc from the hand
 * down to a ring on the ground, the size of your footprint once there, with
 * a chevron for the way you will face and a mark at the height your eyes
 * will be.
 */
export class DestinationMarker {
    private readonly root: TransformNode;
    private readonly pillar: Mesh;
    private readonly eye: Mesh;
    private readonly arcNode: TransformNode;
    private arc: LinesMesh;
    private readonly points = Array.from({ length: ARC_POINTS }, () => new Vector3());
    private shown = false;

    public constructor(private readonly scene: Scene, group: number, material: (name: string, color: Color3, alpha: number) => Material) {
        const glow = new Color3(0.72, 0.9, 1);
        this.root = new TransformNode("xr destination", scene);
        this.root.rotationQuaternion = new Quaternion();
        const meshes: Mesh[] = [];

        const ring = CreateTorus("xr destination ring", { diameter: 1, thickness: 0.035, tessellation: 64 }, scene);
        ring.material = material("xr destination ring", glow, 0.95);
        meshes.push(ring);

        // A soft disc inside the ring: the ground you will stand on.
        const floor = CreateDisc("xr destination floor", { radius: 0.5, tessellation: 48 }, scene);
        floor.rotation.x = Math.PI / 2;
        floor.material = material("xr destination floor", glow, 0.14);
        meshes.push(floor);

        // Ahead of the ring, pointing the way you will face.
        const chevron = new Mesh("xr destination facing", scene);
        Object.assign(new VertexData(), {
            positions: [-0.2, 0, 0.6, 0.2, 0, 0.6, 0, 0, 0.9, -0.1, 0, 0.6, 0.1, 0, 0.6, 0, 0, 0.75],
            indices: [0, 2, 5, 0, 5, 3, 1, 4, 5, 1, 5, 2],
        }).applyToMesh(chevron);
        chevron.material = material("xr destination facing", glow, 0.95);
        meshes.push(chevron);

        // Up to the eyes' height on arrival.
        this.pillar = CreateBox("xr destination height", { width: 0.012, depth: 0.012, height: 1 }, scene);
        this.pillar.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
        this.pillar.material = material("xr destination height", glow, 0.3);
        meshes.push(this.pillar);
        this.eye = CreateDisc("xr destination eyes", { radius: 0.05, tessellation: 24 }, scene);
        this.eye.billboardMode = Mesh.BILLBOARDMODE_ALL;
        this.eye.material = material("xr destination eyes", glow, 0.9);
        meshes.push(this.eye);

        for (const mesh of meshes) {
            mesh.parent = this.root;
            mesh.renderingGroupId = group;
            mesh.isPickable = false;
            mesh.alwaysSelectAsActiveMesh = true;
        }

        // The arc, from the hand: drawn relative to it, so it stays exact far from the globe's origin.
        this.arcNode = new TransformNode("xr destination arc", scene);
        this.arc = CreateLines("xr destination arc", { points: this.points, updatable: true }, scene);
        this.arc.parent = this.arcNode;
        this.arc.color = glow;
        this.arc.alpha = 0.8;
        this.arc.renderingGroupId = group;
        this.arc.isPickable = false;
        this.arc.alwaysSelectAsActiveMesh = true;
        this.hide();
    }

    /**
     * Shows the destination at `hit` (world) for a click from `hand`: arriving
     * with `metre` world units to the metre, eyes `eyeHeight` metres up,
     * facing along `facing`, and seen from `eye`.
     */
    public show(hand: Vector3, hit: Vector3, facing: Vector3, metre: number, eyeHeight: number, eye: Vector3): void {
        const up = hit.normalizeToNew();
        const forward = facing.subtract(up.scale(Vector3.Dot(facing, up)));
        if (forward.lengthSquared() < 1e-12) forward.copyFrom(Vector3.Cross(up, Vector3.Right()));
        forward.normalize();
        this.root.position.copyFrom(hit);
        Quaternion.FromLookDirectionLHToRef(forward, up, this.root.rotationQuaternion!);
        // True to size, unless that would be too small to see from here.
        const size = Math.max(FOOTPRINT * metre, Vector3.Distance(eye, hit) * MIN_ANGULAR);
        this.root.scaling.setAll(size);
        this.pillar.scaling.y = eyeHeight * metre / size;
        this.eye.position.y = eyeHeight * metre / size;

        // A curve rising from the hand and falling onto the ring.
        const span = hit.subtract(hand), length = span.length();
        const control = hand.add(span.scale(0.5)).addInPlace(up.scale(length * 0.18));
        this.arcNode.position.copyFrom(hand);
        for (let i = 0; i < ARC_POINTS; i++) {
            const t = i / (ARC_POINTS - 1), s = 1 - t;
            // Quadratic Bézier, relative to the hand.
            this.points[i].set(
                2 * s * t * (control.x - hand.x) + t * t * span.x,
                2 * s * t * (control.y - hand.y) + t * t * span.y,
                2 * s * t * (control.z - hand.z) + t * t * span.z);
        }
        this.arc = CreateLines("xr destination arc", { points: this.points, instance: this.arc }, this.scene);
        if (!this.shown) {
            this.shown = true;
            this.root.setEnabled(true);
            this.arcNode.setEnabled(true);
        }
    }

    public get isShown(): boolean {
        return this.shown;
    }

    public hide(): void {
        this.shown = false;
        this.root.setEnabled(false);
        this.arcNode.setEnabled(false);
    }
}
