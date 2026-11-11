import { formatDateTime, formatDuration } from "./format.js";
import { csrfField, html, timeZoneOptions, type SafeHtml } from "./html.js";
import { defaultGraceSec, type Limits } from "./limits.js";
import type { MonitorTiming } from "./monitor-state.js";
import type { ObjectId } from "mongodb";
import {
  choiceOf,
  type AlertChannelChoice,
  type MonitorAlertChannels,
} from "./monitor-alert-channels.js";
import {
  cronError,
  normalizeCron,
  scheduledTimesAfter,
  shortestGapSec,
  type Schedule,
} from "./schedule.js";
import { isValidTimeZone } from "./users.js";

const MAX_NAME_LENGTH = 100;
const MAX_NOTES_LENGTH = 2000;
const MAX_CRON_LENGTH = 200;
const UNIT_SEC = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 } as const;
type Unit = keyof typeof UNIT_SEC;

/** Shows the Interval or Schedule fields as chosen and previews the Schedule; the form works without it. */
export const MONITOR_FORM_SCRIPT = "schedule.js";

/** Scheduled times the form shows for a Schedule. */
export const SCHEDULE_PREVIEW_COUNT = 3;

export interface MonitorForm {
  name: string;
  /** "interval", or "schedule" for `cron` in `timeZone`. */
  timing: string;
  interval: string;
  intervalUnit: string;
  cron: string;
  timeZone: string;
  grace: string;
  graceUnit: string;
  maxRunTime: string;
  maxRunTimeUnit: string;
  notes: string;
  /** "all", or "chosen" for the channels in `alertChannelIds`. */
  alertChannels: string;
  alertChannelIds: string[];
}

/** An Alert channel the form offers. */
export interface ChannelOption {
  _id: ObjectId;
  name: string;
}

/**
 * What the form edits. `validate` always sets `maxRunTimeSec` (null: none) and both `intervalSec` and `schedule` (one
 * of them null), so saving clears a removed one.
 */
export interface MonitorSettings extends MonitorTiming, AlertChannelChoice {
  name: string;
  notes: string;
  schedule: Schedule | null;
  alertChannels: MonitorAlertChannels;
}

/** The submitted form; `defaultTimeZone` (the owner's) when no time zone was sent. */
export function readForm(body: unknown, defaultTimeZone: string): MonitorForm {
  const b = (body ?? {}) as Record<string, unknown>;
  const field = (name: string) =>
    typeof b[name] === "string" ? (b[name] as string) : "";
  return {
    name: field("name"),
    timing: field("timing") === "schedule" ? "schedule" : "interval",
    interval: field("interval"),
    intervalUnit: field("intervalUnit") || "s",
    cron: field("cron"),
    timeZone: field("timeZone") || defaultTimeZone,
    grace: field("grace"),
    graceUnit: field("graceUnit") || "s",
    maxRunTime: field("maxRunTime"),
    maxRunTimeUnit: field("maxRunTimeUnit") || "m",
    notes: field("notes"),
    alertChannels: field("alertChannels") === "chosen" ? "chosen" : "all",
    alertChannelIds: (Array.isArray(b.alertChannelIds)
      ? (b.alertChannelIds as unknown[])
      : [b.alertChannelIds]
    ).filter((v): v is string => typeof v === "string"),
  };
}

/**
 * The form values that show these settings, in the largest unit that divides each duration evenly. An Interval
 * Monitor's Schedule fields start at the owner's time zone, ready for a switch.
 */
export function formFor(
  monitor: MonitorTiming & AlertChannelChoice & { name: string; notes: string },
  defaultTimeZone: string,
): MonitorForm {
  const split = (sec: number): [string, Unit] => {
    const unit =
      (["d", "h", "m", "s"] as const).find(
        (u) => sec > 0 && sec % UNIT_SEC[u] === 0,
      ) ?? "s";
    return [String(sec / UNIT_SEC[unit]), unit];
  };
  const [interval, intervalUnit] =
    monitor.intervalSec != null ? split(monitor.intervalSec) : ["", "s"];
  const [grace, graceUnit] = split(monitor.graceSec);
  const [maxRunTime, maxRunTimeUnit] =
    monitor.maxRunTimeSec != null ? split(monitor.maxRunTimeSec) : ["", "m"];
  return {
    name: monitor.name,
    timing: monitor.schedule ? "schedule" : "interval",
    interval,
    intervalUnit,
    cron: monitor.schedule?.cron ?? "",
    timeZone: monitor.schedule?.timeZone ?? defaultTimeZone,
    grace,
    graceUnit,
    maxRunTime,
    maxRunTimeUnit,
    notes: monitor.notes,
    ...alertChannelsForm(choiceOf(monitor)),
  };
}

