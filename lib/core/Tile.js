import { Vector3 } from "@babylonjs/core/Maths/math.js";
import { BoundingBox } from "@babylonjs/core/Culling/boundingBox.js";
//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";
export default class Tile {
    constructor(mesh, tileSet) {
        this.mesh = mesh;
        this.tileSet = tileSet;
        //////////////////////////////////
        // BUILDINGS
        //////////////////////////////////
        this.buildings = [];
        this.mergedBuildingMesh = undefined;
        this.terrainLoaded = false;
        this.eastSeamFixed = false;
        this.northSeamFixed = false;
        this.northEastSeamFixed = false;
        this.terrainLODMeshes = [];
        this.refreshBoundingBox();
    }
    /** Refresh world-space bounds after moving a tile, including frozen meshes. */
    refreshBoundingBox() {
        const wasFrozen = this.mesh.isWorldMatrixFrozen;
        this.mesh.unfreezeWorldMatrix();
        this.mesh.computeWorldMatrix(true);
        const bounds = this.mesh.getBoundingInfo().boundingBox;
        this.box2D = new BoundingBox(new Vector3(bounds.minimumWorld.x, -1, bounds.minimumWorld.z), new Vector3(bounds.maximumWorld.x, 1, bounds.maximumWorld.z));
        if (wasFrozen)
            this.mesh.freezeWorldMatrix();
    }
    deleteBuildings() {
        for (let m of this.buildings) {
            m.dispose();
        }
        this.buildings = [];
        if (this.mergedBuildingMesh !== undefined) {
            this.mergedBuildingMesh.dispose();
            this.mergedBuildingMesh = undefined;
        }
    }
    clearTerrainLOD() {
        for (const lodMesh of this.terrainLODMeshes) {
            this.mesh.removeLODLevel(lodMesh);
            lodMesh?.dispose();
        }
        this.terrainLODMeshes = [];
    }
    hideIndividualBuildings() {
        for (let m of this.buildings) {
            m.mesh.setEnabled(false);
        }
    }
    getAllBuildingMeshes() {
        const ourMeshes = [];
        for (let b of this.buildings) {
            ourMeshes.push(b.mesh);
        }
        return ourMeshes;
    }
    isBuildingInsideTileBoundingBox(m) {
        const bounds = m.getBoundingInfo().boundingBox;
        for (const v of bounds.vectorsWorld) {
            if (!this.box2D.intersectsPoint(new Vector3(v.x, 0, v.z))) {
                return false;
            }
        }
        return true;
    }
}
//# sourceMappingURL=Tile.js.map