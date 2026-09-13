/** Stable priority heap; rebuild only when the ordering policy changes. */
export class PriorityQueue {
    compare;
    entries = [];
    sequence = 0;
    constructor(compare) {
        this.compare = compare;
    }
    get length() { return this.entries.length; }
    before(a, b) {
        const left = this.entries[a], right = this.entries[b];
        return (this.compare(left.value, right.value) || left.sequence - right.sequence) < 0;
    }
    push(value) {
        let index = this.entries.length;
        this.entries.push({ value, sequence: this.sequence++ });
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (!this.before(index, parent))
                break;
            [this.entries[index], this.entries[parent]] = [this.entries[parent], this.entries[index]];
            index = parent;
        }
    }
    shift() {
        if (!this.entries.length)
            return undefined;
        const first = this.entries[0].value;
        const last = this.entries.pop();
        if (this.entries.length) {
            this.entries[0] = last;
            this.sink(0);
        }
        return first;
    }
    rebuild() {
        for (let index = (this.entries.length >> 1) - 1; index >= 0; index--)
            this.sink(index);
    }
    sink(index) {
        while (index * 2 + 1 < this.entries.length) {
            let child = index * 2 + 1;
            if (child + 1 < this.entries.length && this.before(child + 1, child))
                child++;
            if (!this.before(child, index))
                break;
            [this.entries[index], this.entries[child]] = [this.entries[child], this.entries[index]];
            index = child;
        }
    }
}
//# sourceMappingURL=PriorityQueue.js.map