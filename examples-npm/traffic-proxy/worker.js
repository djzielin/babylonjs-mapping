// Cloudflare Worker: live aircraft for the hosted demos. adsb.lol's open
// ADS-B API does not answer cross-origin requests, so a static site (GitHub
// Pages) cannot call it directly; this forwards the one query the demos make,
// adds CORS headers, and caches each answer briefly at the edge so many
// viewers of the same area cost adsb.lol one request.
//
//   GET /v2/point/{latitude}/{longitude}/{radius nautical miles}

const UPSTREAM = "https://api.adsb.lol";
const USER_AGENT = "babylonjs-mapping-globe-demo/1.0 (+https://github.com/djzielin/babylonjs-mapping)";
/** Seconds an answer is shared: the demos poll every few seconds. */
const CACHE_SECONDS = 4;
const MAX_RADIUS = 250;

export default {
    async fetch(request, env, context) {
        const origin = request.headers.get("Origin") ?? "";
        const allowed = allowedOrigin(origin, env.ALLOWED_ORIGINS);
        const cors = {
            "Access-Control-Allow-Origin": allowed ?? "null",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Max-Age": "86400",
            "Vary": "Origin",
        };
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
        if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors });
        if (origin && !allowed) return new Response("Origin not allowed", { status: 403, headers: cors });

        const match = new URL(request.url).pathname.match(/^\/v2\/point\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
        if (!match) return new Response("Expected /v2/point/{latitude}/{longitude}/{radius}", { status: 404, headers: cors });
        const latitude = Number(match[1]), longitude = Number(match[2]), radius = Number(match[3]);
        if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return new Response("Bad position", { status: 400, headers: cors });
        // Rounded, so nearby views share a cache entry: 0.05° is a few km, well inside any radius asked for.
        const round = value => (Math.round(value * 20) / 20).toFixed(2);
        const path = `/v2/point/${round(latitude)}/${round(longitude)}/${Math.max(1, Math.min(MAX_RADIUS, Math.ceil(radius)))}`;

        const cache = caches.default, key = new Request(`https://cache.invalid${path}`);
        let response = await cache.match(key);
        if (!response) {
            const upstream = await fetch(UPSTREAM + path, { headers: { "User-Agent": USER_AGENT, "Accept": "application/json" } });
            response = new Response(upstream.body, {
                status: upstream.status,
                headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
            });
            if (upstream.ok) context.waitUntil(cache.put(key, response.clone()));
        }
        const headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(cors)) headers.set(name, value);
        return new Response(response.body, { status: response.status, headers });
    },
};

/** The origin if the list (comma-separated, `*` for any) allows it; localhost always. */
function allowedOrigin(origin, list = "https://djzielin.github.io") {
    if (!origin) return undefined;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
    const origins = list.split(",").map(entry => entry.trim());
    return origins.includes("*") || origins.includes(origin) ? origin : undefined;
}
