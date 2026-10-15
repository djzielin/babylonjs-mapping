import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { CreateLineSystem } from "@babylonjs/core/Meshes/Builders/linesBuilder.js";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Node } from "@babylonjs/core/node.js";
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Observer } from "@babylonjs/core/Misc/observable.js";
import { RenderingManager } from "@babylonjs/core/Rendering/renderingManager.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ellipsoidFrame } from "../google/GoogleTileFrame.js";
import type { GlobeEarthFrame } from "./GlobeEarthFrame.js";
import type GlobeSet from "./GlobeSet.js";
import { aircraftModel, shipModel, VehiclePart, type VehicleModel } from "./VehicleModels.js";

const NAME = "globeVehicle";

// Lit from above and a little from the eye, two-sided, fogged like the ground.
Effect.ShadersStore[`${NAME}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec4 color;
uniform mat4 worldViewProjection;
uniform mat4 worldView;
varying vec4 vColor;
varying vec3 vNormal;
varying vec3 vRelative;
void main(void) {
    gl_Position = worldViewProjection * vec4(position, 1.0);
    vColor = color;
    vNormal = normal;
    vRelative = position;
}`;

Effect.ShadersStore[`${NAME}FragmentShader`] = `
precision highp float;
uniform vec3 fogColor;
uniform float fogDensity;
uniform vec3 light;
varying vec4 vColor;
varying vec3 vNormal;
varying vec3 vRelative;
void main(void) {
    vec3 n = normalize(vNormal);
    // Whichever side faces the eye.
    if (dot(n, vRelative) > 0.0) n = -n;
    float lit = 0.5 + 0.5 * max(dot(n, light), 0.0);
    float fog = clamp(exp(-pow(fogDensity * length(vRelative), 2.0)), 0.0, 1.0);
    gl_FragColor = vec4(mix(fogColor, vColor.rgb * lit, fog), 1.0);
}`;

/** One position report of a moving vehicle. */
export interface VehicleReport {
    id: string;
    latitude: number;
    longitude: number;
    /** Metres above sea level; undefined for vehicles on the surface (ships, taxiing aircraft). */
    altitude?: number;
    /** Degrees clockwise from north, of the direction of travel or of the bow. */
    heading?: number;
    /** Metres per second over the ground. */
    speed?: number;
    /** Metres per second, climbing positive. */
    verticalSpeed?: number;
    /** ICAO aircraft type designator, such as "B738", for the aircraft's model. */
    type?: string;
    /** ADS-B emitter category, such as "A3", for a model when the type is unknown; for ships, the AIS ship type, such as "70". */
    category?: string;
    /** Overall length in metres, for ships. */
    length?: number;
    /** When the position was measured (`Date.now()` milliseconds). */
    time: number;
}

/** The area to report vehicles in: a circle around the view. */
export interface VehicleArea {
    latitude: number;
    longitude: number;
    /** Metres. */
    radius: number;
}

/** A source of live vehicle positions. Called again for each refresh. */
export type VehicleFeed = (area: VehicleArea, signal: AbortSignal) => Promise<VehicleReport[]>;

export type VehicleKind = "aircraft" | "ship";

export interface GlobeVehiclesOptions {
    feed: VehicleFeed;
    kind: VehicleKind;
    /** Seconds between refreshes. Default 5 for aircraft, 15 for ships. */
    refreshSeconds?: number;
    /**
     * Ships: smallest on-screen length in CSS pixels, so ships stay visible
     * from afar (default 18). Aircraft are drawn at true scale, and as a
     * marker this many pixels across only once their model is smaller (default 5).
     */
    sizePixels?: number;
    /** Seconds of track drawn behind each vehicle. Default 90 for aircraft, 300 for ships. */
    trailSeconds?: number;
    /** Camera height in metres above which the layer is hidden. Default 400 km for aircraft, 150 km for ships. */
    maximumHeight?: number;
    /** Surface height in metres above sea level, for aircraft reported on the ground. */
    heightAt?: (latitude: number, longitude: number) => number | undefined;
    /**
     * Place vehicles in this frame, such as photorealistic 3D tiles', to line
     * up with its content exactly; otherwise on the globe's sphere.
     */
    earthFrame?: GlobeEarthFrame;
    /**
     * The URL of a glTF model of the vehicle, drawn in place of the built-in
     * shape once it is `detailPixels` long on screen, for the nearest
     * `detailedModels` vehicles. Models face +Z with +Y up, as glTF does, and
     * are scaled to the vehicle's length (aircraft by type, ships as reported)
     * and set on their lowest point. Each URL is loaded once, when first needed.
     */
    modelFor?: (report: VehicleReport) => string | undefined;
    /** Most vehicles drawn with their glTF model at once. Default 24. */
    detailedModels?: number;
    /** On-screen length in CSS pixels from which a vehicle is drawn with its glTF model. Default 24. */
    detailPixels?: number;
}

/** A loaded glTF model: one mesh per material, normalised and drawn as thin instances. */
interface DetailedModel {
    meshes: Mesh[];
    textures: BaseTexture[];
    matrices: Float32Array;
    count: number;
}

interface Vehicle {
    report: VehicleReport;
    model: VehicleModel;
    /** Where the vehicle is drawn (world). */
    position: Vector3;
    /** The jump to the latest report, decaying, so vehicles glide to corrections. */
    correction: Vector3;
    heading: number;
    altitude: number;
    latitude: number;
    longitude: number;
    /** Surface height under an aircraft on the ground, found once per report. */
    ground?: number;
    seenAt: number;
    trail: Vector3[];
    trailAt: number;
    /** URL of the vehicle's glTF model, from `modelFor`. */
    modelUrl?: string;
}

const KNOT = 1852 / 3600;
const EARTH_RADIUS = 6_371_008;
/** Vehicles not reported for this long are removed. */
const STALE_MS = 90_000;
/** Dead reckoning stops this long after a report: a lost vehicle stops rather than flying on. */
const MAX_EXTRAPOLATION_MS = 60_000;
const CORRECTION_SECONDS = 1.5;
const TRAIL_STEP_MS = 2000;

const PART_COLORS: Record<VehicleKind, [number, number, number][]> = {
    // Body, wing, engine, tail (replaced by the altitude colour), dark.
    aircraft: [[0.93, 0.94, 0.96], [0.76, 0.78, 0.8], [0.5, 0.52, 0.56], [1, 1, 1], [0.28, 0.29, 0.31]],
    // Superstructure, deck, -, funnel, hull.
    ship: [[0.95, 0.95, 0.93], [0.62, 0.6, 0.55], [0.5, 0.5, 0.5], [0.85, 0.3, 0.2], [0.16, 0.2, 0.3]],
};
const LOW_COLOR = new Color4(1.0, 0.72, 0.3, 1);
const HIGH_COLOR = new Color4(0.45, 0.8, 1.0, 1);
const SHIP_COLOR = new Color4(0.95, 0.97, 1.0, 1);
/** Ships whose length is not reported, in metres. */
const SHIP_LENGTH = 100;
/** How deep hulls sit, as a fraction of their length. */
const SHIP_DRAFT = 0.04;

/**
 * Live aircraft or ships on a globe. Positions from a `VehicleFeed` are dead
 * reckoned between reports, so vehicles move smoothly at their reported
 * speed, heading and climb, and glide rather than jump to each correction.
 *
 * Aircraft are low-poly models of their type at true scale, pitched to their
 * climb, with a faint line to the ground; each shrinks to a small marker
 * coloured by altitude when too distant to see. Ships are hulls kept at
 * least `sizePixels` long. Both trail their recent track.
 */
export default class GlobeVehicles {
    public enabled = true;
    public readonly mesh: Mesh;
    private trails?: LinesMesh;
    private readonly material: ShaderMaterial;
    private readonly scene: Scene;
    private readonly feed: VehicleFeed;
    private readonly kind: VehicleKind;
    private readonly refreshMs: number;
    private readonly sizePixels: number;
    private readonly trailMs: number;
    private readonly maximumHeight: number;
    private readonly heightAt?: (latitude: number, longitude: number) => number | undefined;
    private readonly earthFrame?: GlobeEarthFrame;
    private readonly modelFor?: (report: VehicleReport) => string | undefined;
    private readonly detailedModels: number;
    private readonly detailPixels: number;
    private readonly models = new Map<string, DetailedModel | "loading" | "failed">();
    private light?: HemisphericLight;
    private disposed = false;
    private readonly group: number;
    private readonly vehicles = new Map<string, Vehicle>();
    private readonly observer: Observer<Scene>;
    private positions = new Float32Array(0);
    private normals = new Float32Array(0);
    private colors = new Float32Array(0);
    private loading?: AbortController;
    private requestedAt = -Infinity;
    private requestedArea?: VehicleArea;
    private trailsAt = -Infinity;
    private lastFrame = performance.now();

    public constructor(public readonly globe: GlobeSet, options: GlobeVehiclesOptions) {
        this.scene = globe.scene;
        this.feed = options.feed;
        this.kind = options.kind;
        const aircraft = this.kind === "aircraft";
        this.refreshMs = (options.refreshSeconds ?? (aircraft ? 5 : 15)) * 1000;
        this.sizePixels = options.sizePixels ?? (aircraft ? 5 : 18);
        this.trailMs = (options.trailSeconds ?? (aircraft ? 90 : 300)) * 1000;
        this.maximumHeight = options.maximumHeight ?? (aircraft ? 400_000 : 150_000);
        this.heightAt = options.heightAt;
        this.earthFrame = options.earthFrame;
        this.modelFor = options.modelFor;
        this.detailedModels = options.detailedModels ?? 24;
        this.detailPixels = options.detailPixels ?? 24;

        this.mesh = new Mesh(`globe ${this.kind}`, this.scene);
        const material = this.material = new ShaderMaterial(`globe ${this.kind}`, this.scene, NAME, {
            attributes: ["position", "normal", "color"],
            uniforms: ["worldViewProjection", "worldView", "fogColor", "fogDensity", "light"],
        });
        material.backFaceCulling = false;
        // Explicitly: the engine keeps whatever depth function the last material set.
        material.depthFunction = Constants.LEQUAL;
        this.mesh.material = material;
        this.mesh.isPickable = false;
        this.mesh.alwaysSelectAsActiveMesh = true;
        this.mesh.doNotSyncBoundingInfo = true;
        // Over the ground and buildings, which do not clear depth between
        // their rendering groups: after every group so far.
        this.group = RenderingManager.MAX_RENDERINGGROUPS;
        RenderingManager.MAX_RENDERINGGROUPS = this.group + 1;
        this.scene.setRenderingAutoClearDepthStencil(this.group, false);
        this.mesh.renderingGroupId = this.group;
        this.observer = this.scene.onBeforeRenderObservable.add(() => this.update());
    }

    /** Vehicles currently known. */
    public get count(): number {
        return this.vehicles.size;
    }

    /** URLs of the glTF models drawn this frame, such as to credit their authors. */
    public get drawnModels(): string[] {
        return [...this.models].filter(([, model]) => typeof model !== "string" && model.count > 0 && this.mesh.isEnabled()).map(([url]) => url);
    }

    public dispose(): void {
        this.disposed = true;
        this.scene.onBeforeRenderObservable.remove(this.observer);
        this.loading?.abort();
        for (const model of this.models.values()) {
            if (typeof model === "string") continue;
            for (const mesh of model.meshes) mesh.dispose(false, true);
            for (const texture of model.textures) texture.dispose();
        }
        this.light?.dispose();
        this.trails?.dispose();
        this.material.dispose();
        this.mesh.dispose();
    }

    private update(): void {
        const now = performance.now(), frame = Math.min(0.1, (now - this.lastFrame) / 1000);
        this.lastFrame = now;
        const camera = this.scene.activeCamera;
        const eye = camera?.globalPosition;
        const height = eye ? (eye.length() - this.globe.radius) / this.globe.metresToWorld : Infinity;
        // Beneath the sea, whose surface is not drawn from below, vehicles would hang overhead.
        const visible = this.enabled && !!camera && height < this.maximumHeight && height >= 0;
        this.mesh.setEnabled(visible);
        this.trails?.setEnabled(visible);
        if (!visible) {
            for (const model of this.models.values()) if (typeof model !== "string") for (const mesh of model.meshes) mesh.setEnabled(false);
            return;
        }
        this.refresh(camera!, height, now);
        const scene = this.scene;
        this.material.setColor3("fogColor", scene.fogColor);
        this.material.setFloat("fogDensity", scene.fogEnabled && scene.fogMode === Scene.FOGMODE_EXP2 ? scene.fogDensity : 0);
        this.material.setVector3("light", eye!.normalizeToNew());
        if (this.light) this.light.direction.copyFrom(eye!).normalize();

        const date = Date.now();
        const decay = Math.exp(-frame / CORRECTION_SECONDS * 3);
        for (const [id, vehicle] of this.vehicles) {
            if (date - vehicle.seenAt > STALE_MS) { this.vehicles.delete(id); continue; }
            this.place(vehicle, date, vehicle.position);
            vehicle.correction.scaleInPlace(decay);
            vehicle.position.addInPlace(vehicle.correction);
            if (now - vehicle.trailAt > TRAIL_STEP_MS) {
                vehicle.trailAt = now;
                vehicle.trail.push(vehicle.position.clone());
                if (vehicle.trail.length > this.trailMs / TRAIL_STEP_MS) vehicle.trail.shift();
            }
        }
        this.build(camera!);
        if (now - this.trailsAt > 250) { this.trailsAt = now; this.drawTrails(); }
    }

    /**
     * Models are laid out around the eye each frame: a few hundred vertices
     * per visible vehicle, precise however far from the globe's centre.
     */
    private build(camera: Camera): void {
        const eye = camera.globalPosition, m = this.globe.metresToWorld;
        const planes = this.scene.frustumPlanes;
        const metresPerPixel = this.metresPerPixel(camera);
        const marker = MARKER;
        // Size the buffers for the worst case: every vehicle's full model.
        let needed = 0;
        for (const vehicle of this.vehicles.values()) needed += Math.max(vehicle.model.positions.length, marker.positions.length);
        const resized = this.positions.length < needed;
        if (resized) {
            const capacity = Math.max(3 * 4096, needed * 2);
            this.positions = new Float32Array(capacity);
            this.normals = new Float32Array(capacity);
            this.colors = new Float32Array(capacity / 3 * 4);
        }
        const positions = this.positions, normals = this.normals, colors = this.colors;
        this.mesh.position.copyFrom(eye);
        const up = new Vector3(), north = new Vector3(), east = new Vector3(), forward = new Vector3(), right = new Vector3();
        const colorsByPart = PART_COLORS[this.kind];
        const detailed = this.pickDetailed(eye, metresPerPixel);
        for (const model of this.models.values()) if (typeof model !== "string") model.count = 0;
        let vertex = 0;
        for (const vehicle of this.vehicles.values()) {
            const distance = Vector3.Distance(vehicle.position, eye) / m;
            const model = vehicle.model;
            const pixels = model.length / (metresPerPixel * distance);
            // Aircraft at true scale, a marker once smaller than one; ships no smaller than a minimum.
            const useMarker = this.kind === "aircraft" && pixels < this.sizePixels * 1.5;
            const scale = this.kind === "aircraft"
                ? useMarker ? this.sizePixels * metresPerPixel * distance : 1
                : Math.max(80, this.sizePixels * metresPerPixel * distance);
            // Outside the view: skip.
            const detail = detailed.get(vehicle);
            const radius = (detail ? this.lengthOf(vehicle) : scale * (useMarker ? 1 : model.length)) * m;
            if (planes?.some(plane => plane.dotCoordinate(vehicle.position) < -radius)) continue;

            // East, north and up where the vehicle is, in the frame it is placed in.
            const ecefToWorld = this.earthFrame?.ecefToWorld;
            if (ecefToWorld) {
                const axes = ellipsoidFrame(vehicle.latitude, vehicle.longitude);
                Vector3.TransformNormalToRef(axes.east, ecefToWorld, east).normalize();
                Vector3.TransformNormalToRef(axes.north, ecefToWorld, north).normalize();
                Vector3.TransformNormalToRef(axes.up, ecefToWorld, up).normalize();
            } else {
                const lat = vehicle.latitude * Math.PI / 180, lon = vehicle.longitude * Math.PI / 180;
                east.set(-Math.cos(lon), 0, -Math.sin(lon));
                north.set(Math.sin(lat) * Math.sin(lon), Math.cos(lat), -Math.sin(lat) * Math.cos(lon));
                vehicle.position.normalizeToRef(up);
            }
            const h = vehicle.heading * Math.PI / 180, cos = Math.cos(h), sin = Math.sin(h);
            forward.set(north.x * cos + east.x * sin, north.y * cos + east.y * sin, north.z * cos + east.z * sin);
            right.set(east.x * cos - north.x * sin, east.y * cos - north.y * sin, east.z * cos - north.z * sin);
            // Nose up or down with the climb.
            const report = vehicle.report;
            if (this.kind === "aircraft" && report.verticalSpeed && (report.speed ?? 0) > 20) {
                const pitch = Math.max(-0.25, Math.min(0.35, Math.atan2(report.verticalSpeed, report.speed!)));
                const fx = forward.x * Math.cos(pitch) + up.x * Math.sin(pitch), fy = forward.y * Math.cos(pitch) + up.y * Math.sin(pitch), fz = forward.z * Math.cos(pitch) + up.z * Math.sin(pitch);
                up.set(up.x * Math.cos(pitch) - forward.x * Math.sin(pitch), up.y * Math.cos(pitch) - forward.y * Math.sin(pitch), up.z * Math.cos(pitch) - forward.z * Math.sin(pitch));
                forward.set(fx, fy, fz);
            }
            const ox = vehicle.position.x - eye.x, oy = vehicle.position.y - eye.y, oz = vehicle.position.z - eye.z;
            if (detail) { this.instance(detail, vehicle, ox, oy, oz, forward, up); continue; }
            const shape = useMarker ? marker : model;
            const k = scale * m;
            const accent = this.color(vehicle);
            const source = shape.positions, sourceNormals = shape.normals, parts = shape.parts;
            for (let v = 0; v < source.length / 3; v++, vertex++) {
                const x = source[v * 3], y = source[v * 3 + 1], z = source[v * 3 + 2];
                const nx = sourceNormals[v * 3], ny = sourceNormals[v * 3 + 1], nz = sourceNormals[v * 3 + 2];
                const o = vertex * 3, c = vertex * 4;
                positions[o] = ox + (right.x * x + up.x * y + forward.x * z) * k;
                positions[o + 1] = oy + (right.y * x + up.y * y + forward.y * z) * k;
                positions[o + 2] = oz + (right.z * x + up.z * y + forward.z * z) * k;
                normals[o] = right.x * nx + up.x * ny + forward.x * nz;
                normals[o + 1] = right.y * nx + up.y * ny + forward.y * nz;
                normals[o + 2] = right.z * nx + up.z * ny + forward.z * nz;
                const part = parts[v];
                const rgb = useMarker || (part === VehiclePart.Tail && this.kind === "aircraft") ? [accent.r, accent.g, accent.b] : colorsByPart[part];
                colors[c] = rgb[0]; colors[c + 1] = rgb[1]; colors[c + 2] = rgb[2]; colors[c + 3] = 1;
            }
        }
        // Unused vertices collapse to a point.
        positions.fill(0, vertex * 3);
        if (resized) {
            this.mesh.setVerticesData("position", positions, true, 3);
            this.mesh.setVerticesData("normal", normals, true, 3);
            this.mesh.setVerticesData("color", colors, true, 4);
            this.mesh.setIndices(Array.from({ length: positions.length / 3 }, (_, i) => i));
        } else {
            this.mesh.updateVerticesData("position", positions);
            this.mesh.updateVerticesData("normal", normals);
            this.mesh.updateVerticesData("color", colors);
        }
        for (const model of this.models.values()) {
            if (typeof model === "string") continue;
            for (const mesh of model.meshes) {
                mesh.setEnabled(model.count > 0);
                if (!model.count) continue;
                mesh.position.copyFrom(eye);
                mesh.thinInstanceBufferUpdated("matrix");
                mesh.thinInstanceCount = model.count;
            }
        }
    }

    /** Overall length in metres: aircraft by type, ships as reported. */
    private lengthOf(vehicle: Vehicle): number {
        return this.kind === "aircraft" ? vehicle.model.length : vehicle.report.length || SHIP_LENGTH;
    }

    /**
     * The nearest vehicles long enough on screen to draw with their glTF
     * models, and those models, loading any not yet requested.
     */
    private pickDetailed(eye: Vector3, metresPerPixel: number): Map<Vehicle, DetailedModel> {
        const detailed = new Map<Vehicle, DetailedModel>();
        if (!this.modelFor) return detailed;
        const m = this.globe.metresToWorld, planes = this.scene.frustumPlanes;
        const near: [Vehicle, number][] = [];
        for (const vehicle of this.vehicles.values()) {
            if (!vehicle.modelUrl) continue;
            const length = this.lengthOf(vehicle), distance = Vector3.Distance(vehicle.position, eye) / m;
            if (length / (metresPerPixel * distance) < this.detailPixels) continue;
            if (planes?.some(plane => plane.dotCoordinate(vehicle.position) < -length * m)) continue;
            near.push([vehicle, distance]);
        }
        near.sort((a, b) => a[1] - b[1]);
        for (const [vehicle] of near.slice(0, this.detailedModels)) {
            const model = this.models.get(vehicle.modelUrl!);
            if (model === undefined) this.load(vehicle.modelUrl!);
            else if (typeof model !== "string") detailed.set(vehicle, model);
        }
        return detailed;
    }

    /** Adds `vehicle` to its model's instances, `ox, oy, oz` from the eye. */
    private instance(model: DetailedModel, vehicle: Vehicle, ox: number, oy: number, oz: number, forward: Vector3, up: Vector3): void {
        const m = this.globe.metresToWorld, k = this.lengthOf(vehicle) * m;
        // On its wheels, or sunk to its waterline.
        const drop = (this.kind === "aircraft" ? vehicle.model.length * 0.06 : k / m * SHIP_DRAFT) * m;
        // A proper rotation, so that models are not mirrored.
        const right = Vector3.Cross(up, forward);
        if (model.matrices.length < (model.count + 1) * 16) {
            const grown = new Float32Array(Math.max(16 * 8, model.matrices.length * 2));
            grown.set(model.matrices);
            model.matrices = grown;
            for (const mesh of model.meshes) mesh.thinInstanceSetBuffer("matrix", grown, 16, false);
        }
        Matrix.FromValuesToRef(
            right.x * k, right.y * k, right.z * k, 0,
            up.x * k, up.y * k, up.z * k, 0,
            forward.x * k, forward.y * k, forward.z * k, 0,
            ox - up.x * drop, oy - up.y * drop, oz - up.z * drop, 1,
            SCRATCH_MATRIX);
        SCRATCH_MATRIX.copyToArray(model.matrices, model.count * 16);
        model.count++;
    }

    /**
     * Loads a glTF model: its meshes baked into one per texture, with
     * material colours in vertex colours, centred, one unit long and standing
     * on their lowest point, lit simply.
     */
    private load(url: string): void {
        this.models.set(url, "loading");
        (async () => {
            await import("@babylonjs/loaders/glTF/2.0/index.js");
            const container = await LoadAssetContainerAsync(url, this.scene);
            // Meshes sharing textures and blending share a draw, whatever their colours.
            const groups = new Map<string, { material: Material | null; blend: boolean; parts: VertexData[] }>();
            // Parents first: the container's nodes are not in the scene to be computed.
            const computed = new Set<Node>();
            const compute = (node: Node) => {
                if (computed.has(node)) return;
                computed.add(node);
                if (node.parent) compute(node.parent);
                (node as TransformNode).computeWorldMatrix?.(true);
            };
            for (const mesh of container.meshes) {
                compute(mesh);
                const source = (mesh as AbstractMesh & { sourceMesh?: Mesh }).sourceMesh ?? mesh as Mesh;
                if (!source.getTotalVertices?.() || !source.getIndices()) continue;
                const data = new VertexData();
                data.positions = Array.from(source.getVerticesData("position")!);
                data.indices = Array.from(source.getIndices()!);
                const normals = source.getVerticesData("normal");
                data.normals = normals ? Array.from(normals) : (() => { const n: number[] = []; VertexData.ComputeNormals(data.positions!, data.indices!, n); return n; })();
                const uvs = source.getVerticesData("uv");
                data.uvs = uvs ? Array.from(uvs) : new Array(data.positions.length / 3 * 2).fill(0);
                const pbr = pbrOf(mesh.material);
                // The loader's colours are linear; a StandardMaterial's are not.
                const color = pbr.albedoColor?.toGammaSpace() ?? Color3.White(), alpha = pbr.alpha ?? 1;
                const vertexColors = source.getVerticesData("color"), stride = vertexColors && vertexColors.length === data.positions.length ? 3 : 4;
                data.colors = Array.from({ length: data.positions.length / 3 * 4 }, (_, i) => {
                    const channel = i % 4, v = Math.floor(i / 4);
                    const own = vertexColors ? (channel < stride ? vertexColors[v * stride + channel] : 1) : 1;
                    return own * (channel === 3 ? alpha : color.asArray()[channel]);
                });
                data.transform(mesh.computeWorldMatrix(true));
                const blend = alpha < 1 || pbr.transparencyMode === 2 || pbr.transparencyMode === 3;
                const key = `${pbr.albedoTexture?.uniqueId ?? "-"} ${pbr.emissiveTexture?.uniqueId ?? "-"} ${blend} ${pbr.transparencyMode === 1}`;
                const group = groups.get(key) ?? { material: mesh.material, blend, parts: [] };
                group.parts.push(data);
                groups.set(key, group);
            }
            const min = new Vector3(Infinity, Infinity, Infinity), max = min.negate();
            const merged = [...groups.values()].map(({ material, blend, parts }) => {
                const data = parts[0];
                if (parts.length > 1) data.merge(parts.slice(1), true);
                for (let i = 0; i < data.positions!.length; i += 3) {
                    min.minimizeInPlaceFromFloats(data.positions![i], data.positions![i + 1], data.positions![i + 2]);
                    max.maximizeInPlaceFromFloats(data.positions![i], data.positions![i + 1], data.positions![i + 2]);
                }
                return [material, blend, data] as const;
            });
            const length = max.z - min.z || 1;
            const normalise = Matrix.Translation(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2).multiply(Matrix.Scaling(1 / length, 1 / length, 1 / length));
            const meshes = merged.map(([material, blend, data], i) => {
                data.transform(normalise);
                const mesh = new Mesh(`globe ${this.kind} model ${i}`, this.scene);
                data.applyToMesh(mesh);
                mesh.hasVertexAlpha = blend;
                mesh.material = this.simpleMaterial(material);
                mesh.isPickable = false;
                mesh.alwaysSelectAsActiveMesh = true;
                mesh.doNotSyncBoundingInfo = true;
                mesh.renderingGroupId = this.group;
                mesh.setEnabled(false);
                return mesh;
            });
            // Meshes and materials were copied; the textures are kept.
            for (const mesh of container.meshes) mesh.dispose(false, false);
            for (const material of container.materials) material.dispose(false, false);
            if (this.disposed) {
                for (const mesh of meshes) mesh.dispose(false, true);
                for (const texture of container.textures) texture.dispose();
                return;
            }
            if (!this.light) {
                this.light = new HemisphericLight(`globe ${this.kind} light`, new Vector3(0, 1, 0), this.scene);
                this.light.intensity = 1.2;
                this.light.groundColor = new Color3(0.4, 0.41, 0.44);
                this.light.specular = new Color3(0.15, 0.15, 0.15);
            }
            this.light.includedOnlyMeshes.push(...meshes);
            this.models.set(url, { meshes, textures: container.textures, matrices: new Float32Array(0), count: 0 });
        })().catch(error => {
            console.warn(`Vehicle model ${url}:`, error);
            this.models.set(url, "failed");
        });
    }

    /**
     * A glTF material's textures as a lit StandardMaterial, as the scene has
     * no environment for PBR; its colours are in the mesh's vertex colours.
     */
    private simpleMaterial(source: Material | null): StandardMaterial {
        const pbr = pbrOf(source);
        const material = new StandardMaterial(`globe ${this.kind} model`, this.scene);
        material.diffuseTexture = pbr.albedoTexture ?? null;
        material.emissiveTexture = pbr.emissiveTexture ?? null;
        material.emissiveColor = pbr.emissiveTexture ? pbr.emissiveColor?.toGammaSpace() ?? Color3.White() : Color3.Black();
        material.specularColor = new Color3(0.2, 0.2, 0.2);
        if (pbr.transparencyMode === 1 && material.diffuseTexture) material.diffuseTexture.hasAlpha = true;
        material.backFaceCulling = false;
        material.twoSidedLighting = true;
        material.depthFunction = Constants.LEQUAL;
        return material;
    }

    /** Request vehicles around the view when it is time, or the view moved away. */
    private refresh(camera: Camera, height: number, now: number): void {
        if (this.loading) return;
        const { latitude, longitude } = this.globe.getSurfaceCoordinates(camera.globalPosition);
        const radius = this.kind === "aircraft"
            ? Math.min(400_000, Math.max(60_000, height * 6))
            : Math.min(150_000, Math.max(20_000, height * 4));
        const previous = this.requestedArea;
        const moved = previous ? groundDistance(previous.latitude, previous.longitude, latitude, longitude) > previous.radius / 3 || radius > previous.radius * 1.5 : true;
        if (!moved && now - this.requestedAt < this.refreshMs) return;
        const area = { latitude, longitude, radius };
        const controller = this.loading = new AbortController();
        this.requestedAt = now;
        this.requestedArea = area;
        this.feed(area, controller.signal).then(reports => this.receive(reports), () => {
            // Try again at the next refresh.
        }).finally(() => { if (this.loading === controller) this.loading = undefined; });
    }

    private receive(reports: VehicleReport[]): void {
        const date = Date.now();
        for (const report of reports) {
            if (!Number.isFinite(report.latitude) || !Number.isFinite(report.longitude)) continue;
            const ground = report.altitude === undefined && this.kind === "aircraft"
                ? Math.max(0, this.heightAt?.(report.latitude, report.longitude) ?? 0) : undefined;
            const vehicle = this.vehicles.get(report.id);
            if (!vehicle) {
                const position = new Vector3();
                const model = this.kind === "aircraft" ? aircraftModel(report.type, report.category, report.speed) : shipModel();
                const created: Vehicle = {
                    report, model, position, correction: new Vector3(), heading: report.heading ?? 0, altitude: 0,
                    latitude: report.latitude, longitude: report.longitude, ground, seenAt: date, trail: [], trailAt: -Infinity,
                    modelUrl: this.modelFor?.(report),
                };
                this.place(created, date, position);
                this.vehicles.set(report.id, created);
                continue;
            }
            if (report.time < vehicle.report.time) continue;
            if (report.type && report.type !== vehicle.report.type) vehicle.model = aircraftModel(report.type, report.category, report.speed);
            // Glide from where the vehicle is drawn to where the report puts it.
            const drawn = vehicle.position.clone();
            vehicle.report = report;
            vehicle.modelUrl = this.modelFor?.(report);
            vehicle.ground = ground;
            vehicle.seenAt = date;
            const corrected = new Vector3();
            this.place(vehicle, date, corrected);
            drawn.subtractToRef(corrected, vehicle.correction);
            // A jump larger than a few kilometres is a new track, not a correction.
            if (vehicle.correction.length() / this.globe.metresToWorld > 3000) { vehicle.correction.setAll(0); vehicle.trail = []; }
        }
    }

    /** The dead-reckoned position of `vehicle` at `date`, without its correction. */
    private place(vehicle: Vehicle, date: number, result: Vector3): void {
        const report = vehicle.report;
        const heading = report.heading ?? vehicle.heading;
        vehicle.heading = heading;
        const elapsed = Math.min(MAX_EXTRAPOLATION_MS, Math.max(0, date - report.time)) / 1000;
        const travelled = (report.speed ?? 0) * elapsed / EARTH_RADIUS;
        const lat1 = report.latitude * Math.PI / 180, lon1 = report.longitude * Math.PI / 180, bearing = heading * Math.PI / 180;
        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(travelled) + Math.cos(lat1) * Math.sin(travelled) * Math.cos(bearing));
        const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(travelled) * Math.cos(lat1), Math.cos(travelled) - Math.sin(lat1) * Math.sin(lat2));
        const latitude = lat2 * 180 / Math.PI, longitude = ((lon2 * 180 / Math.PI + 540) % 360) - 180;
        let altitude: number;
        if (report.altitude !== undefined) altitude = Math.max(0, report.altitude + (report.verticalSpeed ?? 0) * Math.min(elapsed, 20));
        else altitude = vehicle.ground ?? 0;
        vehicle.altitude = altitude;
        vehicle.latitude = latitude;
        vehicle.longitude = longitude;
        // Aircraft sit on their wheels, a few metres up; hulls sit in the water.
        const lift = this.kind === "aircraft" ? vehicle.model.length * 0.06 : 0;
        const ecefToWorld = this.earthFrame?.ecefToWorld;
        if (ecefToWorld) Vector3.TransformCoordinatesToRef(this.earthFrame!.toECEF(latitude, longitude, altitude + lift), ecefToWorld, result);
        else result.copyFrom(this.globe.getSurfacePosition(latitude, longitude, (altitude + lift) * this.globe.metresToWorld));
    }

    /** Aircraft from warm low to cool high; ships a single bright tone. */
    private color(vehicle: Vehicle): Color4 {
        if (this.kind === "ship") return SHIP_COLOR;
        const t = Math.min(1, Math.max(0, vehicle.altitude / 12_000));
        return LOW_COLOR.multiplyByFloats(1 - t, 1 - t, 1 - t, 1).addInPlace(HIGH_COLOR.multiplyByFloats(t, t, t, 0));
    }

    /** Metres per CSS pixel at a distance of one metre. */
    private metresPerPixel(camera: Camera): number {
        const engine = this.scene.getEngine();
        const height = engine.getRenderingCanvasClientRect()?.height || engine.getRenderHeight();
        return 2 * Math.tan(camera.fov / 2) / height;
    }

    /** Tracks fading behind each vehicle, and aircraft's lines to the ground. */
    private drawTrails(): void {
        const lines: Vector3[][] = [], colors: Color4[][] = [];
        for (const vehicle of this.vehicles.values()) {
            const trail = [...vehicle.trail, vehicle.position];
            const base = this.kind === "aircraft" ? this.color(vehicle) : SHIP_COLOR;
            if (trail.length > 1) {
                lines.push(trail);
                colors.push(trail.map((_, i) => new Color4(base.r, base.g, base.b, 0.7 * (i / (trail.length - 1)) ** 1.5)));
            }
            if (this.kind === "aircraft" && vehicle.altitude > 50) {
                // Down to sea level: the ground hides the rest.
                const ground = vehicle.position.normalizeToNew().scaleInPlace(this.globe.radius);
                lines.push([vehicle.position, ground]);
                colors.push([new Color4(base.r, base.g, base.b, 0.25), new Color4(base.r, base.g, base.b, 0)]);
            }
        }
        this.trails?.dispose();
        this.trails = undefined;
        if (!lines.length) return;
        this.trails = CreateLineSystem(`globe ${this.kind} trails`, { lines, colors, useVertexAlpha: true }, this.scene);
        this.trails.isPickable = false;
        this.trails.alwaysSelectAsActiveMesh = true;
        this.trails.doNotSyncBoundingInfo = true;
        this.trails.renderingGroupId = this.group;
    }
}

