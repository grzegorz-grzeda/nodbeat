import type { Clock } from "./clock.js";

/** How often, at most, stale keys are swept once there are many. */
const SWEEP_EVERY_MS = 1000;

/** In-memory limiter: at most `max` acquisitions per key within any `windowMs`. */
export class SlidingWindowLimiter {
  readonly #hits = new Map<string, number[]>();
  #lastSweep = 0;

  constructor(
    readonly clock: Clock,
    readonly max: number,
    readonly windowMs: number,
  ) {}

  /**
   * Takes one acquisition for `key`, or returns false when it has none left. To count only some outcomes (e.g.
   * failures), acquire before the slow work and `release` on the outcomes that don't count: checking first and
   * recording afterwards would let parallel requests all pass the check.
   */
  tryAcquire(key: string): boolean {
    const now = this.clock.now().getTime();
    this.#maybeSweep(now);
    const hits = this.#recent(key, now);
    if (hits.length >= this.max) {
      this.#hits.set(key, hits);
      return false;
    }
    hits.push(now);
    this.#hits.set(key, hits);
    return true;
  }

  /** Gives back the newest acquisition of `key`. */
  release(key: string): void {
    const hits = this.#hits.get(key);
    if (!hits) return;
    hits.pop();
    if (hits.length === 0) this.#hits.delete(key);
  }

  #recent(key: string, now: number): number[] {
    return (this.#hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
  }

  #maybeSweep(now: number): void {
    if (this.#hits.size <= 1000 || now - this.#lastSweep < SWEEP_EVERY_MS) {
      return;
    }
    this.#lastSweep = now;
    for (const [key, hits] of this.#hits) {
      if (hits.every((t) => t <= now - this.windowMs)) this.#hits.delete(key);
    }
  }
}
