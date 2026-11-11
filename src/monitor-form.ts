import { formatDuration } from "./format.js";
import { csrfField, html, type SafeHtml } from "./html.js";
import { defaultGraceSec, type Limits } from "./limits.js";
import type { MonitorTiming } from "./monitor-state.js";
import type { ObjectId } from "mongodb";
import {
  choiceOf,
  type AlertChannelChoice,
  type MonitorAlertChannels,
} from "./monitor-alert-channels.js";

const MAX_NAME_LENGTH = 100;
const MAX_NOTES_LENGTH = 2000;
const UNIT_SEC = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 } as const;
type Unit = keyof typeof UNIT_SEC;

export interface MonitorForm {
  name: string;
  interval: string;
  intervalUnit: string;
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

/** What the form edits. `validate` always sets `maxRunTimeSec` (null: none), so saving clears a removed one. */
export interface MonitorSettings extends MonitorTiming, AlertChannelChoice {
  name: string;
  notes: string;
  alertChannels: MonitorAlertChannels;
}

export function readForm(body: unknown): MonitorForm {
  const b = (body ?? {}) as Record<string, unknown>;
  const field = (name: string) =>
    typeof b[name] === "string" ? (b[name] as string) : "";
  return {
    name: field("name"),
    interval: field("interval"),
    intervalUnit: field("intervalUnit") || "s",
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

/** The form values that show these settings, in the largest unit that divides each duration evenly. */
export function formFor(
  monitor: MonitorTiming & AlertChannelChoice & { name: string; notes: string },
): MonitorForm {
  const split = (sec: number): [string, Unit] => {
    const unit =
      (["d", "h", "m", "s"] as const).find(
        (u) => sec > 0 && sec % UNIT_SEC[u] === 0,
      ) ?? "s";
    return [String(sec / UNIT_SEC[unit]), unit];
  };
  const [interval, intervalUnit] = split(monitor.intervalSec);
  const [grace, graceUnit] = split(monitor.graceSec);
  const [maxRunTime, maxRunTimeUnit] =
    monitor.maxRunTimeSec != null ? split(monitor.maxRunTimeSec) : ["", "m"];
  return {
    name: monitor.name,
    interval,
    intervalUnit,
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

/** Checks the form; chosen Alert channels must be among `ownChannels`, the owner's. */
export function validate(
  form: MonitorForm,
  limits: Limits,
  ownChannels: ChannelOption[],
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

  const intervalSec = toSeconds(form.interval, form.intervalUnit);
  if (
    intervalSec === null ||
    intervalSec < limits.minIntervalSec ||
    intervalSec > limits.maxIntervalSec
  ) {
    errors.push(
      `Interval must be between ${formatDuration(limits.minIntervalSec)} and ${formatDuration(limits.maxIntervalSec)}.`,
    );
  }

  let graceSec: number | null;
  if (form.grace.trim() === "") {
    graceSec =
      intervalSec === null ? null : defaultGraceSec(intervalSec, limits);
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

  if (errors.length > 0 || intervalSec === null || graceSec === null) {
    return { errors };
  }
  return {
    settings: {
      name,
      notes,
      intervalSec,
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
  errors?: string[];
  editing?: string;
}): SafeHtml {
  const { csrf, form, limits, channels, errors = [], editing } = options;
  const chosen = form.alertChannels === "chosen";
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
      <label
        >Interval (${formatDuration(limits.minIntervalSec)} to
        ${formatDuration(limits.maxIntervalSec)})
        <input
          type="number"
          name="interval"
          value="${form.interval}"
          min="1"
          required
        />
        ${unitSelect("intervalUnit", form.intervalUnit)}</label
      >
      <label
        >Grace period (up to ${formatDuration(limits.maxGraceSec)}; leave empty
        for half the Interval)
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
