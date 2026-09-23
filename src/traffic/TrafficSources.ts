/** WGS84 bounds in south, west, north, east order. */
export type TrafficBounds = readonly [number, number, number, number];

export interface RoadSpeed {
    id: string;
    name: string;
    speedMph: number | null;
    observedAt: string;
    path: { latitude: number; longitude: number }[];
}

export interface AircraftPosition {
    id: string;
    callsign: string;
    latitude: number;
    longitude: number;
    altitudeMeters: number | null;
    heading: number | null;
    speedMetersPerSecond: number | null;
    observedAt: number;
}

export interface VesselPosition {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    heading: number | null;
    speedKnots: number | null;
    observedAt: number;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const latitude = (value: unknown): value is number => finite(value) && value >= -90 && value <= 90;
const longitude = (value: unknown): value is number => finite(value) && value >= -180 && value <= 180;
const numberOrNull = (value: unknown): number | null => finite(value) ? value : null;

export function parseNYCRoadSpeeds(rows: unknown): RoadSpeed[] {
    if (!Array.isArray(rows)) return [];
    const result: RoadSpeed[] = [];
    const seen = new Set<string>();
    for (const value of rows) {
        if (!value || typeof value !== "object") continue;
        const row = value as Record<string, unknown>;
        if (typeof row.link_id !== "string" || seen.has(row.link_id) || typeof row.link_points !== "string") continue;
        const path = row.link_points.split(/\s+/).map(point => {
            const [lat, lon] = point.split(",").map(Number);
            return { latitude: lat, longitude: lon };
        }).filter(point => latitude(point.latitude) && longitude(point.longitude));
        if (path.length < 2) continue;
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

export async function fetchNYCRoadSpeeds(fetcher: typeof fetch = fetch, limit = 600): Promise<RoadSpeed[]> {
    const url = new URL("https://data.cityofnewyork.us/resource/i4gi-tjb9.json");
    url.searchParams.set("$select", "link_id,link_name,speed,status,data_as_of,link_points");
    url.searchParams.set("$order", "data_as_of DESC");
    url.searchParams.set("$limit", String(Math.min(1000, Math.max(1, Math.floor(limit)))));
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`NYC DOT request failed: ${response.status}`);
    return parseNYCRoadSpeeds(await response.json());
}

export function parseOpenSkyStates(value: unknown): AircraftPosition[] {
    if (!value || typeof value !== "object") return [];
    const rows = (value as { states?: unknown }).states;
    if (!Array.isArray(rows)) return [];
    const result: AircraftPosition[] = [];
    for (const row of rows) {
        if (!Array.isArray(row) || typeof row[0] !== "string" || !longitude(row[5]) || !latitude(row[6])) continue;
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

export async function fetchOpenSkyAircraft(bounds: TrafficBounds, fetcher: typeof fetch = fetch, token?: string): Promise<AircraftPosition[]> {
    const [south, west, north, east] = bounds;
    if (![south, west, north, east].every(Number.isFinite) || south >= north || west >= east || !latitude(south) || !latitude(north) || !longitude(west) || !longitude(east))
        throw new RangeError("Invalid OpenSky bounds");
    const url = new URL("https://opensky-network.org/api/states/all");
    for (const [key, value] of Object.entries({ lamin: south, lomin: west, lamax: north, lomax: east })) url.searchParams.set(key, String(value));
    const response = await fetcher(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    if (!response.ok) throw new Error(`OpenSky request failed: ${response.status}`);
    return parseOpenSkyStates(await response.json());
}

export function aisStreamSubscription(apiKey: string, bounds: TrafficBounds): object {
    const [south, west, north, east] = bounds;
    if (!apiKey || south >= north || west >= east || !latitude(south) || !latitude(north) || !longitude(west) || !longitude(east))
        throw new RangeError("AISStream requires an API key and valid bounds");
    return {
        APIKey: apiKey,
        BoundingBoxes: [[ [north, west], [south, east] ]],
        FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport"],
    };
}

export function parseAISStreamPosition(value: unknown, observedAt = Date.now()): VesselPosition | null {
    if (!value || typeof value !== "object") return null;
    const envelope = value as Record<string, unknown>;
    const type = envelope.MessageType;
    if (type !== "PositionReport" && type !== "StandardClassBPositionReport" && type !== "ExtendedClassBPositionReport") return null;
    const metadata = envelope.MetaData as Record<string, unknown> | undefined;
    const message = envelope.Message as Record<string, unknown> | undefined;
    const report = message?.[type] as Record<string, unknown> | undefined;
    if (!metadata || !report || !latitude(metadata.Latitude) || !longitude(metadata.Longitude)) return null;
    const id = metadata.MMSI ?? report.UserID;
    if (typeof id !== "string" && !finite(id)) return null;
    return {
        id: String(id),
        name: typeof metadata.ShipName === "string" && metadata.ShipName.trim() ? metadata.ShipName.trim() : String(id),
        latitude: metadata.Latitude, longitude: metadata.Longitude,
        heading: numberOrNull(report.Cog),
        speedKnots: numberOrNull(report.Sog),
        observedAt,
    };
}
