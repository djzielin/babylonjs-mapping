import { expect, it } from "vitest";
import { PriorityQueue } from "../src/shared/PriorityQueue";

it("retains stable order with interleaved insertion and removal", () => {
    const compare = (a: { priority: number }, b: { priority: number }) => a.priority - b.priority;
    const queue = new PriorityQueue<{ priority: number; id: number }>(compare);
    const expected: { priority: number; id: number }[] = [];
    for (let i = 0; i < 10000; i++) {
        const value = { priority: (i * 7919) % 127, id: i };
        queue.push(value); expected.push(value);
        if (i % 3 === 0) {
            expected.sort(compare);
            expect(queue.shift()).toBe(expected.shift());
        }
    }
    expected.sort(compare);
    for (const value of expected) expect(queue.shift()).toBe(value);
    expect(queue.length).toBe(0); expect(queue.shift()).toBeUndefined();
});

it("reorders existing work when the camera priority policy changes", () => {
    let eye = 0;
    const queue = new PriorityQueue<number>((a, b) => Math.abs(a - eye) - Math.abs(b - eye));
    [1, 9, 3, 7].forEach(value => queue.push(value));
    expect(queue.shift()).toBe(1);
    eye = 10; queue.rebuild();
    expect([queue.shift(), queue.shift(), queue.shift()]).toEqual([9, 7, 3]);
});