const SCRATCH_MATRIX = new Matrix();

/** The parts of a glTF loader's PBR material that a simple one keeps. */
function pbrOf(material: Material | null): { albedoTexture?: BaseTexture | null; albedoColor?: Color3; emissiveTexture?: BaseTexture | null; emissiveColor?: Color3; alpha?: number; transparencyMode?: number | null } {
    return material ?? {};
}

/** A diamond one unit across, for aircraft too distant to make out. */
const MARKER: VehicleModel = (() => {
    const tips = [[0.5, 0, 0], [-0.5, 0, 0], [0, 0.5, 0], [0, -0.5, 0], [0, 0, 0.5], [0, 0, -0.5]];
    const positions: number[] = [], normals: number[] = [];
    for (const x of [0, 1]) for (const y of [2, 3]) for (const z of [4, 5]) {
        const a = tips[x], b = tips[y], c = tips[z];
        const n = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
        const l = Math.hypot(n[0], n[1], n[2]);
        positions.push(...a, ...b, ...c);
        for (let i = 0; i < 3; i++) normals.push(n[0] / l, n[1] / l, n[2] / l);
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), parts: new Uint8Array(positions.length / 3), length: 1 };
})();

function groundDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const r = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
    return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Aircraft from an ADS-B Exchange v2 style API (adsb.lol, airplanes.live and
 * others serve `/v2/point/{lat}/{lon}/{radius nm}`). These APIs do not allow
 * browser requests from other origins, so `baseUrl` is usually a proxy of yours.
 * Geometric altitudes are above the WGS84 ellipsoid: pass `geoid` (the geoid's
 * height above it, such as EGM96) for heights above sea level.
 */
