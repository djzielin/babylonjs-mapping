import { Vector3 } from "@babylonjs/core/Maths/math";
import { BoundingBox } from "@babylonjs/core/Culling/boundingBox";
import { MeshBuilder } from "@babylonjs/core";
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
        mesh.computeWorldMatrix(true); //we were previously missing this, which caused a bug in the computation of the tile bounds! 
        const originalBox = mesh.getBoundingInfo().boundingBox;
        const originalMin = originalBox.minimumWorld;
        const originalMax = originalBox.maximumWorld;
        const newMin = new Vector3(originalMin.x, -1, originalMin.z);
        const newMax = new Vector3(originalMax.x, 1, originalMax.z);
        this.box2D = new BoundingBox(newMin, newMax);
        //code for debugging the tile bounds
        /*const p1 = new Vector3(originalMin.x, 0, originalMin.z);
        const p2 = new Vector3(originalMax.x, 0, originalMax.z);
        const p3 = new Vector3(originalMin.x, 0, originalMax.z);
        const p4 = new Vector3(originalMax.x, 0, originalMin.z);

        this.makeSphere(p1, this.mesh.name + " p1");
        this.makeSphere(p2, this.mesh.name + " p2");
        this.makeSphere(p3, this.mesh.name + " p3");
        this.makeSphere(p4, this.mesh.name + " p4");
        */
    }
    makeSphere(p, name) {
        const sphere = MeshBuilder.CreateSphere("sphere", { diameter: 1.0 }, this.tileSet.scene);
        sphere.position = p;
        sphere.name = name;
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