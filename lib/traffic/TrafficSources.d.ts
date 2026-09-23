/** WGS84 bounds in south, west, north, east order. */
export type TrafficBounds = readonly [number, number, number, number];
export interface RoadSpeed {
    id: string;
    name: string;
    speedMph: number | null;
    observedAt: string;
    path: {
        latitude: number;
        longitude: number;
    }[];
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
export declare function parseNYCRoadSpeeds(rows: unknown): RoadSpeed[];
export declare function fetchNYCRoadSpeeds(fetcher?: typeof fetch, limit?: number): Promise<RoadSpeed[]>;
export declare function parseOpenSkyStates(value: unknown): AircraftPosition[];
export declare function fetchOpenSkyAircraft(bounds: TrafficBounds, fetcher?: typeof fetch, token?: string): Promise<AircraftPosition[]>;
export declare function aisStreamSubscription(apiKey: string, bounds: TrafficBounds): object;
export declare function parseAISStreamPosition(value: unknown, observedAt?: number): VesselPosition | null;
