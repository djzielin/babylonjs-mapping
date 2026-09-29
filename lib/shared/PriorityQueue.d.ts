/** Stable priority heap; rebuild only when the ordering policy changes. */
export declare class PriorityQueue<T> {
    private compare;
    private entries;
    private sequence;
    constructor(compare: (a: T, b: T) => number);
    get length(): number;
    peek(): T | undefined;
    clear(): void;
    /** Replace a changed-priority backlog with one linear-time heap build. */
    replaceAll(values: Iterable<T>): void;
    private before;
    push(value: T): void;
    shift(): T | undefined;
    rebuild(): void;
    private sink;
}
