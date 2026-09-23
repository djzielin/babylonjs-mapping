import { Color3, Vector3 } from "@babylonjs/core/Maths/math";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { GlobeSet, MapLayerRenderer } from "babylonjs-mapping";

type TrafficSnapshot = {
    roads: { name: string; speedMph: number | null; path: { latitude: number; longitude: number }[] }[];
    aircraft: { callsign: string; latitude: number; longitude: number; altitudeMeters: number | null }[];
    ships: { name: string; latitude: number; longitude: number }[];
    errors?: Record<string,string>; sources?: Record<string,string>;
};

/** Small, disposable globe overlay driven by the dedicated traffic demo's API. */
export class TrafficOverlay {
    private meshes: AbstractMesh[] = [];
    private enabled = false;
    private timer?: ReturnType<typeof setInterval>;
    private readonly aircraftMaterial: StandardMaterial;
    private readonly shipMaterial: StandardMaterial;
    private readonly roadMaterials: StandardMaterial[];

    constructor(private readonly scene: Scene, private readonly globe: GlobeSet, private readonly layers: MapLayerRenderer, private readonly status: HTMLElement, private readonly endpoint: () => string) {
        this.aircraftMaterial = this.markerMaterial("Aircraft", new Color3(.45, .82, 1));
        this.shipMaterial = this.markerMaterial("Ships", new Color3(.72, .59, 1));
        this.roadMaterials = [new Color3(.91,.47,.40), new Color3(.91,.73,.40), new Color3(.45,.84,.64), new Color3(.47,.53,.58)]
            .map((color, band) => this.markerMaterial(`Road speed band ${band}`, color));
    }

    private markerMaterial(name: string, color: Color3): StandardMaterial {
        const material = new StandardMaterial(name, this.scene);
        material.diffuseColor = color;
        material.emissiveColor = color;
        material.disableLighting = true;
        material.specularColor = Color3.Black();
        return material;
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
        for (const aircraft of data.aircraft) {
            const mesh = MeshBuilder.CreateSphere(`Aircraft: ${aircraft.callsign}`, { diameter: .012 }, this.scene);
            mesh.position.copyFrom(this.surface(aircraft.latitude, aircraft.longitude, Math.max(500, aircraft.altitudeMeters ?? 500)));
            mesh.material = this.aircraftMaterial;
            mesh.isPickable = false;
            this.layers.add(mesh, 7);
            this.meshes.push(mesh);
        }
        for (const ship of data.ships) {
            const mesh = MeshBuilder.CreateSphere(`Ship: ${ship.name}`, { diameter: .01 }, this.scene);
            mesh.position.copyFrom(this.surface(ship.latitude, ship.longitude, 120));
            mesh.material = this.shipMaterial;
            mesh.isPickable = false;
            this.layers.add(mesh, 7);
            this.meshes.push(mesh);
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
        this.aircraftMaterial.dispose();
        this.shipMaterial.dispose();
        for (const material of this.roadMaterials) material.dispose();
    }
}
