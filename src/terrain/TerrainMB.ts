import { Scene } from "@babylonjs/core/scene.js";
import { Vector2 } from "@babylonjs/core/Maths/math.js";
import { Vector3 } from "@babylonjs/core/Maths/math.js";
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import type { FloatArray } from "@babylonjs/core/types.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type Tile from '../core/Tile';
import type TileSet from "../core/TileSet.js";

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

export default class TerrainMB {
    private mbServer: string = "https://api.mapbox.com/v4/";

    public globalMinHeight = Number.POSITIVE_INFINITY;
    private index = 0;
    public accessToken: string = "";
    private heightScaleFixer=0;
    private skuToken: string="";
    //public onAllLoaded: Observable<boolean> = new Observable();

    constructor(public tileSet: TileSet, private scene: Scene) {
        if(this.tileSet){
            if(this.tileSet.ourTileMath){
                console.log("we seem to be able to access tileMath here");

            } else{
                console.error("unable to access tileMath!");
            }
        } else{
            console.error("unable to access tileSet!");
        }  
        this.skuToken = this.tileSet.ourTileMath.generateSKU();
          
    }  

    public setExaggeration(tileScale: number, exaggeration: number) {
        this.heightScaleFixer = tileScale * exaggeration;
    }

    //based on code from
    //https://www.babylonjs-playground.com/#DXARSP#30
    private GetAsyncTexture (url: string) : Promise<Texture> {
        return new Promise((resolve, reject) => {
            var texture = new Texture(url, this.scene, true, false, Texture.NEAREST_SAMPLINGMODE, function() {
                console.log("loading texture success!");
                resolve(texture);
            }, function(message) {
                reject(message);
            });    
        })
    }

    public async updateAllTerrainTiles(exaggeration: number): Promise<void> {
        this.setExaggeration(this.tileSet.ourTileMath.computeTileScale(), exaggeration);
        this.globalMinHeight = Number.POSITIVE_INFINITY;

        await Promise.all(this.tileSet.ourTiles.map((tile) => this.updateSingleTerrainTile(tile)));

        //Fix Seams Here
        /*for (let t of this.ourTiles) {
            for (let t2 of this.ourTiles) {
                if ((t.tileCoords.x == (t2.tileCoords.x - 1)) && (t.tileCoords.y == t2.tileCoords.y)) {
                    if (t.eastSeamFixed == false) {
                        this.ourMB.fixEastSeam(t,t2);
                    }
                }
                if ((t.tileCoords.x == t2.tileCoords.x) && (t.tileCoords.y == (t2.tileCoords.y+1))) {
                    if (t.northSeamFixed == false) {
                        this.ourMB.fixNorthSeam(t,t2);
                    }
                }
                if ((t.tileCoords.x == (t2.tileCoords.x - 1)) && (t.tileCoords.y == (t2.tileCoords.y+1))) {
                    if (t.northEastSeamFixed == false) {
                        this.ourMB.fixNorthEastSeam(t,t2);
                    }
                }
            }
        }
        */
        //this.ourMB.getTileTerrain(this.ourTiles[0]); //just one for testing
    }

    public setupTerrainLOD(precisions: number[], distances: number[], skirtDepth = this.tileSet.tileWidth): void {
        this.validateTerrainLOD(precisions, distances, skirtDepth);

        for (const tile of this.tileSet.ourTiles) {
            if (!tile.terrainLoaded) {
                throw new Error("Cannot set up terrain LOD before every tile has loaded terrain.");
            }
        }

        for (const tile of this.tileSet.ourTiles) {
            tile.clearTerrainLOD();

            for (let levelIndex = 0; levelIndex < precisions.length; levelIndex++) {
                const precision = precisions[levelIndex];
                const distance = distances[levelIndex];

                if (precision === 0) {
                    tile.mesh.addLODLevel(distance, null);
                    tile.terrainLODMeshes.push(null);
                    continue;
                }

                const lodMesh = this.tileSet.makeSingleTileMesh(0, 0, precision);
                // Keep the LOD under the master tile so endless-tile movement
                // moves every terrain level together. The generated ground is
                // centered at the origin, so zero is the correct local offset.
                lodMesh.setParent(tile.mesh);
                lodMesh.position.set(0, 0, 0);
                lodMesh.name = `${tile.mesh.name}_LOD_${precision}`;
                lodMesh.material = tile.material;
                lodMesh.isPickable = false;

                this.applyDetailedTerrainToMesh(lodMesh, tile, precision);
                this.addTerrainSkirt(lodMesh, precision, skirtDepth);

                tile.mesh.addLODLevel(distance, lodMesh);
                tile.terrainLODMeshes.push(lodMesh);
            }
        }
    }

