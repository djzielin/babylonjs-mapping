import type { Engine } from "@babylonjs/core/Engines/engine";
import { Logger } from "@babylonjs/core/Misc/logger";
import type { Scene } from "@babylonjs/core/scene";

/**
 * What a headset can't show otherwise: errors (shader compile failures
 * included, which Babylon only logs), and where each frame's time goes.
 * Errors appear on the page and, through `errors`, in VR.
 */
export class Diagnostics {
    public readonly errors: string[] = [];
    /** Main-thread milliseconds per frame, averaged over the last second. */
    public cpuMs = 0;
    public readonly gpu: string;
    private readonly box = document.getElementById("diagnostics");
    private cpu = { total: 0, frames: 0, since: 0, start: 0 };

    public constructor(engine: Engine, scene: Scene) {
        const info = engine.getGlInfo();
        this.gpu = `${info.renderer} · WebGL ${engine.webGLVersion}`;
        addEventListener("error", event => this.add(event.message || String(event.error)));
        addEventListener("unhandledrejection", event => this.add(`Unhandled: ${event.reason?.message ?? event.reason}`));
        const error = console.error.bind(console);
        console.error = (...args: unknown[]) => { error(...args); this.add(args.map(String).join(" ")); };
        Logger.OnNewCacheEntry = entry => { if (/error/i.test(entry) && !/Failed to load resource/.test(entry)) this.add(entry.replace(/<[^>]+>/g, "")); };
        scene.onBeforeAnimationsObservable.add(() => { this.cpu.start = performance.now(); });
        scene.onAfterRenderObservable.add(() => this.frameEnd());
    }

    /** One line for the wrist: the frame's main-thread time. (Quest Browser has no GPU timer queries.) */
    public get summary(): string {
        return `CPU ${this.cpuMs.toFixed(1)} ms`;
    }

    private frameEnd(): void {
        const now = performance.now(), cpu = this.cpu;
        cpu.total += now - cpu.start;
        cpu.frames++;
        if (now - cpu.since < 1000) return;
        this.cpuMs = cpu.total / cpu.frames;
        cpu.total = cpu.frames = 0;
        cpu.since = now;
    }

    public add(message: string): void {
        const text = message.trim().slice(0, 300);
        if (!text || this.errors.includes(text) || this.errors.length >= 12) return;
        this.errors.push(text);
        if (!this.box) return;
        this.box.hidden = false;
        this.box.textContent = `${this.gpu}\n${this.errors.join("\n")}`;
    }
}
