/** A small counting semaphore so the API never runs more than N Playwright sessions at once. */
export class Semaphore {
  private available: number;
  private queue: (() => void)[] = [];

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new Error("Semaphore max must be a positive integer.");
    this.available = max;
  }

  async acquire(): Promise<() => void> {
    let released = false;
    const releaseOnce = () => {
      if (released) return;
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

  private release(): void {
    this.available += 1;
    const next = this.queue.shift();
    if (next) next();
  }

  get inUse(): number {
    return this.max - this.available;
  }
}
