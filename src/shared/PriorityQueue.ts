/** Stable priority heap; rebuild only when the ordering policy changes. */
export class PriorityQueue<T> {
    private entries: { value: T; sequence: number }[] = [];
    private sequence = 0;
    constructor(private compare: (a: T, b: T) => number) {}
    public get length(): number { return this.entries.length; }
    private before(a: number, b: number): boolean {
        const left = this.entries[a], right = this.entries[b];
        return (this.compare(left.value, right.value) || left.sequence - right.sequence) < 0;
    }
    public push(value: T): void {
        let index = this.entries.length;
        this.entries.push({ value, sequence: this.sequence++ });
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (!this.before(index, parent)) break;
            [this.entries[index], this.entries[parent]] = [this.entries[parent], this.entries[index]];
            index = parent;
        }
    }
    public shift(): T | undefined {
        if (!this.entries.length) return undefined;
        const first = this.entries[0].value;
        const last = this.entries.pop()!;
        if (this.entries.length) { this.entries[0] = last; this.sink(0); }
        return first;
    }
    public rebuild(): void {
        for (let index = (this.entries.length >> 1) - 1; index >= 0; index--) this.sink(index);
    }
    private sink(index: number): void {
        while (index * 2 + 1 < this.entries.length) {
            let child = index * 2 + 1;
            if (child + 1 < this.entries.length && this.before(child + 1, child)) child++;
            if (!this.before(child, index)) break;
            [this.entries[index], this.entries[child]] = [this.entries[child], this.entries[index]];
            index = child;
        }
    }
}
