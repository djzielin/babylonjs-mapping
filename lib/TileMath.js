import { Vector2, Vector4 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { BoundingBox } from "@babylonjs/core";
export var ProjectionType;
(function (ProjectionType) {
    ProjectionType[ProjectionType["EPSG_3857"] = 0] = "EPSG_3857";
    ProjectionType[ProjectionType["EPSG_4326"] = 1] = "EPSG_4326";
})(ProjectionType || (ProjectionType = {}));
//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";
export default class TileMath {
    constructor(tileSet) {
        this.tileSet = tileSet;
    }
    //https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
    lon2tile(lon, zoom) { return (Math.floor((lon + 180) / 360 * Math.pow(2, zoom))); }
    lat2tile(lat, zoom) { return (Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))); }
    //without rounding
    lon2tileExact(lon, zoom) { return (((lon + 180) / 360 * Math.pow(2, zoom))); }
    lat2tileExact(lat, zoom) { return (((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom))); }
    //inverse
    tile2lon(x, z) {
        return (x / Math.pow(2, z) * 360 - 180);
    }
    tile2lat(y, z) {
        var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
        return (180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))));
    }
    tile2lonlat(tileCoords) {
        const x = tileCoords.x;
        const y = tileCoords.y;
        const zoom = tileCoords.z;
        const lon = this.tile2lon(x, zoom);
        const lat = this.tile2lat(y, zoom);
        return new Vector2(lon, lat);
    }
    computeBBOX_4326(tileCoords) {
        console.log("In computeBBOX_4326!");
        console.log("   looking at tile: " + tileCoords);
        const tileBottomLeft = tileCoords.add(new Vector3(0, 1, 0));
        console.log("   proposed bottom left: " + tileBottomLeft);
        const bottomLeft = this.tile2lonlat(tileBottomLeft);
        console.log("   result: " + bottomLeft);
        const tileUpperRight = tileCoords.add(new Vector3(1, 0, 0));
        console.log("   proposed upper right: " + tileUpperRight);
        const topRight = this.tile2lonlat(tileUpperRight);
        console.log("   result: " + topRight);
        const finalResult = new Vector4(bottomLeft.y, bottomLeft.x, topRight.y, topRight.x); //note the swapped y,x and to get lat,lon ordering   
        console.log("   final result: " + finalResult);
        return finalResult;
    }
    /*
    public computeBBOX_3857(tileCoords: Vector3): Vector4 {
        const answer4326 = this.computeBBOX_4326(tileCoords);

        const firstPair = new Vector2(answer4326.y, answer4326.x); //flip back to lon,lat
        const secondPair = new Vector2(answer4326.w, answer4326.z);

        const fixedFirst = this.epsg4326toEpsg3857(firstPair);
        const fixedSecond = this.epsg4326toEpsg3857(secondPair);

        const finalResult = new Vector4(fixedFirst.x, fixedFirst.y, fixedSecond.x, fixedSecond.y);
        return finalResult;
    }*/
    //https://wiki.openstreetmap.org/wiki/Zoom_levels
    //Stile = C ∙ cos(latitude) / 2^zoomlevel
    computeTileRealWidthMeters(lat, zoom) {
        if (zoom == 0) {
            console.log("ERROR: zoom not setup yet!");
            return 0;
        }
        console.log("tryign to compute tile width for lat: " + lat);
        const C = 40075016.686;
        const latRadians = lat * Math.PI / 180.0;
        return C * Math.cos(latRadians) / Math.pow(2, zoom); //seems to need abs?
    }
    computeCornerTile(pos, projection, zoom) {
        if (this.tileSet === undefined) {
            console.error("tileSet is undefined!");
            return new Vector2(0, 0);
        }
        if (zoom === undefined) {
            zoom = this.tileSet.zoom;
        }
        console.log("computing corner tile for: " + pos);
        let cornerTile = this.GetTilePosition(pos, projection, zoom);
        console.log("center tile: " + cornerTile);
        cornerTile.x -= Math.floor(this.tileSet.numTiles.x / 2); //use floor to handle odd tileset sizes
        cornerTile.y += Math.floor(this.tileSet.numTiles.y / 2);
        console.log("corner tile: " + cornerTile);
        return cornerTile;
    }
    GetWorldPosition(pos, projection, zoom) {
        if (zoom === undefined) {
            if (this.tileSet === undefined) {
                console.error("tileSet is undefined!");
                return new Vector3(0, 0, 0);
            }
            zoom = this.tileSet.zoom;
        }
        const tilePos = this.GetTilePositionExact(pos, projection, zoom);
        return this.GetWorldPositionFromTile(tilePos);
    }
    GetTilePosition(pos, projection, zoom) {
        if (zoom === undefined) {
            if (this.tileSet === undefined) {
                console.error("tileSet is undefined!");
                return new Vector2(0, 0);
            }
            zoom = this.tileSet.zoom;
        }
        const exact = this.GetTilePositionExact(pos, projection, zoom);
        return new Vector2(Math.floor(exact.x), Math.floor(exact.y));
    }
    //from https://github.com/Turfjs/turf/blob/master/packages/turf-projection/index.ts
    epsg3857toEpsg4326(coord3857) {
        // 900913 properties.
        var R2D = 180 / Math.PI;
        var A = 6378137.0;
        return new Vector2((coord3857.x * R2D) / A, (Math.PI * 0.5 - 2.0 * Math.atan(Math.exp(-coord3857.y / A))) * R2D);
    }
    epsg4326toEpsg3857(lonLat) {
        var D2R = Math.PI / 180, 
        // 900913 properties
        A = 6378137.0, MAXEXTENT = 20037508.342789244;
        // compensate longitudes passing the 180th meridian
        // from https://github.com/proj4js/proj4js/blob/master/lib/common/adjust_lon.js
        var adjusted = Math.abs(lonLat.x) <= 180 ? lonLat.x : lonLat.x - this.sign(lonLat.x) * 360;
        const xy = new Vector2(A * adjusted * D2R, A * Math.log(Math.tan(Math.PI * 0.25 + 0.5 * lonLat.y * D2R)));
        // if xy value is beyond maxextent (e.g. poles), return maxextent
        if (xy.x > MAXEXTENT)
            xy.x = MAXEXTENT;
        if (xy.x < -MAXEXTENT)
            xy.x = -MAXEXTENT;
        if (xy.y > MAXEXTENT)
            xy.y = MAXEXTENT;
        if (xy.y < -MAXEXTENT)
            xy.y = -MAXEXTENT;
        return xy;
    }
    sign(x) {
        return x < 0 ? -1 : x > 0 ? 1 : 0;
    }
    GetTilePositionExact(pos, projection, zoom) {
        if (zoom === undefined) {
            if (this.tileSet === undefined) {
                console.error("tileSet is undefined!");
                return new Vector2(0, 0);
            }
            zoom = this.tileSet.zoom;
        }
        if (projection == ProjectionType.EPSG_4326 || projection == ProjectionType.EPSG_3857) {
            let lonLat = pos;
            if (projection == ProjectionType.EPSG_3857) //if in meters
             {
                lonLat = this.epsg3857toEpsg4326(pos); //lets just get everything into 4326 (lat/lon), and then convert to tile
            }
            const x = this.lon2tileExact(lonLat.x, zoom);
            const y = this.lat2tileExact(lonLat.y, zoom);
            return new Vector2(x, y);
        }
        else {
            console.error("unknown projection type");
            return new Vector2(0, 0);
        }
    }
    GetWorldPositionFromTile(pos) {
        if (this.tileSet === undefined) {
            console.error("tileSet is undefined!");
            return new Vector3(0, 0, 0);
        }
        const t = this.tileSet.ourTiles[0]; //just grab the first tile
        //console.log("corner tile coords: " + t.tileCoords);
        const tileDiffX = pos.x - t.tileCoords.x;
        const tileDiffY = pos.y - t.tileCoords.y;
        //console.log("tile diff: " + tileDiffX + " " + tileDiffY);
        const upperLeftCornerX = t.mesh.position.x - this.tileSet.tileWidth * 0.5;
        const upperLeftCornerY = t.mesh.position.z + this.tileSet.tileWidth * 0.5;
        //console.log("lower left corner: " + upperLeftCornerX + " " + upperLeftCornerY);
        const xFixed = upperLeftCornerX + tileDiffX * this.tileSet.tileWidth;
        const yFixed = upperLeftCornerY - tileDiffY * this.tileSet.tileWidth;
        // console.log("world position: " + xFixed +" " + yFixed);       
        return new Vector3(xFixed, 0, yFixed);
    }
    computeTileScale() {
        if (this.tileSet === undefined) {
            console.error("tileSet is undefined!");
            return 0;
        }
        const tileMeters = this.computeTileRealWidthMeters(this.tileSet.centerCoords.y, this.tileSet.zoom);
        console.log("tile (real world) width in meters: " + tileMeters);
        const tileWorldMeters = this.tileSet.tileWidth; //passed in a parameter in the constructor
        console.log("tile (in game) width in meteres: " + tileWorldMeters);
        const result = tileWorldMeters / tileMeters;
        console.log("scale of tile (in game) (1.0 would be true size): " + result);
        return result;
    }
    findBestTile(position) {
        if (this.tileSet === undefined) {
            console.error("tileSet is undefined!");
            return undefined;
        }
        const tileHalfWidth = this.tileSet.tileWidth * 0.500001; //make bounding box just a bit bigger, in the off chance something lands right on the line
        const addMax = new Vector3(this.tileSet.tileWidth * 0.5, 0, this.tileSet.tileWidth * 0.5);
        const addMin = new Vector3(-this.tileSet.tileWidth * 0.5, 0, -this.tileSet.tileWidth * 0.5);
        let closestTileDistance = Number.POSITIVE_INFINITY;
        let closestTile = this.tileSet.ourTiles[0];
        for (const t of this.tileSet.ourTiles) {
            const tp = t.mesh.position;
            const tMax = tp.add(addMax);
            const tMin = tp.add(addMin);
            const tileBox = new BoundingBox(tMin, tMax);
            //console.log("box: " + tileBox.center + " " + tileBox.centerWorld);   
            if (tileBox.intersectsPoint(position)) {
                //console.log("found a tile that can contain this building!");
                return t;
            }
            const dist = Vector3.Distance(tp, position);
            if (dist < closestTileDistance) {
                closestTile = t;
            }
        }
        console.log("couldn't find a tile for this building. choosing closest tile");
        return closestTile; //position wasn't inside tile, so we will send back the closest tile
    }
}
//# sourceMappingURL=TileMath.js.map