function alertChannelsForm(
  choice: MonitorAlertChannels,
): Pick<MonitorForm, "alertChannels" | "alertChannelIds"> {
  return choice === "all"
    ? { alertChannels: "all", alertChannelIds: [] }
    : { alertChannels: "chosen", alertChannelIds: choice.map(String) };
}

function toSeconds(value: string, unit: string): number | null {
  if (!/^\d+$/.test(value.trim()) || !(unit in UNIT_SEC)) return null;
  return Number(value.trim()) * UNIT_SEC[unit as Unit];
}

/**
 * Checks a Schedule: a valid expression in a known time zone that runs, with no two scheduled times closer than the
 * limit. Returns the Schedule as stored and its shortest gap (null if it runs less than twice a year), or the errors.
 */
export function checkSchedule(
  cron: string,
  timeZone: string,
  limits: Limits,
  now: Date,
): { schedule: Schedule; gapSec: number | null } | { errors: string[] } {
  if (!isValidTimeZone(timeZone)) return { errors: ["Unknown time zone."] };
  if (cron.length > MAX_CRON_LENGTH) {
    return {
      errors: [`Schedule can be at most ${MAX_CRON_LENGTH} characters.`],
    };
  }
  const error = cronError(cron);
  if (error) return { errors: [error] };
  const schedule = { cron: normalizeCron(cron), timeZone };
  if (scheduledTimesAfter(schedule, now, 1).length === 0) {
    return { errors: ["Schedule never runs."] };
  }
  const gapSec = shortestGapSec(schedule, now);
  if (gapSec !== null && gapSec < limits.minScheduleGapSec) {
    return {
      errors: [
        `Schedule runs too often: its scheduled times must be at least ${formatDuration(limits.minScheduleGapSec)} apart, and some are ${formatDuration(gapSec)} apart.`,
      ],
    };
  }
  return { schedule, gapSec };
}

/** The next scheduled times of a Schedule as the form shows them ("2026-01-02 02:00", in its time zone), or errors. */
export function schedulePreview(
  cron: string,
  timeZone: string,
  limits: Limits,
  now: Date,
): { times: string[] } | { errors: string[] } {
  const result = checkSchedule(cron, timeZone, limits, now);
  if ("errors" in result) return result;
  return {
    times: scheduledTimesAfter(
      result.schedule,
      now,
      SCHEDULE_PREVIEW_COUNT,
    ).map((t) => formatDateTime(t, timeZone).slice(0, 16)),
  };
}

