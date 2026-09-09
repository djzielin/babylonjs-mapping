import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.js";
import TileMath, { EPSG_Type } from "./TileMath.js";
import type GlobeSet from "./GlobeSet.js";
/** Geographic conversion shared by globe features and picking. */
export default class GlobeTileMath extends TileMath {
    private globe;
    private flat;
    constructor(globe: GlobeSet, flat?: boolean);
    Tile_to_Game(pos: Vector2): Vector3;
    Game_to_Tile(pos: Vector3): Vector3;
    computeCornerTile(pos: Vector2, epsg: EPSG_Type, zoom?: number): Vector2;
    findBestTile(pos: Vector3): import("./Tile.js").default;
}
