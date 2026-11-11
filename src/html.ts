/** HTML that is already safe to emit. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type Interpolation = SafeHtml | string | number | undefined | null | false;

/** Tagged template that escapes every interpolated value unless it is SafeHtml (or an array of it). */
export function html(
  strings: TemplateStringsArray,
  ...values: Array<Interpolation | Interpolation[]>
): SafeHtml {
  let out = strings[0] ?? "";
  values.forEach((value, i) => {
    const parts = Array.isArray(value) ? value : [value];
    for (const part of parts) {
      if (part instanceof SafeHtml) out += part.value;
      else if (part !== undefined && part !== null && part !== false) {
        out += escapeHtml(String(part));
      }
    }
    out += strings[i + 1] ?? "";
  });
  return new SafeHtml(out);
}

export function csrfField(token: string): SafeHtml {
  return html`<input type="hidden" name="_csrf" value="${token}" />`;
}

/** Every IANA time zone the runtime knows, plus `current` in case it's an alias missing from that list. */
export function timeZoneOptions(current: string): SafeHtml[] {
  const zones = Intl.supportedValuesOf("timeZone");
  if (!zones.includes(current)) zones.unshift(current);
  return zones.map(
    (z) =>
      html`<option value="${z}" ${z === current && html`selected`}>
        ${z}
      </option>`,
  );
}

/** Copies the text of the element with this id; `assets/copy.js` reveals and wires it. */
export function copyButton(target: string): SafeHtml {
  return html`<button
    type="button"
    class="secondary copy"
    data-copy="${target}"
    hidden
  >
    Copy
  </button>`;
}
