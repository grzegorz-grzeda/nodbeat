import { Cron } from "croner";

/** A Monitor's Schedule: a 5-field cron expression read in an IANA time zone. */
export interface Schedule {
  cron: string;
  timeZone: string;
}

/**
 * One element of a cron field's comma list: `*`, a number or a three-letter name, optionally a range, optionally a
 * step. Anything else (`L`, `W`, `#`, `?`) is refused before the expression reaches croner, which accepts more.
 */
const ELEMENT = /^(\*|(\d+|[a-z]{3})(-(\d+|[a-z]{3}))?)(\/\d+)?$/i;

/** Days of the month, minutes and hours have no names. */
const NUMERIC_ELEMENT = /^(\*|\d+(-\d+)?)(\/\d+)?$/;

const FIELD_NAMES = ["minute", "hour", "day of month", "month", "day of week"];

/** Runs looked at to find a Schedule's shortest gap: about a year, or this many runs, whichever comes first. */
const GAP_SCAN_RUNS = 5000;
const GAP_SCAN_MS = 366 * 24 * 60 * 60 * 1000;

/** croner jobs by `cron` and time zone: the Down checker asks for the same few over and over. */
const jobs = new Map<string, Cron>();
const MAX_CACHED_JOBS = 1000;

function job(schedule: Schedule): Cron {
  const key = `${schedule.timeZone} ${schedule.cron}`;
  let cron = jobs.get(key);
  if (!cron) {
    cron = new Cron(schedule.cron, {
      timezone: schedule.timeZone,
      mode: "5-part",
      // Standard cron: a restricted day of month and day of week match either.
      domAndDow: false,
    });
    if (jobs.size >= MAX_CACHED_JOBS) jobs.clear();
    jobs.set(key, cron);
  }
  return cron;
}

/** Why `cron` isn't a 5-field expression nodbeat accepts, or null if it is. */
export function cronError(cron: string): string | null {
  const fields = cron.trim().split(/\s+/);
  if (cron.trim() === "" || fields.length !== 5) {
    return "Schedule must have 5 fields: minute, hour, day of month, month and day of week.";
  }
  for (const [i, field] of fields.entries()) {
    const pattern = i === 3 || i === 4 ? ELEMENT : NUMERIC_ELEMENT;
    if (!field.split(",").every((e) => pattern.test(e))) {
      return `Schedule has an invalid ${FIELD_NAMES[i]} field: ${field}.`;
    }
  }
  try {
    new Cron(fields.join(" "), { mode: "5-part", timezone: "UTC" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return `Schedule is not a valid cron expression (${detail.replace(/^CronPattern: /, "")}).`;
  }
  return null;
}

/** The expression as stored: fields separated by single spaces. */
export function normalizeCron(cron: string): string {
  return cron.trim().split(/\s+/).join(" ");
}

/** The next `count` scheduled times strictly after `after`. Fewer if the Schedule runs out (e.g. 30 February). */
export function scheduledTimesAfter(
  schedule: Schedule,
  after: Date,
  count: number,
): Date[] {
  return job(schedule).nextRuns(count, after);
}

/** The first scheduled time strictly after `after`, or null if there is none. */
export function nextScheduledTime(
  schedule: Schedule,
  after: Date,
): Date | null {
  return job(schedule).nextRun(after);
}

/** The last scheduled time at or before `at`, or null if there is none. */
export function previousScheduledTime(
  schedule: Schedule,
  at: Date,
): Date | null {
  return job(schedule).previousRuns(1, new Date(at.getTime() + 1))[0] ?? null;
}

/**
 * The shortest time in seconds between two scheduled times in about a year from `from` (so across both DST changes),
 * or null if the Schedule runs less than twice in it.
 */
export function shortestGapSec(schedule: Schedule, from: Date): number | null {
  const end = from.getTime() + GAP_SCAN_MS;
  let previous: Date | null = null;
  let shortest: number | null = null;
  for (const run of job(schedule).nextRuns(GAP_SCAN_RUNS, from)) {
    if (run.getTime() > end) break;
    if (previous) {
      const gap = (run.getTime() - previous.getTime()) / 1000;
      if (shortest === null || gap < shortest) shortest = gap;
      if (shortest <= 60) break; // Cron's finest step: nothing shorter can follow.
    }
    previous = run;
  }
  return shortest;
}
