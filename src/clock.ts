/** Source of "now". Injected so tests can move time explicitly. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