    private validateTerrainLOD(precisions: number[], distances: number[], skirtDepth: number): void {
        if (precisions.length === 0 || precisions.length !== distances.length) {
            throw new RangeError("Terrain LOD precisions and distances must be non-empty arrays of equal length.");
        }
        if (!Number.isFinite(skirtDepth) || skirtDepth <= 0) {
            throw new RangeError("Terrain LOD skirtDepth must be a finite number greater than zero.");
        }

        for (let index = 0; index < precisions.length; index++) {
            const precision = precisions[index];
            const distance = distances[index];

            if (!Number.isInteger(precision) || precision < 0 || precision >= this.tileSet.meshPrecision) {
                throw new RangeError(`Terrain LOD precision at index ${index} must be an integer from 0 to ${this.tileSet.meshPrecision - 1}.`);
            }
            if (!Number.isFinite(distance) || distance <= 0 || (index > 0 && distance <= distances[index - 1])) {
                throw new RangeError("Terrain LOD distances must be finite, greater than zero, and strictly increasing.");
            }
            if (precision === 0 && index !== precisions.length - 1) {
                throw new RangeError("A terrain LOD precision of 0 must be the final level.");
            }
            if (index > 0 && precision !== 0 && precision >= precisions[index - 1]) {
                throw new RangeError("Terrain LOD precisions must strictly decrease with distance.");
            }
        }
    }

    private applyDetailedTerrainToMesh(lodMesh: Mesh, tile: Tile, precision: number): void {
        const sourcePositions = tile.mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;
        const lodPositions = lodMesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;
        const sourcePrecision = this.tileSet.meshPrecision;
        const lodSubdivisions = precision + 1;
        const sourceSubdivisions = sourcePrecision + 1;

        for (let y = 0; y < lodSubdivisions; y++) {
            for (let x = 0; x < lodSubdivisions; x++) {
                const sourceX = x * sourcePrecision / precision;
                const sourceY = y * sourcePrecision / precision;
                const x0 = Math.floor(sourceX);
                const x1 = Math.min(Math.ceil(sourceX), sourcePrecision);
                const y0 = Math.floor(sourceY);
                const y1 = Math.min(Math.ceil(sourceY), sourcePrecision);
                const tx = sourceX - x0;
                const ty = sourceY - y0;
                const height00 = sourcePositions[1 + (x0 + y0 * sourceSubdivisions) * 3];
                const height10 = sourcePositions[1 + (x1 + y0 * sourceSubdivisions) * 3];
                const height01 = sourcePositions[1 + (x0 + y1 * sourceSubdivisions) * 3];
                const height11 = sourcePositions[1 + (x1 + y1 * sourceSubdivisions) * 3];
                const topHeight = height00 + (height10 - height00) * tx;
                const bottomHeight = height01 + (height11 - height01) * tx;
                const lodIndex = 1 + (x + y * lodSubdivisions) * 3;

                lodPositions[lodIndex] = topHeight + (bottomHeight - topHeight) * ty;
            }
        }

        lodMesh.updateVerticesData(VertexBuffer.PositionKind, lodPositions);
    }

