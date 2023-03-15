import { Vector2 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import Tile from './Tile';
import TileSet from "./TileSet";
export declare enum ProjectionType {
    EPSG_3857 = 0,
    EPSG_4326 = 1
}
export default class TileMath {
    private tileSet;
    constructor(tileSet: TileSet);
    lon2tile(lon: number, zoom: number): number;
    lat2tile(lat: number, zoom: number): number;
    lon2tileExact(lon: number, zoom: number): number;
    lat2tileExact(lat: number, zoom: number): number;
    computeTileRealWidthMeters(lat: number, zoom: number): number;
    computeCornerTile(pos: Vector2, projection: ProjectionType, zoom?: number): Vector2;
    GetWorldPosition(pos: Vector2, projection: ProjectionType, zoom?: number): Vector3;
    GetTilePosition(pos: Vector2, projection: ProjectionType, zoom?: number): Vector2;
    GetTilePositionExact(pos: Vector2, projection: ProjectionType, zoom?: number): Vector2;
    GetWorldPositionFromTile(pos: Vector2): Vector3;
    computeTileScale(): number;
    findBestTile(position: Vector3): Tile;
}
