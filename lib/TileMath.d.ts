import { Vector2, Vector4 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import Tile from './Tile';
import TileSet from "./TileSet";
export declare enum ProjectionType {
    EPSG_3857 = 0,
    EPSG_4326 = 1
}
export default class TileMath {
    private tileSet;
    constructor(tileSet: TileSet | undefined);
    lon2tile(lon: number, zoom: number): number;
    lat2tile(lat: number, zoom: number): number;
    lon2tileExact(lon: number, zoom: number): number;
    lat2tileExact(lat: number, zoom: number): number;
    tile2lon(x: number, z: number): number;
    tile2lat(y: number, z: number): number;
    tile2lonlat(tileCoords: Vector3): Vector2;
    computeBBOX_4326(tileCoords: Vector3): Vector4;
    computeTileRealWidthMeters(lat: number, zoom: number): number;
    computeCornerTile(pos: Vector2, projection: ProjectionType, zoom?: number): Vector2;
    GetWorldPosition(pos: Vector2, projection: ProjectionType, zoom?: number): Vector3;
    GetTilePosition(pos: Vector2, projection: ProjectionType, zoom?: number): Vector2;
    epsg3857toEpsg4326(coord3857: Vector2): Vector2;
    epsg4326toEpsg3857(lonLat: Vector2): Vector2;
    sign(x: number): number;
    GetTilePositionExact(pos: Vector2, projection: ProjectionType, zoom?: number): Vector2;
    GetWorldPositionFromTile(pos: Vector2): Vector3;
    GamePosToTile(gPos: Vector3): Vector3;
    computeTileScale(): number;
    findBestTile(position: Vector3): Tile | undefined;
    generateSKU(): string;
    line_segment_intersect(p1: Vector2, p2: Vector2, p3: Vector2, p4: Vector2): Vector2 | false;
    v3_to_v2(v: Vector3): Vector2;
    v2_to_v3(v: Vector2): Vector3;
}
