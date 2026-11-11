/** How often a Monitor can ask to be reminded while Down: every 1, 6 or 24 hours. */
export const REMINDER_CADENCES_SEC = [3600, 21600, 86400] as const;
export type ReminderEverySec = (typeof REMINDER_CADENCES_SEC)[number];

export const isReminderCadence = (sec: number): sec is ReminderEverySec =>
  (REMINDER_CADENCES_SEC as readonly number[]).includes(sec);

/** What decides whether and how often a Monitor is reminded. */
export interface ReminderSettings {
  /** Null: never. Absent on Monitors stored before Reminders existed: never. */
  reminderEverySec?: ReminderEverySec | null;
  alertsEnabled: boolean;
}

/** A cadence in hours, as Users pick it: "1 h", "6 h", "24 h". */
export const cadenceText = (everySec: ReminderEverySec): string =>
  `${everySec / 3600} h`;

/** "every 1 h while Down", or "never". */
export const reminderText = (monitor: ReminderSettings): string =>
  monitor.reminderEverySec != null
    ? `every ${cadenceText(monitor.reminderEverySec)} while Down`
    : "never";

/**
 * When a Monitor Down since (or reminded from) `from` gets its first Reminder: one cadence later. Null without
 * Reminders or with Alerts off.
 */
export function firstReminderAt(
  monitor: ReminderSettings,
  from: Date,
): Date | null {
  if (!monitor.alertsEnabled || monitor.reminderEverySec == null) return null;
  return new Date(from.getTime() + monitor.reminderEverySec * 1000);
}

/**
 * The Reminder after the one due at `due`, sent at `now`: the first time after `now` a whole number of cadences after
 * `due`. Times missed while nodbeat wasn't running are skipped, so a late tick sends one Reminder, never a burst.
 */
export function reminderAfter(due: Date, everySec: number, now: Date): Date {
  const everyMs = everySec * 1000;
  const slots = Math.floor((now.getTime() - due.getTime()) / everyMs) + 1;
  return new Date(due.getTime() + slots * everyMs);
}