    private addTerrainSkirt(mesh: Mesh, precision: number, skirtDepth: number): void {
        const positions = Array.from(mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray);
        const normals = Array.from(mesh.getVerticesData(VertexBuffer.NormalKind) as FloatArray);
        const uvs = Array.from(mesh.getVerticesData(VertexBuffer.UVKind) as FloatArray);
        const indices = Array.from(mesh.getIndices() ?? []);
        const subdivisions = precision + 1;
        const boundary: number[] = [];

        for (let x = 0; x < subdivisions; x++) boundary.push(x);
        for (let y = 1; y < subdivisions; y++) boundary.push((subdivisions - 1) + y * subdivisions);
        for (let x = subdivisions - 2; x >= 0; x--) boundary.push(x + (subdivisions - 1) * subdivisions);
        for (let y = subdivisions - 2; y > 0; y--) boundary.push(y * subdivisions);

        const skirtTopStart = positions.length / 3;
        for (const vertexIndex of boundary) {
            positions.push(
                positions[vertexIndex * 3],
                positions[vertexIndex * 3 + 1],
                positions[vertexIndex * 3 + 2],
            );
            uvs.push(uvs[vertexIndex * 2], uvs[vertexIndex * 2 + 1]);
        }

        const skirtBottomStart = positions.length / 3;
        for (const vertexIndex of boundary) {
            positions.push(
                positions[vertexIndex * 3],
                positions[vertexIndex * 3 + 1] - skirtDepth,
                positions[vertexIndex * 3 + 2],
            );
            uvs.push(uvs[vertexIndex * 2], uvs[vertexIndex * 2 + 1]);
        }

        for (let index = 0; index < boundary.length; index++) {
            const next = (index + 1) % boundary.length;
            const topA = skirtTopStart + index;
            const topB = skirtTopStart + next;
            const bottomA = skirtBottomStart + index;
            const bottomB = skirtBottomStart + next;

            indices.push(topA, bottomA, topB, topB, bottomA, bottomB);
        }

        normals.length = positions.length;
        normals.fill(0);
        VertexData.ComputeNormals(positions, indices, normals);
        mesh.setVerticesData(VertexBuffer.PositionKind, positions, true);
        mesh.setVerticesData(VertexBuffer.NormalKind, normals, true);
        mesh.setVerticesData(VertexBuffer.UVKind, uvs, true);
        mesh.setIndices(indices);
        mesh.refreshBoundingInfo();
    }


    //https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-dem-v1/
    public async updateSingleTerrainTile(tile: Tile) {
        tile.clearTerrainLOD();
        tile.terrainLoaded=false;
        tile.eastSeamFixed = false;
        tile.northSeamFixed = false;
        tile.northEastSeamFixed = false;
        this.invalidateTileSeams(tile);

        if(tile.tileCoords.z>15 && this.tileSet.doTerrainResBoost==false){            
            console.log("DEM not supported beyond level 15 (if not doing res boost)");
            return;
        }
        if(tile.tileCoords.z>14 && this.tileSet.doTerrainResBoost==true){            
            console.log("DEM not supported beyond 14 (if doing res boost)");
            return;
        }

        const storedCoords=tile.tileCoords.clone();

        tile.dem = []; //to reclaim memory?

        const prefix = this.mbServer;
        const boostParam = this.tileSet.doTerrainResBoost ? "@2x" : "";

        //const mapType = "mapbox.terrain-rgb";
        const mapType = "mapbox.mapbox-terrain-dem-v1";

        const extension = ".pngraw";
        const skuParam = "?sku=" + this.skuToken;
        const accessParam = "&access_token=" + this.accessToken;
        const url = prefix + mapType + "/" + (tile.tileCoords.z) + "/" + (tile.tileCoords.x) + "/" + (tile.tileCoords.y) + boostParam + extension + skuParam + accessParam;

        console.log("trying to get: " + url);
       
        const ourTex: Texture = await this.GetAsyncTexture(url); //wait for loading to be complete

        if (!ourTex){
            console.error("unable to load terrain for: " + tile.tileCoords);
            return;
        }
        //console.log("terrain dimensions: " + tile.demDimensions);

        const bufferView = await ourTex.readPixels();

        if (!bufferView) {
            console.error("unable to read pixels from texture for terrain tile: " + tile.tileCoords);
        }

        const bufferUint: Uint8Array = new Uint8Array(bufferView!.buffer, bufferView!.byteOffset, bufferView!.byteLength);
        //console.log("terrain buffer dimensions: " + bufferUint.byteLength)

        if(tile.tileCoords.equals(storedCoords)==false){
            console.warn("looks like tile coords have changed already! bailing on this update for: " + tile.tileCoords);
            return;
        }

        tile.demDimensions = new Vector2(ourTex.getSize().width, ourTex.getSize().height);

        this.convertRGBtoDEM(bufferUint, tile);
        this.applyDEMToMesh(tile, this.tileSet.meshPrecision);

        tile.terrainLoaded=true;

        this.fixTileSeams();

        /*
        for(let t of this.tileSet.ourTiles){
            if(!t.terrainLoaded){
                return;
            }
        }

        this.onAllLoaded.notifyObservers(true);  */
    }

