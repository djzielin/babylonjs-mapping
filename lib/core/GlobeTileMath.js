import { Vector3 } from "@babylonjs/core/Maths/math.js";
import TileMath, { EPSG_Type } from "./TileMath.js";
/** Geographic conversion shared by globe features and picking. */
export default class GlobeTileMath extends TileMath {
    constructor(globe, flat = false) {
        super(globe);
        this.globe = globe;
        this.flat = flat;
    }
    Tile_to_Game(pos) {
        if (!this.flat)
            return this.globe.getTileSurfacePosition(new Vector3(pos.x, pos.y, this.globe.zoom), 0, 0);
        const center = this.EPSG_to_TileExact(this.globe.centerCoords, EPSG_Type.EPSG_4326, this.globe.zoom);
        const count = 2 ** this.globe.zoom;
        const dx = ((((pos.x - center.x + count / 2) % count) + count) % count) -
            count / 2;
        return new Vector3(dx * this.globe.tileWidth, 0, (center.y - pos.y) * this.globe.tileWidth);
    }
    Game_to_Tile(pos) {
        if (!this.flat) {
            const ll = this.globe.getSurfaceCoordinates(pos);
            return new Vector3(this.lon_to_tileExact(ll.longitude, this.globe.zoom), this.lat_to_tileExact(ll.latitude, this.globe.zoom), this.globe.zoom);
        }
        const center = this.EPSG_to_TileExact(this.globe.centerCoords, EPSG_Type.EPSG_4326, this.globe.zoom);
        return new Vector3(center.x + pos.x / this.globe.tileWidth, center.y - pos.z / this.globe.tileWidth, this.globe.zoom);
    }
    computeCornerTile(pos, epsg, zoom = this.globe.zoom) {
        const corner = super.computeCornerTile(pos, epsg, zoom);
        corner.y = Math.max(this.globe.numTiles.y - 1, Math.min(2 ** zoom - 1, corner.y));
        return corner;
    }
    findBestTile(pos) {
        const c = this.Game_to_Tile(pos);
        const n = 2 ** c.z;
        return (this.globe.ourTiles.find((t) => ((t.tileCoords.x % n) + n) % n ===
            ((Math.floor(c.x) % n) + n) % n &&
            t.tileCoords.y === Math.floor(c.y)) ?? this.globe.ourTiles[0]);
    }
}
//# sourceMappingURL=GlobeTileMath.js.map