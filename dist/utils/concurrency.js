/** A small counting semaphore so the API never runs more than N Playwright sessions at once. */
export class Semaphore {
    max;
    available;
    queue = [];
    constructor(max) {
        this.max = max;
        if (!Number.isInteger(max) || max < 1)
            throw new Error("Semaphore max must be a positive integer.");
        this.available = max;
    }
    async acquire() {
        let released = false;
        const releaseOnce = () => {
            if (released)
                return;
            released = true;
            this.release();
        };
        if (this.available > 0) {
            this.available -= 1;
            return releaseOnce;
        }
        return new Promise((resolve) => {
            this.queue.push(() => {
                this.available -= 1;
                resolve(releaseOnce);
            });
        });
    }
    release() {
        this.available += 1;
        const next = this.queue.shift();
        if (next)
            next();
    }
    get inUse() {
        return this.max - this.available;
    }
}
//# sourceMappingURL=concurrency.js.map