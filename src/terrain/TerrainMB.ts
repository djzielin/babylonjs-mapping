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
import TerrainRGB from "./TerrainRGB.js";
import type GlobeSet from "../core/GlobeSet.js";

//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";

export default class TerrainMB {
    private mbServer: string = "https://api.mapbox.com/v4/";

    public globalMinHeight = Number.POSITIVE_INFINITY;
    private readonly terrainRequests = new WeakMap<Tile, symbol>();
    public accessToken: string = "";
    private heightScaleFixer=0;
    private skuToken: string="";
    //public onAllLoaded: Observable<boolean> = new Observable();

    constructor(public tileSet: TileSet, private scene: Scene) {
        this.skuToken = this.tileSet.ourTileMath.generateSKU();
          
    }  

    public setExaggeration(tileScale: number, exaggeration: number) {
        this.heightScaleFixer = tileScale * exaggeration;
    }

    //based on code from
    //https://www.babylonjs-playground.com/#DXARSP#30
    private GetAsyncTexture (url: string) : Promise<Texture> {
        return new Promise((resolve, reject) => {
            const texture = new Texture(url, this.scene, true, false, Texture.NEAREST_SAMPLINGMODE, function() {
                console.log("loading texture success!");
                resolve(texture);
            }, function(message) {
                texture.dispose();
                reject(new Error(message ?? "Unable to load terrain texture."));
            });    
        })
    }

