import { Color3, Vector3 } from "@babylonjs/core/Maths/math";
import { Constants } from "@babylonjs/core/Engines/constants";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RenderingManager } from "@babylonjs/core/Rendering/renderingManager";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { GlobeSet, MapLayerRenderer } from "babylonjs-mapping";
import { trailingPoint } from "../../../examples-shared/TrafficIcon";

import { orientTrafficIcon } from "../../../examples-shared/TrafficIconOrientation";

type TrafficSnapshot = {
    roads: { name: string; speedMph: number | null; path: { latitude: number; longitude: number }[] }[];
    aircraft: { callsign: string; latitude: number; longitude: number; altitudeMeters: number | null; heading: number | null }[];
    ships: { name: string; latitude: number; longitude: number; heading: number | null }[];
    errors?: Record<string,string>; sources?: Record<string,string>;
};

/** Small, disposable globe overlay driven by the dedicated traffic demo's API. */
export class TrafficOverlay {
    private meshes: AbstractMesh[] = [];
    private symbols: Mesh[] = [];
    private movingIcons: { mesh: Mesh; behind: Vector3 }[] = [];
    private enabled = false;
    private disposed = false;
    private requestGeneration = 0;
    private request?: AbortController;
    private readonly visibilityObserver;
    private timer?: ReturnType<typeof setInterval>;
    private readonly roadMaterials: StandardMaterial[];
    private readonly aircraftTrail: StandardMaterial;
    private readonly shipWake: StandardMaterial;

    constructor(private readonly scene: Scene, private readonly globe: GlobeSet, private readonly layers: MapLayerRenderer, private readonly status: HTMLElement, private readonly endpoint: () => string, private readonly symbolRenderingGroup = 9) {
        // Draw badges after every map layer; coarse fallback terrain renders last.
        RenderingManager.MAX_RENDERINGGROUPS = Math.max(RenderingManager.MAX_RENDERINGGROUPS, symbolRenderingGroup + 1);
        scene.setRenderingAutoClearDepthStencil(symbolRenderingGroup, false);
        this.roadMaterials = [new Color3(.91,.47,.40), new Color3(.91,.73,.40), new Color3(.45,.84,.64), new Color3(.47,.53,.58)]
            .map((color, band) => this.markerMaterial(`Road speed band ${band}`, color));
        this.aircraftTrail = this.markerMaterial("Aircraft trail", new Color3(.39,.79,1));
        this.aircraftTrail.alpha = .55;
        this.shipWake = this.markerMaterial("Ship wake", new Color3(.7,.54,1));
        this.shipWake.alpha = .55;
        this.visibilityObserver = scene.onBeforeRenderObservable.add(() => this.updateSymbolVisibility());
    }

    private markerMaterial(name: string, color: Color3): StandardMaterial {
        const material = new StandardMaterial(name, this.scene);
        material.diffuseColor = color;
        material.emissiveColor = color;
        material.disableLighting = true;
        material.specularColor = Color3.Black();
        return material;
    }

    private symbol(name: string, kind: "aircraft" | "ship", size: number): Mesh {
        const outline = kind === "aircraft"
            ? [[0,-1], [.16,-.22], [.9,.24], [.9,.4], [.15,.2], [.12,.74], [.36,.92], [.36,1], [0,.86], [-.36,1], [-.36,.92], [-.12,.74], [-.15,.2], [-.9,.4], [-.9,.24], [-.16,-.22], [0,-1]]
            : [[0,-1], [.58,-.3], [.45,.65], [0,.95], [-.45,.65], [-.58,-.3], [0,-1]];
        const mesh = MeshBuilder.CreateLines(name, { points: outline.map(([x,y]) => new Vector3(x * size / 2, -y * size / 2, 0)) }, this.scene);
        mesh.color = kind === "aircraft" ? new Color3(.3,.78,1) : new Color3(.69,.45,1);
        mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        mesh.renderingGroupId = this.symbolRenderingGroup;
        if (mesh.material) {
            mesh.material.depthFunction = Constants.ALWAYS;
            mesh.material.disableDepthWrite = true;
        }
        return mesh;
    }

    private updateSymbolVisibility(): void {
        const eye = this.scene.activeCamera?.globalPosition;
        if (!eye) return;
        for (const { mesh, behind } of this.movingIcons) orientTrafficIcon(mesh, behind);
        const radiusSquared = this.globe.radius ** 2;
        for (const symbol of this.symbols) {
            // Badges render over local terrain, but must never shine through Earth.
            // Test the whole sight line so aircraft above the limb remain visible.
            const direction = symbol.position.subtract(eye);
            const lengthSquared = direction.lengthSquared();
            const t = lengthSquared ? -Vector3.Dot(eye, direction) / lengthSquared : 0;
            const blocked = t > 0 && t < 1 &&
                eye.add(direction.scale(t)).lengthSquared() < radiusSquared * (1 - 1e-12);
            symbol.setEnabled(!blocked);
        }
    }

    private cancelRequest(): void {
        this.requestGeneration++;
        this.request?.abort();
        this.request = undefined;
    }

    setEnabled(enabled: boolean): void {
        if (this.disposed) return;
        this.cancelRequest();
        this.enabled = enabled;
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        if (!enabled) {
            this.clear();
            this.status.textContent = "Traffic feeds off";
            return;
        }
        void this.refresh();
        this.timer = setInterval(() => void this.refresh(), 60_000);
    }

    private clear(): void {
        for (const mesh of this.meshes) mesh.dispose();
        this.meshes.length = 0;
        this.symbols.length = 0;
        this.movingIcons.length = 0;
    }

