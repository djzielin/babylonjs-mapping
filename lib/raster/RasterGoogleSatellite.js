import Raster from "./Raster.js";
/** Google Map Tiles API satellite imagery for the same area as 3D Tiles. */
export default class RasterGoogleSatellite extends Raster {
    apiKey;
    token;
    constructor(tileSet, apiKey, token) {
        super("Google Maps satellite", tileSet);
        this.apiKey = apiKey;
        this.token = token;
    }
    /**
     * Open a satellite tile session. Sessions last about two weeks and Google
     * asks clients to reuse them, so one is kept in localStorage until a day
     * before it expires: tile URLs stay the same across page loads and the
     * browser's HTTP cache can serve them. Pass `reuse: false` for a fresh one.
     */
    static async openSession(apiKey, { reuse = true } = {}) {
        const storageKey = `babylonjs-mapping/google-satellite-session/${fingerprint(apiKey)}`;
        if (reuse) {
            const stored = readStorage(storageKey);
            if (stored && stored.expiry * 1000 > Date.now() + 86_400_000)
                return stored;
        }
        const response = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(apiKey)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mapType: "satellite", language: "en-US", region: "US" }),
        });
        if (!response.ok)
            throw new Error(`Google satellite session HTTP ${response.status}`);
        const result = await response.json();
        const expiry = Number(result.expiry);
        if (!result.session || !Number.isFinite(expiry) || expiry * 1000 <= Date.now())
            throw new Error("Invalid Google satellite session");
        const session = { session: result.session, expiry };
        try {
            localStorage.setItem(storageKey, JSON.stringify(session));
        }
        catch { /* storage unavailable */ }
        return session;
    }
    static async viewportCopyright(apiKey, token, bounds, zoom) {
        const query = new URLSearchParams({
            session: token.session, key: apiKey, zoom: String(zoom),
            north: String(bounds.north), south: String(bounds.south),
            east: String(bounds.east), west: String(bounds.west),
        });
        const response = await fetch(`https://tile.googleapis.com/tile/v1/viewport?${query}`);
        if (!response.ok)
            throw new Error(`Google satellite viewport HTTP ${response.status}`);
        const result = await response.json();
        return result.copyright ?? "";
    }
    getRasterURL(tileCoords, zoom) {
        if (!Number.isInteger(zoom) || zoom < 0 || zoom > 22)
            throw new RangeError("Google satellite zoom must be an integer from 0 to 22");
        const count = 2 ** zoom;
        const x = ((Math.floor(tileCoords.x) % count) + count) % count;
        const y = Math.max(0, Math.min(count - 1, Math.floor(tileCoords.y)));
        const query = new URLSearchParams({ session: this.token.session, key: this.apiKey });
        return `https://tile.googleapis.com/v1/2dtiles/${zoom}/${x}/${y}?${query}`;
    }
}
/** A short, non-reversible tag for an API key, so the key itself is never stored. */
function fingerprint(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++)
        hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(36);
}
function readStorage(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) ?? "null");
        return typeof value?.session === "string" && Number.isFinite(value.expiry) ? value : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=RasterGoogleSatellite.js.map