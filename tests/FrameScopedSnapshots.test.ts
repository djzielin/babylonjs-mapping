import { expect, it, vi } from "vitest";
import { WebGPUSnapshotRendering } from "@babylonjs/core/Engines/WebGPU/webgpuSnapshotRendering";
import type { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import type { WebGPUBundleList } from "@babylonjs/core/Engines/WebGPU/webgpuBundleList";
import { FrameScopedSnapshots } from "../examples-npm/globe-mode/src/StreamingWebGPUEngine";

it("preserves cached draws while excluding asynchronous texture passes between frames", () => {
    const run = vi.fn();
    const engine = { _reportDrawCall: vi.fn() } as unknown as WebGPUEngine;
    const bundles = { clone: () => ({ run, numDrawCalls: 12 }), reset: vi.fn() } as unknown as WebGPUBundleList;
    const original = new WebGPUSnapshotRendering(engine, 1, bundles);
    const scoped = new FrameScopedSnapshots(engine, bundles, original);
    const pass = {} as GPURenderPassEncoder;
    scoped.enabled = true;
    expect(scoped.enabled).toBe(false);
    expect(scoped.endRenderPass(pass)).toBe(false);
    scoped.active = true;
    expect(scoped.record).toBe(true); expect(scoped.endRenderPass(pass)).toBe(true);
    scoped.endFrame();
    expect(scoped.play).toBe(false); expect(scoped.endRenderPass(pass)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    scoped.active = true;
    expect(scoped.play).toBe(true); scoped.endRenderPass(pass); scoped.endFrame();
    expect(run).toHaveBeenCalledTimes(2);
    scoped.enabled = false;
    scoped.active = true;
    expect(scoped.play).toBe(false); expect(scoped.endRenderPass(pass)).toBe(false);
});
