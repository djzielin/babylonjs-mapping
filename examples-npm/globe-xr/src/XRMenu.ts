import type { Ray } from "@babylonjs/core/Culling/ray";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

import { findAddresses, type AddressResult } from "../../globe-mode/src/AddressSearch";
import type { XRPointerUI } from "./XRControls";
import { fitText, roundRect, TextPanel } from "./XRPanels";

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
/** The panel in metres, and its texture's resolution. */
const WIDTH = 0.56, HEIGHT = 0.42, PIXELS_PER_METRE = 1500;
const W = Math.round(WIDTH * PIXELS_PER_METRE), H = Math.round(HEIGHT * PIXELS_PER_METRE);
const PAD = 28;
const KEY_ROWS = ["qwertyuiop", "asdfghjkl'", "zxcvbnm,.-"];
/** Typing pauses this long before a search is sent. */
const SEARCH_DELAY_MS = 350;

export interface XRMenuActions {
    readonly tourOn: boolean;
    readonly trafficOn: boolean;
    readonly hasTraffic: boolean;
    toggleTour(): void;
    toggleTraffic(): void;
    overview(): void;
    goTo(result: AddressResult): void;
    /** Mapbox token for address search, or "" for Photon's place search. */
    readonly searchToken: string;
    readonly help: readonly string[];
}

export type Page = "main" | "search" | "help";

interface Target {
    id: string;
    x: number; y: number; w: number; h: number;
}

/**
 * The headset's menu: a panel floating ahead, worked with the laser. It
 * starts and stops the tour, finds places by name on a keyboard of its own,
 * and switches the live traffic.
 */
export class XRMenu implements XRPointerUI {
    private readonly panel: TextPanel;
    private page: Page = "main";
    private hovered = "";
    private query = "";
    private results: AddressResult[] = [];
    private status = "";
    private timer?: ReturnType<typeof setTimeout>;
    private request?: AbortController;
    private open = false;
    private readonly inverse = new Matrix();

    public constructor(scene: Scene, group: number, private readonly actions: XRMenuActions) {
        this.panel = new TextPanel("xr menu", scene, WIDTH, HEIGHT, PIXELS_PER_METRE, group, ctx => this.draw(ctx));
        this.panel.alpha = 0;
    }

    public get isOpen(): boolean {
        return this.open;
    }

    /** Opens ahead of `head` (rig-local, physical metres), facing it along `forward`, in `rig`. */
    public show(rig: TransformNode, head: Vector3, forward: Vector3, page: Page = "main"): void {
        const level = new Vector3(forward.x, 0, forward.z);
        if (level.lengthSquared() < 1e-6) level.set(0, 0, 1);
        level.normalize();
        const mesh = this.panel.mesh;
        mesh.parent = rig;
        // Within reach, a little below the eyes, tilted back to face them.
        mesh.position.copyFrom(head).addInPlace(level.scale(0.62));
        mesh.position.y = head.y - 0.2;
        mesh.rotation.set(0.3, Math.atan2(level.x, level.z), 0);
        this.page = page;
        this.hovered = "";
        this.open = true;
        this.panel.alpha = 1;
        this.redraw();
    }

    public hide(): void {
        this.open = false;
        this.panel.alpha = 0;
        this.cancelSearch();
    }

    public toggle(rig: TransformNode, head: Vector3, forward: Vector3): void {
        if (this.open) this.hide(); else this.show(rig, head, forward);
    }

    /** Redraws what may have changed elsewhere, such as the tour ending. */
    public refresh(): void {
        if (this.open) this.redraw();
    }

    public hover(ray: Ray): number | undefined {
        const hit = this.hit(ray);
        const id = hit ? this.targets().find(t => inside(t, hit.x, hit.y))?.id ?? "" : "";
        if (id !== this.hovered) { this.hovered = id; this.redraw(); }
        return hit?.distance;
    }

    public click(ray: Ray): void {
        const hit = this.hit(ray);
        // A click past the panel puts it away.
        if (!hit) { this.hide(); return; }
        const target = this.targets().find(t => inside(t, hit.x, hit.y));
        if (target) this.press(target.id);
    }

    public dispose(): void {
        this.cancelSearch();
        this.panel.dispose();
    }

    // ------------------------------------------------------------------ input

    private press(id: string): void {
        const a = this.actions;
        if (id === "search") { this.page = "search"; this.status = this.results.length ? "" : "Type a place, an address or a landmark"; }
        else if (id === "tour") { a.toggleTour(); if (a.tourOn) this.hide(); }
        else if (id === "traffic") a.toggleTraffic();
        else if (id === "overview") { this.hide(); a.overview(); }
        else if (id === "help") this.page = "help";
        else if (id === "back") this.page = "main";
        else if (id === "close") this.hide();
        else if (id.startsWith("result:")) {
            const result = this.results[Number(id.slice(7))];
            if (result) { this.hide(); a.goTo(result); }
        } else if (id.startsWith("key:")) this.type(id.slice(4));
        this.redraw();
    }

