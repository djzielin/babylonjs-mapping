import { describe, expect, it, vi } from "vitest";
import { MeshBuilder, NullEngine, Scene, UniversalCamera, Vector3 } from "@babylonjs/core";
import Buildings, { BuildingRequestType } from "../src/buildings/Buildings";
import { RetrievalLocation } from "../src/shared/Retrieval";
import { EPSG_Type } from "../src/core/TileMath";
import type TileSet from "../src/core/TileSet";

class Provider extends Buildings {
    SubmitLoadTileRequest(): void {}
    SubmitLoadAllRequest(): void {}
    setQueue(queue: any[]): void { this.buildingRequests = queue; }
}
const setup = () => {
    const engine = new NullEngine(); const scene = new Scene(engine);
    const provider = new Provider("test", { scene } as TileSet, RetrievalLocation.Local);
    return { engine, scene, provider };
};

describe("building scheduling", () => {
    it("prioritizes tiles without recomputing a world matrix for every feature", () => {
        const { scene, engine, provider } = setup();
        scene.activeCamera = new UniversalCamera("camera", Vector3.Zero(), scene);
        const far = { mesh: MeshBuilder.CreateGround("far", {}, scene) };
        const near = { mesh: MeshBuilder.CreateGround("near", {}, scene) };
        far.mesh.position.x = 100; far.mesh.freezeWorldMatrix(); near.mesh.freezeWorldMatrix();
        const compute = vi.spyOn(far.mesh, "computeWorldMatrix");
        const revision = far.mesh.getWorldMatrix().updateFlag;
        provider.optimizationOptions.prioritizeRequestsByDistance = true;
        provider.setQueue([
            ...Array.from({ length: 10000 }, () => ({ tile: far, requestType: BuildingRequestType.CreateBuilding })),
            { tile: near, requestType: BuildingRequestType.MergeAllBuildingsOnTile },
            { tile: near, requestType: BuildingRequestType.CreateBuilding },
        ]);
        expect((provider as any).selectBuildingRequestIndex()).toBe(10001);
        expect(compute.mock.calls.length).toBeLessThan(5);
        expect(compute.mock.calls.every(call => call[0] !== true)).toBe(true);
        expect(far.mesh.getWorldMatrix().updateFlag).toBe(revision);
        scene.dispose(); engine.dispose();
    });
    it("shares the generation budget across providers and renews it on the next frame", () => {
        const { scene, engine, provider } = setup();
        const other = new Provider("other", { scene } as TileSet, RetrievalLocation.Local);
        provider.setQueue([{}]); other.setQueue([{}]);
        let now = 0, frame = 1;
        const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
        const frameId = vi.spyOn(scene, "getFrameId").mockImplementation(() => frame);
        const first = vi.spyOn(provider as any, "processBuildingRequestsWithinBudget").mockImplementation(() => { now += 1.1; });
        const second = vi.spyOn(other as any, "processBuildingRequestsWithinBudget").mockImplementation(() => { now += 0.1; });
        try {
            Buildings.setSceneCreationTimeBudget(scene, 1);
            provider.processBuildingRequests(); other.processBuildingRequests();
            expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled();
            frame++;
            other.processBuildingRequests();
            expect(second).toHaveBeenCalledOnce();
            expect(() => Buildings.setSceneCreationTimeBudget(scene, 0)).toThrow();
        } finally { clock.mockRestore(); frameId.mockRestore(); scene.dispose(); engine.dispose(); }
    });
    it("filters covered source features before enqueueing geometry while retaining the merge", () => {
        const { scene, engine, provider } = setup();
        const tile = { mesh: MeshBuilder.CreateGround("tile", {}, scene), tileCoords: new Vector3(1, 1, 2) };
        const features = ["covered", "visible"].map(id => ({ id, type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [] } }));
        provider.doMerge = true;
        provider.buildingFeatureFilter = feature => feature.id === "visible";
        provider.ProcessGeoJSON({ tile, tileCoords: tile.tileCoords.clone(), epsgType: EPSG_Type.EPSG_4326 } as any,
            { type: "FeatureCollection", features } as any);
        expect(provider.pendingRequestCount).toBe(2);
        expect((provider as any).buildingRequests[0].feature.id).toBe("visible");
        expect((provider as any).buildingRequests[1].requestType).toBe(BuildingRequestType.MergeAllBuildingsOnTile);
        scene.dispose(); engine.dispose();
    });

});
