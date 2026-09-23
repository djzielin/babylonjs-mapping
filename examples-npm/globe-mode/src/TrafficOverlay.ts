import { Color3, Vector3 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { GlobeSet, MapLayerRenderer } from "babylonjs-mapping";
import { trailingPoint } from "../../../examples-shared/TrafficIcon";

type TrafficSnapshot = {
    roads: { name: string; speedMph: number | null; path: { latitude: number; longitude: number }[] }[];
    aircraft: { callsign: string; latitude: number; longitude: number; altitudeMeters: number | null; heading: number | null }[];
    ships: { name: string; latitude: number; longitude: number; heading: number | null }[];
    errors?: Record<string,string>; sources?: Record<string,string>;
};

/** Small, disposable globe overlay driven by the dedicated traffic demo's API. */
export class TrafficOverlay {
    private meshes: AbstractMesh[] = [];
    private enabled = false;
    private timer?: ReturnType<typeof setInterval>;
    private readonly roadMaterials: StandardMaterial[];
    private readonly aircraftTrail: StandardMaterial;
    private readonly shipWake: StandardMaterial;

    constructor(private readonly scene: Scene, private readonly globe: GlobeSet, private readonly layers: MapLayerRenderer, private readonly status: HTMLElement, private readonly endpoint: () => string) {
        this.roadMaterials = [new Color3(.91,.47,.40), new Color3(.91,.73,.40), new Color3(.45,.84,.64), new Color3(.47,.53,.58)]
            .map((color, band) => this.markerMaterial(`Road speed band ${band}`, color));
        this.aircraftTrail = this.markerMaterial("Aircraft trail", new Color3(.39,.79,1));
        this.aircraftTrail.alpha = .55;
        this.shipWake = this.markerMaterial("Ship wake", new Color3(.7,.54,1));
        this.shipWake.alpha = .55;
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
        const mesh = MeshBuilder.CreateLines(name, { points: outline.map(([x,y]) => new Vector3(x * size / 2, y * size / 2, 0)) }, this.scene);
        mesh.color = kind === "aircraft" ? new Color3(.3,.78,1) : new Color3(.69,.45,1);
        mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        return mesh;
    }

    setEnabled(enabled: boolean): void {
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
            mesh.isPickable = false;
            this.meshes.push(mesh);
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
            mesh.isPickable = false;
            this.meshes.push(mesh);
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
        this.status.textContent = `NYC road links ${data.roads.length} · aircraft ${data.aircraft.length} · vessels ${data.ships.length}${errors.length ? ` · ${errors.join(" · ")}` : ""}${data.sources?.ships === "AISStream key required" ? " · AIS key required" : ""}`;
    }

    async refresh(): Promise<void> {
        const url = this.endpoint();
        if (!url) { this.status.textContent = "Enter the traffic API URL to show live feeds"; return; }
        this.status.textContent = "Loading traffic feeds…";
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json() as TrafficSnapshot;
            if (this.enabled) this.draw(data);
        } catch (error) {
            if (this.enabled) this.status.textContent = `Traffic feeds unavailable: ${String(error)}`;
        }
    }

    dispose(): void {
        this.setEnabled(false);
        for (const material of this.roadMaterials) material.dispose();
        this.aircraftTrail.dispose();
        this.shipWake.dispose();
    }
}
