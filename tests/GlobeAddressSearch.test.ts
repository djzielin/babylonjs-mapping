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
    it("prefers configured Mapbox geocoding and uses its full address and coordinates", async () => {
        const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [
            { geometry: { coordinates: [-77, 38] }, properties: { feature_type: "address", full_address: "12 Example Drive, Example City" } },
            { geometry: { coordinates: [-77.1, 38.1] }, properties: { feature_type: "place", name: "Example City", place_formatted: "Virginia" } },
            { geometry: { coordinates: [0, 100] }, properties: { full_address: "Invalid" } },
        ] }) });
        vi.stubGlobal("fetch", fetcher);
        const signal = new AbortController().signal;
        const results = await findAddresses("12 Example Dr VA", signal, " demo-token ");
        const url = new URL(fetcher.mock.calls[0][0]);
        expect(url.origin).toBe("https://api.mapbox.com");
        expect(url.searchParams.get("q")).toBe("12 Example Dr VA");
        expect(url.searchParams.get("access_token")).toBe("demo-token");
        expect(url.searchParams.get("autocomplete")).toBe("true");
        expect(fetcher.mock.calls[0][1].signal).toBe(signal);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(results).toEqual([
            { label: "12 Example Drive, Example City", longitude: -77, latitude: 38, zoom: 16 },
            { label: "Example City, Virginia", longitude: -77.1, latitude: 38.1, zoom: 12 },
        ]);
    });
    it.each(["empty", "denied", "network"])("falls back to Photon when Mapbox is %s", async failure => {
        const fetcher = vi.fn();
        if (failure === "network") fetcher.mockRejectedValueOnce(new TypeError("network"));
        else fetcher.mockResolvedValueOnce({ ok: failure === "empty", json: async () => ({ features: [] }) });
        fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ features: [{
            geometry: { coordinates: [1, 2] }, properties: { name: "Example Park" },
        }] }) });
        vi.stubGlobal("fetch", fetcher);
        const results = await findAddresses("Example Park", new AbortController().signal, "demo-token");
        expect(results[0].label).toBe("Example Park");
        expect(new URL(fetcher.mock.calls[1][0]).hostname).toBe("photon.komoot.io");
    });
    it("does not fall back after an obsolete autocomplete request is aborted", async () => {
        const controller = new AbortController();
        const fetcher = vi.fn().mockImplementation(async () => {
            controller.abort();
            throw new DOMException("Aborted", "AbortError");
        });
        vi.stubGlobal("fetch", fetcher);
        await expect(findAddresses("Example", controller.signal, "demo-token")).rejects.toThrow("Aborted");
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it("reports provider errors instead of inventing a destination", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
        await expect(findAddresses("address", new AbortController().signal)).rejects.toThrow("unavailable");
    });
});