    /** Re-applies every available cardinal and diagonal seam. */
    public fixTileSeams() {
        for (const tile of this.tileSet.ourTiles) {
            if (!tile.terrainLoaded) {
                continue;
            }

            const upperTile = this.tileSet.ourTilesMap.get(
                new Vector3(tile.tileCoords.x, tile.tileCoords.y - 1, tile.tileCoords.z).toString(),
            );
            if (upperTile?.terrainLoaded) {
                this.fixNorthSeam(tile, upperTile);
            }

            const rightTile = this.tileSet.ourTilesMap.get(
                new Vector3(tile.tileCoords.x + 1, tile.tileCoords.y, tile.tileCoords.z).toString(),
            );
            if (rightTile?.terrainLoaded) {
                this.fixEastSeam(tile, rightTile);
            }

            const upperRightTile = this.tileSet.ourTilesMap.get(
                new Vector3(tile.tileCoords.x + 1, tile.tileCoords.y - 1, tile.tileCoords.z).toString(),
            );
            if (upperRightTile?.terrainLoaded) {
                this.fixNorthEastSeam(tile, upperRightTile);
            }
        }
    }

    private invalidateTileSeams(tile: Tile): void {
        // Seam state belongs to the tile on the south/west side. Clear the
        // neighboring flags too when a recycled tile gets new DEM data.
        const lowerTile = this.tileSet.ourTilesMap.get(
            new Vector3(tile.tileCoords.x, tile.tileCoords.y + 1, tile.tileCoords.z).toString(),
        );
        if (lowerTile) {
            lowerTile.northSeamFixed = false;
        }

        const leftTile = this.tileSet.ourTilesMap.get(
            new Vector3(tile.tileCoords.x - 1, tile.tileCoords.y, tile.tileCoords.z).toString(),
        );
        if (leftTile) {
            leftTile.eastSeamFixed = false;
        }

        const lowerLeftTile = this.tileSet.ourTilesMap.get(
            new Vector3(tile.tileCoords.x - 1, tile.tileCoords.y + 1, tile.tileCoords.z).toString(),
        );
        if (lowerLeftTile) {
            lowerLeftTile.northEastSeamFixed = false;
        }
    }

    //https://docs.mapbox.com/data/tilesets/guides/access-elevation-data/
    private convertRGBtoDEM(ourBuff: Uint8Array, tile: Tile) {
        var heightDEM: number[] = [];
        let maxHeight = Number.NEGATIVE_INFINITY;
        let minHeight = Number.POSITIVE_INFINITY;      

        for (let i = 0; i < ourBuff.length; i += 4) {
            //documentation: height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)

            const R = ourBuff[i + 0];
            const G = ourBuff[i + 1];
            const B = ourBuff[i + 2];
            //const A = image[i + 3]; //unused

            const height = -10000.0 + ((R * 256.0 * 256.0 + G * 256.0 + B) * 0.1);
            if (height > maxHeight) {
                maxHeight = height;
            }
            if (height < minHeight) {
                minHeight = height;
            }

            heightDEM.push(height);
        }
        console.log("  terrain ranges from : " + minHeight.toFixed(2) + " to " + maxHeight.toFixed(2));
        console.log("  height delta: " + (maxHeight - minHeight).toFixed(2));

        tile.dem = heightDEM;
        tile.minHeight = minHeight;
        tile.maxHeight = maxHeight;

        if(tile.minHeight<this.globalMinHeight){
            this.globalMinHeight=tile.minHeight;
        }
    }

    public applyDEMToMesh(tile: Tile, meshPrecision: number) {
        const positions = tile.mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;
        const subdivisions = meshPrecision + 1;

        for (let y = 0; y < subdivisions; y++) {
            for (let x = 0; x < subdivisions; x++) {
                const percent = new Vector2(x / (subdivisions - 1), y / (subdivisions - 1));
                const demIndex = this.computeIndexByPercent(percent, tile.demDimensions);                
                const height = (tile.dem[demIndex]) * this.heightScaleFixer;
                const meshIndex = 1 + (x + y * subdivisions) * 3;

                positions[meshIndex] = height;
            }
        }

        tile.mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
        tile.mesh.refreshBoundingInfo();
    }

    private computeIndexByPercent(percent: Vector2, maxPixel: Vector2): number {
        const pixelX = Math.floor(percent.x * (maxPixel.x - 1));
        const pixelY = Math.floor(percent.y * (maxPixel.y - 1));

        const total = pixelY * maxPixel.x + pixelX;
        //console.log("Percent: " + percent.x + " " + percent.y + " Pixel: "+ pixelX + " " + pixelY + " Total: " + total);

        return total;
    }

