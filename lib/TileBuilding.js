import { Vector3 } from "@babylonjs/core/Maths/math";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
export default class TileBuilding {
    constructor(mesh, tile) {
        this.mesh = mesh;
        this.tile = tile;
        this.isBBoxContainedOnTile = false;
        this.ShapeType = "";
        this.LineSegments = [];
        this.verticies = [];
        this.tm = this.tile.tileSet.ourTileMath;
        this.getVerticies();
        this.computeBuildingBoxInsideTile();
    }
    computeLineSegments() {
        const ext = this.tile.tileSet.streetExtensionAmount;
        for (let singleArray of this.LineArray) {
            for (let i = 0; i < singleArray.length - 1; i++) {
                let p1 = this.tm.v3_to_v2(singleArray[i]);
                let p2 = this.tm.v3_to_v2(singleArray[i + 1]);
                if (i == 0) { //first coordinate
                    const dir = p1.subtract(p2);
                    const dirNormalized = dir.normalizeToNew();
                    const extensionVec = dirNormalized.multiplyByFloats(ext, ext);
                    p1 = p1.add(extensionVec); //push p1 back just a bit
                }
                if (i == singleArray.length - 2) { //last coordinate
                    const dir = p2.subtract(p1);
                    const dirNormalized = dir.normalizeToNew();
                    const extensionVec = dirNormalized.multiplyByFloats(ext, ext);
                    p2 = p2.add(extensionVec); //push p2 forward just a bit
                }
                const segment = {
                    p1: p1,
                    p2: p2
                };
                this.LineSegments.push(segment);
            }
        }
    }
    computeDir(seg) {
        const v1 = seg.p1;
        const v2 = seg.p2;
        return v2.subtract(v1).normalize();
    }
    findLineIntersectionPoint(otherStreet) {
        const tm = this.tile.tileSet.ourTileMath;
        for (let l1_segment of this.LineSegments) {
            for (let l2_segment of otherStreet.LineSegments) {
                const result = tm.line_segment_intersect(l1_segment.p1, l1_segment.p2, l2_segment.p1, l2_segment.p2);
                if (result) {
                    const result_v2 = result;
                    return {
                        p: this.tm.v2_to_v3(result_v2),
                        dir1: this.tm.v2_to_v3(this.computeDir(l1_segment)),
                        dir2: this.tm.v2_to_v3(this.computeDir(l2_segment))
                    };
                }
            }
        }
        return false;
    }
    dispose() {
        this.mesh.dispose();
        this.verticies = [];
    }
    //https://forum.babylonjs.com/t/is-there-any-way-to-get-the-vertices-of-a-given-mesh-facet-or-get-neighbouring-facets/19888/4
    getVerticies() {
        const vd = this.mesh.getVerticesData(VertexBuffer.PositionKind);
        if (vd === null) {
            return;
        }
        const worldMatrix = this.mesh.getWorldMatrix();
        for (var i = 0; i < vd.length; i += 3) {
            const x = vd[i + 0];
            const y = vd[i + 1];
            const z = vd[+2];
            const localVector = new Vector3(x, y, z);
            const worldVector = Vector3.TransformCoordinates(localVector, worldMatrix);
            this.verticies.push(worldVector);
        }
    }
    computeBuildingBoxInsideTile() {
        console.log("trying to compute if: " + this.mesh.name + " is completely inside tile: " + this.tile.mesh.name);
        const mBounds = this.mesh.getBoundingInfo().boundingBox;
        let bboxPointsInsideTile = 0;
        for (let v of mBounds.vectorsWorld) {
            const vNoY = new Vector3(v.x, 0, v.z);
            /*if(this.mesh.name.includes("Lewis")){ //from when we were troubleshooting the bounds calc in Tile.ts
                const sphere = MeshBuilder.CreateSphere("sphere", { diameter: 0.25 },this.tile.tileSet.scene);
                sphere.position=vNoY;
            }*/
            if (this.tile.box2D.intersectsPoint(vNoY)) {
                bboxPointsInsideTile++;
            }
        }
        if (bboxPointsInsideTile == 8) {
            this.isBBoxContainedOnTile = true;
        }
        else {
            this.isBBoxContainedOnTile = false;
        }
    }
    doVerticesMatch(otherBuilding) {
        if (this.verticies.length != otherBuilding.verticies.length) {
            return false;
        }
        let accumulatedError = 0.0;
        for (let i = 0; i < this.verticies.length; i++) {
            const v1 = this.verticies[i];
            const v2 = otherBuilding.verticies[i];
            const diffVector = v1.subtract(v2);
            const length = diffVector.length();
            accumulatedError += length;
        }
        //console.log("accumulated error for: " + this.mesh.name + ": " + accumulatedError);
        if (accumulatedError < 0.00001) {
            return true;
        }
        return false;
    }
}
//# sourceMappingURL=TileBuilding.js.map