import { afterEach, describe, expect, it, vi } from "vitest";
import { findAddresses } from "../examples-npm/globe-mode/src/AddressSearch";

afterEach(() => vi.unstubAllGlobals());

describe("globe address lookup", () => {
    it("encodes arbitrary queries and maps GeoJSON longitude/latitude to a fly-to target", async () => {
        const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [{
            geometry: { coordinates: [-73.9857, 40.7484] },
            properties: { name: "Empire State Building", housenumber: "20", street: "West 34th Street", city: "New York", country: "United States", type: "house" },
        }] }) });
        vi.stubGlobal("fetch", fetcher);
        const signal = new AbortController().signal;
        const results = await findAddresses("20 W 34th St & 5th Ave", signal);
        const url = new URL(fetcher.mock.calls[0][0]);
        expect(url.searchParams.get("q")).toBe("20 W 34th St & 5th Ave");
        expect(url.searchParams.get("limit")).toBe("5");
        expect(fetcher.mock.calls[0][1].signal).toBe(signal);
        expect(results[0]).toEqual({ label: "Empire State Building, 20 West 34th Street, New York, United States", latitude: 40.7484, longitude: -73.9857, zoom: 16 });
    });
    it("ignores malformed coordinates and frames cities more broadly than addresses", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [
            { geometry: { coordinates: [151.2, -33.86] }, properties: { name: "Sydney", city: "Sydney", type: "city" } },
            { geometry: { coordinates: [0, 100] }, properties: { name: "Invalid" } },
            { properties: { name: "Missing location" } },
        ] }) }));
        expect(await findAddresses("Sydney", new AbortController().signal)).toEqual([
            { label: "Sydney", latitude: -33.86, longitude: 151.2, zoom: 12 },
        ]);
    });
    it("reports provider errors instead of inventing a destination", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
        await expect(findAddresses("address", new AbortController().signal)).rejects.toThrow("unavailable");
    });
});
