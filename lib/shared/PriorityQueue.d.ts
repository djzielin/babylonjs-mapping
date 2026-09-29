/** Stable priority heap; rebuild only when the ordering policy changes. */
export declare class PriorityQueue<T> {
    private compare;
    private entries;
    private sequence;
    constructor(compare: (a: T, b: T) => number);
    get length(): number;
    peek(): T | undefined;
    clear(): void;
    private before;
    push(value: T): void;
    shift(): T | undefined;
    rebuild(): void;
    private sink;
}