    public async updateAllTerrainTiles(exaggeration: number): Promise<void> {
        this.setExaggeration(this.tileSet.ourTileMath.computeTileScale(), exaggeration);
        this.globalMinHeight = Number.POSITIVE_INFINITY;

        await Promise.all(this.tileSet.ourTiles.map((tile) => this.updateSingleTerrainTile(tile)));

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

        if (this.tileSet.isGlobe && tile.elevationHeights) {
            const heights: number[] = [];
            for (let y = 0; y <= precision; y++) for (let x = 0; x <= precision; x++) {
                const sx = x * sourcePrecision / precision, sy = y * sourcePrecision / precision;
                const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(x0+1,sourcePrecision), y1 = Math.min(y0+1,sourcePrecision);
                const h = tile.elevationHeights, n = sourceSubdivisions, tx = sx-x0, ty = sy-y0;
                heights.push((h[y0*n+x0]*(1-tx)+h[y0*n+x1]*tx)*(1-ty)+(h[y1*n+x0]*(1-tx)+h[y1*n+x1]*tx)*ty);
            }
            (this.tileSet as GlobeSet).applyGlobeHeights(lodMesh, tile, precision, heights);
        } else lodMesh.updateVerticesData(VertexBuffer.PositionKind, lodPositions);
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
            const point = new Vector3(positions[vertexIndex*3], positions[vertexIndex*3+1], positions[vertexIndex*3+2]);
            if (this.tileSet.isGlobe) {
                const origin = mesh.parent instanceof Mesh ? mesh.parent.position : Vector3.Zero();
                point.addInPlace(origin);
                point.scaleInPlace(Math.max(0.01, 1 - skirtDepth / point.length()));
                point.subtractInPlace(origin);
            }
            else point.y -= skirtDepth;
            positions.push(point.x, point.y, point.z);
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
        const request = Symbol();
        this.terrainRequests.set(tile, request);
        const heightScale = this.heightScaleFixer;
        tile.clearTerrainLOD();
        tile.terrainLoaded=false;
        tile.eastSeamFixed = false;
        tile.northSeamFixed = false;
        tile.northEastSeamFixed = false;
        this.invalidateTileSeams(tile);

        const storedCoords=tile.tileCoords.clone();

        tile.dem = []; //to reclaim memory?

        const sourceZoom = Math.min(storedCoords.z, this.tileSet.doTerrainResBoost ? 14 : 15);
        const factor = 2 ** (storedCoords.z - sourceZoom);
        const sourceX = ((Math.floor(storedCoords.x / factor) % (2 ** sourceZoom)) + 2 ** sourceZoom) % (2 ** sourceZoom);
        const sourceY = Math.floor(storedCoords.y / factor);
        const prefix = this.mbServer;
        const boostParam = this.tileSet.doTerrainResBoost ? "@2x" : "";

        //const mapType = "mapbox.terrain-rgb";
        const mapType = "mapbox.mapbox-terrain-dem-v1";

        const extension = ".pngraw";
        const query = new URLSearchParams({ sku: this.skuToken, access_token: this.accessToken });
        const url = prefix + mapType + "/" + sourceZoom + "/" + sourceX + "/" + sourceY + boostParam + extension + "?" + query;
        const texture = await this.GetAsyncTexture(url);
        try {
            const bufferView = await texture.readPixels();
            if (tile.mesh.isDisposed() || !tile.tileCoords.equals(storedCoords) || this.terrainRequests.get(tile) !== request) {
                return;
            }
            if (!bufferView) {
                throw new Error("Unable to read terrain texture pixels.");
            }
            const pixels = new Uint8Array(bufferView.buffer, bufferView.byteOffset, bufferView.byteLength);
            const size = texture.getSize();
            tile.demDimensions = new Vector2(size.width, size.height);
            this.convertRGBtoDEM(pixels, tile);
            if (sourceZoom < storedCoords.z) {
                const grid = TerrainRGB.crop({data: tile.dem, width: size.width, height: size.height}, storedCoords, sourceZoom);
                tile.dem = Array.from(grid.data);
                tile.demDimensions = new Vector2(grid.width, grid.height);
            }
            this.applyDEMToMesh(tile, this.tileSet.meshPrecision, heightScale);
            tile.terrainLoaded = true;
            this.fixTileSeams();
        } finally {
            texture.dispose();
        }
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

    public applyDEMToMesh(tile: Tile, meshPrecision: number, heightScale = this.heightScaleFixer) {
        if (this.tileSet.isGlobe) {
            const globe = this.tileSet as GlobeSet;
            globe.setElevationData(tile, tile.dem, tile.demDimensions.x, tile.demDimensions.y, heightScale / this.tileSet.tileScale);
            return;
        }
        const positions = tile.mesh.getVerticesData(VertexBuffer.PositionKind) as FloatArray;
        const subdivisions = meshPrecision + 1;

        for (let y = 0; y < subdivisions; y++) {
            for (let x = 0; x < subdivisions; x++) {
                const percent = new Vector2(x / (subdivisions - 1), y / (subdivisions - 1));
                const demIndex = this.computeIndexByPercent(percent, tile.demDimensions);                
                const height = (tile.dem[demIndex]) * heightScale;
                const meshIndex = 1 + (x + y * subdivisions) * 3;

                positions[meshIndex] = height;
            }
        }

        this.updateTerrainPositions(tile.mesh, positions);
    }

    private updateTerrainPositions(mesh: Mesh, positions: FloatArray): void {
        mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
        const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
        const indices = mesh.getIndices();
        if (normals && indices) {
            VertexData.ComputeNormals(positions, indices, normals);
            mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
        }
        mesh.refreshBoundingInfo();
    }

    private computeIndexByPercent(percent: Vector2, maxPixel: Vector2): number {
        const pixelX = Math.floor(percent.x * (maxPixel.x - 1));
        const pixelY = Math.floor(percent.y * (maxPixel.y - 1));

        const total = pixelY * maxPixel.x + pixelX;
        //console.log("Percent: " + percent.x + " " + percent.y + " Pixel: "+ pixelX + " " + pixelY + " Total: " + total);

        return total;
    }

    public fixNorthSeam(tile: Tile, tileUpper: Tile) {
        if (this.tileSet.isGlobe) {
            if (!tile.elevationHeights || !tileUpper.elevationHeights) return;
            const p = this.tileSet.meshPrecision, n = p + 1;
            for (let x = 0; x <= p; x++) tile.elevationHeights[x] = tileUpper.elevationHeights[x + p * n];
            this.tileSet.applyElevationGrid(tile, tile.elevationHeights, p);
            return;
        }
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

        this.updateTerrainPositions(tile.mesh, positions1);
        tile.northSeamFixed = true;
    }

    public fixEastSeam(tile: Tile, tileRight: Tile) {
        if (this.tileSet.isGlobe) {
            if (!tile.elevationHeights || !tileRight.elevationHeights) return;
            const p = this.tileSet.meshPrecision, n = p + 1;
            for (let x = 0; x <= p; x++) tile.elevationHeights[p + x * n] = tileRight.elevationHeights[x * n];
            this.tileSet.applyElevationGrid(tile, tile.elevationHeights, p);
            return;
        }
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

        this.updateTerrainPositions(tile.mesh, positions1);
        tile.eastSeamFixed = true;
    }

    public fixNorthEastSeam(tile: Tile, tileUpperRight: Tile) {
        if (this.tileSet.isGlobe) {
            if (!tile.elevationHeights || !tileUpperRight.elevationHeights) return;
            const p = this.tileSet.meshPrecision, n = p + 1;
            tile.elevationHeights[p] = tileUpperRight.elevationHeights[p * n];
            this.tileSet.applyElevationGrid(tile, tile.elevationHeights, p);
            return;
        }
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

        this.updateTerrainPositions(tile.mesh, positions1);
        tile.northEastSeamFixed = true;
    }
    
}