/** Checks the form; chosen Alert channels must be among `ownChannels`, the owner's. */
export function validate(
  form: MonitorForm,
  limits: Limits,
  ownChannels: ChannelOption[],
  now: Date,
): { settings: MonitorSettings } | { errors: string[] } {
  const errors: string[] = [];
  const name = form.name.trim();
  const notes = form.notes.trim();
  if (!name) errors.push("Name is required.");
  if (name.length > MAX_NAME_LENGTH) {
    errors.push(`Name can be at most ${MAX_NAME_LENGTH} characters.`);
  }
  if (notes.length > MAX_NOTES_LENGTH) {
    errors.push(`Notes can be at most ${MAX_NOTES_LENGTH} characters.`);
  }

  let intervalSec: number | null = null;
  let schedule: Schedule | null = null;
  // What the default Grace period is half of; null when the timing is invalid.
  let periodSec: number | null = null;
  if (form.timing === "schedule") {
    const result = checkSchedule(form.cron, form.timeZone, limits, now);
    if ("errors" in result) {
      errors.push(...result.errors);
    } else {
      schedule = result.schedule;
      // Less than twice a year: the Grace period default is clamped anyway.
      periodSec = result.gapSec ?? Infinity;
    }
  } else {
    intervalSec = toSeconds(form.interval, form.intervalUnit);
    if (
      intervalSec === null ||
      intervalSec < limits.minIntervalSec ||
      intervalSec > limits.maxIntervalSec
    ) {
      errors.push(
        `Interval must be between ${formatDuration(limits.minIntervalSec)} and ${formatDuration(limits.maxIntervalSec)}.`,
      );
    } else {
      periodSec = intervalSec;
    }
  }

  let graceSec: number | null;
  if (form.grace.trim() === "") {
    graceSec = periodSec === null ? null : defaultGraceSec(periodSec, limits);
  } else {
    graceSec = toSeconds(form.grace, form.graceUnit);
    if (
      graceSec === null ||
      graceSec < limits.minGraceSec ||
      graceSec > limits.maxGraceSec
    ) {
      errors.push(
        `Grace period must be between ${formatDuration(limits.minGraceSec)} and ${formatDuration(limits.maxGraceSec)}.`,
      );
    }
  }

  let maxRunTimeSec: number | null = null;
  if (form.maxRunTime.trim() !== "") {
    maxRunTimeSec = toSeconds(form.maxRunTime, form.maxRunTimeUnit);
    if (
      maxRunTimeSec === null ||
      maxRunTimeSec < limits.minMaxRunTimeSec ||
      maxRunTimeSec > limits.maxMaxRunTimeSec
    ) {
      errors.push(
        `Max run time must be between ${formatDuration(limits.minMaxRunTimeSec)} and ${formatDuration(limits.maxMaxRunTimeSec)}.`,
      );
    }
  }

  let alertChannels: MonitorAlertChannels = "all";
  if (form.alertChannels === "chosen") {
    const own = new Map(ownChannels.map((c) => [String(c._id), c._id]));
    const chosen = [...new Set(form.alertChannelIds)];
    if (chosen.every((id) => own.has(id))) {
      alertChannels = chosen.map((id) => own.get(id)!);
    } else {
      errors.push("Choose only your own Alert channels.");
    }
  }

  if (errors.length > 0 || periodSec === null || graceSec === null) {
    return { errors };
  }
  return {
    settings: {
      name,
      notes,
      intervalSec,
      schedule,
      graceSec,
      maxRunTimeSec,
      alertChannels,
    },
  };
}

