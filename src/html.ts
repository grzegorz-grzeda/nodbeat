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
