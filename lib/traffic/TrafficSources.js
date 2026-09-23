const finite = (value) => typeof value === "number" && Number.isFinite(value);
const latitude = (value) => finite(value) && value >= -90 && value <= 90;
const longitude = (value) => finite(value) && value >= -180 && value <= 180;
const numberOrNull = (value) => finite(value) ? value : null;
export function parseNYCRoadSpeeds(rows) {
    if (!Array.isArray(rows))
        return [];
    const result = [];
    const seen = new Set();
    for (const value of rows) {
        if (!value || typeof value !== "object")
            continue;
        const row = value;
        if (typeof row.link_id !== "string" || seen.has(row.link_id) || typeof row.link_points !== "string")
            continue;
        const path = row.link_points.split(/\s+/).map(point => {
            const [lat, lon] = point.split(",").map(Number);
            return { latitude: lat, longitude: lon };
        }).filter(point => latitude(point.latitude) && longitude(point.longitude));
        if (path.length < 2)
            continue;
        seen.add(row.link_id);
        const speed = Number(row.speed);
        // DOT uses status -101 and zero speed for unavailable observations.
        result.push({
            id: row.link_id,
            name: typeof row.link_name === "string" ? row.link_name : row.link_id,
            speedMph: row.status === "-101" || !Number.isFinite(speed) ? null : speed,
            observedAt: typeof row.data_as_of === "string" ? row.data_as_of : "",
            path,
        });
    }
    return result;
}
export async function fetchNYCRoadSpeeds(fetcher = fetch, limit = 600) {
    const url = new URL("https://data.cityofnewyork.us/resource/i4gi-tjb9.json");
    url.searchParams.set("$select", "link_id,link_name,speed,status,data_as_of,link_points");
    url.searchParams.set("$order", "data_as_of DESC");
    url.searchParams.set("$limit", String(Math.min(1000, Math.max(1, Math.floor(limit)))));
    const response = await fetcher(url);
    if (!response.ok)
        throw new Error(`NYC DOT request failed: ${response.status}`);
    return parseNYCRoadSpeeds(await response.json());
}
export function parseOpenSkyStates(value) {
    if (!value || typeof value !== "object")
        return [];
    const rows = value.states;
    if (!Array.isArray(rows))
        return [];
    const result = [];
    for (const row of rows) {
        if (!Array.isArray(row) || typeof row[0] !== "string" || !longitude(row[5]) || !latitude(row[6]))
            continue;
        result.push({
            id: row[0],
            callsign: typeof row[1] === "string" && row[1].trim() ? row[1].trim() : row[0],
            longitude: row[5], latitude: row[6],
            altitudeMeters: numberOrNull(row[7]),
            speedMetersPerSecond: numberOrNull(row[9]),
            heading: numberOrNull(row[10]),
            observedAt: finite(row[3]) ? row[3] : 0,
        });
    }
    return result;
}
export async function fetchOpenSkyAircraft(bounds, fetcher = fetch, token) {
    const [south, west, north, east] = bounds;
    if (![south, west, north, east].every(Number.isFinite) || south >= north || west >= east || !latitude(south) || !latitude(north) || !longitude(west) || !longitude(east))
        throw new RangeError("Invalid OpenSky bounds");
    const url = new URL("https://opensky-network.org/api/states/all");
    for (const [key, value] of Object.entries({ lamin: south, lomin: west, lamax: north, lomax: east }))
        url.searchParams.set(key, String(value));
    const response = await fetcher(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    if (!response.ok)
        throw new Error(`OpenSky request failed: ${response.status}`);
    return parseOpenSkyStates(await response.json());
}
export function aisStreamSubscription(apiKey, bounds) {
    const [south, west, north, east] = bounds;
    if (!apiKey || south >= north || west >= east || !latitude(south) || !latitude(north) || !longitude(west) || !longitude(east))
        throw new RangeError("AISStream requires an API key and valid bounds");
    return {
        APIKey: apiKey,
        BoundingBoxes: [[[north, west], [south, east]]],
        FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport"],
    };
}
export function parseAISStreamPosition(value, observedAt = Date.now()) {
    if (!value || typeof value !== "object")
        return null;
    const envelope = value;
    const type = envelope.MessageType;
    if (type !== "PositionReport" && type !== "StandardClassBPositionReport" && type !== "ExtendedClassBPositionReport")
        return null;
    const metadata = envelope.MetaData;
    const message = envelope.Message;
    const report = message?.[type];
    if (!metadata || !report || !latitude(metadata.Latitude) || !longitude(metadata.Longitude))
        return null;
    const id = metadata.MMSI ?? report.UserID;
    if (typeof id !== "string" && !finite(id))
        return null;
    return {
        id: String(id),
        name: typeof metadata.ShipName === "string" && metadata.ShipName.trim() ? metadata.ShipName.trim() : String(id),
        latitude: metadata.Latitude, longitude: metadata.Longitude,
        heading: numberOrNull(report.Cog),
        speedKnots: numberOrNull(report.Sog),
        observedAt,
    };
}
//# sourceMappingURL=TrafficSources.js.map