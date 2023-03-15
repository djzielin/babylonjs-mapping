import { Vector2 } from "@babylonjs/core/Maths/math";
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { VertexBuffer } from "@babylonjs/core";
//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";
export default class MapBox {
    //public onAllLoaded: Observable<boolean> = new Observable();
    constructor(tileSet, scene) {
        //sku code generation from:
        //https://github.com/mapbox/mapbox-gl-js/blob/992514ac5471c1231d8a1951bc6752a65aa9e3e6/src/util/sku_token.js
        this.tileSet = tileSet;
        this.scene = scene;
        this.mbServer = "https://api.mapbox.com/v4/";
        this.globalMinHeight = Number.POSITIVE_INFINITY;
        this.index = 0;
        this.accessToken = "";
        this.heightScaleFixer = 0;
        const SKU_ID = '01';
        const TOKEN_VERSION = '1';
        const base62chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        // sessionRandomizer is a randomized 10-digit base-62 number
        let sessionRandomizer = '';
        for (let i = 0; i < 10; i++) {
            sessionRandomizer += base62chars[Math.floor(Math.random() * 62)];
        }
        this.skuToken = [TOKEN_VERSION, SKU_ID, sessionRandomizer].join('');
    }
    //https://docs.mapbox.com/api/maps/raster-tiles/
    getRasterURL(tileCoords, zoom, doResBoost) {
        let mapType = "mapbox.satellite";
        const prefix = this.mbServer;
        const boostParam = doResBoost ? "@2x" : "";
        let extension = ".jpg90"; //can do jpg70 to reduce quality & bandwidth
        const accessParam = "?access_token=" + this.accessToken;
        let url = prefix + mapType + "/" + zoom + "/" + (tileCoords.x) + "/" + (tileCoords.y) + boostParam + extension + accessParam;
        this.index++;
        return url;
    }
    ///////////////////////////////////////////////////////////////////////////
    // TERRAIN
    ///////////////////////////////////////////////////////////////////////////
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
    updateAllTerrainTiles(exaggeration) {
        this.setExaggeration(this.tileSet.ourTileMath.computeTileScale(), exaggeration);
        for (let t of this.tileSet.ourTiles) {
            this.updateSingleTerrainTile(t);
        }
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
    /*public setupTerrainLOD(precisions: number[], distances:number[]) {
        for (let t of this.ourTiles) {

            for (let i = 0; i < precisions.length; i++) {
                const precision = precisions[i];
                const distance = distances[i];

                if(precision>0){
                    const loadMesh = this.makeSingleTileMesh(t.colRow.x, t.colRow.y, precision);
                    this.ourMB.applyHeightArrayToMesh(loadMesh, t, precision, -this.globalMinHeight);
                    loadMesh.material = t.material;
                    t.mesh.addLODLevel(distance, loadMesh);
                }
                else{
                    t.mesh.addLODLevel(distance,null);
                }
            }
        }
    }*/
    //https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-dem-v1/
    async updateSingleTerrainTile(tile) {
        tile.terrainLoaded = false;
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
        const buffer = bufferView.buffer;
        const bufferUint = new Uint8Array(buffer);
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
//# sourceMappingURL=MapBox.js.map