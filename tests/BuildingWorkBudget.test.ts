import { expect, it, vi } from "vitest";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { SceneWorkBudget } from "../src/shared/SceneWorkBudget.js";

it("shares a frame slice across producers and reprioritizes waiting work", async () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const scene = { onAfterRenderObservable: new Observable(), onDisposeObservable: new Observable() } as unknown as Scene;
    const budget = new SceneWorkBudget(scene, 1);
    const order: string[] = [];
    let a = 20, b = 10;
    const first = budget.checkpoint(() => a)!.then(() => { order.push("a"); now += 2; });
    const second = budget.checkpoint(() => b)!.then(() => { order.push("b"); now += 2; });
    a = 1; b = 20;
    scene.onAfterRenderObservable.notifyObservers(scene);
    await first;
    expect(order).toEqual(["a"]);
    scene.onAfterRenderObservable.notifyObservers(scene);
    await second;
    expect(order).toEqual(["a", "b"]);
    const cancelled = budget.checkpoint(() => 0)!;
    scene.onDisposeObservable.notifyObservers(scene);
    await cancelled;
    expect(budget.checkpoint(() => 0)).toBeUndefined();
    clock.mockRestore();
});

it("keeps stable priorities until the eye moves, then prioritizes the new nearest job", async () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const eye = { x: 0, y: 0, z: 0 };
    const scene = { activeCamera: { globalPosition: eye }, onAfterRenderObservable: new Observable(), onDisposeObservable: new Observable() } as unknown as Scene;
    const budget = new SceneWorkBudget(scene, 1);
    const order: number[] = [];
    const priorities = [0, 10, 20].map(x => vi.fn(() => Math.abs(x - eye.x)));
    const pending = priorities.map((priority, index) => budget.checkpoint(priority)!.then(() => { order.push(index); now += 2; }));
    scene.onAfterRenderObservable.notifyObservers(scene);
    await pending[0];
    const calls = priorities[2].mock.calls.length;
    scene.onAfterRenderObservable.notifyObservers(scene);
    await pending[1];
    expect(priorities[2].mock.calls.length).toBe(calls);
    const fourth = budget.checkpoint(() => Math.abs(100 - eye.x))!.then(() => { order.push(3); now += 2; });
    eye.x = 100;
    scene.onAfterRenderObservable.notifyObservers(scene);
    await fourth;
    expect(order).toEqual([0, 1, 3]);
    scene.onAfterRenderObservable.notifyObservers(scene);
    await pending[2];
    scene.onDisposeObservable.notifyObservers(scene);
    clock.mockRestore();
});

it("reorders waiting preparation when the camera turns in place", async () => {
    let now = 0, revision = 1, visible = "a";
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const camera = { globalPosition: {x:0,y:0,z:0}, getViewMatrix: () => undefined,
        getTransformationMatrix: () => ({updateFlag:revision}) };
    const scene = {activeCamera:camera, onAfterRenderObservable:new Observable(),
        onDisposeObservable:new Observable()} as unknown as Scene;
    const budget = new SceneWorkBudget(scene, 1);
    const order:string[]=[];
    scene.onAfterRenderObservable.notifyObservers(scene);
    now = 2;
    const a = budget.checkpoint(() => visible === "a" ? 0 : 100)!.then(() => {order.push("a");now += 2;});
    const b = budget.checkpoint(() => visible === "b" ? 0 : 100)!.then(() => {order.push("b");now += 2;});
    visible = "b";revision++;
    scene.onAfterRenderObservable.notifyObservers(scene);
    await b;
    expect(order).toEqual(["b"]);
    scene.onAfterRenderObservable.notifyObservers(scene);
    await a;
    scene.onDisposeObservable.notifyObservers(scene);
    clock.mockRestore();
});

it("runs urgent Google preparation ahead of nearer background building work", async () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const scene = { onAfterRenderObservable: new Observable(), onDisposeObservable: new Observable() } as unknown as Scene;
    const budget = new SceneWorkBudget(scene, 1);
    const order: string[] = [];
    const building = budget.checkpoint(() => 1)!.then(() => { order.push("building"); now += 2; });
    const google = budget.checkpoint(() => 1000, 0)!.then(() => { order.push("google"); now += 2; });
    scene.onAfterRenderObservable.notifyObservers(scene);
    await google;
    expect(order).toEqual(["google"]);
    scene.onAfterRenderObservable.notifyObservers(scene);
    await building;
    expect(order).toEqual(["google", "building"]);
    scene.onDisposeObservable.notifyObservers(scene);
    clock.mockRestore();
});
