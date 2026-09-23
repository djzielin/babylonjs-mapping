import { describe, expect, it, vi } from "vitest";
import { aisStreamSubscription, fetchNYCRoadSpeeds, fetchOpenSkyAircraft, parseAISStreamPosition, parseNYCRoadSpeeds, parseOpenSkyStates } from "../src/traffic/TrafficSources";

describe("traffic source adapters", () => {
    it("parses NYC road geometry and treats unavailable readings as missing", () => {
        const roads = parseNYCRoadSpeeds([
            { link_id: "1", link_name: "FDR", speed: "34.52", status: "0", data_as_of: "2026-09-22T23:26:06.000", link_points: "40.7,-73.9 40.8,-73.8" },
            { link_id: "1", speed: "10", link_points: "40.7,-73.9 40.8,-73.8" },
            { link_id: "2", speed: "0", status: "-101", link_points: "40.6,-74.1 40.7,-74.0" },
            { link_id: "3", speed: "18", link_points: "invalid" },
            { link_id: "4", speed: "22", status: "0", link_points: "40.7,-73.9 40.8,-73.8 40.9,-7" },
        ]);
        expect(roads).toHaveLength(3);
        expect(roads[0].speedMph).toBe(34.52);
        expect(roads[0].path[0]).toEqual({ latitude: 40.7, longitude: -73.9 });
        expect(roads[1].speedMph).toBeNull();
        expect(roads[2].path).toHaveLength(2);
    });

    it("requests the recent NYC readings using the documented columns", async () => {
        const fetcher = vi.fn(async () => new Response("[]", { status: 200 }));
        await fetchNYCRoadSpeeds(fetcher as typeof fetch);
        const url = new URL(fetcher.mock.calls[0][0] as unknown as URL);
        expect(url.hostname).toBe("data.cityofnewyork.us");
        expect(url.searchParams.get("$order")).toBe("data_as_of DESC");
    });

    it("filters OpenSky states without valid positions and passes bounds", async () => {
        const valid = ["abc123", "TEST   ", "US", 123, 124, -73.8, 40.7, 2000, false, 150, 270];
        expect(parseOpenSkyStates({ states: [valid, ["bad", null, null, null, null, null, null]] })).toEqual([
            { id: "abc123", callsign: "TEST", longitude: -73.8, latitude: 40.7, altitudeMeters: 2000, speedMetersPerSecond: 150, heading: 270, observedAt: 123 },
        ]);
        const fetcher = vi.fn(async () => Response.json({ states: [valid] }));
        await fetchOpenSkyAircraft([40.5, -74.2, 40.9, -73.6], fetcher as typeof fetch, "token");
        const url = new URL(fetcher.mock.calls[0][0] as unknown as URL);
        expect(url.searchParams.get("lamin")).toBe("40.5");
        expect(fetcher.mock.calls[0][1]).toEqual({ headers: { Authorization: "Bearer token" } });
    });

    it("subscribes to and parses AIS position messages", () => {
        expect(aisStreamSubscription("key", [40.5, -74.2, 40.9, -73.6])).toMatchObject({
            BoundingBoxes: [[[40.9, -74.2], [40.5, -73.6]]],
        });
        const message = { MessageType: "PositionReport", MetaData: { MMSI: 123456789, ShipName: "FERRY", Latitude: 40.7, Longitude: -74.0 }, Message: { PositionReport: { Sog: 12.4, Cog: 86.7 } } };
        expect(parseAISStreamPosition(message, 1234)).toEqual({ id: "123456789", name: "FERRY", latitude: 40.7, longitude: -74, speedKnots: 12.4, heading: 86.7, observedAt: 1234 });
        expect(parseAISStreamPosition({ MessageType: "SubscriptionConfirmation" })).toBeNull();
    });
});
