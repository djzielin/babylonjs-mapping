import { Vector2 } from "@babylonjs/core/Maths/math.js";
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { VertexBuffer } from "@babylonjs/core";
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
        this.index = 0;
        this.accessToken = "";
        this.heightScaleFixer = 0;
        this.skuToken = "";
        if (this.tileSet) {
            if (this.tileSet.ourTileMath) {
                console.log("we seem to be able to access tileMath here");
            }
            else {
                console.error("unable to access tileMath!");
            }
        }
        else {
            console.error("unable to access tileSet!");
        }
        this.skuToken = this.tileSet.ourTileMath.generateSKU();
    }
    setExaggeration(tileScale, exaggeration) {
        this.heightScaleFixer = tileScale * exaggeration;
    }
    //based on code from
    //https://www.babylonjs-playground.com/#DXARSP#30
    GetAsyncTexture(url) {
        return new Promise((resolve, reject) => {
            var texture = new Texture(url, this.scene, true, false, Texture.NEAREST_SAMPLINGMODE, function () {
                console.log("loading texture success!");
                resolve(texture);
            }, function (message) {
                reject(message);
            });
        });
    }
    async updateAllTerrainTiles(exaggeration) {
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
                lodMesh.position.copyFrom(tile.mesh.position);
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
        tile.clearTerrainLOD();
        tile.terrainLoaded = false;
        tile.eastSeamFixed = false;
        tile.northSeamFixed = false;
        tile.northEastSeamFixed = false;
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
        const skuParam = "?sku=" + this.skuToken;
        const accessParam = "&access_token=" + this.accessToken;
        const url = prefix + mapType + "/" + (tile.tileCoords.z) + "/" + (tile.tileCoords.x) + "/" + (tile.tileCoords.y) + boostParam + extension + skuParam + accessParam;
        console.log("trying to get: " + url);
        const ourTex = await this.GetAsyncTexture(url); //wait for loading to be complete
        if (!ourTex) {
            console.error("unable to load terrain for: " + tile.tileCoords);
            return;
        }
        //console.log("terrain dimensions: " + tile.demDimensions);
        const bufferView = await ourTex.readPixels();
        if (!bufferView) {
            console.error("unable to read pixels from texture for terrain tile: " + tile.tileCoords);
        }
        const bufferUint = new Uint8Array(bufferView.buffer, bufferView.byteOffset, bufferView.byteLength);
        //console.log("terrain buffer dimensions: " + bufferUint.byteLength)
        if (tile.tileCoords.equals(storedCoords) == false) {
            console.warn("looks like tile coords have changed already! bailing on this update for: " + tile.tileCoords);
            return;
        }
        tile.demDimensions = new Vector2(ourTex.getSize().width, ourTex.getSize().height);
        this.convertRGBtoDEM(bufferUint, tile);
        this.applyDEMToMesh(tile, this.tileSet.meshPrecision);
        tile.terrainLoaded = true;
        this.fixTileSeams();
        /*
        for(let t of this.tileSet.ourTiles){
            if(!t.terrainLoaded){
                return;
            }
        }

        this.onAllLoaded.notifyObservers(true);  */
    }
    fixTileSeams() {
        for (let t of this.tileSet.ourTiles) {
            if (!t.terrainLoaded) {
                continue;
            }
            if (!t.northSeamFixed) {
                //console.log("tile doesn't have north seam fixed yet: " + t.tileCoords);
                const upperTileCoords = t.tileCoords.clone();
                upperTileCoords.y--;
                const upperTileCoordsString = upperTileCoords.toString();
                const upperTile = this.tileSet.ourTilesMap.get(upperTileCoordsString);
                if (upperTile) {
                    console.log("found upper tile for tile: " + t.tileCoords);
                    if (upperTile.terrainLoaded) {
                        this.fixNorthSeam(t, upperTile);
                    }
                }
            }
            if (!t.eastSeamFixed) {
                //console.log("tile doesn't have east seam fixed yet: " + t.tileCoords);
                const rightTileCoords = t.tileCoords.clone();
                rightTileCoords.x++;
                const rightTileCoordsString = rightTileCoords.toString();
                const rightTile = this.tileSet.ourTilesMap.get(rightTileCoordsString);
                if (rightTile) {
                    console.log("found right tile for tile: " + t.tileCoords);
                    if (rightTile.terrainLoaded) {
                        this.fixEastSeam(t, rightTile);
                    }
                }
            }
            if (!t.northEastSeamFixed) {
                //console.log("tile doesn't have east seam fixed yet: " + t.tileCoords);
                const upperRightCoords = t.tileCoords.clone();
                upperRightCoords.x++;
                upperRightCoords.y--;
                const upperRightCoordsString = upperRightCoords.toString();
                const upperRightTile = this.tileSet.ourTilesMap.get(upperRightCoordsString);
                if (upperRightTile) {
                    console.log("found upper right tile for tile: " + t.tileCoords);
                    if (upperRightTile.terrainLoaded) {
                        this.fixNorthEastSeam(t, upperRightTile);
                    }
                }
            }
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
    applyDEMToMesh(tile, meshPrecision) {
        const positions = tile.mesh.getVerticesData(VertexBuffer.PositionKind);
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
        let xStop = subdivisions;
        if (tile.northEastSeamFixed) {
            xStop--; //skip corner
        }
        for (let x = 0; x < xStop; x++) {
            const meshIndex1 = 1 + (x + y1 * subdivisions) * 3;
            const meshIndex2 = 1 + (x + y2 * subdivisions) * 3;
            positions1[meshIndex1] = positions2[meshIndex2];
        }
        tile.mesh.updateVerticesData(VertexBuffer.PositionKind, positions1);
        tile.mesh.refreshBoundingInfo();
        tile.northSeamFixed = true;
    }
    fixEastSeam(tile, tileRight) {
        const positions1 = tile.mesh.getVerticesData(VertexBuffer.PositionKind);
        const positions2 = tileRight.mesh.getVerticesData(VertexBuffer.PositionKind);
        const subdivisions = this.tileSet.meshPrecision + 1;
        const x1 = subdivisions - 1;
        const x2 = 0;
        let yStart = 0;
        if (tile.northEastSeamFixed) {
            yStart++; //skip corner
        }
        for (let y = yStart; y < subdivisions; y++) {
            const meshIndex1 = 1 + (x1 + y * subdivisions) * 3;
            const meshIndex2 = 1 + (x2 + y * subdivisions) * 3;
            positions1[meshIndex1] = positions2[meshIndex2];
        }
        tile.mesh.updateVerticesData(VertexBuffer.PositionKind, positions1);
        tile.mesh.refreshBoundingInfo();
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
        tile.mesh.updateVerticesData(VertexBuffer.PositionKind, positions1);
        tile.mesh.refreshBoundingInfo();
        tile.northEastSeamFixed = true;
    }
}
//# sourceMappingURL=TerrainMB.js.map