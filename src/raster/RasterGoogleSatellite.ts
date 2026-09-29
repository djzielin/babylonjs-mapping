import { Vector2 } from "@babylonjs/core/Maths/math.js";
import type TileSet from "../core/TileSet.js";
import Raster from "./Raster.js";

export interface GoogleSatelliteSession {
    session: string;
    expiry: number;
}

/** Google Map Tiles API satellite imagery for the same area as 3D Tiles. */
export default class RasterGoogleSatellite extends Raster {
    constructor(tileSet: TileSet, private apiKey: string, private token: GoogleSatelliteSession) {
        super("Google Maps satellite", tileSet);
    }

    public static async openSession(apiKey: string): Promise<GoogleSatelliteSession> {
        const response = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(apiKey)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mapType: "satellite", language: "en-US", region: "US" }),
        });
        if (!response.ok) throw new Error(`Google satellite session HTTP ${response.status}`);
        const result = await response.json() as { session?: string; expiry?: string };
        const expiry = Number(result.expiry);
        if (!result.session || !Number.isFinite(expiry) || expiry * 1000 <= Date.now())
            throw new Error("Invalid Google satellite session");
        return { session: result.session, expiry };
    }

    public static async viewportCopyright(apiKey: string, token: GoogleSatelliteSession,
        bounds: { north: number; south: number; east: number; west: number }, zoom: number): Promise<string> {
        const query = new URLSearchParams({
            session: token.session, key: apiKey, zoom: String(zoom),
            north: String(bounds.north), south: String(bounds.south),
            east: String(bounds.east), west: String(bounds.west),
        });
        const response = await fetch(`https://tile.googleapis.com/tile/v1/viewport?${query}`);
        if (!response.ok) throw new Error(`Google satellite viewport HTTP ${response.status}`);
        const result = await response.json() as { copyright?: string };
        return result.copyright ?? "";
    }

    public override getRasterURL(tileCoords: Vector2, zoom: number): string {
        if (!Number.isInteger(zoom) || zoom < 0 || zoom > 22)
            throw new RangeError("Google satellite zoom must be an integer from 0 to 22");
        const count = 2 ** zoom;
        const x = ((Math.floor(tileCoords.x) % count) + count) % count;
        const y = Math.max(0, Math.min(count - 1, Math.floor(tileCoords.y)));
        const query = new URLSearchParams({ session: this.token.session, key: this.apiKey });
        return `https://tile.googleapis.com/v1/2dtiles/${zoom}/${x}/${y}?${query}`;
    }
}
