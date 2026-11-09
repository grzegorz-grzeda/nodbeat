/**
 * Runs read → transition → write → effects for one Monitor at a time, so Heartbeat intake and the Down checker
 * never act on a stale read of the same Monitor. In memory: nodbeat is a single process (ADR 0002).
 */
export class MonitorLock {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(monitorId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(monitorId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => (release = resolve));
    this.#tails.set(monitorId, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.#tails.get(monitorId) === tail) this.#tails.delete(monitorId);
    }
  }
}
