import { Vector2 } from "@babylonjs/core/Maths/math.js";
import { Vector3 } from "@babylonjs/core/Maths/math.js";
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";
export default class TerrainMB {
    //public onAllLoaded: Observable<boolean> = new Observable();
    constructor(tileSet, scene) {
        this.tileSet = tileSet;
        this.scene = scene;
        this.mbServer = "https://api.mapbox.com/v4/";
        this.globalMinHeight = Number.POSITIVE_INFINITY;
        this.terrainRequests = new WeakMap();
        this.accessToken = "";
        this.heightScaleFixer = 0;
        this.skuToken = "";
        this.skuToken = this.tileSet.ourTileMath.generateSKU();
    }
    setExaggeration(tileScale, exaggeration) {
        this.heightScaleFixer = tileScale * exaggeration;
    }
    //based on code from
    //https://www.babylonjs-playground.com/#DXARSP#30
    GetAsyncTexture(url) {
        return new Promise((resolve, reject) => {
            const texture = new Texture(url, this.scene, true, false, Texture.NEAREST_SAMPLINGMODE, function () {
                console.log("loading texture success!");
                resolve(texture);
            }, function (message) {
                texture.dispose();
                reject(new Error(message ?? "Unable to load terrain texture."));
            });
        });
    }
    async updateAllTerrainTiles(exaggeration) {
        this.setExaggeration(this.tileSet.ourTileMath.computeTileScale(), exaggeration);
        this.globalMinHeight = Number.POSITIVE_INFINITY;
        await Promise.all(this.tileSet.ourTiles.map((tile) => this.updateSingleTerrainTile(tile)));
    }
    setupTerrainLOD(precisions, distances, skirtDepth = this.tileSet.tileWidth) {
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
    validateTerrainLOD(precisions, distances, skirtDepth) {
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
    applyDetailedTerrainToMesh(lodMesh, tile, precision) {
        const sourcePositions = tile.mesh.getVerticesData(VertexBuffer.PositionKind);
        const lodPositions = lodMesh.getVerticesData(VertexBuffer.PositionKind);
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
    addTerrainSkirt(mesh, precision, skirtDepth) {
        const positions = Array.from(mesh.getVerticesData(VertexBuffer.PositionKind));
        const normals = Array.from(mesh.getVerticesData(VertexBuffer.NormalKind));
        const uvs = Array.from(mesh.getVerticesData(VertexBuffer.UVKind));
        const indices = Array.from(mesh.getIndices() ?? []);
        const subdivisions = precision + 1;
        const boundary = [];
        for (let x = 0; x < subdivisions; x++)
            boundary.push(x);
        for (let y = 1; y < subdivisions; y++)
            boundary.push((subdivisions - 1) + y * subdivisions);
        for (let x = subdivisions - 2; x >= 0; x--)
            boundary.push(x + (subdivisions - 1) * subdivisions);
        for (let y = subdivisions - 2; y > 0; y--)
            boundary.push(y * subdivisions);
        const skirtTopStart = positions.length / 3;
        for (const vertexIndex of boundary) {
            positions.push(positions[vertexIndex * 3], positions[vertexIndex * 3 + 1], positions[vertexIndex * 3 + 2]);
            uvs.push(uvs[vertexIndex * 2], uvs[vertexIndex * 2 + 1]);
        }
        const skirtBottomStart = positions.length / 3;
        for (const vertexIndex of boundary) {
            positions.push(positions[vertexIndex * 3], positions[vertexIndex * 3 + 1] - skirtDepth, positions[vertexIndex * 3 + 2]);
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
    async updateSingleTerrainTile(tile) {
        const request = Symbol();
        this.terrainRequests.set(tile, request);
        const heightScale = this.heightScaleFixer;
        tile.clearTerrainLOD();
        tile.terrainLoaded = false;
        tile.eastSeamFixed = false;
        tile.northSeamFixed = false;
        tile.northEastSeamFixed = false;
        this.invalidateTileSeams(tile);
        if (tile.tileCoords.z > 15 && this.tileSet.doTerrainResBoost == false) {
            console.log("DEM not supported beyond level 15 (if not doing res boost)");
            return;
        }
        if (tile.tileCoords.z > 14 && this.tileSet.doTerrainResBoost == true) {
            console.log("DEM not supported beyond 14 (if doing res boost)");
            return;
        }
        const storedCoords = tile.tileCoords.clone();
        tile.dem = []; //to reclaim memory?
        const prefix = this.mbServer;
        const boostParam = this.tileSet.doTerrainResBoost ? "@2x" : "";
        //const mapType = "mapbox.terrain-rgb";
        const mapType = "mapbox.mapbox-terrain-dem-v1";
        const extension = ".pngraw";
        const query = new URLSearchParams({ sku: this.skuToken, access_token: this.accessToken });
        const url = prefix + mapType + "/" + storedCoords.z + "/" + storedCoords.x + "/" + storedCoords.y + boostParam + extension + "?" + query;
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
            this.applyDEMToMesh(tile, this.tileSet.meshPrecision, heightScale);
            tile.terrainLoaded = true;
            this.fixTileSeams();
        }
        finally {
            texture.dispose();
        }
    }
    /** Re-applies every available cardinal and diagonal seam. */
    fixTileSeams() {
        for (const tile of this.tileSet.ourTiles) {
            if (!tile.terrainLoaded) {
                continue;
            }
            const upperTile = this.tileSet.ourTilesMap.get(new Vector3(tile.tileCoords.x, tile.tileCoords.y - 1, tile.tileCoords.z).toString());
            if (upperTile?.terrainLoaded) {
                this.fixNorthSeam(tile, upperTile);
            }
            const rightTile = this.tileSet.ourTilesMap.get(new Vector3(tile.tileCoords.x + 1, tile.tileCoords.y, tile.tileCoords.z).toString());
            if (rightTile?.terrainLoaded) {
                this.fixEastSeam(tile, rightTile);
            }
            const upperRightTile = this.tileSet.ourTilesMap.get(new Vector3(tile.tileCoords.x + 1, tile.tileCoords.y - 1, tile.tileCoords.z).toString());
            if (upperRightTile?.terrainLoaded) {
                this.fixNorthEastSeam(tile, upperRightTile);
            }
        }
    }
    invalidateTileSeams(tile) {
        // Seam state belongs to the tile on the south/west side. Clear the
        // neighboring flags too when a recycled tile gets new DEM data.
        const lowerTile = this.tileSet.ourTilesMap.get(new Vector3(tile.tileCoords.x, tile.tileCoords.y + 1, tile.tileCoords.z).toString());
        if (lowerTile) {
            lowerTile.northSeamFixed = false;
        }
        const leftTile = this.tileSet.ourTilesMap.get(new Vector3(tile.tileCoords.x - 1, tile.tileCoords.y, tile.tileCoords.z).toString());
        if (leftTile) {
            leftTile.eastSeamFixed = false;
        }
        const lowerLeftTile = this.tileSet.ourTilesMap.get(new Vector3(tile.tileCoords.x - 1, tile.tileCoords.y + 1, tile.tileCoords.z).toString());
        if (lowerLeftTile) {
            lowerLeftTile.northEastSeamFixed = false;
        }
    }
    //https://docs.mapbox.com/data/tilesets/guides/access-elevation-data/
    convertRGBtoDEM(ourBuff, tile) {
        var heightDEM = [];
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
        if (tile.minHeight < this.globalMinHeight) {
            this.globalMinHeight = tile.minHeight;
        }
    }
    applyDEMToMesh(tile, meshPrecision, heightScale = this.heightScaleFixer) {
        const positions = tile.mesh.getVerticesData(VertexBuffer.PositionKind);
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
    updateTerrainPositions(mesh, positions) {
        mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
        const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
        const indices = mesh.getIndices();
        if (normals && indices) {
            VertexData.ComputeNormals(positions, indices, normals);
            mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
        }
        mesh.refreshBoundingInfo();
    }
    computeIndexByPercent(percent, maxPixel) {
        const pixelX = Math.floor(percent.x * (maxPixel.x - 1));
        const pixelY = Math.floor(percent.y * (maxPixel.y - 1));
        const total = pixelY * maxPixel.x + pixelX;
        //console.log("Percent: " + percent.x + " " + percent.y + " Pixel: "+ pixelX + " " + pixelY + " Total: " + total);
        return total;
    }
    fixNorthSeam(tile, tileUpper) {
        const positions1 = tile.mesh.getVerticesData(VertexBuffer.PositionKind);
        const positions2 = tileUpper.mesh.getVerticesData(VertexBuffer.PositionKind);
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
    fixEastSeam(tile, tileRight) {
        const positions1 = tile.mesh.getVerticesData(VertexBuffer.PositionKind);
        const positions2 = tileRight.mesh.getVerticesData(VertexBuffer.PositionKind);
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
    fixNorthEastSeam(tile, tileUpperRight) {
        const positions1 = tile.mesh.getVerticesData(VertexBuffer.PositionKind);
        const positions2 = tileUpperRight.mesh.getVerticesData(VertexBuffer.PositionKind);
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
//# sourceMappingURL=TerrainMB.js.map