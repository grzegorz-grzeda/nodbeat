import type { Clock } from "./clock.js";

/** In-memory limiter: at most `max` acquisitions per key within any `windowMs`. */
export class SlidingWindowLimiter {
  readonly #hits = new Map<string, number[]>();

  constructor(
    readonly clock: Clock,
    readonly max: number,
    readonly windowMs: number,
  ) {}

  tryAcquire(key: string): boolean {
    const now = this.clock.now().getTime();
    if (this.#hits.size > 1000) this.#sweep(now);
    const hits = (this.#hits.get(key) ?? []).filter(
      (t) => t > now - this.windowMs,
    );
    if (hits.length >= this.max) {
      this.#hits.set(key, hits);
      return false;
    }
    hits.push(now);
    this.#hits.set(key, hits);
    return true;
  }

  #sweep(now: number): void {
    for (const [key, hits] of this.#hits) {
      if (hits.every((t) => t <= now - this.windowMs)) this.#hits.delete(key);
    }
  }
}
