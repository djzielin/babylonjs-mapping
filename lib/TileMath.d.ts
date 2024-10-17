import { Vector2, Vector4 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import Tile from './Tile';
import TileSet from "./TileSet";
export declare enum EPSG_Type {
    EPSG_3857 = 0,
    EPSG_4326 = 1
}
export default class TileMath {
    private tileSet;
    constructor(tileSet: TileSet | undefined);
    lon_to_tile(lon: number, zoom: number): number;
    lat_to_tile(lat: number, zoom: number): number;
    lon_to_tileExact(lon: number, zoom: number): number;
    lat_to_tileExact(lat: number, zoom: number): number;
    tile_to_lon(x: number, z: number): number;
    tile_to_lat(y: number, z: number): number;
    tile_to_lonlat(tileCoords: Vector3): Vector2;
    epsg3857_to_Epsg4326(coord3857: Vector2): Vector2;
    epsg4326_to_Epsg3857(lonLat: Vector2): Vector2;
    sign(x: number): number;
    EPSG_to_Game(pos: Vector2, epsg: EPSG_Type, zoom?: number): Vector3;
    Game_to_LonLat(gamePos: Vector3): Vector2;
    EPSG_to_Tile(pos: Vector2, epsg: EPSG_Type, zoom?: number): Vector2;
    EPSG_to_TileExact(pos: Vector2, epsg: EPSG_Type, zoom?: number): Vector2;
    Tile_to_Game(pos: Vector2): Vector3;
    Game_to_Tile(gPos: Vector3): Vector3;
    computeBBOX_4326(tileCoords: Vector3): Vector4;
    computeBBOX_4326_Tileset(): Vector4;
    computeTileRealWidthMeters(lat: number, zoom: number): number;
    computeCornerTile(pos: Vector2, epsg: EPSG_Type, zoom?: number): Vector2;
    computeTileScale(): number;
    findBestTile(position: Vector3): Tile | undefined;
    generateSKU(): string;
    line_segment_intersect(p1: Vector2, p2: Vector2, p3: Vector2, p4: Vector2): Vector2 | false;
    v3_to_v2(v: Vector3): Vector2;
    v2_to_v3(v: Vector2): Vector3;
}