    private type(key: string): void {
        if (key === "space") this.query += " ";
        else if (key === "delete") this.query = this.query.slice(0, -1);
        else if (key === "clear") this.query = "";
        else this.query += key;
        this.query = this.query.slice(0, 60);
        this.scheduleSearch();
    }

    private scheduleSearch(): void {
        this.cancelSearch();
        const query = this.query.trim();
        if (query.length < 2) { this.results = []; this.status = "Type a place, an address or a landmark"; return; }
        this.status = "Searching…";
        this.timer = setTimeout(() => void this.search(query), SEARCH_DELAY_MS);
    }

    private async search(query: string): Promise<void> {
        const request = this.request = new AbortController();
        try {
            // Landmarks and places (Photon) first, then street addresses (Mapbox), each place once.
            const token = this.actions.searchToken;
            const [places, addresses] = await Promise.all([
                findAddresses(query, request.signal, ""),
                token ? findAddresses(query, request.signal, token).catch(() => []) : Promise.resolve([]),
            ]);
            const results: AddressResult[] = [];
            for (const result of [...places.slice(0, 2), ...addresses, ...places.slice(2)])
                if (!results.some(r => Math.abs(r.latitude - result.latitude) + Math.abs(r.longitude - result.longitude) < 0.02)) results.push(result);
            if (request.signal.aborted) return;
            this.results = results.slice(0, 3);
            this.status = results.length ? "" : "No places found";
        } catch (error) {
            if (request.signal.aborted) return;
            this.results = [];
            this.status = "Search is unavailable just now";
            console.warn(error);
        }
        this.redraw();
    }

    private cancelSearch(): void {
        clearTimeout(this.timer);
        this.request?.abort();
        this.request = undefined;
    }

    // ----------------------------------------------------------------- layout

    /** Where the ray meets the panel's face, in texture pixels, and how far along it. */
    private hit(ray: Ray): { x: number; y: number; distance: number } | undefined {
        if (!this.open) return undefined;
        const mesh = this.panel.mesh;
        mesh.computeWorldMatrix(true).invertToRef(this.inverse);
        const origin = Vector3.TransformCoordinates(ray.origin, this.inverse);
        const ahead = Vector3.TransformCoordinates(ray.origin.add(ray.direction), this.inverse).subtractInPlace(origin);
        // The plane's face is toward -z; a ray from behind, or along it, misses.
        if (ahead.z <= 1e-9 || origin.z >= 0) return undefined;
        const t = -origin.z / ahead.z;
        const x = origin.x + ahead.x * t, y = origin.y + ahead.y * t;
        const u = (x / WIDTH + 0.5) * W, v = (0.5 - y / HEIGHT) * H;
        if (u < 0 || u > W || v < 0 || v > Math.min(H, this.pageHeight())) return undefined;
        return { x: u, y: v, distance: t * ray.direction.length() };
    }

    private targets(): Target[] {
        const inner = W - PAD * 2;
        if (this.page === "main") {
            const rows = ["search", "tour", ...this.actions.hasTraffic ? ["traffic"] : [], "overview", "help"];
            const h = 74, top = 78;
            return [{ id: "close", x: W - PAD - 64, y: 18, w: 64, h: 48 }, ...rows.map((id, i) => ({ id, x: PAD, y: top + i * (h + 6), w: inner, h }))];
        }
        if (this.page === "help") return [{ id: "back", x: PAD, y: 96 + this.actions.help.length * 50 + 10, w: 160, h: 64 }];
        // Search: back, the field, three results, then the keys.
        const targets: Target[] = [{ id: "back", x: PAD, y: 18, w: 96, h: 56 }];
        this.results.forEach((_, i) => targets.push({ id: `result:${i}`, x: PAD, y: 140 + i * 50, w: inner, h: 46 }));
        const keyW = (inner - 9 * 6) / 10, keyH = 54, keysTop = 300;
        KEY_ROWS.forEach((row, r) => [...row].forEach((key, k) =>
            targets.push({ id: `key:${key}`, x: PAD + k * (keyW + 6), y: keysTop + r * (keyH + 6), w: keyW, h: keyH })));
        const last = keysTop + 3 * (keyH + 6);
        targets.push({ id: "key:clear", x: PAD, y: last, w: keyW * 2 + 6, h: keyH });
        targets.push({ id: "key:space", x: PAD + 2 * (keyW + 6), y: last, w: keyW * 6 + 30, h: keyH });
        targets.push({ id: "key:delete", x: PAD + 8 * (keyW + 6), y: last, w: keyW * 2 + 6, h: keyH });
        return targets;
    }

    // ---------------------------------------------------------------- drawing

    private redraw(): void {
        this.panel.refresh(`${this.page}|${this.hovered}|${this.query}|${this.status}|${this.results.map(r => r.label).join("/")}|${this.actions.tourOn}|${this.actions.trafficOn}`);
    }