export function adsbAircraftFeed(baseUrl: string, { geoid }: { geoid?: (latitude: number, longitude: number) => number } = {}): VehicleFeed {
    const base = baseUrl.replace(/\/+$/, "");
    return async (area, signal) => {
        const radius = Math.min(250, Math.ceil(area.radius / 1852));
        const response = await fetch(`${base}/v2/point/${area.latitude.toFixed(4)}/${area.longitude.toFixed(4)}/${radius}`, { signal });
        if (!response.ok) throw new Error(`Aircraft feed: HTTP ${response.status}`);
        const body = await response.json() as { now?: number; ac?: Record<string, unknown>[] };
        const now = body.now ?? Date.now();
        const reports: VehicleReport[] = [];
        const number = (value: unknown) => typeof value === "number" ? value : undefined;
        for (const plane of body.ac ?? []) {
            const latitude = number(plane.lat), longitude = number(plane.lon);
            if (latitude === undefined || longitude === undefined) continue;
            const onGround = plane.alt_baro === "ground";
            const geometric = number(plane.alt_geom), barometric = number(plane.alt_baro);
            const altitude = onGround ? undefined
                : geometric !== undefined ? geometric * 0.3048 - (geoid?.(latitude, longitude) ?? 0)
                : barometric !== undefined ? barometric * 0.3048 : undefined;
            const rate = number(plane.geom_rate) ?? number(plane.baro_rate);
            reports.push({
                id: String(plane.hex),
                latitude, longitude, altitude,
                heading: number(plane.track) ?? number(plane.true_heading),
                speed: number(plane.gs) !== undefined ? number(plane.gs)! * KNOT : undefined,
                verticalSpeed: rate !== undefined && !onGround ? rate * 0.3048 / 60 : undefined,
                type: typeof plane.t === "string" ? plane.t : undefined,
                category: typeof plane.category === "string" ? plane.category : undefined,
                time: now - (number(plane.seen_pos) ?? 0) * 1000,
            });
        }
        return reports;
    };
}

