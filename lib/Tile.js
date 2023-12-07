import { Vector3 } from "@babylonjs/core/Maths/math";
import { BoundingBox } from "@babylonjs/core/Culling/boundingBox";
//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";
export default class Tile {
    constructor(mesh) {
        this.mesh = mesh;
        //////////////////////////////////
        // BUILDINGS
        //////////////////////////////////
        this.buildings = [];
        this.mergedBuildingMesh = undefined;
        this.terrainLoaded = false;
        this.eastSeamFixed = false;
        this.northSeamFixed = false;
        this.northEastSeamFixed = false;
        const originalBox = mesh.getBoundingInfo().boundingBox;
        const originalMin = originalBox.minimumWorld;
        const originalMax = originalBox.maximumWorld;
        const newMin = new Vector3(originalMin.x, -1, originalMin.z);
        const newMax = new Vector3(originalMax.x, 1, originalMax.z);
        this.box2D = new BoundingBox(newMin, newMax);
    }
    deleteBuildings() {
        for (let m of this.buildings) {
            m.dispose();
        }
        this.buildings = [];
        if (this.mergedBuildingMesh !== undefined) {
            this.mergedBuildingMesh.dispose();
        }
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
        const b = m.getBoundingInfo();
        return true;
    }
}
//# sourceMappingURL=Tile.js.map