import { Constants } from "@babylonjs/core/Engines/constants";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

/**
 * A flat panel of text in the headset: a plane whose texture is redrawn
 * only when its text changes, drawn over the world.
 */
export class TextPanel {
    public readonly mesh: Mesh;
    private readonly texture: DynamicTexture;
    private readonly material: StandardMaterial;
    private drawn = "";

    public constructor(name: string, scene: Scene, private readonly widthMetres: number, private readonly heightMetres: number,
        pixelsPerMetre: number, group: number, private readonly draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void) {
        this.mesh = CreatePlane(name, { width: widthMetres, height: heightMetres }, scene);
        this.texture = new DynamicTexture(name, { width: Math.round(widthMetres * pixelsPerMetre), height: Math.round(heightMetres * pixelsPerMetre) }, scene, true);
        this.texture.hasAlpha = true;
        const material = this.material = new StandardMaterial(name, scene);
        material.disableLighting = true;
        material.emissiveTexture = this.texture;
        material.opacityTexture = this.texture;
        material.diffuseColor = Color3.Black();
        material.depthFunction = Constants.ALWAYS;
        material.disableDepthWrite = true;
        material.fogEnabled = false;
        this.mesh.material = material;
        this.mesh.renderingGroupId = group;
        this.mesh.isPickable = false;
        this.mesh.alwaysSelectAsActiveMesh = true;
    }

    /** Redraws if `key` (a summary of what is drawn) changed. */
    public refresh(key: string): void {
        if (key === this.drawn) return;
        this.drawn = key;
        const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
        const { width, height } = this.texture.getSize();
        ctx.clearRect(0, 0, width, height);
        this.draw(ctx, width, height);
        this.texture.update(true);
    }

    public set alpha(alpha: number) {
        this.material.alpha = alpha;
        this.mesh.setEnabled(alpha > 0.01);
    }

    public dispose(): void {
        this.texture.dispose();
        this.material.dispose();
        this.mesh.dispose();
    }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/** Text in `font`, shortened with an ellipsis to fit `width`. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
    if (ctx.measureText(text).width <= width) return text;
    let low = 0, high = text.length;
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (ctx.measureText(text.slice(0, mid) + "…").width <= width) low = mid; else high = mid - 1;
    }
    return text.slice(0, low).trimEnd() + "…";
}

export interface WristState {
    title: string;
    detail: string;
    lines: string[];
}

/** On the left wrist: where you are, quietly; errors, when there are any. */
export function createWristPanel(scene: Scene, group: number, state: () => WristState): TextPanel {
    const panel = new TextPanel("xr wrist panel", scene, 0.15, 0.1, 4200, group, (ctx, w) => {
        const s = state();
        const pad = 30, lineHeight = 36;
        // Only as tall as what it says.
        const height = 132 + s.lines.length * lineHeight;
        ctx.fillStyle = "rgba(12, 15, 20, 0.72)";
        roundRect(ctx, 4, 4, w - 8, height, 30);
        ctx.fill();
        ctx.fillStyle = "#f2f5f8";
        ctx.font = `600 46px ${FONT}`;
        ctx.fillText(fitText(ctx, s.title, w - pad * 2), pad, 72);
        ctx.fillStyle = "rgba(242, 245, 248, 0.6)";
        ctx.font = `400 28px ${FONT}`;
        ctx.fillText(fitText(ctx, s.detail, w - pad * 2), pad, 114);
        ctx.font = `400 26px ${FONT}`;
        s.lines.forEach((line, i) => {
            ctx.fillStyle = s.lines.length === 1 ? "rgba(156, 201, 255, 0.75)" : "rgba(255, 190, 170, 0.9)";
            ctx.fillText(fitText(ctx, line, w - pad * 2), pad, 160 + i * lineHeight);
        });
    });
    // Above the back of the left hand, tilted toward the eyes.
    panel.mesh.position.set(0.02, 0.05, -0.06);
    panel.mesh.rotation.set(Math.PI / 3.2, 0, 0);
    return panel;
}

/** A small line low in the view: data credits, as unobtrusive as legible allows. */
export function createCreditLine(scene: Scene, group: number, camera: Node, text: () => string): TextPanel {
    const panel = new TextPanel("xr credits", scene, 0.5, 0.022, 4096, group, (ctx, w, h) => {
        ctx.font = `500 ${Math.round(h * 0.62)}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
        ctx.shadowBlur = 6;
        ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
        ctx.fillText(fitText(ctx, text(), w - 20), w / 2, h / 2);
    });
    panel.mesh.parent = camera;
    // 21 degrees below the centre of view, a metre away.
    panel.mesh.position.set(0, -0.38, 1);
    panel.mesh.rotation.x = 0.36;
    return panel;
}

/** A place's name, floating ahead on arrival. */
export function createCaption(scene: Scene, group: number, text: () => { title: string; text: string }): TextPanel {
    return new TextPanel("xr caption", scene, 1.4, 0.36, 1400, group, (ctx, w, h) => {
        const { title, text: detail } = text();
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
        ctx.shadowBlur = 18;
        ctx.fillStyle = "#ffffff";
        ctx.font = `600 ${Math.round(h * 0.36)}px ${FONT}`;
        ctx.fillText(fitText(ctx, title, w - 40), w / 2, h * 0.48);
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.font = `500 ${Math.round(h * 0.14)}px ${FONT}`;
        ctx.fillText(fitText(ctx, detail, w - 40), w / 2, h * 0.8);
    });
}