    private surface(latitude: number, longitude: number, clearanceMeters: number): Vector3 {
        return this.globe.getSurfacePosition(latitude, longitude,
            this.globe.sampleElevation(latitude, longitude) + clearanceMeters * this.globe.metresToWorld);
    }

    private draw(data: TrafficSnapshot): void {
        this.clear();
        const roadMeshes: Mesh[][] = [[], [], [], []];
        for (const road of data.roads) {
            if (road.path.length < 2) continue;
            const points = road.path.map(point => this.surface(point.latitude, point.longitude, 180));
            const band = road.speedMph === null ? 3 : road.speedMph < 20 ? 0 : road.speedMph < 40 ? 1 : 2;
            const mesh = MeshBuilder.CreateTube(`Traffic: ${road.name}`, { path: points, radius: .0005, tessellation: 4 }, this.scene);
            mesh.material = this.roadMaterials[band];
            roadMeshes[band].push(mesh);
        }
        for (let band = 0; band < 4; band++) if (roadMeshes[band].length) {
            const mesh = Mesh.MergeMeshes(roadMeshes[band], true, true);
            if (!mesh) continue;
            mesh.name = `Traffic speed band ${band}`;
            mesh.material = this.roadMaterials[band];
            mesh.isPickable = false;
            this.layers.add(mesh, 7);
            this.meshes.push(mesh);
        }
        const aircraftTrails: Mesh[] = [];
        for (const aircraft of data.aircraft) {
            const altitude = Math.max(500, aircraft.altitudeMeters ?? 500);
            if (aircraft.heading !== null) {
                const behind = trailingPoint(aircraft.latitude, aircraft.longitude, aircraft.heading, .018);
                const trail = MeshBuilder.CreateTube(`Aircraft trail: ${aircraft.callsign}`, {
                    path: [this.surface(behind.latitude, behind.longitude, altitude), this.surface(aircraft.latitude, aircraft.longitude, altitude)],
                    radius: .00016, tessellation: 4,
                }, this.scene);
                trail.material = this.aircraftTrail;
                aircraftTrails.push(trail);
            }
            const mesh = this.symbol(`Aircraft: ${aircraft.callsign}`, "aircraft", .027);
            mesh.position.copyFrom(this.surface(aircraft.latitude, aircraft.longitude, altitude));
            if (aircraft.heading !== null) {
                const behind = trailingPoint(aircraft.latitude, aircraft.longitude, aircraft.heading, .018);
                this.movingIcons.push({ mesh, behind: this.surface(behind.latitude, behind.longitude, altitude) });
            }
            mesh.isPickable = false;
            this.meshes.push(mesh);
            this.symbols.push(mesh);
        }
        if (aircraftTrails.length) {
            const trails = Mesh.MergeMeshes(aircraftTrails, true, true);
            if (trails) {
                trails.material = this.aircraftTrail;
                trails.isPickable = false;
                this.layers.add(trails, 7);
                this.meshes.push(trails);
            }
        }
        const shipWakes: Mesh[] = [];
        for (const ship of data.ships) {
            if (ship.heading !== null) for (const offset of [-18, 18]) {
                const behind = trailingPoint(ship.latitude, ship.longitude, ship.heading + offset, .01);
                const wake = MeshBuilder.CreateTube(`Ship wake: ${ship.name}`, {
                    path: [this.surface(behind.latitude, behind.longitude, 120), this.surface(ship.latitude, ship.longitude, 120)],
                    radius: .00013, tessellation: 4,
                }, this.scene);
                wake.material = this.shipWake;
                shipWakes.push(wake);
            }
            const mesh = this.symbol(`Ship: ${ship.name}`, "ship", .025);
            mesh.position.copyFrom(this.surface(ship.latitude, ship.longitude, 120));
            if (ship.heading !== null) {
                const behind = trailingPoint(ship.latitude, ship.longitude, ship.heading, .01);
                this.movingIcons.push({ mesh, behind: this.surface(behind.latitude, behind.longitude, 120) });
            }
            mesh.isPickable = false;
            this.meshes.push(mesh);
            this.symbols.push(mesh);
        }
        if (shipWakes.length) {
            const wakes = Mesh.MergeMeshes(shipWakes, true, true);
            if (wakes) {
                wakes.material = this.shipWake;
                wakes.isPickable = false;
                this.layers.add(wakes, 7);
                this.meshes.push(wakes);
            }
        }
        const errors = Object.values(data.errors ?? {});
        this.updateSymbolVisibility();
        this.status.textContent = `NYC road links ${data.roads.length} · aircraft ${data.aircraft.length} · vessels ${data.ships.length}${errors.length ? ` · ${errors.join(" · ")}` : ""}${data.sources?.ships === "AISStream key required" ? " · AIS key required" : ""}`;
    }

    async refresh(): Promise<void> {
        if (!this.enabled || this.disposed) return;
        this.cancelRequest();
        const generation = this.requestGeneration;
        const url = this.endpoint();
        if (!url) { this.status.textContent = "Enter the traffic API URL to show live feeds"; return; }
        const request = new AbortController();
        this.request = request;
        const isCurrent = () => this.enabled && !this.disposed &&
            generation === this.requestGeneration && url === this.endpoint();
        this.status.textContent = "Loading traffic feeds…";
        try {
            const response = await fetch(url, { signal: request.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json() as TrafficSnapshot;
            if (isCurrent()) this.draw(data);
        } catch (error) {
            if (isCurrent()) this.status.textContent = `Traffic feeds unavailable: ${String(error)}`;
        } finally {
            if (this.request === request) this.request = undefined;
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.setEnabled(false);
        this.disposed = true;
        this.scene.onBeforeRenderObservable.remove(this.visibilityObserver);
        for (const material of this.roadMaterials) material.dispose();
        this.aircraftTrail.dispose();
        this.shipWake.dispose();
    }
}
