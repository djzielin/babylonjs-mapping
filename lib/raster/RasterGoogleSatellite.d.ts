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
    /**
     * Open a satellite tile session. Sessions last about two weeks and Google
     * asks clients to reuse them, so one is kept in localStorage until a day
     * before it expires: tile URLs stay the same across page loads and the
     * browser's HTTP cache can serve them. Pass `reuse: false` for a fresh one.
     */
    static openSession(apiKey: string, { reuse }?: {
        reuse?: boolean;
    }): Promise<GoogleSatelliteSession>;
    static viewportCopyright(apiKey: string, token: GoogleSatelliteSession, bounds: {
        north: number;
        south: number;
        east: number;
        west: number;
    }, zoom: number): Promise<string>;
    getRasterURL(tileCoords: Vector2, zoom: number): string;
}
