/**
 * Runs work for one key at a time, in arrival order; different keys run in parallel. Keyed by Monitor it keeps
 * Heartbeat intake and the Down checker from acting on a stale read of the same Monitor; keyed by User it keeps
 * parallel creates from passing the Monitor limit. In memory: nodbeat is a single process (ADR 0002).
 */
export class KeyedLock {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => (release = resolve));
    this.#tails.set(key, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}