    /** Pixels of the panel each page fills, from the top: the rest is left clear. */
    private pageHeight(): number {
        if (this.page === "search") return H;
        if (this.page === "help") return 96 + this.actions.help.length * 50 + 100;
        const rows = this.targets().filter(t => t.id !== "close");
        return rows[rows.length - 1].y + rows[rows.length - 1].h + PAD;
    }

    private draw(ctx: CanvasRenderingContext2D): void {
        ctx.fillStyle = "rgba(12, 15, 20, 0.86)";
        roundRect(ctx, 2, 2, W - 4, Math.min(H, this.pageHeight()) - 4, 30);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.textBaseline = "middle";
        const targets = new Map(this.targets().map(t => [t.id, t]));
        const a = this.actions;
        const button = (id: string, label: string, options: { value?: string; align?: "left" | "center"; size?: number; quiet?: boolean } = {}) => {
            const t = targets.get(id);
            if (!t) return;
            const hovered = this.hovered === id;
            ctx.fillStyle = hovered ? "rgba(156, 201, 255, 0.22)" : options.quiet ? "rgba(255, 255, 255, 0)" : "rgba(255, 255, 255, 0.06)";
            roundRect(ctx, t.x, t.y, t.w, t.h, Math.min(16, t.h / 3));
            ctx.fill();
            ctx.font = `500 ${options.size ?? 30}px ${FONT}`;
            ctx.fillStyle = hovered ? "#ffffff" : "rgba(242, 245, 248, 0.88)";
            ctx.textAlign = options.align ?? "left";
            const x = options.align === "center" ? t.x + t.w / 2 : t.x + 22;
            ctx.fillText(fitText(ctx, label, t.w - 44 - (options.value ? 120 : 0)), x, t.y + t.h / 2 + 1);
            if (options.value) {
                ctx.textAlign = "right";
                ctx.fillStyle = options.value === "On" ? "rgba(156, 201, 255, 0.95)" : "rgba(242, 245, 248, 0.45)";
                ctx.fillText(options.value, t.x + t.w - 22, t.y + t.h / 2 + 1);
            }
        };
        const heading = (text: string, x = PAD + 4) => {
            ctx.textAlign = "left";
            ctx.font = `600 30px ${FONT}`;
            ctx.fillStyle = "rgba(242, 245, 248, 0.55)";
            ctx.fillText(text, x, 44);
        };

        if (this.page === "main") {
            heading("Menu");
            button("close", "✕", { align: "center", size: 28, quiet: true });
            button("search", "Search places");
            button("tour", "Tour", { value: a.tourOn ? "On" : "Off" });
            button("traffic", "Live traffic", { value: a.trafficOn ? "On" : "Off" });
            button("overview", "Whole globe");
            button("help", "Controls");
            return;
        }
        if (this.page === "help") {
            heading("Controls");
            ctx.font = `400 25px ${FONT}`;
            a.help.forEach((line, i) => {
                // Continuations are indented and quieter.
                const more = line.startsWith(" ");
                ctx.fillStyle = more ? "rgba(242, 245, 248, 0.6)" : "rgba(242, 245, 248, 0.9)";
                ctx.fillText(fitText(ctx, line.trim(), W - PAD * 2 - (more ? 30 : 0)), PAD + 4 + (more ? 30 : 0), 96 + i * 50);
            });
            button("back", "‹  Back", { quiet: true });
            return;
        }
        button("back", "‹", { align: "center", size: 34, quiet: true });
        // The field: what has been typed, and a caret.
        const fieldX = PAD + 110, fieldW = W - PAD - fieldX;
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        roundRect(ctx, fieldX, 18, fieldW, 56, 16);
        ctx.fill();
        ctx.textAlign = "left";
        ctx.font = `400 30px ${FONT}`;
        ctx.fillStyle = this.query ? "#ffffff" : "rgba(242, 245, 248, 0.4)";
        const shown = this.query ? fitText(ctx, this.query, fieldW - 50) : "Search places";
        ctx.fillText(shown, fieldX + 20, 47);
        if (this.query) {
            const caret = fieldX + 22 + ctx.measureText(shown).width;
            ctx.fillStyle = "rgba(156, 201, 255, 0.9)";
            ctx.fillRect(caret, 30, 3, 34);
        }
        if (this.status) {
            ctx.font = `400 26px ${FONT}`;
            ctx.fillStyle = "rgba(242, 245, 248, 0.5)";
            ctx.fillText(this.status, PAD + 6, 120);
        }
        this.results.forEach((result, i) => button(`result:${i}`, result.label, { size: 26 }));
        for (const row of KEY_ROWS) for (const key of row) button(`key:${key}`, key, { align: "center", size: 30 });
        button("key:clear", "Clear", { align: "center", size: 26 });
        button("key:space", "space", { align: "center", size: 26 });
        button("key:delete", "⌫", { align: "center", size: 30 });
    }
}

function inside(t: Target, x: number, y: number): boolean {
    return x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h;
}
