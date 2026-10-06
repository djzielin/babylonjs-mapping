import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine, Scene } from "@babylonjs/core";
import { SceneWorkBudget } from "../src/shared/SceneWorkBudget";

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).reverse().forEach(dispose => dispose());
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function sceneFixture() {
  const engine = new NullEngine(), scene = new Scene(engine);
  cleanup.push(() => engine.dispose(), () => scene.dispose());
  return scene;
}

function postedFixture() {
  const posted: Array<() => void> = [];
  const closed = vi.fn();
  vi.stubGlobal("MessageChannel", class {
    public port1 = { onmessage: undefined as (() => void) | undefined, close: closed };
    public port2 = { postMessage: () => { posted.push(() => this.port1.onmessage?.()); }, close: closed };
  });
  return { posted, closed };
}

describe("scene preparation budget", () => {
  it("coalesces startup wake-ups while retaining priority and a real CPU slice", async () => {
    const scene = sceneFixture();
    const { posted } = postedFixture();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const timers = vi.spyOn(globalThis, "setTimeout");
    const budget = new SceneWorkBudget(scene, 8, "posted");
    const order: string[] = [];
    const later = budget.checkpoint(() => 5)!.then(() => { order.push("later"); });
    const first = budget.checkpoint(() => 1)!.then(() => { order.push("first"); now = 8; });
    expect(posted).toHaveLength(1);
    posted[0]();
    await first;
    await Promise.resolve();
    expect(order).toEqual(["first"]);
    expect(posted).toHaveLength(2);
    expect(timers.mock.calls.some(([, delay]) => delay === 16)).toBe(false);
    posted[1](); await later;
    expect(order).toEqual(["first", "later"]);
  });

  it("retains the 16ms fallback for the default background budget", async () => {
    const scene = sceneFixture();
    const { posted } = postedFixture();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(performance, "now").mockReturnValue(0);
    const budget = new SceneWorkBudget(scene);
    const completed = vi.fn();
    const ready = budget.checkpoint(() => 0)!.then(completed);
    await vi.advanceTimersByTimeAsync(15);
    expect(completed).not.toHaveBeenCalled(); expect(posted).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); await ready;
    expect(completed).toHaveBeenCalledOnce();
  });

  it("settles posted waiters and closes both ports when the scene is disposed", async () => {
    const scene = sceneFixture();
    const { posted, closed } = postedFixture();
    vi.spyOn(performance, "now").mockReturnValue(0);
    const budget = new SceneWorkBudget(scene, 8, "posted");
    const completed = vi.fn();
    const ready = budget.checkpoint(() => 0)!.then(completed);
    scene.dispose(); await ready;
    expect(completed).toHaveBeenCalledOnce(); expect(closed).toHaveBeenCalledTimes(2);
    posted[0]();
    expect(posted).toHaveLength(1);
  });
});