    public fixNorthSeam(tile: Tile, tileUpper: Tile) {
        const positions1 = tile.mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;
        const positions2 = tileUpper.mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;
        const subdivisions = this.tileSet.meshPrecision + 1;

        const y1 = 0;
        const y2 = subdivisions - 1;

        for (let x = 0; x < subdivisions; x++) {
            const meshIndex1 = 1 + (x + y1 * subdivisions) * 3;
            const meshIndex2 = 1 + (x + y2 * subdivisions) * 3;

            positions1[meshIndex1] = positions2[meshIndex2];
        }

        tile.mesh.updateVerticesData(VertexBuffer.PositionKind, positions1);
        tile.mesh.refreshBoundingInfo();
        tile.northSeamFixed = true;
    }

    public fixEastSeam(tile: Tile, tileRight: Tile) {
        const positions1 = tile.mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;
        const positions2 = tileRight.mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;
        const subdivisions = this.tileSet.meshPrecision + 1;

        const x1 = subdivisions - 1;
        const x2 = 0;

        for (let y = 0; y < subdivisions; y++) {

            const meshIndex1 = 1 + (x1 + y * subdivisions) * 3;
            const meshIndex2 = 1 + (x2 + y * subdivisions) * 3;

            positions1[meshIndex1] = positions2[meshIndex2];
        }

        tile.mesh.updateVerticesData(VertexBuffer.PositionKind, positions1);
        tile.mesh.refreshBoundingInfo();
        tile.eastSeamFixed = true;
    }

    public fixNorthEastSeam(tile: Tile, tileUpperRight: Tile) {
        const positions1 = tile.mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;
        const positions2 = tileUpperRight.mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;
        const subdivisions = this.tileSet.meshPrecision + 1;

        const x1 = subdivisions - 1;
        const x2 = 0;

        const y1 = 0;
        const y2 = subdivisions - 1;

        const meshIndex1 = 1 + (x1 + y1 * subdivisions) * 3;
        const meshIndex2 = 1 + (x2 + y2 * subdivisions) * 3;

        positions1[meshIndex1] = positions2[meshIndex2];

        tile.mesh.updateVerticesData(VertexBuffer.PositionKind, positions1);
        tile.mesh.refreshBoundingInfo();
        tile.northEastSeamFixed = true;
    }
    
    /*
    //DEM Version of seam fixing
    public fixNorthSeam(tile: Tile, tileUpper: Tile){
        const dem1=tile.dem;
        const dem2=tileUpper.dem;
        const dimensions=tile.demDimensions;

        for(let x=0; x<dimensions.x;x++){
            const pos1Index=x;
            const pos2Index=x+dimensions.x*(dimensions.y-1); //last row

            const height1=dem1[pos1Index];
            const height2=dem2[pos2Index];

            dem1[pos1Index]=height2;
        }      

        tile.northSeamFixed = true;
    }

    //DEM Version of seam fixing
    public fixEastSeam(tile: Tile, tileRight: Tile) {
        //console.log("fixing right seam!");
        //console.log("dem size: "+ tile.dem.length);
        const dem1 = tile.dem;
        const dem2 = tileRight.dem;
        const dimensions = tile.demDimensions;
        //console.log("dem dimensions: " + dimensions.x + " " + dimensions.y);

        for (let y = 0; y < dimensions.y; y++) {
            const pos1Index = (dimensions.x - 1) + y * dimensions.x; //right most col
            const pos2Index = y * dimensions.x; //left most col

            const height1=dem1[pos1Index];
            const height2 = dem2[pos2Index];

            dem1[pos1Index]=height2;
        }       

        tile.eastSeamFixed = true;
    }
    
    //DEM Version of seam fixing
    public fixNorthEastSeam(tile: Tile, tileUpperRight: Tile) {

        //console.log("dem size: "+ tile.dem.length);
        const dem1 = tile.dem;
        const dem2 = tileUpperRight.dem;
        const dimensions = tile.demDimensions;

        const pos1Index = (dimensions.x - 1); //upper right
        const pos2Index = (dimensions.y - 1) * dimensions.x; //lower left

        const height1 = dem1[pos1Index];
        const height2 = dem2[pos2Index];

        dem1[pos1Index] = height2;
    
        tile.northEastSeamFixed = true;
    }
    */
}
