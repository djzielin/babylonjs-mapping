import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { WebGPUSnapshotRendering } from "@babylonjs/core/Engines/WebGPU/webgpuSnapshotRendering";
import type { WebGPUBundleList } from "@babylonjs/core/Engines/WebGPU/webgpuBundleList";

/** Keep asynchronous texture passes outside the scene's recorded draw sequence. */
export class FrameScopedSnapshots extends WebGPUSnapshotRendering {
    public active = false;
    constructor(engine: WebGPUEngine, bundles: WebGPUBundleList, private delegate: WebGPUSnapshotRendering) {
        super(engine, delegate.mode, bundles);
    }
    public override get enabled(): boolean { return this.active && this.delegate.enabled; }
    public override set enabled(value: boolean) { this.delegate.enabled = value; }
    public override get play(): boolean { return this.active && this.delegate.play; }
    public override get record(): boolean { return this.active && this.delegate.record; }
    public override get mode(): number { return this.delegate.mode; }
    public override set mode(value: number) { this.delegate.mode = value; }
    public override endRenderPass(pass: GPURenderPassEncoder): boolean {
        return this.active ? this.delegate.endRenderPass(pass) : false;
    }
    public override endFrame(): void {
        if (this.active) this.delegate.endFrame();
        this.active = false;
    }
    public override reset(): void { this.delegate.reset(); }
}

export class StreamingWebGPUEngine extends WebGPUEngine {
    private frameSnapshots?: FrameScopedSnapshots;
    public override async initAsync(...options: Parameters<WebGPUEngine["initAsync"]>): Promise<void> {
        await super.initAsync(...options);
        this.frameSnapshots = new FrameScopedSnapshots(this, this._bundleList, this._snapshotRendering);
        this._snapshotRendering = this.frameSnapshots;
    }
    public override beginFrame(): void {
        // Finish any upload-side render pass before recording/replaying the scene.
        if (this._currentRenderPass) this.flushFramebuffer();
        if (this.frameSnapshots) this.frameSnapshots.active = true;
        super.beginFrame();
    }
}
