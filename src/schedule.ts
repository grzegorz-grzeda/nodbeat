import { Cron } from "croner";
import { formatDuration } from "./format.js";
import type { Limits } from "./limits.js";
import { isValidTimeZone } from "./users.js";

/** A Monitor's Schedule: a 5-field expression read in an IANA time zone. */
export interface Schedule {
  cron: string;
  timeZone: string;
  /**
   * The shortest gap in seconds between two scheduled times, worked out on save; null if there are fewer than two a
   * year. Absent on Monitors stored before it was kept: see shortestGapSec().
   */
  shortestGapSec?: number | null;
}

/** Longest Schedule expression accepted, in characters. */
export const MAX_CRON_LENGTH = 200;

/**
 * One element of a field's comma list: `*`, a number or a three-letter name, optionally a range, optionally a step.
 * Anything else (`L`, `W`, `#`, `?`) is refused before the expression reaches croner, which accepts more.
 */
const ELEMENT = /^(\*|(\d+|[a-z]{3})(-(\d+|[a-z]{3}))?)(\/\d+)?$/i;

/** Days of the month, minutes and hours have no names. */
const NUMERIC_ELEMENT = /^(\*|\d+(-\d+)?)(\/\d+)?$/;

const FIELD_NAMES = ["minute", "hour", "day of month", "month", "day of week"];

/** Local days looked at to find a Schedule's shortest gap: a year, so both DST changes are in it. */
const GAP_SCAN_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Scheduled times are whole minutes: no gap is shorter. */
const SHORTEST_POSSIBLE_GAP_SEC = 60;

/** croner jobs by expression and time zone, least recently used first: the Down checker asks for the same few. */
const jobs = new Map<string, Cron>();
const MAX_CACHED_JOBS = 1000;

function job(schedule: Pick<Schedule, "cron" | "timeZone">): Cron {
  const key = `${schedule.timeZone} ${schedule.cron}`;
  let cron = jobs.get(key);
  if (cron) {
    jobs.delete(key);
  } else {
    cron = new Cron(schedule.cron, {
      timezone: schedule.timeZone,
      mode: "5-part",
      // As in crontab: a restricted day of month and day of week match either.
      domAndDow: false,
    });
    if (jobs.size >= MAX_CACHED_JOBS) jobs.delete(jobs.keys().next().value!);
  }
  jobs.set(key, cron);
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

/** The next `count` scheduled times strictly after `after`. Fewer if there are no more (e.g. 30 February). */
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
 * The shortest time in seconds between two scheduled times in the year of local days from the one `from` is in (so
 * across both DST changes), or null if there are fewer than two in it.
 *
 * Exact without visiting every scheduled time: each 24-hour local day the Schedule fires on has the same times of
 * day, so only the first such day and the days a DST change makes shorter or longer are walked through, plus the
 * gap from each day's last scheduled time to the next day's first.
 */
export function shortestGapSec(schedule: Schedule, from: Date): number | null {
  const times = job(schedule);
  const midnights = job({ cron: "0 0 * * *", timeZone: schedule.timeZone });
  let shortest: number | null = null;
  const consider = (gapSec: number | null) => {
    if (gapSec !== null && (shortest === null || gapSec < shortest)) {
      shortest = gapSec;
    }
  };
  const secBetween = (earlier: Date, later: Date) =>
    (later.getTime() - earlier.getTime()) / 1000;
  // The shortest gap within a 24-hour day (null: one scheduled time a day); undefined until one was walked through.
  let regularDayGap: number | null | undefined;
  let previousLast: Date | null = null;
  let dayStart =
    midnights.previousRuns(1, new Date(from.getTime() + 1))[0] ?? from;
  for (let day = 0; day < GAP_SCAN_DAYS; day++) {
    const dayEnd = midnights.nextRun(dayStart);
    if (!dayEnd) break;
    // Scheduled times are whole minutes: one second before dayStart is before any at dayStart.
    const first = times.nextRun(new Date(dayStart.getTime() - 1000));
    if (first && first < dayEnd) {
      if (previousLast) consider(secBetween(previousLast, first));
      const regular = dayEnd.getTime() - dayStart.getTime() === DAY_MS;
      let last = first;
      if (regular && regularDayGap !== undefined) {
        last = times.previousRuns(1, dayEnd)[0] ?? first;
        consider(regularDayGap);
      } else {
        let dayGap: number | null = null;
        for (
          let next = times.nextRun(last);
          next && next < dayEnd;
          next = times.nextRun(last)
        ) {
          const gap = secBetween(last, next);
          if (dayGap === null || gap < dayGap) dayGap = gap;
          last = next;
        }
        consider(dayGap);
        if (regular) regularDayGap = dayGap;
      }
      previousLast = last;
      if (shortest !== null && shortest <= SHORTEST_POSSIBLE_GAP_SEC) break;
    }
    dayStart = dayEnd;
  }
  return shortest;
}

/**
 * Checks a Schedule: a valid expression in a known time zone that has scheduled times, no two closer than the limit.
 * Returns the Schedule as stored, with its shortest gap, or the errors.
 */
export function checkSchedule(
  cron: string,
  timeZone: string,
  limits: Limits,
  now: Date,
): { schedule: Schedule } | { errors: string[] } {
  if (!isValidTimeZone(timeZone)) return { errors: ["Unknown time zone."] };
  if (cron.length > MAX_CRON_LENGTH) {
    return {
      errors: [`Schedule can be at most ${MAX_CRON_LENGTH} characters.`],
    };
  }
  const error = cronError(cron);
  if (error) return { errors: [error] };
  const parsed = { cron: normalizeCron(cron), timeZone };
  if (!nextScheduledTime(parsed, now)) {
    return { errors: ["Schedule has no scheduled times."] };
  }
  const gapSec = shortestGapSec(parsed, now);
  if (gapSec !== null && gapSec < limits.minScheduleGapSec) {
    return {
      errors: [
        `Schedule fires too often: its scheduled times must be at least ${formatDuration(limits.minScheduleGapSec)} apart, and some are ${formatDuration(gapSec)} apart.`,
      ],
    };
  }
  return { schedule: { ...parsed, shortestGapSec: gapSec } };
}
