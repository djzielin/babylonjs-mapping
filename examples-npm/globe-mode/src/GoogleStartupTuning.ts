/** Diagnostic overrides let startup throughput be measured without changing quality demand. */
export function googleStartupTuning(search: string) {
    const query = new URLSearchParams(search);
    const bounded = (name: string, fallback: number, maximum: number) => {
        const raw = query.get(name);
        const value = raw === null ? NaN : Number(raw);
        return Number.isInteger(value) && value >= 1 && value <= maximum ? value : fallback;
    };
    return { requests: bounded("tileRequests", 512, 512), decodes: bounded("tileDecodes", 192, 192),
        buffer: bounded("tileBuffer", 1024, 1024), fastStaticModels: query.get("staticTiles") !== "0" };
}