/**
 * Ships from Fintraffic's Digitraffic marine AIS API: open, keyless and
 * browser-friendly, covering the Baltic Sea around Finland. Reports carry
 * each ship's length and AIS ship type (as `category`) when known.
 */
export function digitrafficShipFeed(user = "babylonjs-mapping"): VehicleFeed {
    // Every vessel's static data, about 50 kB, refreshed every half hour.
    let vessels: Promise<Map<number, { type?: number; length?: number }>> | undefined, vesselsAt = -Infinity;
    const loadVessels = () => {
        if (vessels && Date.now() - vesselsAt < 30 * 60_000) return vessels;
        vesselsAt = Date.now();
        return vessels = fetch("https://meri.digitraffic.fi/api/ais/v1/vessels", { headers: { "Digitraffic-User": user } })
            .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
            .then((list: { mmsi: number; shipType?: number; referencePointA?: number; referencePointB?: number }[]) => new Map(list.map(vessel => [vessel.mmsi, {
                type: vessel.shipType || undefined,
                length: (vessel.referencePointA ?? 0) + (vessel.referencePointB ?? 0) || undefined,
            }])))
            .catch(() => { vesselsAt = -Infinity; return new Map(); });
    };
    return async (area, signal) => {
        const statics = await loadVessels();
        const from = Date.now() - 20 * 60_000;
        const url = `https://meri.digitraffic.fi/api/ais/v1/locations?latitude=${area.latitude.toFixed(4)}&longitude=${area.longitude.toFixed(4)}`
            + `&radius=${Math.min(500, Math.ceil(area.radius / 1000))}&from=${from}`;
        const response = await fetch(url, { signal, headers: { "Digitraffic-User": user } });
        if (!response.ok) throw new Error(`Ship feed: HTTP ${response.status}`);
        const body = await response.json() as { features?: { mmsi?: number; geometry?: { coordinates?: number[] }; properties?: Record<string, number> }[] };
        const reports: VehicleReport[] = [];
        for (const feature of body.features ?? []) {
            const [longitude, latitude] = feature.geometry?.coordinates ?? [];
            const p = feature.properties ?? {};
            if (typeof latitude !== "number" || typeof longitude !== "number") continue;
            // 511 and 360 mean unavailable.
            const heading = p.heading !== undefined && p.heading < 360 ? p.heading : p.cog !== undefined && p.cog < 360 ? p.cog : undefined;
            const mmsi = feature.mmsi ?? p.mmsi, vessel = statics.get(mmsi);
            reports.push({
                id: String(mmsi),
                latitude, longitude, heading,
                category: vessel?.type !== undefined ? String(vessel.type) : undefined,
                length: vessel?.length,
                // 102.3 knots means unavailable; drifting at anchor is not travel.
                speed: p.sog !== undefined && p.sog < 102 && p.sog > 0.3 ? p.sog * KNOT : 0,
                time: p.timestampExternal ?? Date.now(),
            });
        }
        return reports;
    };
}
