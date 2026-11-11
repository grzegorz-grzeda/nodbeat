import type { Db, ObjectId } from "mongodb";
import { setNextReminder } from "./incidents.js";

/** How often a Monitor can ask to be reminded while Down: every 1, 6 or 24 hours. */
export const REMINDER_CADENCES_SEC = [3600, 21600, 86400] as const;
export type ReminderEverySec = (typeof REMINDER_CADENCES_SEC)[number];

export const isReminderCadence = (sec: number): sec is ReminderEverySec =>
  (REMINDER_CADENCES_SEC as readonly number[]).includes(sec);

/** What decides whether and how often a Monitor is reminded. */
export interface ReminderSettings {
  /** How often a Reminder repeats the Down Alert while Down; null: never. Absent on Monitors stored before Reminders
   * existed: never. */
  reminderEverySec?: ReminderEverySec | null;
  alertsEnabled: boolean;
}

/** A cadence as Users pick it: "every 1 h while Down". */
export const cadenceText = (everySec: ReminderEverySec): string =>
  `every ${everySec / 3600} h while Down`;

/** "every 1 h while Down", or "never". */
export const reminderText = (monitor: ReminderSettings): string =>
  monitor.reminderEverySec != null
    ? cadenceText(monitor.reminderEverySec)
    : "never";

/**
 * When a Monitor Down since (or reminded from) `from` is next reminded: one cadence later. Null without Reminders or
 * with Alerts off.
 */
export function nextReminderFrom(
  monitor: ReminderSettings,
  from: Date,
): Date | null {
  if (!monitor.alertsEnabled || monitor.reminderEverySec == null) return null;
  return new Date(from.getTime() + monitor.reminderEverySec * 1000);
}

/**
 * Re-times the open Incident's next Reminder, if any, after the Monitor's Reminder settings changed at `now`: a changed
 * cadence, or Alerts switched on, counts from `now`; Never or Alerts off stops them. Unchanged settings keep the timing.
 */
export async function rescheduleReminder(
  db: Db,
  monitorId: ObjectId,
  before: ReminderSettings,
  after: ReminderSettings,
  now: Date,
): Promise<void> {
  if (
    (before.reminderEverySec ?? null) === (after.reminderEverySec ?? null) &&
    before.alertsEnabled === after.alertsEnabled
  ) {
    return;
  }
  await setNextReminder(db, monitorId, nextReminderFrom(after, now));
}

/**
 * The Reminder after the one due at `due`, sent at `now`: the first time after `now` a whole number of cadences after
 * `due`. Times missed while nodbeat wasn't running are skipped, so a late tick sends one Reminder, never a burst.
 */
export function reminderAfter(
  due: Date,
  everySec: ReminderEverySec,
  now: Date,
): Date {
  const everyMs = everySec * 1000;
  const slots = Math.floor((now.getTime() - due.getTime()) / everyMs) + 1;
  return new Date(due.getTime() + slots * everyMs);
}
