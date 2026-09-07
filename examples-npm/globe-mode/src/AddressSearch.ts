export interface AddressResult {
    label: string;
    latitude: number;
    longitude: number;
    zoom: number;
}

/** Photon supports autocomplete; the public Nominatim service does not. */
export async function findAddresses(query: string, signal: AbortSignal): Promise<AddressResult[]> {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "5");
    const response = await fetch(url.toString(), { signal });
    if (!response.ok) throw new Error("Address search is unavailable. Please try again.");
    const data = await response.json();
    const results: AddressResult[] = [];
    for (const feature of data.features ?? []) {
        const [longitude, latitude] = feature.geometry?.coordinates ?? [];
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
        const p = feature.properties ?? {};
        const street = [p.housenumber, p.street].filter(Boolean).join(" ");
        const parts = [p.name, street, p.city || p.town || p.village, p.state, p.country].filter((v): v is string => typeof v === "string" && v.length > 0);
        const label = parts.filter((v, i) => parts.indexOf(v) === i).join(", ");
        if (!label) continue;
        results.push({ label, latitude, longitude, zoom: p.type === "country" ? 5 : p.type === "state" ? 7 : p.type === "city" ? 12 : 16 });
    }
    return results;
}

export function setupAddressSearch(onSelect: (result: AddressResult) => void): void {
    const input = document.getElementById("addressSearch") as HTMLInputElement;
    const list = document.getElementById("addressResults")!;
    const status = document.getElementById("addressStatus")!;
    const cache = new Map<string, AddressResult[]>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    let revision = 0;
    let active = -1;
    let results: AddressResult[] = [];

    const close = () => {
        revision++;
        clearTimeout(timer);
        request?.abort();
        list.hidden = true;
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
        active = -1;
        status.textContent = "";
    };
    const select = (index: number) => {
        const result = results[index];
        if (!result) return;
        input.value = result.label;
        close();
        onSelect(result);
    };
    const highlight = (index: number) => {
        active = index;
        Array.from(list.children).forEach((item, i) => item.setAttribute("aria-selected", String(i === active)));
        input.setAttribute("aria-activedescendant", `address-result-${active}`);
        list.children[active]?.scrollIntoView({ block: "nearest" });
    };
    const render = (items: AddressResult[]) => {
        results = items;
        active = -1;
        list.replaceChildren();
        for (let i = 0; i < items.length; i++) {
            const item = document.createElement("li");
            item.id = `address-result-${i}`;
            item.setAttribute("role", "option");
            item.setAttribute("aria-selected", "false");
            item.textContent = items[i].label;
            item.addEventListener("pointerdown", event => event.preventDefault());
            item.addEventListener("click", () => select(i));
            list.append(item);
        }
        list.hidden = items.length === 0;
        input.setAttribute("aria-expanded", String(items.length > 0));
        status.textContent = items.length ? `${items.length} suggestions. Use arrow keys and Enter to choose.` : "No matches. Try adding a city or postal code.";
    };
    input.addEventListener("input", () => {
        close();
        if (input.value.trim().length < 3) return;
        const query = input.value.trim();
        const version = revision;
        const cached = cache.get(query.toLowerCase());
        if (cached) { render(cached); return; }
        status.textContent = "Searching…";
        timer = setTimeout(async () => {
            const controller = new AbortController();
            request = controller;
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
                const items = await findAddresses(query, controller.signal);
                if (version !== revision) return;
                if (cache.size >= 40) cache.delete(cache.keys().next().value!);
                cache.set(query.toLowerCase(), items);
                render(items);
            } catch {
                if (version === revision) status.textContent = "Search unavailable. Please try again.";
            } finally {
                clearTimeout(timeout);
            }
        }, 450);
    });
    input.addEventListener("keydown", event => {
        if (event.isComposing) return;
        if (event.key === "Escape") { close(); return; }
        if (list.hidden || !results.length) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            highlight(active < 0 ? (event.key === "ArrowDown" ? 0 : results.length - 1) : (active + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
        } else if (event.key === "Enter") {
            event.preventDefault();
            select(active < 0 ? 0 : active);
        }
    });
    input.addEventListener("blur", close);
}
