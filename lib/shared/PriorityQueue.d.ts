/** Stable priority heap; rebuild only when the ordering policy changes. */
export declare class PriorityQueue<T> {
    private compare;
    private entries;
    private sequence;
    constructor(compare: (a: T, b: T) => number);
    get length(): number;
    private before;
    push(value: T): void;
    shift(): T | undefined;
    rebuild(): void;
    private sink;
}
