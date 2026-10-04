import { Vector2 } from "@babylonjs/core/Maths/math.js";
import type TileSet from "../core/TileSet.js";
import Raster from "./Raster.js";
export interface GoogleSatelliteSession {
    session: string;
    expiry: number;
}
/** Google Map Tiles API satellite imagery for the same area as 3D Tiles. */
export default class RasterGoogleSatellite extends Raster {
    private apiKey;
    private token;
    constructor(tileSet: TileSet, apiKey: string, token: GoogleSatelliteSession);
    static openSession(apiKey: string): Promise<GoogleSatelliteSession>;
    static viewportCopyright(apiKey: string, token: GoogleSatelliteSession, bounds: {
        north: number;
        south: number;
        east: number;
        west: number;
    }, zoom: number): Promise<string>;
    getRasterURL(tileCoords: Vector2, zoom: number): string;
}