/** The create form, or the edit form when `editing` is the Monitor's id. */
export function monitorFormBody(options: {
  csrf: string;
  form: MonitorForm;
  limits: Limits;
  /** The owner's Alert channels, to choose from. */
  channels: ChannelOption[];
  /** For the Schedule preview shown before any typing (or without JS). */
  now: Date;
  errors?: string[];
  editing?: string;
}): SafeHtml {
  const { csrf, form, limits, channels, now, errors = [], editing } = options;
  const chosen = form.alertChannels === "chosen";
  const scheduled = form.timing === "schedule";
  const checked = new Set(form.alertChannelIds);
  const unitSelect = (name: string, selected: string) =>
    html`<select name="${name}">
      ${(
        [
          ["s", "seconds"],
          ["m", "minutes"],
          ["h", "hours"],
          ["d", "days"],
        ] as const
      ).map(
        ([value, label]) =>
          html`<option
            value="${value}"
            ${value === selected ? html`selected` : ""}
          >
            ${label}
          </option>`,
      )}
    </select>`;
  const preview =
    form.cron.trim() === ""
      ? null
      : schedulePreview(form.cron, form.timeZone, limits, now);
  return html`<p>
      ${
        editing
          ? html`<a href="/monitors/${editing}">← Back</a>`
          : html`<a href="/">← Dashboard</a>`
      }
    </p>
    <h1>${editing ? "Edit Monitor" : "New Monitor"}</h1>
    ${errors.map((e) => html`<p class="error">${e}</p>`)}
    <form
      method="post"
      action="${editing ? `/monitors/${editing}/edit` : "/monitors"}"
    >
      ${csrfField(csrf)}
      <label
        >Name
        <input
          type="text"
          name="name"
          value="${form.name}"
          maxlength="${MAX_NAME_LENGTH}"
          required
      /></label>
      <fieldset class="timing">
        <legend>When Heartbeats are expected</legend>
        <label
          ><input
            type="radio"
            name="timing"
            value="interval"
            ${scheduled ? "" : html`checked`}
          />
          Every Interval</label
        >
        <label class="timing-detail" data-timing="interval"
          >Interval (${formatDuration(limits.minIntervalSec)} to
          ${formatDuration(limits.maxIntervalSec)})
          <input
            type="number"
            name="interval"
            value="${form.interval}"
            min="1"
          />
          ${unitSelect("intervalUnit", form.intervalUnit)}</label
        >
        <label
          ><input
            type="radio"
            name="timing"
            value="schedule"
            ${scheduled ? html`checked` : ""}
          />
          On a Schedule</label
        >
        <div class="timing-detail" data-timing="schedule">
          <label
            >Schedule (cron: minute, hour, day of month, month, day of week;
            e.g. <code>0 2 * * *</code> for 02:00 every day)
            <input
              type="text"
              name="cron"
              id="schedule-cron"
              value="${form.cron}"
              maxlength="${MAX_CRON_LENGTH}"
              autocomplete="off"
              spellcheck="false"
          /></label>
          <label
            >Time zone
            <select name="timeZone" id="schedule-time-zone">
              ${timeZoneOptions(form.timeZone)}
            </select></label
          >
          <div id="schedule-preview" aria-live="polite">
            ${schedulePreviewBody(preview)}
          </div>
        </div>
      </fieldset>
      <label
        >Grace period (up to ${formatDuration(limits.maxGraceSec)}; leave empty
        for half the Interval, or half the shortest gap between scheduled times)
        <input type="number" name="grace" value="${form.grace}" min="0" />
        ${unitSelect("graceUnit", form.graceUnit)}</label
      >
      <label
        >Max run time (optional, ${formatDuration(limits.minMaxRunTimeSec)} to
        ${formatDuration(limits.maxMaxRunTimeSec)}; a longer Run makes the
        Monitor Down)
        <input
          type="number"
          name="maxRunTime"
          value="${form.maxRunTime}"
          min="1"
        />
        ${unitSelect("maxRunTimeUnit", form.maxRunTimeUnit)}</label
      >
      <label
        >Notes (optional)
        <textarea name="notes" rows="3" maxlength="${MAX_NOTES_LENGTH}">
${form.notes}</textarea>
      </label>
      <fieldset class="alert-channels">
        <legend>Alert channels</legend>
        <label
          ><input
            type="radio"
            name="alertChannels"
            value="all"
            ${chosen ? "" : html`checked`}
          />
          All Alert channels, including ones added later</label
        >
        <label
          ><input
            type="radio"
            name="alertChannels"
            value="chosen"
            ${chosen ? html`checked` : ""}
          />
          Only these:</label
        >
        ${
          channels.length === 0
            ? html`<p>
                <small
                  >No Alert channels yet. Add one in
                  <a href="/settings">Settings</a>.</small
                >
              </p>`
            : channels.map(
                (c) =>
                  html`<label class="channel-choice"
                    ><input
                      type="checkbox"
                      name="alertChannelIds"
                      value="${String(c._id)}"
                      ${checked.has(String(c._id)) ? html`checked` : ""}
                    />
                    ${c.name}</label
                  >`,
              )
        }
      </fieldset>
      <button type="submit">${editing ? "Save" : "Create Monitor"}</button>
    </form>`;
}

/** The preview's content; `assets/schedule.js` builds the same markup from `/monitors/schedule-preview`. */
function schedulePreviewBody(
  preview: { times: string[] } | { errors: string[] } | null,
): SafeHtml {
  if (!preview) return html``;
  if ("errors" in preview) {
    return html`${preview.errors.map((e) => html`<p class="error">${e}</p>`)}`;
  }
  return html`<p>Next scheduled times:</p>
    <ul class="plain">
      ${preview.times.map((t) => html`<li>${t}</li>`)}
    </ul>`;
}
