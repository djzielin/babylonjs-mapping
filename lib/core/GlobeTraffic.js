import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { RenderingManager } from "@babylonjs/core/Rendering/renderingManager.js";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { parseRetryAfter } from "../shared/HostThrottle.js";
import { TileBatch } from "../shared/TileBatch.js";
import { TileWorkerPool } from "../shared/TileWorkerPool.js";
import { ellipsoidECEF, globeECEFToWorld } from "./GlobeEarthFrame.js";
const NAME = "globeTraffic";
// Each road segment is a quad whose corners are pushed sideways in screen
// space, so roads keep a constant width in pixels at any distance. Both
// ends are projected to find the segment's direction on screen.
Effect.ShadersStore[`${NAME}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec3 other;
// side (-1 or 1), end (0 start, 1 end), metres along the road, width in pixels
attribute vec4 shape;
// colour and pulse speed in metres per second
attribute vec4 style;
uniform mat4 tileWorld;
uniform mat4 tileViewProjection;
uniform vec2 viewport;
uniform float unitMetres;
uniform float focal;
varying vec4 vStyle;
varying float vAlong;
varying float vAcross;
varying float vDistance;
varying float vWidth;
void main(void) {
    // Lifted a little toward the eye, so roads stay above the ground they lie on.
    vec3 here = (tileWorld * vec4(position, 1.0)).xyz;
    vec3 there = (tileWorld * vec4(other, 1.0)).xyz;
    float lift = 1.0 - 0.005;
    vec4 a = tileViewProjection * vec4(here * lift, 1.0);
    vec4 b = tileViewProjection * vec4(there * lift, 1.0);
    vec2 sa = a.xy / max(a.w, 1e-6) * viewport;
    vec2 sb = b.xy / max(b.w, 1e-6) * viewport;
    vec2 forward = shape.y < 0.5 ? sb - sa : sa - sb;
    forward = length(forward) > 1e-4 ? normalize(forward) : vec2(1.0, 0.0);
    vec2 normal = vec2(-forward.y, forward.x);
    // No wider than about half the carriageway it marks, so the road and
    // what is on it stay visible up close.
    float pixelsPerMetre = focal * viewport.y / max(a.w, 1e-6) / unitMetres;
    float width = max(1.5, min(shape.w, shape.w * 2.0 * pixelsPerMetre));
    // Each direction of travel keeps to its own side of the road, and the
    // ends overlap the next segment so joints have no gaps.
    vec2 offset = normal * (shape.x * width * 0.5 - width * 0.6) + forward * (shape.y < 0.5 ? -0.5 : 0.5) * width;
    gl_Position = vec4(a.xy + offset / viewport * a.w, a.z, a.w);
    vStyle = style;
    vAlong = shape.z;
    vAcross = shape.x;
    vDistance = length(here) * unitMetres;
    vWidth = width;
}`;
Effect.ShadersStore[`${NAME}FragmentShader`] = `
precision highp float;
uniform float time;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float unitMetres;
varying vec4 vStyle;
varying float vAlong;
varying float vAcross;
varying float vDistance;
varying float vWidth;
void main(void) {
    // Antialiased edges, a pixel wide.
    float edge = clamp((1.0 - abs(vAcross)) * vWidth * 0.5, 0.0, 1.0);
    // Pulses flowing along the road at the traffic's speed: long, quick
    // streaks where it flows, short, slow ones where it is jammed.
    float spacing = 60.0 + vStyle.a * 6.0;
    float phase = fract((vAlong - vStyle.a * time) / spacing);
    float pulse = pow(phase, 8.0);
    vec3 color = vStyle.rgb * (0.7 + 0.9 * pulse);
    // Minor roads fade out with distance before they become clutter.
    float reach = vWidth * 1500.0;
    float fade = 1.0 - smoothstep(reach * 0.6, reach, vDistance);
    float fog = clamp(exp(-pow(fogDensity * vDistance / unitMetres, 2.0)), 0.0, 1.0);
    float alpha = edge * fade * fog * 0.8;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color, alpha);
}`;
/** Colours by congestion, like a traffic map: flowing, slowing, heavy, stopped. */
const CONGESTION = {
    low: { color: [0.2, 0.85, 0.45], speed: 22 },
    moderate: { color: [1.0, 0.62, 0.15], speed: 11 },
    heavy: { color: [0.95, 0.2, 0.15], speed: 5 },
    severe: { color: [0.6, 0.05, 0.1], speed: 1.5 },
};
/** Width in CSS pixels by road class; undefined for minor streets. */
function roadWidth(roadClass) {
    switch (roadClass) {
        case "motorway":
        case "trunk": return 4.5;
        case "primary": return 3.6;
        case "secondary": return 3;
        case "tertiary": return 2.5;
        case "motorway_link":
        case "trunk_link":
        case "primary_link": return 2.5;
        default: return undefined;
    }
}
/** Milliseconds per frame spent building road geometry. */
const BUILD_BUDGET_MS = 3;
/** Metres between samples along a bridge. */
const DECK_SPACING = 25;
/** A surface higher above the ground than this is a structure over the bridge's path, not its deck. */
const MAX_DECK = 120;
/** After its first build, a tile is laid again once, when finer ground has had time to load. */
const RELAY_MS = 5000;
/**
 * Live road traffic on a globe from Mapbox Traffic v1: each road drawn as a
 * line of constant on-screen width, coloured by congestion, with pulses
 * flowing along it in the direction and at roughly the speed of travel.
 * Tiles near the camera load and refresh in the background.
 */
export default class GlobeTraffic {
    globe;
    batch;
    enabled = true;
    scene;
    accessToken;
    heightAt;
    zoom;
    radius;
    maximumHeight;
    refreshMs;
    tiles = new Map();
    observer;
    wanted = [];
    plannedAt = -Infinity;
    inFlight = 0;
    building;
    deckHeightAt;
    earthFrame;
    constructor(globe, options) {
        this.globe = globe;
        if (!options.accessToken?.trim())
            throw new Error("GlobeTraffic requires a Mapbox access token.");
        this.scene = globe.scene;
        this.accessToken = options.accessToken.trim();
        this.heightAt = options.heightAt;
        this.deckHeightAt = options.deckHeightAt;
        this.earthFrame = options.earthFrame;
        this.zoom = options.zoom ?? 14;
        this.radius = options.radius ?? 7000;
        this.maximumHeight = options.maximumHeight ?? 30_000;
        this.refreshMs = (options.refreshSeconds ?? 120) * 1000;
        const engine = this.scene.getEngine();
        this.batch = new TileBatch("globe traffic", this.scene, {
            name: NAME,
            attributes: ["other", "shape", "style"],
            uniforms: ["viewport", "unitMetres", "time", "focal"],
            bind: effect => {
                // Widths are in CSS pixels; the shader works in render-target pixels.
                const scale = engine.getRenderHeight() / Math.max(1, engine.getRenderingCanvasClientRect()?.height ?? engine.getRenderHeight());
                effect.setFloat2("viewport", engine.getRenderWidth() / 2 / scale, engine.getRenderHeight() / 2 / scale);
                effect.setFloat("unitMetres", 1 / globe.metresToWorld);
                effect.setFloat("time", performance.now() / 1000 % 3600);
                effect.setFloat("focal", this.scene.activeCamera?.getProjectionMatrix().m[5] ?? 1);
                engine.setAlphaMode(Constants.ALPHA_COMBINE);
            },
        });
        const material = this.batch.material;
        material.disableDepthWrite = true;
        // Explicitly: the engine keeps whatever depth function the last material set.
        material.depthFunction = Constants.LEQUAL;
        material.backFaceCulling = false;
        material.options.needAlphaBlending = true;
        // Over the ground and buildings, which do not clear depth between
        // their rendering groups: after every group so far.
        const group = RenderingManager.MAX_RENDERINGGROUPS;
        RenderingManager.MAX_RENDERINGGROUPS = group + 1;
        this.scene.setRenderingAutoClearDepthStencil(group, false);
        this.batch.renderingGroupId = group;
        this.observer = this.scene.onBeforeRenderObservable.add(() => this.update());
    }
    dispose() {
        this.building = undefined;
        this.scene.onBeforeRenderObservable.remove(this.observer);
        for (const tile of this.tiles.values())
            this.release(tile);
        this.tiles.clear();
        this.batch.dispose();
    }
    update() {
        const camera = this.scene.activeCamera;
        if (!camera || !this.enabled) {
            this.batch.items = [];
            return;
        }
        const position = camera.globalPosition;
        const height = (position.length() - this.globe.radius) / this.globe.metresToWorld;
        // Beneath the sea, whose surface is not drawn from below, roads would hang overhead.
        if (height > this.maximumHeight || height < 0) {
            this.batch.items = [];
            return;
        }
        const now = performance.now();
        if (now - this.plannedAt > 500) {
            this.plannedAt = now;
            this.plan(position, now);
        }
        this.buildFor(now + BUILD_BUDGET_MS);
        // Through the shared frame as it is now, so roads move with the content they lie on.
        const ecefToWorld = this.earthFrame?.ecefToWorld;
        const items = [];
        for (const tile of this.wanted) {
            if (!tile.drawable)
                continue;
            const anchor = tile.anchor;
            Matrix.TranslationToRef(anchor.x, anchor.y, anchor.z, tile.drawable.world);
            tile.drawable.world.multiplyToRef(ecefToWorld ?? tile.sphere, tile.drawable.world);
            items.push(tile.drawable);
        }
        this.batch.items = items;
    }
    /** Build road geometry until `deadline`, one tile at a time, so frames stay even. */
    buildFor(deadline) {
        while (performance.now() < deadline) {
            if (!this.building) {
                // Roads wait for the ground beneath them, so they are not laid at sea level.
                let tile = this.wanted.find(tile => tile.pending && this.groundReady(tile));
                if (!tile) {
                    tile = this.wanted.find(tile => !tile.relaid && tile.data && performance.now() - tile.laidAt > RELAY_MS);
                    if (!tile)
                        return;
                    tile.relaid = true;
                    tile.pending = tile.data;
                }
                tile.data = tile.pending;
                tile.pending = undefined;
                this.building = { tile, steps: this.build(tile) };
            }
            const { tile, steps } = this.building;
            // A tile left behind, or reloaded meanwhile, is abandoned.
            const current = this.tiles.get(`${tile.x}/${tile.y}`) === tile && !tile.pending;
            if (!current || steps.next().done)
                this.building = undefined;
        }
    }
    /** Choose the tiles around the camera, nearest first, and start loads. */
    plan(position, now) {
        const { latitude, longitude } = this.globe.getSurfaceCoordinates(position);
        const n = 2 ** this.zoom;
        const cx = (longitude + 180) / 360 * n;
        const latRad = latitude * Math.PI / 180;
        const cy = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
        const tileMetres = 40_075_016 * Math.cos(latRad) / n;
        const reach = Math.ceil(this.radius / tileMetres);
        const wanted = [];
        for (let dy = -reach; dy <= reach; dy++)
            for (let dx = -reach; dx <= reach; dx++) {
                const x = ((Math.floor(cx) + dx) % n + n) % n, y = Math.floor(cy) + dy;
                if (y < 0 || y >= n)
                    continue;
                const distance = Math.hypot(Math.max(0, Math.abs(Math.floor(cx) + dx + 0.5 - cx) - 0.5), Math.max(0, Math.abs(y + 0.5 - cy) - 0.5)) * tileMetres;
                if (distance > this.radius)
                    continue;
                const key = `${x}/${y}`;
                let tile = this.tiles.get(key);
                if (!tile)
                    this.tiles.set(key, tile = { x, y, loadedAt: -Infinity });
                wanted.push({ tile, distance });
            }
        wanted.sort((a, b) => a.distance - b.distance);
        this.wanted = wanted.map(entry => entry.tile);
        const keep = new Set(this.wanted);
        for (const [key, tile] of this.tiles)
            if (!keep.has(tile)) {
                this.release(tile);
                this.tiles.delete(key);
            }
        for (const tile of this.wanted) {
            if (this.inFlight >= 6)
                break;
            if (!tile.loading && now - tile.loadedAt > this.refreshMs)
                void this.load(tile);
        }
    }
    async load(tile) {
        const controller = tile.loading = new AbortController();
        this.inFlight++;
        const url = `https://api.mapbox.com/v4/mapbox.mapbox-traffic-v1/${this.zoom}/${tile.x}/${tile.y}.vector.pbf?access_token=${encodeURIComponent(this.accessToken)}`;
        const throttle = TileWorkerPool.throttle;
        let host;
        try {
            host = await throttle.acquire(url, controller.signal);
            const response = await fetch(url, { signal: controller.signal });
            throttle.release(host, response.status, response.headers.get("retry-after"));
            host = undefined;
            // Not found is an empty tile: nothing to show there.
            tile.loadedAt = performance.now();
            if (response.status === 404) {
                tile.pending = new ArrayBuffer(0);
                return;
            }
            if (!response.ok) {
                // Try again later, sooner after a slow-down request than a full refresh.
                tile.loadedAt -= this.refreshMs - (parseRetryAfter(response.headers.get("retry-after")) ?? 30_000);
                return;
            }
            tile.pending = await response.arrayBuffer();
            tile.relaid = false;
        }
        catch {
            if (host)
                throttle.release(host);
            tile.loadedAt = performance.now() - this.refreshMs + 30_000;
        }
        finally {
            if (tile.loading === controller)
                tile.loading = undefined;
            this.inFlight--;
        }
    }
    groundReady(tile) {
        if (!this.heightAt)
            return true;
        const n = 2 ** this.zoom;
        const longitude = (tile.x + 0.5) / n * 360 - 180;
        const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * (tile.y + 0.5) / n))) * 180 / Math.PI;
        return this.heightAt(latitude, longitude) !== undefined;
    }
    /**
     * Turn a loaded tile into road ribbons, a slice at a time: the generator
     * yields between roads and update() stops it when the frame's budget is spent.
     */
    *build(tile) {
        const data = tile.data;
        const roads = data.byteLength ? new VectorTile(new PbfReader(data)).layers.traffic : undefined;
        const n = 2 ** this.zoom;
        const anchorLon = (tile.x + 0.5) / n * 360 - 180;
        const anchorLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (tile.y + 0.5) / n))) * 180 / Math.PI;
        const toECEF = (latitude, longitude, height) => this.earthFrame?.toECEF(latitude, longitude, height) ?? ellipsoidECEF(latitude, longitude, height);
        const anchor = tile.anchor = toECEF(anchorLat, anchorLon, 0);
        tile.sphere ??= globeECEFToWorld(this.globe, anchorLat, anchorLon);
        const positions = [], others = [], shapes = [], styles = [], indices = [];
        const point = new Vector3();
        for (let f = 0; roads && f < roads.length; f++) {
            yield;
            const feature = roads.feature(f);
            if (feature.type !== 2)
                continue;
            const congestion = CONGESTION[feature.properties.congestion];
            // Tunnels are out of sight.
            if (!congestion || feature.properties.structure === "tunnel")
                continue;
            // Minor streets only where traffic is slow, as on a traffic map: a
            // city's every free street in green hides what matters.
            const width = roadWidth(feature.properties.class) ?? (congestion.speed < 20 ? 2 : 0);
            if (!width)
                continue;
            const marked = feature.properties.structure === "bridge";
            const extent = feature.extent;
            const metresPerUnit = 40_075_016 / n / extent * Math.cos(anchorLat * Math.PI / 180);
            for (const line of feature.loadGeometry()) {
                // Bridges are sampled finely, so a span follows its deck
                // rather than running straight between its ends.
                // Roads over water are bridges too, whatever the data says.
                const wet = line.map(({ x, y }) => (this.heightAt?.(Math.atan(Math.sinh(Math.PI * (1 - 2 * (tile.y + y / extent) / n))) * 180 / Math.PI, (tile.x + x / extent) / n * 360 - 180) ?? 0) < 0);
                const bridge = !!this.deckHeightAt && (marked || wet.some(Boolean));
                const samples = [];
                for (let i = 0; i < line.length; i++) {
                    const steps = bridge && i && (marked || wet[i] || wet[i - 1]) ? Math.max(1, Math.ceil(Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y) * metresPerUnit / DECK_SPACING)) : 1;
                    for (let step = i ? 1 : steps; step <= steps; step++) {
                        const t = step / steps, a = line[i ? i - 1 : 0], b = line[i];
                        samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
                    }
                }
                const coordinates = samples.map(({ x, y }) => ({
                    longitude: (tile.x + x / extent) / n * 360 - 180,
                    latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * (tile.y + y / extent) / n))) * 180 / Math.PI,
                }));
                const heights = coordinates.map(({ latitude, longitude }) => Math.max(0, this.heightAt?.(latitude, longitude) ?? 0));
                if (bridge) {
                    // A bridge lies on its deck: the first surface from above,
                    // unless that is far above the ground. Samples that miss the
                    // deck, beside it or where it has not loaded, take the
                    // heights of the hits around them.
                    const decks = coordinates.map(({ latitude, longitude }, i) => {
                        const deck = this.deckHeightAt(latitude, longitude);
                        return deck !== undefined && deck > heights[i] - 2 && deck < heights[i] + MAX_DECK ? deck : undefined;
                    });
                    yield;
                    let last = -1;
                    for (let i = 0; i <= decks.length; i++) {
                        if (i < decks.length && decks[i] === undefined)
                            continue;
                        for (let j = last + 1; j < i; j++) {
                            if (last >= 0 && i < decks.length)
                                decks[j] = decks[last] + (decks[i] - decks[last]) * (j - last) / (i - last);
                            else
                                decks[j] = last >= 0 ? decks[last] : i < decks.length ? decks[i] : undefined;
                        }
                        last = i;
                    }
                    for (let i = 0; i < heights.length; i++)
                        heights[i] = Math.max(heights[i], decks[i] ?? heights[i]);
                }
                let previous, along = 0;
                for (let i = 0; i < coordinates.length; i++) {
                    const current = toECEF(coordinates[i].latitude, coordinates[i].longitude, heights[i]).subtractInPlace(anchor);
                    if (previous) {
                        const length = Vector3.Distance(previous, current);
                        const base = positions.length / 3;
                        for (let corner = 0; corner < 4; corner++) {
                            const end = corner >> 1, side = corner & 1 ? 1 : -1;
                            point.copyFrom(end ? current : previous);
                            const far = end ? previous : current;
                            positions.push(point.x, point.y, point.z);
                            others.push(far.x, far.y, far.z);
                            shapes.push(side, end, along + (end ? length : 0), width);
                            styles.push(...congestion.color, congestion.speed);
                        }
                        indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
                        along += length;
                    }
                    previous = current;
                }
            }
        }
        tile.laidAt = performance.now();
        this.clear(tile);
        if (!indices.length)
            return;
        const engine = this.scene.getEngine();
        const vertices = positions.length / 3;
        tile.drawable = {
            positions: new VertexBuffer(engine, new Float32Array(positions), VertexBuffer.PositionKind, false, false, 3),
            attributes: {
                other: new VertexBuffer(engine, new Float32Array(others), "other", false, false, 3),
                shape: new VertexBuffer(engine, new Float32Array(shapes), "shape", false, false, 4),
                style: new VertexBuffer(engine, new Float32Array(styles), "style", false, false, 4),
            },
            indexBuffer: engine.createIndexBuffer(vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)),
            indexCount: indices.length,
            world: new Matrix(),
        };
    }
    get stats() {
        return { tiles: this.wanted.length, drawn: this.wanted.filter(tile => tile.drawable).length, loading: this.inFlight };
    }
    release(tile) {
        tile.loading?.abort();
        this.clear(tile);
    }
    clear(tile) {
        const drawable = tile.drawable;
        if (!drawable)
            return;
        tile.drawable = undefined;
        TileBatch.release(this.scene.getEngine(), drawable);
    }
}
//# sourceMappingURL=GlobeTraffic.js.map