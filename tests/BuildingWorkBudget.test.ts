import { expect, it, vi } from "vitest";
import { Observable } from "@babylonjs/core/Misc/observable.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { BuildingWorkBudget } from "../src/buildings/BuildingWorkBudget.js";

it("shares a frame slice across producers and reprioritizes waiting work", async () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const scene = { onAfterRenderObservable: new Observable(), onDisposeObservable: new Observable() } as unknown as Scene;
    const budget = new BuildingWorkBudget(scene, 1);
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
